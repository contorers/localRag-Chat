<template>
    <div v-if="visible" class="modal-overlay">
      <div class="modal-content">
        <h3>验证二级密码</h3>
        <p>检测到新设备登录，请输入安全密码以解密私钥</p>
        <input v-model="password" type="password" placeholder="请输入二级密码" />
        <div class="actions">
          <button @click="handleConfirm">确定</button>
        </div>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue';
  const visible = ref(false);
  const password = ref('');
  const emit = defineEmits(['confirm']);
  
  // 暴露给父组件的方法
  const open = () => {
    visible.value = true;
    password.value = '';
  };
  
  const handleConfirm = () => {
    if (!password.value) return alert('请输入密码');
    visible.value = false;
    emit('confirm', password.value); // 触发确认事件
  };
  
  defineExpose({ open });
  </script>