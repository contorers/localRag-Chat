<script setup>
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useUserStore } from './store/useStore'
import { useContextMenuStore } from './store/contextMenu' // 🌟 修复：补上菜单 Store 的引入
import Alert from "./components/ui/Alert.vue"

// ---------- Store ----------
const userStore = useUserStore()
const menuStore = useContextMenuStore()
const isLoading = computed(() => userStore.isLoading) // 🌟 修复：删除了多余的重复声明

// ---------- 窗口实例 & 状态 ----------
const appWindow = getCurrentWindow()
const isMaximized = ref(false) // 🌟 修复：补上变量定义

const updateMaximizedState = async () => {
  isMaximized.value = await appWindow.isMaximized()
}

// ---------- 进度条控制（组合式函数） ----------
function useProgress(isLoadingRef) {
  const progress = ref(0)
  const isVisible = ref(false)
  let timer = null
  let hideTimeout = null  // 🌟 修复：补回防闪烁逻辑
  let resetTimeout = null

  const startProgress = () => {
    if (hideTimeout) clearTimeout(hideTimeout)
    if (resetTimeout) clearTimeout(resetTimeout)

    isVisible.value = true
    progress.value = 0
    setTimeout(() => { progress.value = 30 }, 20)

    timer = setInterval(() => {
      if (progress.value < 90) {
        progress.value += Math.random() * 5
      }
    }, 400)
  }

  const finishProgress = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    progress.value = 100
    hideTimeout = setTimeout(() => {
      isVisible.value = false
      resetTimeout = setTimeout(() => { progress.value = 0 }, 300)
    }, 300)
  }

  watch(
    isLoadingRef,
    (newVal) => {
      if (newVal) {
        if (timer) clearInterval(timer)
        startProgress()
      } else {
        finishProgress()
      }
    },
    { immediate: false }
  )

  return { progress, isVisible }
}

const { progress, isVisible } = useProgress(isLoading) // 🌟 修复：删除了重复的调用

// ---------- 全局事件 ----------
const handleGlobalClick = () => {
  if (menuStore.visible) {
    menuStore.closeMenu()
  }
}

const handleGlobalContextMenu = (e) => {
  e.preventDefault()
}

// ---------- 定义按键处理函数 ----------
const handleKeyDown = (e) => {
  // 禁用 F12 (开发者工具)
  if (e.key === 'F12') {
    e.preventDefault()
    e.stopPropagation()
  }

  // 禁用 F5 (刷新)
  if (e.key === 'F5') {
    e.preventDefault()
    e.stopPropagation()
  }

  // 禁用 Ctrl+R 或 Cmd+R (强制刷新)
  if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
    e.preventDefault()
    e.stopPropagation()
  }
}

// ---------- 生命周期 ----------
onMounted(async () => {
  await updateMaximizedState()

  await nextTick() 
  await appWindow.show() 

  const unlistenResized = await appWindow.onResized(() => {
    updateMaximizedState()
  })

  window.addEventListener('click', handleGlobalClick)
  window.addEventListener('contextmenu', handleGlobalContextMenu)
  window.addEventListener('keydown', handleKeyDown)

  window.__appUnlistenFns = [unlistenResized]
})

onUnmounted(() => {
  window.removeEventListener('click', handleGlobalClick)
  window.removeEventListener('contextmenu', handleGlobalContextMenu)
  window.removeEventListener('keydown', handleKeyDown)
  
  if (window.__appUnlistenFns) {
    window.__appUnlistenFns.forEach((fn) => fn())
    delete window.__appUnlistenFns
  }
})
</script>

<template>
  <div :class="{ 'is-maximized': isMaximized }">
   <div class="global-progress-bar" :class="{ 'hidden': !isVisible }">
      <div 
        class="bar-inner" 
        :style="{ width: progress + '%' }"
      ></div>
    </div>
    
    <router-view v-slot="{ Component, route }">
      <transition name="fade" mode="out-in">
        <keep-alive>
          <component :is="Component" :key="route.path" />
        </keep-alive>
      </transition>
    </router-view>
    
    <Alert />
  </div>
</template>

<style scoped>
/* 进度条容器 */
.global-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  z-index: 9999;
  background: transparent;
  transition: opacity 0.3s ease; 
  opacity: 1;
}

/* 隐藏状态 */
.global-progress-bar.hidden {
  opacity: 0;
  pointer-events: none;
}

/* 进度条本体 */
.bar-inner {
  height: 100%;
  background: #1877f2;
  transition: width 0.3s ease-out;
  box-shadow: 0 0 10px rgba(24, 119, 242, 0.7);
}
</style>