import { invoke } from '@tauri-apps/api/core';

class KeyManager {
  constructor() {
    // 🌟 范式改变：JS 端不再存储任何私钥！
    // 我们只需要一个全局的 Promise 锁，用来拦截那些在 Rust 金库还没装载完就急着发消息的组件
    this._resolveVaultReady = null;
    this.vaultReadyPromise = new Promise((resolve) => { 
      this._resolveVaultReady = resolve; 
    });

    // 公钥不敏感，且经常需要明文发给服务器，所以可以缓存在 JS 端
    this.publicKeys = {
      sign: null,
      encrypt: null
    };
  }

  // ==========================================
  // 1. 生命周期管理 (装载与销毁)
  // ==========================================

  // 替代原来繁琐的 4 个 setter。
  // 在你的 useUserStore.js (Pinia) 里，登录并初始化 DB 后，只需调用这一个方法！
  async loadVaultFromDB(secondPassword) {
    try {
      // 🌟 新增：如果 Rust 内存里已经有密钥（刷新场景），直接同步公钥缓存，不重新解密
      const alreadyLoaded = await this.isVaultLoaded();
      if (alreadyLoaded) {
        this.publicKeys.sign = await invoke('get_public_key_cmd', { keyType: 'sign' });
        this.publicKeys.encrypt = await invoke('get_public_key_cmd', { keyType: 'encrypt' });
        this._resolveVaultReady();
        console.log("[KeyManager] ✅ Rust 金库已在内存中，跳过解密直接放行");
        return;
      }
  
      // 下面是原来的逻辑，完全不动
      await invoke('load_keys_to_vault_cmd', { secondPassword });
      this.publicKeys.sign = await invoke('get_public_key_cmd', { keyType: 'sign' });
      this.publicKeys.encrypt = await invoke('get_public_key_cmd', { keyType: 'encrypt' });
      this._resolveVaultReady();
      console.log("[KeyManager] 🛡️ Rust 加密金库已装载完毕，业务锁已释放！");
    } catch (error) {
      console.error("[KeyManager] ❌ 装载加密金库失败：", error);
      throw error;
    }
  }
  // 在 loadVaultFromDB 上面加
  async isVaultLoaded() {
    try {
      // 1. 先问 Rust
      const rustSaysLoaded = await invoke('is_vault_loaded_cmd');
      if (!rustSaysLoaded) return false;

      // 2. 🌟 测谎环节：就算 Rust 说 true，我也要抽查一下到底能不能拿出真东西
      const testKey = await invoke('get_public_key_cmd', { keyType: 'encrypt' });
      
      // 如果拿出来的是 null、undefined 或者空字符串/空数组
      if (!testKey || testKey.length === 0) {
        console.warn("⚠️ [KeyManager] 发现 Rust 幽灵状态（谎称已加载），正在强制物理清理...");
        await invoke('reset_vault_cmd'); // 强行把 Rust 的垃圾内存擦掉
        return false; // 判定为未加载，逼迫系统重新走输入密码的流程
      }

      return true;
    } catch (e) {
      console.error("[KeyManager] isVaultLoaded 探测失败:", e);
      return false;
    }
  }

  // 登出时调用
  async reset() {
    // 1. 通知 Rust 主动物理擦除（Zeroize）内存中的私钥
    await invoke('reset_vault_cmd');

    // 2. 清空 JS 端的缓存
    this.publicKeys = { sign: null, encrypt: null };

    // 3. 重新生成一把挂起的锁，拦截新登录前的越权调用
    this.vaultReadyPromise = new Promise((resolve) => { 
      this._resolveVaultReady = resolve; 
    });
    console.log("[KeyManager] 🧹 所有密钥已重置，Rust 内存已主动覆写清零");
  }

  // ==========================================
  // 2. 密码学黑盒代理区 (JS 给明文/密文，Rust 给结果)
  // ==========================================

  // 业务调用：给消息签名
  async signMessage(payload) {
    await this.vaultReadyPromise; // 自动等待金库就绪
    // 私钥根本不出 Rust，直接在底层算完返回签名
    return await invoke('sign_message_cmd', { payload: String(payload) });
  }

  // 业务调用：解密收到的消息信封
  async decryptMessage(ciphertext) {
    await this.vaultReadyPromise; // 自动等待金库就绪
    return await invoke('decrypt_message_cmd', { ciphertext: String(ciphertext) });
  }

  // 业务调用 批量解密收到的消息信封
  async decryptMessageBatch(ciphertexts) {
    await this.vaultReadyPromise;
    // 传给 Rust 的是一个数组
    return await invoke('decrypt_message_batch_cmd', { ciphertexts });
  }

  // ==========================================
  // 3. 公钥获取区 (Getters)
  // ==========================================

  async getSignPublicKey() {
    await this.vaultReadyPromise;
    return this.publicKeys.sign;
  }

  async getEncryptPublicKey() {
    await this.vaultReadyPromise;
    return this.publicKeys.encrypt;
  }
}

export const globalKeyManager = new KeyManager();