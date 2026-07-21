// embedding.worker.js
import { pipeline, env } from "@xenova/transformers";

// 允许从本地或者 CDN 加载量化模型
env.allowLocalModels = false;

let extractor = null;

// 初始化模型
let isInitializing = false; // 🌟 增加锁，防止多个请求同时触发初始化 
const ESTIMATED_GTE_SMALL_SIZE = 29360128; // 约 28MB

async function initModel() {
  if (extractor) return extractor;
  
  if (isInitializing) {
    while (!extractor) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return extractor;
  }

  isInitializing = true;

  // 🌟 1. 劫持控制台：在加载期间静默 content-length 警告
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('content-length')) return;
    originalWarn.apply(console, args);
  };

  try {
    extractor = await pipeline('feature-extraction', 'Supabase/gte-small', {
      quantized: true,
      progress_callback: (data) => {
        // 🌟 2. 进度条补丁逻辑（保持你写的，很棒）
        if (!data.total || data.total <= 0) {
          data.total = ESTIMATED_GTE_SMALL_SIZE;
        }
        if (data.loaded > data.total) {
          data.total = data.loaded + 1024 * 1024;
        }

        self.postMessage({
          type: 'DOWNLOAD_PROGRESS',
          payload: data
        });
      }
    });

    // 🌟 3. 预热引擎：模型加载完后，先跑一次空的推理，防止第一次使用时卡顿
    await extractor("warm up", { pooling: 'mean', normalize: true });
 
    // 🌟 4. 明确发送就绪信号
    self.postMessage({
      type: 'DOWNLOAD_PROGRESS',
      payload: { status: 'ready' }
    });

    return extractor;
  } catch (error) {
    self.postMessage({
      type: 'DOWNLOAD_PROGRESS',
      payload: { status: 'error', error: `模型加载失败: ${error.message}` }
    });
    throw error;
  } finally {
    // 🌟 5. 恢复控制台
    console.warn = originalWarn;
    isInitializing = false;
  }
}

// 计算余弦相似度的高效函数
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 监听主线程消息
self.addEventListener("message", async (event) => {
  const { type, payload } = event.data;
  
  try {
    // 🌟 将模型初始化放入 try-catch，防止网络断开导致 Worker 彻底死掉
    const model = await initModel();

    if (type === "GENERATE_EMBEDDING") {
      try {
        // 1. 将文本转为向量
        const output = await model(payload.text, {
          pooling: "mean",
          normalize: true,
        });
        const vector = Array.from(output.data);
        
        // ✅ 成功送回
        self.postMessage({ type: "EMBEDDING_DONE", id: payload.id, vector });
      } catch (err) {
        // 🚨 失败回传（配合主线程的 catch）
        self.postMessage({ type: "EMBEDDING_ERROR", id: payload.id, error: err.message });
      }
      
    } else if (type === "VECTOR_SEARCH") {
      try {
        // 2. 批量计算余弦相似度并排序
        const { id, queryVector, dbRecords, limit = 10 } = payload; // 🌟 记得提取 id
        
        const scoredRecords = dbRecords.map((record) => ({
          ...record,
          similarity: cosineSimilarity(queryVector, record.vector),
        }));

        // 按相似度降序
        scoredRecords.sort((a, b) => b.similarity - a.similarity);
        
        // ✅ 成功送回（🌟 加上了至关重要的 id）
        self.postMessage({
          type: "SEARCH_DONE",
          id: id, 
          results: scoredRecords.slice(0, limit),
        });
      } catch (err) {
        // 🚨 失败回传
        self.postMessage({ type: "SEARCH_ERROR", id: payload.id, error: err.message });
      }
    }
  } catch (initError) {
    console.error("[Worker] 模型初始化失败:", initError);
    // 如果是因为模型没加载出来导致的失败，也必须给主线程一个交代，防止挂起
    if (payload && payload.id) {
       const errorType = type === "GENERATE_EMBEDDING" ? "EMBEDDING_ERROR" : "SEARCH_ERROR";
       self.postMessage({ type: errorType, id: payload.id, error: "模型引擎尚未就绪或加载失败" });
    }
    // 顺便通知负责进度条的监听器
    self.postMessage({ type: 'DOWNLOAD_PROGRESS', payload: { status: 'error', error: initError.message } });
  }
}); 
