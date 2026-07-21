// src/api/cryptoDatabase.js
import { invoke } from "@tauri-apps/api/core";

export const CryptoDatabase = {
  // ==========================================
  // Room Keys (群组密钥)
  // ==========================================
  async getRoomKey(roomId, keyVersion) {
    return await invoke('get_room_key_cmd', { roomId: String(roomId), keyVersion: Number(keyVersion) });
  },

  async upsertRoomKeys(keys) {
    return await invoke('upsert_room_keys_cmd', { keys });
  },

  async deleteRoomKey(roomId, keyVersion) {
    return await invoke('delete_room_key_cmd', { roomId: String(roomId), keyVersion: Number(keyVersion) });
  },

  // ==========================================
  // User Public Keys (用户身份公钥)
  // ==========================================
  async getUserPublicKeys(userIds) {
    return await invoke('get_user_public_keys_cmd', { userIds });
  },

  async upsertUserPublicKeys(keys) {
    return await invoke('upsert_user_public_keys_cmd', { keys });
  },

  async deleteUserPublicKey(userId) {
    return await invoke('delete_user_public_key_cmd', { userId: String(userId) });
  },

// ==========================================
  // Key Store (本地私钥与核心素材库)
  // ==========================================
  async getKeyStoreItem(keyName) {
    return await invoke('get_key_store_item_cmd', { keyName: String(keyName) });
  },

  async upsertKeyStoreItems(items) {
    // items 数组里的对象现在只需要 { key_name: "xxx", payload: "xxx" }
    return await invoke('upsert_key_store_items_cmd', { items });
  },

  async hasKeys(keyNames) {
    try {
      return await invoke('has_keys_cmd', { keyNames });
    } catch (error) {
      console.error("Failed to check keys existence:", error);
      throw error;
    }
  },

  async deleteKeyStoreItem(keyName) {
    return await invoke('delete_key_store_item_cmd', { keyName: String(keyName) });
  },

  // ==========================================
  // Key Store (本地私钥生成)
  // ==========================================
  async  setupNewDevice(secondPassword) {
    try {
      // 1. 让 Rust 后端生成密钥并加密备份
      const result = await invoke("generate_and_backup_all_keys_cmd", {
        secondPassword: secondPassword
      });
  
      return {
        signPrivateKey: result.sign_private_base64,
        encryptPrivateKey: result.encrypt_private_base64,
        signPublicKey: result.sign_public_base64,
        encryptPublicKey: result.encrypt_public_base64,
        backupData: result.backup_data
      }
    } catch (error) {
      console.error("生成密钥失败: ", error);
    }
  },

  async  restoreKeys(secondPassword,signPublicBase64,decryptPublicBase64,encryptedPrivateBase64) {
    try {
      // 1. 让 Rust 后端生成密钥并加密备份
      await invoke("restore_and_load_keys_cmd", {
        secondPassword: secondPassword,
        signPubBase64: signPublicBase64,
        encryptPubBase64: decryptPublicBase64,
        encryptedBackupBase64: encryptedPrivateBase64
      });
  
    } catch (error) {
      console.error("生成密钥失败: ", error);
    }
  },

  async changeSecondPassword(oldPassword, newPassword) {
    try {
      // 💡 业务建议：为了安全，前端或者后端最好先校验一下 oldPassword 是否正确
      // 这里省略校验逻辑，假设用户输入的新密码没问题
      
      const newBackupBase64 = await invoke("change_backup_password_cmd", {
        oldPassword:oldPassword,
        newPassword: newPassword
      });

      console.log("✅ 二次密码修改成功，历史聊天数据完全不受影响！");

      return newBackupBase64;

    } catch (error) {
      console.error("修改密码失败: ", error);
    }
  }
};