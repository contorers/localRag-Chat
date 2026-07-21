// src/composables/AI-Chat/embeddingClient.js
import EmbeddingWorker from "./embedding.worker.js?worker";

// 🌟 1. 全局单例变量
let workerInstance = null;

/**
 * 🌟 2. 核心调度方法：保证全局只有这一个 Worker
 */
export function getEmbeddingWorker() {
  if (!workerInstance) {
    workerInstance = new EmbeddingWorker();
    console.log("🚀 [单例模式] 向量计算引擎 Worker 已启动");
  }
  return workerInstance;
}

/**
 * 🌟 3. 终极杀手锏：处理 Vite 的热更新 (HMR)
 * 这一步专门解决“一刷新出现十几个”的开发环境痛点
 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (workerInstance) {
      workerInstance.terminate(); // 物理超度旧线程
      workerInstance = null;
      console.log("🧹 [HMR] 已清理旧的向量计算引擎 Worker");
    }
  });
}

/**
 * 🌟 4. （可选）手动释放内存的钩子
 */
export function terminateEmbeddingWorker() {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}