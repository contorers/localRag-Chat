import { defineStore } from "pinia";
import { CryptoEngine } from "../utils/cryptoEngine.js";
import { globalKeyManager } from "../utils/keyManager.js";
import { showConfirm } from "../components/ui/ui-js/confirm.js";
import Long from 'long';

// 🌟 引入刚刚封装好的底层服务
import { UserDatabase } from "../rustservice/userDatabase.js";
import { CryptoDatabase } from "../rustservice/cryptoDatabase.js";

let restorePromise = null;

export const useUserStore = defineStore("loginUser", {
  state: () => ({
    localAvatarPath: "",
    userToken: null,
    userLevel:null,
    userInfo: null,
    userDeviceType: "",
    isLoading: false,
    isSessionRestored: false,
  }),

  getters: {
    isLoggedIn: (state) => !!state.userInfo,
    id: (state) => state.userInfo?.id || "",
    name: (state) => state.userInfo?.name || "",
    phone: (state) => state.userInfo?.phone || "",
    email: (state) => state.userInfo?.email || "",
    avatar: (state) => state.userInfo?.avatar || "",
    avatarUrl: (state) =>
      state.userInfo?.avatar ? imgBaseUrl + "/" + state.userInfo.avatar : "",
    mobile: (state) => state.userDeviceType,
    version: (state) => state.userInfo?.version || "",
    localAvatar: (state) => state.localAvatarPath || "",
  },

  actions: {
    async getUserInfo() {
      return this.userInfo;
     },
     async getUserKeys() {
try{
      const LOCAL_USER = "local_device_user";
      await UserDatabase.initRustDb(LOCAL_USER)

      const hasPrivateKey = await CryptoDatabase.hasKeys([
        "sign_public_key",
        "encrypt_public_key",
        "encrypted_private_keys"
      ]);
    
      if (!hasPrivateKey) {
        console.log("🆕 本地无密钥，生成新密钥...");
        const secondPassword = await this.promptUserForSecondPassword();
        try {
          await CryptoDatabase.setupNewDevice(secondPassword);
          await globalKeyManager.loadVaultFromDB(null);
          this.userInfo = { hasSecPwd: true }; // ← 先赋值对象
          console.log("🎉 新密钥生成完毕");
        } catch (error) {
          this.userInfo = null;
          console.error("❌ 密钥生成失败：", error);
        }
      } else {
        console.log("🔑 本地已有密钥，请输入密码解锁...");
        const isLoaded = await globalKeyManager.isVaultLoaded();
        if (isLoaded) {
          await globalKeyManager.loadVaultFromDB(null);
          this.userInfo = { hasSecPwd: true }; // ← 先赋值对象
          return;
        }
        const secondPassword = await this.promptUserForSecondPassword();
        try {
          await globalKeyManager.loadVaultFromDB(secondPassword);
          this.userInfo = { hasSecPwd: true }; // ← 先赋值对象
          console.log("✅ 金库解锁成功");
        } catch (error) {
          this.userInfo = null;
          console.error("❌ 密码错误或解密失败：", error);
        }
      }
    }catch(e){
      console.log(e)
    }
    },

    async promptUserForSecondPassword() {
      try {
        const password = await showConfirm({
          title: '安全验证',
          message: '请输入金库二级密码：',
          showInput: true,
          inputType: 'password'
        })
        if (password === "") {
          showAlert("error","密码不能为空！");
          return
        }
        return password;
      } catch (error) {
        throw new Error("用户取消了密码验证");
      }
    },

    parseJwt(token) {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
      );
      return JSON.parse(json);
    },

    resetState() {
      this.userInfo = null;
      this.userToken = null; // 确保清空
      this.userDeviceType = "";
      this.isLoading = false;
    },

    startLoading() {
      this.isLoading = true;
    },
    stopLoading() {
      this.isLoading = false;
    },
  },
});
