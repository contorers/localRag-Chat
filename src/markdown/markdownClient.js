// src/composables/AI-Chat/markdownClient.js
import MarkdownWorker from "./markdown.worker.js?worker";

let workerInstance = null;
const callbacks = new Map(); 
let isWorkerReady = false;
const messageQueue = []; 

export function getMarkdownWorker() {
  if (!workerInstance) {
    workerInstance = new MarkdownWorker();
    
    workerInstance.onerror = (err) => {
      console.error("🔥 [Worker 崩溃] 正在销毁并准备重启...", err);
      workerInstance.terminate();
      workerInstance = null; 
    };
    
    workerInstance.onmessage = (e) => {
      if (e.data.status === 'ready') {
        isWorkerReady = true;
        while (messageQueue.length) {
          const task = messageQueue.shift();
          workerInstance.postMessage(task);
        }
        return;
      }
      
      const { id, status, error } = e.data;
      if (status === 'error') console.error("❌ [Worker 解析异常]", error); 
      
      // 🌟 核心修复 1：安全执行回调，必须确认拿到的真是一个 function
      const callback = callbacks.get(id);
      if (typeof callback === 'function') {
        callback(e.data);
      }
    };
  }
  return workerInstance;
}

// 🌟 核心修复 2：参数重载兼容处理
// 不管外部传 4 个参数还是 5 个参数，我们都能完美接住！
export function renderMarkdownAsync(id, text, isGenerating, arg4, arg5) {
  let engine = 'somarkdown';
  let onResult = null;

  // 嗅探参数：如果第 4 个参数是个函数，说明用的是旧版调用姿势
  if (typeof arg4 === 'function') {
    onResult = arg4;
    engine = 'somarkdown'; // 没有传 engine，默认给一个
  } else {
    // 否则是正常的新版调用姿势
    engine = arg4 || 'somarkdown';
    onResult = arg5;
  }

  const task = { id, text, componentId: id, isGenerating, engine }; 
  const worker = getMarkdownWorker();

  // 只有真正拿到函数时，才往 Map 里存
  if (typeof onResult === 'function') {
    callbacks.set(id, onResult);
  }

  if (!isWorkerReady && !isGenerating) {
    messageQueue.push(task);
  } else {
    worker.postMessage(task);
  }
}

export function unregisterMarkdown(id) {
  callbacks.delete(id);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (workerInstance) workerInstance.terminate();
    workerInstance = null;
    callbacks.clear();
  });
}