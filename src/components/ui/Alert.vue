<template>
  <div class="toast-wrapper">
    <transition-group name="toast">
      <div
        v-for="alert in alerts"
        :key="alert.id"
        :class="['toast-card', alert.type]"
        @click="close(alert.id)"
      >
        <div class="color-stripe"></div>

        <Icon 
          :icon="alert.type === 'success' ? 'lucide:check-circle-2' : 'lucide:alert-triangle'" 
          class="toast-icon"
        />

        <span class="toast-message">{{ alert.message }}</span>
        
        <Icon icon="lucide:x" class="close-icon" @click.stop="close(alert.id)" />
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { ref } from 'vue'
// 如果你项目没有安装 @iconify/vue，请删掉这一行并将 template 里的 <Icon> 换成你原来的 <i>
import { Icon } from '@iconify/vue' 

const alerts = ref([])
let idCounter = 0

// 改成 unshift 依然可以，但不需要 duration 默认参数（写在 logic 更好）
function showAlert(type = 'success', msg = '', duration = 3000) {
  const id = idCounter++
  // 🌟 改动：新 alert 放在数组末尾 (push)，让它排在最下面
  // 如果依然想让最新的排最上面，用 unshift，但 CSS 需要配合 flex-direction: column-reverse
  alerts.value.push({ id, type, message: msg }) 

  setTimeout(() => {
    close(id)
  }, duration)
}

function close(id) {
  alerts.value = alerts.value.filter(a => a.id !== id)
}

// 供外部测试调用
window.showAlert = showAlert
</script>

<style>
/* 🌟 全局样式：整个通知区域 */
.toast-wrapper {
  position: fixed;
  top: 24px;  /* 距离顶部一段距离，更精致 */
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  
  /* 🌟 核心修改：利用 Flex 实现自动向下堆叠，无需计算 index 和 bottom */
  display: flex;
  flex-direction: column; /* 垂直排列 */
  align-items: center;    /* 居中对齐 */
  gap: 12px;              /* 卡片之间的间距 */
  
  /* 防止移动端卡片太靠边 */
  padding: 0 16px;
  max-width: 90vw;
  pointer-events: none;   /* 穿透：防止 wrapper 区域拦截点击，只有卡片拦截 */
}

/* 🌟 单张通知卡片基本样式 */
.toast-card {
  pointer-events: auto; /* 卡片需要响应点击 */
  position: relative;
  display: flex;        /* inline-flex 改 flex，配合 column 布局 */
  align-items: center;
  
  min-width: 280px;      /* 稍微加大最小宽度，更有质感 */
  max-width: 100%;       /* 继承父级 padding */
  
  padding: 14px 18px;    /* 稍微加大内边距 */
  border-radius: 12px;   /* 更圆润的角 */
  
  font-size: 14px;
  font-weight: 500;
  
  /* 🌟 美化核心：磨砂玻璃效果 + 精致阴影 */
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
  
  border: 1px solid transparent; /* 预留边框位置，用于高亮 */
  cursor: pointer;
  overflow: hidden;      /* 裁剪 color-stripe */
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); /* 更流畅的动画曲线 */
}

.toast-card:hover {
  transform: translateY(-1px) scale(1.01); /* 微弱的悬停交互 */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

/* 🌟 卡片图标和文字样式 */
.toast-icon {
  font-size: 20px;       /* 稍微放大图标 */
  margin-right: 12px;
  flex-shrink: 0;        /* 防止文字长了挤压图标 */
}

.toast-message {
  flex: 1;               /* 占据剩余空间 */
  color: #1a1a1a;        /* 文字颜色统一为深色，提升可读性 */
  line-height: 1.4;
  word-break: break-all; /* 防止长单词撑破卡片 */
}

/* 🌟 新增：关闭图标样式 */
.close-icon {
  font-size: 16px;
  color: #a0a0a0;
  margin-left: 12px;
  cursor: pointer;
  transition: color 0.2s;
  flex-shrink: 0;
}
.close-icon:hover {
  color: #f56c6c; /* 悬停变成红色 */
}

/* 🌟 高亮条（可选，不加也行，看你喜欢哪种风格） */
/* .color-stripe {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 5px;
} */

/* 🌟 Success 状态样式（柔和背景 + 高亮文字） */
.toast-card.success {
  background-color: rgba(230, 247, 237, 0.9); /* #e6f7ed */
  border-color: rgba(149, 236, 105, 0.3);
}
.toast-card.success .toast-icon { color: #23b56a; /* Vibrant Green */ }
/* .toast-card.success .color-stripe { background-color: #23b56a; } */ /* 启用高亮条 */

/* 🌟 Error 状态样式（柔和背景 + 高亮文字） */
.toast-card.error {
  background-color: rgba(254, 236, 238, 0.9); /* #feecee */
  border-color: rgba(253, 226, 226, 0.3);
}
.toast-card.error .toast-icon { color: #f56c6c; /* Soft Red */ }
/* .toast-card.error .color-stripe { background-color: #f56c6c; } */ /* 启用高亮条 */


/* 🌟 动画：顶部滑入滑出 */
.toast-enter-from {
  opacity: 0;
  transform: translateY(-20px) scale(0.9); /* 顶部滑入，带有微弱缩放 */
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-10px); /* 向上滑动消失 */
}

/* 用于堆叠向下移动时的流畅过渡 */
.toast-move {
  transition: transform 0.4s ease;
}
</style>
