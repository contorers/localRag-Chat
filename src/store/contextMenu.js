import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useContextMenuStore = defineStore('contextMenu', () => {
  const visible = ref(false);
  const x = ref(0);
  const y = ref(0);
  // 存放当前菜单的选项，例如: [{ label: '复制', action: () => {} }]
  const menuItems = ref([]); 

  // 打开菜单
  const openMenu = (event, items) => {
    event.preventDefault()
    const menuWidth = 120
    const menuHeight = items.length * 36
  
    x.value = event.clientX + menuWidth > window.innerWidth
      ? event.clientX - menuWidth
      : event.clientX
  
    y.value = event.clientY + menuHeight > window.innerHeight
      ? event.clientY - menuHeight
      : event.clientY
  
    menuItems.value = items
    visible.value = true
  }

  // 关闭菜单
  const closeMenu = () => {
    visible.value = false;
  };

  return { visible, x, y, menuItems, openMenu, closeMenu };
});