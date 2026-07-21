import { createRouter, createWebHashHistory } from "vue-router";
import { useUserStore } from "../store/useStore.js"; // 你的 Store
// 1. 定义路由表
const routes = [
  {
    path: "/",
    component: () => import("../components/AIUserChat.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/aiUserChat",
    component: () => import("../components/AIUserChat.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/apiSettings",
    component: () => import("../components/ApiSettings.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/aiHybrdSettings",
    component: () => import("../components/AiHybrdSettings.vue"),
    meta: { requiresAuth: true },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition;
    } else {
      return { top: 0 };
    }
  },
});

// 注意参数里已经把 next 删掉了
router.beforeEach(async (to, from) => {
  const userStore = useUserStore(); 
  userStore.startLoading(); 

  if (to.meta.requiresAuth) {
    // ⚠️ 如果还没有登录
    if (!userStore.isLoggedIn) {
      try {
        // 🚨 核心修复 1：必须调用 getUserKeys！
        // 只有这个方法才会去唤醒 IndexedDB、弹窗要密码，并给 userInfo 赋值！
        await userStore.getUserKeys(); 
        
        // 🚨 核心修复 2：状态装载完毕后，直接 return true 放行！
        // 绝对不能写 return { ...to }，否则会强制路由重新跑一圈拦截器！
        return true; 
        
      } catch (error) {
        userStore.$reset(); 
        return false; 
      }
    }
    // 如果 isLoggedIn 为 true，直接放行
    return true;
  }

  // 普通页面直接放行
  return true; 
});
router.afterEach(() => {
  const userStore = useUserStore();
  // 稍微延迟一点关闭，视觉上更舒服
  setTimeout(() => {
    userStore.stopLoading(); // 切换结束：隐藏进度条
  }, 300);
});
export default router;
