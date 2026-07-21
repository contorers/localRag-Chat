// src/utils/globalToast.js
import { createVNode, render } from 'vue';
import GlobalToastComponent from '../GlobalToast.vue'; // 确认一下这里的相对路径对不对

let instanceExposed = null;

function initInstance() {
  if (instanceExposed) return;

  // 1. 创建挂载的 DOM 节点
  const container = document.createElement('div');
  
  // 👑 核弹级防御：用内联样式赋予最高优先级，强行将挂载点钉在右上角！
  // 哪怕 Vue 的 CSS 没加载出来，位置也绝对不会跑偏
  container.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    right: 0 !important;
    z-index: 99999 !important;
    pointer-events: none !important; /* 核心：让点击穿透容器，不阻挡底层页面交互 */
    display: flex !important;
    flex-direction: column !important;
    align-items: flex-end !important;
  `;
  
  document.body.appendChild(container);

  // 2. 将 Vue 组件转化为 VNode
  const vnode = createVNode(GlobalToastComponent);
  
  // 3. 渲染到刚才“焊死”的 DOM 上
  render(vnode, container);

  // 4. 获取暴露的方法
  instanceExposed = vnode.component.exposed;
}

export function showGlobalToast(options) {
  initInstance();

  if (typeof options === 'string') {
    instanceExposed.add({ message: options, type: 'info' });
    return;
  }
  instanceExposed.add(options);
}