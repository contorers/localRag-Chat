// composables/AI-Caht/workerClient.js
import { vectorDB } from "../Indexdb/db/vectorDB"; 

// 🌟 1. 顶部导入（必须写在这里，交给 Vite 在编译阶段处理）
import EmbeddingWorker from "./workers/embedding.worker.js?worker"; 

const isBrowser = typeof window !== "undefined";

let workerInstance = null;
let isReady = false;
let initPromise = null;


/**
 * 🌟 内部私有方法：获取或创建单例 Worker
 */
function getWorker() {
  if (!isBrowser) return null;
  if (!workerInstance) {
    // 🌟 2. 直接 new 你在顶部导入的那个变量
    workerInstance = new EmbeddingWorker(); 
    
    workerInstance.onerror = (e) => console.error("[Worker Fatal]", e);
    console.log("🚀 [单例模式] Embedding Worker 已启动");
  }
  return workerInstance;
}

/**
 * 🌟 终极杀手锏：处理 Vite 热更新 (HMR)
 * 当你在开发环境下按 Ctrl+S 触发热更新时，Vite 会销毁旧模块。
 * 这个钩子能精准拦截这个时机，调用 terminate() 物理结束旧线程！
 * 彻底解决刷新出现十几个 Worker 的问题。
 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (workerInstance) {
      workerInstance.terminate();
      workerInstance = null;
      isReady = false;
      initPromise = null;
      console.log("🧹 [HMR] 已清理旧的 Embedding Worker 线程");
    }
  });
}

export const checkEmbeddingReady = () => isReady;

/**
 * 🌟 工业级初始化方法
 */
export function initEmbeddingEngine(onProgress, timeoutMs = 300000) {
  if (!isBrowser) return Promise.resolve(false);
  if (isReady) {
    if (onProgress) onProgress({ status: "ready" });
    return Promise.resolve(true);
  }

  if (initPromise) return initPromise;

  const currentWorker = getWorker();

  initPromise = new Promise((resolve, reject) => {
    let timeoutId;

    const handler = (e) => {
      if (e.data.type === "DOWNLOAD_PROGRESS") {
        const payload = e.data.payload;

        // 进度条兜底逻辑
        if (!payload.total || payload.total <= 0) {
          const ESTIMATED_SIZE = 30 * 1024 * 1024;
          payload.total = ESTIMATED_SIZE;
          const fakePercent = (payload.loaded / ESTIMATED_SIZE) * 100;
          if (fakePercent > 99) payload.loaded = ESTIMATED_SIZE * 0.99;
          if (onProgress && payload.loaded)
            onProgress({ ...payload, isIndeterminate: true });
        } else if (onProgress) {
          onProgress(payload);
        }

        if (payload.status === "ready") {
          isReady = true;
          clearTimeout(timeoutId);
          currentWorker.removeEventListener("message", handler);

          // 预热并清理旧向量
          getVectorFromWorker(" ")
            .then(() => vectorDB.pruneOldestVectors(2000))
            .catch((err) => console.warn("[Worker] 预热或清理失败", err))
            .finally(() => {
              initPromise = null;
              resolve(true);
            });
        }

        if (payload.status === "error") {
          clearTimeout(timeoutId);
          currentWorker.removeEventListener("message", handler);
          initPromise = null;
          reject(new Error(payload.error || "模型引擎加载失败"));
        }
      }
    };

    currentWorker.addEventListener("message", handler);
    // 发送任意消息触发 Worker 内部的 initModel
    currentWorker.postMessage({ type: "INIT_MODEL" });

    timeoutId = setTimeout(() => {
      currentWorker.removeEventListener("message", handler);
      initPromise = null;
      reject(new Error(`[Worker] 模型初始化超时 (${timeoutMs / 1000}秒)`));
    }, timeoutMs);
  });

  return initPromise;
}

/**
 * 🌟 让 Worker 把文本转成向量
 */
export function getVectorFromWorker(text, timeoutMs = 15000) {
  const currentWorker = getWorker(); 
  if (!currentWorker) return Promise.reject(new Error("Worker 引擎未就绪"));  

  return new Promise((resolve, reject) => {
    const id = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : Date.now().toString() + Math.random();
    let timeoutId;

    const handler = (e) => {
      if (e.data.id === id) {
        if (e.data.type === "EMBEDDING_DONE") {
          clearTimeout(timeoutId);
          currentWorker.removeEventListener("message", handler);
          resolve(e.data.vector);
        } else if (e.data.type === "EMBEDDING_ERROR") {
          clearTimeout(timeoutId);
          currentWorker.removeEventListener("message", handler);
          reject(new Error(e.data.error || "Worker 计算向量失败"));
        }
      }
    };

    currentWorker.addEventListener("message", handler);
    currentWorker.postMessage({
      type: "GENERATE_EMBEDDING",
      payload: { id, text },
    });

    timeoutId = setTimeout(() => {
      currentWorker.removeEventListener("message", handler);
      reject(new Error(`[Worker Timeout] 向量生成超时 (${timeoutMs}ms)`));
    }, timeoutMs);
  });
}

/**
 * 🌟 让 Worker 批量计算余弦相似度
 */
export function searchVectorsInWorker(
  queryVector,
  dbRecords,
  limit = 10,
  timeoutMs = 15000
) { 
  const currentWorker = getWorker();
  if (!currentWorker) return Promise.reject(new Error("Worker 引擎未就绪"));

  return new Promise((resolve, reject) => {
    const taskId = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : "search_" + Date.now();
    let timeoutId;

    const handler = (e) => {
      if (e.data.id === taskId) {
        if (e.data.type === "SEARCH_DONE") {
          clearTimeout(timeoutId);
          currentWorker.removeEventListener("message", handler);
          resolve(e.data.results);
        } else if (e.data.type === "SEARCH_ERROR") {
          clearTimeout(timeoutId);
          currentWorker.removeEventListener("message", handler);
          reject(new Error(e.data.error || "Worker 向量搜索失败"));
        }
      }
    };

    currentWorker.addEventListener("message", handler);
    currentWorker.postMessage({
      type: "VECTOR_SEARCH",
      payload: { id: taskId, queryVector, dbRecords, limit },
    });

    timeoutId = setTimeout(() => {
      currentWorker.removeEventListener("message", handler);
      reject(new Error(`[Worker Timeout] 向量搜索超时 (${timeoutMs}ms)`));
    }, timeoutMs);
  });
}