import { createApp } from "vue";

import App from "./App.vue";
import router from "./router/router.js";
import pinia from "./pinia"; 

import "./styles/element-override.css";
import "./styles/main.css";
// 全局挂载 
// ==========================🌟 拦截 ResizeObserver 的良性报错，防止它污染控制台或导致渲染中断
const debounce = (fn, delay) => {
  let timer = null;
  return function () {
    let context = this;
    let args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () {
      fn.apply(context, args);
    }, delay);
  };
};

const _ResizeObserver = window.ResizeObserver;
window.ResizeObserver = class ResizeObserver extends _ResizeObserver {
  constructor(callback) {
    callback = debounce(callback, 16);
    super(callback);
  }
};

// 屏蔽全局错误抛出
window.addEventListener("error", (e) => {
  if (e.message === "ResizeObserver loop limit exceeded") {
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
});
// ==========================

const app = createApp(App); 

app.use(router);
app.use(pinia); 
app.mount("#app");