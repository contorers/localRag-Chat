// utils/toast.js
export function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    
    // 极简内联样式，绝对轻量
    toast.style.cssText = `
      position: fixed;
      top: 50px;
      left: 50%;
      transform: translateX(-50%);
      background-color: ${type === 'success' ? '#f0f9eb' : '#fef0f0'};
      color: ${type === 'success' ? '#67c23a' : '#f56c6c'};
      border: 1px solid ${type === 'success' ? '#e1f3d8' : '#fde2e2'};
      padding: 10px 20px;
      border-radius: 4px;
      font-size: 14px;
      z-index: 9999;
      transition: opacity 0.3s, transform 0.3s;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    `;
    
    toast.innerText = message;
    document.body.appendChild(toast);
  
    // 3秒后自动消失并销毁 DOM，不留一丝垃圾
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, -20px)';
      setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
  }