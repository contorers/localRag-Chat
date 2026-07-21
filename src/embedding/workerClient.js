import { invoke } from "@tauri-apps/api/core"; // Tauri v2 的引入方式
import { listen } from "@tauri-apps/api/event";

/**
 * 🌟 1. 初始化模型引擎 (直接调用 Rust)
 */
export async function initEmbeddingEngine(onProgress) {
  let unlisten = null;

  try {
    // 1. 先注册监听，再触发 invoke，避免错过最早的事件
    unlisten = await listen("embedding_progress", (event) => {
      if (onProgress) onProgress(event.payload);
    });

    // 2. 触发 Rust 初始化（async，不阻塞 UI）
    await invoke("init_embedding");

    return true;
  } catch (error) {
    console.error("[Tauri] 模型初始化失败:", error);
    throw new Error(error);
  } finally {
    // 3. 无论成功失败，都取消监听，防止内存泄漏
    if (unlisten) unlisten();
  }
}


/**
 * 🌟 2. 文本转向量 (直接调用 Rust)
 */
export async function getVectorFromWorker(text) {
  try {
    // 调用我们刚才写的 Rust 函数
    const vector = await invoke("get_embedding", { text });
    return vector;
  } catch (error) {
    console.error("[Tauri] 向量生成失败:", error);
    throw new Error(error);
  }
}

/**
 * 🌟 3. 批量搜索向量相似度 (调用即将用 Rust 写的搜索函数)
 */
export async function searchVectorsInWorker(queryVector, dbRecords, limit = 10) {
  try {
    // 将查询向量和数据库记录直接丢给 Rust 算，极速返回结果
    const results = await invoke("search_vectors", {
      queryVector,
      records: dbRecords,
      limit
    });
    return results;
  } catch (error) {
    console.error("[Tauri] 向量搜索失败:", error);
    throw new Error(error);
  }
}