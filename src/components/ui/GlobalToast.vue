<!-- src/components/GlobalToast.vue -->
<template>
  <div class="global-toast-container">
    <transition-group name="toast-slide" tag="div" class="toast-wrapper">
      <div 
        v-for="toast in toasts" 
        :key="toast.id" 
        class="toast-item"
        :class="[`toast-${toast.type || 'info'}`, { 'is-clickable': toast.onClick }]"
        @click="handleClick(toast)"
      >
        <!-- 核心美化 1：使用极简纯净的 Iconify 双色图标，去掉外围方框 -->
        <Icon :icon="getIcon(toast.type)" class="toast-icon" />
        
        <!-- 内容区 -->
        <div class="toast-content">
          <h4 class="toast-title" v-if="toast.title">{{ toast.title }}</h4>
          <p class="toast-message" v-if="toast.message">{{ toast.message }}</p>
        </div>

        <!-- 核心美化 2：替换关闭按钮为 Iconify -->
        <button class="toast-close" @click.stop="remove(toast.id)" aria-label="关闭">
          <Icon icon="ph:x-bold" />
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Icon } from "@iconify/vue";

const toasts = ref([]);
let toastIdSeed = 0;

const add = (options) => {
  const id = toastIdSeed++;
  const toast = {
    id,
    title: options.title || '',
    message: options.message || '',
    type: options.type || 'info',
    duration: options.duration !== undefined ? options.duration : 4000,
    onClick: options.onClick || null
  };
  
  toasts.value.push(toast);

  if (toast.duration > 0) {
    setTimeout(() => {
      remove(id);
    }, toast.duration);
  }
};

const remove = (id) => {
  const index = toasts.value.findIndex(t => t.id === id);
  if (index > -1) {
    toasts.value.splice(index, 1);
  }
};

const handleClick = (toast) => {
  if (toast.onClick) {
    toast.onClick();
    remove(toast.id);
  }
};

// 👑 返回 Iconify 的图标名称 (选用极其高级的 Solar Duotone 系列)
const getIcon = (type) => {
  const icons = {
    info: 'solar:info-circle-bold-duotone',
    success: 'solar:check-circle-bold-duotone',
    warning: 'solar:danger-triangle-bold-duotone',
    error: 'solar:close-circle-bold-duotone'
  };
  return icons[type] || icons.info;
};

defineExpose({ add });
</script>

<style scoped>
/* 容器严格对齐右上角，使用 !important 镇压一切外部污染 */ 
.global-toast-container {
  position: fixed !important;
  top: 32px !important;
  right: 32px !important;
  left: auto !important; 
  transform: none !important; 
  z-index: 99999 !important;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end; 
}

.toast-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-end; 
  gap: 14px;
}

/* =========================================
   卡片极其精致的质感 (通透毛玻璃 + 高级悬浮阴影)
========================================= */
.toast-item {
  position: relative;
  width: 340px;
  background: rgba(255, 255, 255, 0.85); /* 提升通透感 */
  backdrop-filter: blur(20px) saturate(180%); /* 增加高斯模糊和色彩饱和度，类似 iOS */
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.04); /* 极细极淡的边框 */
  border-radius: 16px; /* 更圆润现代的倒角 */
  padding: 16px 20px;
  display: flex;
  align-items: flex-start;
  /* 更立体、更有呼吸感的阴影 */
  box-shadow: 
    0 10px 40px -10px rgba(0, 0, 0, 0.06), 
    0 4px 12px -2px rgba(0, 0, 0, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 1);
  pointer-events: auto;
  overflow: hidden;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease;
}

/* 悬浮交互：微微抬起 + 阴影扩散 */
.toast-item.is-clickable {
  cursor: pointer;
}
.toast-item.is-clickable:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 
    0 20px 40px -10px rgba(0, 0, 0, 0.1), 
    0 6px 16px -2px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 1);
}

/* =========================================
   色彩主题 (调整为视觉更舒适的莫兰迪亮色)
========================================= */
.toast-info { --toast-color: #1877F2; }
.toast-success { --toast-color: #10B981; }
.toast-warning { --toast-color: #F59E0B; }
.toast-error { --toast-color: #EF4444; }

/* 核心美化：图标直接裸露，靠双色渐变撑起颜值 */
.toast-icon {
  font-size: 28px; /* 加大图标，作为视觉锚点 */
  color: var(--toast-color);
  flex-shrink: 0;
  margin-right: 14px;
  /* 给图标本身加上轻微的自身光晕 */
  filter: drop-shadow(0 4px 8px rgba(var(--toast-color), 0.2));
}

/* =========================================
   字体与排版细节
========================================= */
.toast-content { 
  flex: 1; 
  min-width: 0; 
  margin-top: 3px; /* 微调：让多行文本时，标题和左侧图标视觉中心对齐 */
}
.toast-title { 
  margin: 0 0 4px 0; 
  font-size: 15px; 
  font-weight: 600; 
  color: #111827; /* 更深一点的墨黑 */
  letter-spacing: 0.3px;
}
.toast-message { 
  margin: 0; 
  font-size: 13.5px; 
  color: #6B7280; 
  line-height: 1.5; 
  word-break: break-word; 
}

/* =========================================
   极简关闭按钮 (平时透明，悬浮显现背景)
========================================= */
.toast-close { 
  background: transparent;
  border: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  margin-left: 12px;
  margin-top: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9CA3AF;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}
.toast-close:hover { 
  background-color: #F3F4F6;
  color: #374151; 
}

/* =========================================
   Vue 丝滑滑动 & 自动重排动画
========================================= */
.toast-slide-enter-active,
.toast-slide-leave-active,
.toast-slide-move {
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); /* Apple 经典回弹曲线 */
}

/* 划入状态 */
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(40px) scale(0.95);
}

/* 划出状态 */
.toast-slide-leave-to {
  opacity: 0;
  transform: scale(0.9); /* 离开时只需原位缩小变淡即可，向右滑出容易显得拖沓 */
}

/* 确保后面的元素能平滑补位 */
.toast-slide-leave-active {
  position: absolute;
  right: 0; 
}
</style>