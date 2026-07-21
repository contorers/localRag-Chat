export class CryptoEngine {
  // ==============================================================================
  // 🔐 1. 双子星密钥对：生成、备份与恢复 (Key Generation & Recovery)
  // ==============================================================================

  /**
   * 🚀 【核心架构】：生成“双子星”密钥对、备份并锁定
   * 1. ECDSA: 专门用于聊天消息防篡改签名
   * 2. RSA-OAEP: 专门用于加密群聊房间 AES Key
   * @param {string} secondPassword 用户的二级验证密码
   */
  static async generateAndBackupAllKeys(secondPassword) {
    try {
      // 1. 生成临时可导出的 ECDSA 签名密钥对 (P-256)
      const ecdsaPair = await window.crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true, // 暂时允许导出
        ["sign", "verify"]
      );

      // 2. 生成临时可导出的 RSA 加密密钥对 (2048位)
      const rsaPair = await window.crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true, // 暂时允许导出
        ["encrypt", "decrypt"]
      );

      // 3. 导出私钥用于备份和重新锁定 (拿到的是 ArrayBuffer)
      const rawEcdsaPriv = await window.crypto.subtle.exportKey("pkcs8", ecdsaPair.privateKey);
      const rawRsaPriv = await window.crypto.subtle.exportKey("pkcs8", rsaPair.privateKey);

      // 4. 【打包】双私钥并用二级密码加密备份
      const privateKeysPayload = JSON.stringify({
        ecdsa: this._arrayBufferToBase64(rawEcdsaPriv), 
        rsa: this._arrayBufferToBase64(rawRsaPriv),
      });
      const backupData = await this._encryptPayloadForBackup(privateKeysPayload, secondPassword);

      // 5. 【关键锁定】以 extractable: false 重新导入，彻底封死 XSS 窃取可能！
      const permanentEcdsaPriv = await window.crypto.subtle.importKey(
        "pkcs8", rawEcdsaPriv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
      );
      const permanentRsaPriv = await window.crypto.subtle.importKey(
        "pkcs8", rawRsaPriv, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]
      );

      // 6. 处理公钥导出 (拿到的是 ArrayBuffer)
      const rawEcdsaPub = await window.crypto.subtle.exportKey("spki", ecdsaPair.publicKey);
      const rawRsaPub = await window.crypto.subtle.exportKey("spki", rsaPair.publicKey);

      // 7. 返回结果
      return {
        localPrivateKeys: {
          signKey: permanentEcdsaPriv,
          decryptKey: permanentRsaPriv,
        },
        publicKeysToUpload: {
          signPubKey: rawEcdsaPub,
          encryptPubKey: rawRsaPub,
          backupData: backupData,
        },
      };
    } catch (error) {
      console.error("[Crypto] 双子星密钥生成及备份失败:", error);
      throw error;
    }
  }

  /**
   * 🚀 【核心架构】：通过二级密码和备份数据，恢复出双私钥
   * @param {string|Uint8Array} backupData 从服务器拉取的 encrypted_private_keys
   * @param {string} password 用户的二级密码
   */
  static async restoreKeysFromBackup(backupData, password) {
    try {
      // 1. 判断输入类型并转为 Uint8Array
      const data = typeof backupData === "string"
        ? new Uint8Array(this._base64ToArrayBuffer(backupData))
        : new Uint8Array(backupData);

      // 2. 提取 Salt(16字节), IV(12字节), 密文
      const salt = data.slice(0, 16);
      const iv = data.slice(16, 28);
      const encrypted = data.slice(28);

      // 3. PBKDF2 派生 AES 解密密钥
      const encoder = new TextEncoder();
      const baseKey = await window.crypto.subtle.importKey(
        "raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]
      );
      const aesKey = await window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
      );

      // 4. 解密出 JSON 字符串
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv }, aesKey, encrypted
      );
      const payloadString = new TextDecoder().decode(decryptedBuffer);
      const keysObj = JSON.parse(payloadString);

      // 5. 将 JSON 里的 Base64 字符串转回 ArrayBuffer
      const rawEcdsaPriv = this._base64ToArrayBuffer(keysObj.ecdsa);
      const rawRsaPriv = this._base64ToArrayBuffer(keysObj.rsa);

      // 6. 🌟 导入为“可临时导出”的 CryptoKey 实例 (extractable: true，供存储层使用)
      const signKey = await window.crypto.subtle.importKey(
        "pkcs8", rawEcdsaPriv, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]
      );
      const decryptKey = await window.crypto.subtle.importKey(
        "pkcs8", rawRsaPriv, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]
      );

      return { signKey, decryptKey };
    } catch (error) {
      console.error("[Crypto] 恢复密钥失败:", error);
      throw new Error("密码错误或备份数据损坏");
    }
  }

  // ==============================================================================
  // ✉️ 2. 聊天消息：加密与解密 (Message AES-GCM)
  // ==============================================================================

  /**
   * 🌟 核心：使用房间密钥加密聊天消息内容
   * @param {string} plaintext - 用户输入的明文文本
   * @param {Uint8Array} rawRoomKey - 数据库拿出的房间密钥二进制流
   * @returns {Promise<Uint8Array>} 返回拼接好的 [IV(12) + 密文]
   */
  static async encryptMessageContentStr(plaintext, rawRoomKey) {
    try {
      const encodedMessage = new TextEncoder().encode(plaintext);

      // 导入 AES 密钥
      const aesKey = await window.crypto.subtle.importKey(
        "raw", rawRoomKey, { name: "AES-GCM" }, false, ["encrypt"]
      );

      // 生成 12 字节随机 IV 并加密
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv }, aesKey, encodedMessage
      );
      const ciphertext = new Uint8Array(encryptedBuffer);

      // 拼接 IV 和密文
      const combinedData = new Uint8Array(iv.length + ciphertext.length);
      combinedData.set(iv, 0);          // IV 占 0~11 字节
      combinedData.set(ciphertext, 12); // 密文占 12 往后

      return combinedData;
    } catch (error) {
      console.error("[Crypto] 消息加密失败:", error);
      throw new Error("加密消息失败");
    }
  }

  /**
   * 🌟 解密收到的聊天消息 (传入原始密钥字节流)
   * @param {Uint8Array} combinedData - 包含 IV(前12字节) 和 密文的合并流
   * @param {Uint8Array} rawRoomKey - 原始房间密钥二进制流
   * @returns {Promise<string>} 解密后的明文字符串
   */
  static async decryptMessageContentUnit(combinedData, rawRoomKey) {
    try {
      const data = new Uint8Array(combinedData);
      const iv = data.slice(0, 12);
      const ciphertext = data.slice(12);

      const aesKey = await window.crypto.subtle.importKey(
        "raw", rawRoomKey, { name: "AES-GCM" }, false, ["decrypt"]
      );

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv }, aesKey, ciphertext
      );

      return new TextDecoder().decode(decryptedBuffer);
    } catch (error) {
      console.error("[Crypto] 消息解密失败:", error);
      return "[消息解密失败或密钥不匹配]"; 
    }
  }

  /**
   * 🌟 解密收到的聊天消息 (传入 CryptoKey 对象实例)
   * 注：若业务层已预先 importKey，可直接调用此方法以提升性能
   * @param {Uint8Array} encryptedContentBytes 包含 IV(前12字节) 和密文
   * @param {CryptoKey} aesRoomKey 预先导入好的 AES 密钥实例
   * @returns {Promise<string>} 解密后的明文文本
   */
  static async decryptMessageContent(encryptedContentBytes, aesRoomKey) {
    try {
      const iv = encryptedContentBytes.slice(0, 12);
      const ciphertext = encryptedContentBytes.slice(12);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv }, aesRoomKey, ciphertext
      );

      return new TextDecoder().decode(decryptedBuffer);
    } catch (e) {
      console.error("[Crypto] 内容解密失败 (可能是密钥错误或非加密消息):", e);
      return "【系统提示：消息解密失败】";
    }
  }

  // ==============================================================================
  // ✍️ 3. 签名与防篡改 (Signature Verification)
  // ==============================================================================

  /**
   * 🚀 验证收到消息的 ECDSA 签名防篡改
   * @param {Uint8Array|ArrayBuffer} senderPubKeyBase64 发送者的公钥
   * @param {Uint8Array|ArrayBuffer} signatureBuffer 提取出的签名
   * @param {Uint8Array|ArrayBuffer} dataBuffer 提取出的纯净载荷
   * @returns {Promise<boolean>} 验签是否通过
   */
  static async verifyMessageSignature(senderPubKeyBase64, signatureBuffer, dataBuffer) {
    try {
      const publicKey = await window.crypto.subtle.importKey(
        "spki",
        senderPubKeyBase64,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );

      return await window.crypto.subtle.verify(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        publicKey,
        signatureBuffer,
        dataBuffer
      );
    } catch (e) {
      console.error("[Crypto] 验签过程发生异常:", e);
      return false;
    }
  }

  // ==============================================================================
  // 🛠️ 4. 底层密码学与编码工具箱 (Internal Utils)
  // ==============================================================================

  /**
   * 使用二级密码加密任意字符串 (PBKDF2 + AES-GCM)
   * 返回格式：Salt(16) + IV(12) + 密文Data
   */
  static async _encryptPayloadForBackup(payloadString, password) {
    const encoder = new TextEncoder();
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const baseKey = await window.crypto.subtle.importKey(
      "raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]
    );
    
    const aesKey = await window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );

    const dataToEncrypt = encoder.encode(payloadString);
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, aesKey, dataToEncrypt
    );

    // 格式拼装
    const result = new Uint8Array(salt.byteLength + iv.byteLength + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.byteLength);
    result.set(new Uint8Array(encrypted), salt.byteLength + iv.byteLength);

    return result.buffer;
  }

  /**
   * 压缩 ECDSA 公钥至 33 字节
   */
  static _compressPublicKey(rawPubBuffer) {
    const u8 = new Uint8Array(rawPubBuffer);
    const x = u8.slice(1, 33);
    const y = u8.slice(33);
    const prefix = (y[31] & 1) === 0 ? 0x02 : 0x03;
    const compressed = new Uint8Array(33);
    compressed[0] = prefix;
    compressed.set(x, 1);
    return compressed.buffer;
  }

  /**
   * 彻底解决堆栈溢出漏洞的 ArrayBuffer -> Base64 转换法
   */
  static _arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    // 使用传统循环，内存占用小且绝不崩溃
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * 高性能版：Base64 -> ArrayBuffer
   */
  static _base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
    return bytes.buffer;
  }

  /**
   * Base64 -> Uint8Array (业务层别名)
   */
  static base64ToUint8Array(base64String) {
    const binaryString = window.atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
}