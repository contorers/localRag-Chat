// src/api/userDatabase.js
import { appDataDir, join } from "@tauri-apps/api/path";
import { Stronghold } from "@tauri-apps/plugin-stronghold";
import { invoke } from "@tauri-apps/api/core";

const VAULT_PASS = "Weiyu_Desktop_Super_Secret_2026!";
let stronghold = null;
let store = null;
let initPromise = null;

// ✅ 新增：重置单例，迁移后调用
function resetVault() {
  stronghold = null;
  store = null;
  initPromise = null;
  console.log("🔄 Stronghold 单例已重置");
}

async function getVaultStore() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (!stronghold) {
        console.log("🔹 正在获取系统安全路径...");
        // ✅ 动态读路径，跟着 config.json 走
        const storagePath = await invoke('get_app_dir_cmd');
        const vaultPath = await join(storagePath, "weiyu_state.stronghold");
        console.log("🔹 保险箱绝对路径:", vaultPath);

        stronghold = await Stronghold.load(vaultPath, VAULT_PASS);
        console.log("🔹 Stronghold.load 完成");
      }

      const clientName = "session_client";
      let client;
      try {
        client = await stronghold.loadClient(clientName);
      } catch {
        client = await stronghold.createClient(clientName);
      }

      store = await client.getStore("session_store");
      return { stronghold, store };
    } catch (e) {
      initPromise = null;
      throw e;
    }
  })();

  return initPromise;
}

export const UserDatabase = {
  async saveToken(tokenStr) {
    try {
      const { stronghold, store } = await getVaultStore();
      const tokenBytes = Array.from(new TextEncoder().encode(tokenStr));
      await store.insert("ACCESS_TOKEN", tokenBytes);
      await stronghold.save();
      console.log("🔒 Token 已安全写入 Stronghold 加密保险箱");
    } catch (err) {
      console.error("🔒 写入 Stronghold 失败:", err);
    }
  },

  async getToken() {
    try {
      const { store } = await getVaultStore();
      const tokenBytes = await store.get("ACCESS_TOKEN");
      if (!tokenBytes || tokenBytes.length === 0) return null;
      return new TextDecoder().decode(new Uint8Array(tokenBytes));
    } catch (err) {
      console.error("🔒 读取 Stronghold 失败:", err);
      return null;
    }
  },

  async removeToken() {
    try {
      const { stronghold, store } = await getVaultStore();
      await store.remove("ACCESS_TOKEN");
      await stronghold.save();
      console.log("🗑️ Token 已从保险箱安全粉碎");
    } catch (e) {
      // 忽略
    }
  },

  async getLocalPath() {
    try {
      return await invoke('get_app_dir_cmd');
    } catch (err) {
      console.error("获取项目路径失败:", err);
      return await appDataDir();
    }
  },

  async saveLocalPath(userId, newPath) {
    try {
      await invoke('migrate_app_data', { userId, newPath });
      console.log("✅ 项目整体搬家并重启数据库成功");

      // ✅ 迁移成功后重置 Stronghold 单例
      // 下次访问会重新初始化，自动指向新路径的保险箱
      resetVault();
    } catch (err) {
      console.error("❌ 项目搬家失败:", err);
      throw err;
    }
  },

  async initRustDb(userId) {
    try {
      await invoke('login_success_init_db', { userId });
      console.log("✅ Rust 专属 SQLite 数据库装载完毕");
    } catch (e) {
      console.error("❌ Rust 数据库初始化失败:", e);
      throw e;
    }
  }
};