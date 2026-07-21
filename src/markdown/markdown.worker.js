// components/workers/markdown.worker.js
import { renderMarkdown } from "./markdown-engine"; // 确保引用的名字是对的

self.onmessage = function (e) {
  // 🌟 必须确保从 e.data 解构出了 engine 变量！
  const { id, text, componentId, isGenerating, engine } = e.data;
  
  try {
    // 🌟 必须将 engine 传到第四个参数位置！
    const html = renderMarkdown(text, componentId, isGenerating, engine);
    self.postMessage({ id, html, status: 'success' });
  } catch (error) {
    self.postMessage({ id, error: error.message, status: 'error' });
  }
};

// 允许队列启动
self.postMessage({ status: 'ready' });