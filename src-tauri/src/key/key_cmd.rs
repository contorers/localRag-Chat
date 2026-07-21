// src/commands/key_cmd.rs
use std::sync::Arc;
use tokio::task::JoinHandle;
use tokio::sync::Semaphore;

// Tauri & Serde
use tauri::State;
use serde::{Serialize, Deserialize};
use serde_json::Value;

// ==========================================
// 密码学库引入 (Cryptography)
// ==========================================
// RSA
use rsa::{RsaPrivateKey, Oaep};
use rsa::pkcs8::{DecodePrivateKey as RsaDecodePrivateKey, EncodePrivateKey as RsaEncodePriv, EncodePublicKey as RsaEncodePub};
// P-256 (ECDSA)
use p256::ecdsa::{SigningKey, signature::Signer, Signature};
use p256::pkcs8::{DecodePrivateKey as P256DecodePrivateKey, EncodePrivateKey as P256EncodePriv, EncodePublicKey as P256EncodePub};
// AES-GCM & KDF & Hash
use aes_gcm::{Aes256Gcm, Key, Nonce, aead::{Aead, KeyInit}};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;
// Rand & Base64
use rand::rngs::OsRng;
use rand::RngCore;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};

// ==========================================
// 本地模块引入 (Local Modules)
// ==========================================
use crate::db::crypto::KeyStoreItem;
use crate::key::key_manager::{SecureKeys, KeyManager};
use crate::db::DbManager;


// ==========================================
// 1. 生命周期管理：装载与销毁
// ==========================================
#[tauri::command]
pub async fn load_keys_to_vault_cmd(
    second_password: String,
    key_state: State<'_, KeyManager>,
    db_state: State<'_, DbManager>,
) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;

    // 🎯 修复 Bug 2：get_key_store_item 返回 Option<KeyStoreItem>，需要 .ok_or()?.payload
    let encrypted_backup_base64 = app_db
        .get_key_store_item("encrypted_private_keys")
        .map_err(|e| e.to_string())?
        .ok_or("🚨 数据库缺失: encrypted_private_keys")?
        .payload;

    let sign_pub = app_db
        .get_key_store_item("sign_public_key")
        .map_err(|e| e.to_string())?
        .ok_or("🚨 数据库缺失: sign_public_key")?
        .payload;

    let enc_pub = app_db
        .get_key_store_item("encrypt_public_key")
        .map_err(|e| e.to_string())?
        .ok_or("🚨 数据库缺失: encrypt_public_key")?
        .payload;

    let encrypted_bytes = BASE64_STANDARD
        .decode(&encrypted_backup_base64)
        .map_err(|_| "备份数据 Base64 解码失败".to_string())?;

    let decrypted_json_str = tokio::task::spawn_blocking(move || {
        decrypt_backup_payload(&encrypted_bytes, &second_password)
    })
    .await
    .map_err(|_| "解密线程调度失败".to_string())?
    .map_err(|e| e)?;

    let parsed_keys: Value = serde_json::from_str(&decrypted_json_str)
        .map_err(|_| "解密后的私钥包格式错误".to_string())?;

    // 🎯 修复 Bug 1 & 3：变量名统一，直接提取 String，不再嵌套 Option 判断
    let sign_priv = parsed_keys["ecdsa"]
        .as_str()
        .ok_or("缺失 ECDSA 私钥")?
        .to_string();

    let encrypt_priv = parsed_keys["rsa"]   // 修复 Bug 1：enc_priv → encrypt_priv
        .as_str()
        .ok_or("缺失 RSA 私钥")?
        .to_string();

    let mut keys_guard = key_state.keys.write().await;
    *keys_guard = Some(SecureKeys {
        sign_private: sign_priv,
        encrypt_private: encrypt_priv,
        sign_public: sign_pub,
        encrypt_public: enc_pub,
    });

    println!("✅ 金库装载成功！四大密钥已就位。");
    Ok(())
}

#[tauri::command]
pub async fn is_vault_loaded_cmd(
    key_state: State<'_, KeyManager>,
) -> Result<bool, String> {
    let keys_guard = key_state.keys.read().await;
    
    // 🌟 核心修复：不光要看 Option 是不是 Some，还要深入检查里面的字符串是不是空壳
    if let Some(keys) = &*keys_guard {
        if !keys.encrypt_private.is_empty() 
            && !keys.sign_private.is_empty() 
            && !keys.encrypt_public.is_empty() 
            && !keys.sign_public.is_empty() 
        {
            return Ok(true);
        } else {
            println!("⚠️ 警告：检测到金库存在内存幽灵状态（外壳存在但内容为空）");
        }
    }
    
    Ok(false)
}

#[tauri::command]
pub async fn reset_vault_cmd(key_state: State<'_, KeyManager>) -> Result<(), String> {
    key_state.reset().await;
    Ok(())
}


// ==========================================
// 2. 密码学黑盒代理 (HSM Pattern)
// ==========================================

#[tauri::command]
pub async fn sign_message_cmd(
    key_state: State<'_, KeyManager>,
    payload: String, // JS 传进来的明文消息
) -> Result<String, String> {
    let keys_guard = key_state.keys.read().await;
    
    if let Some(secure_keys) = &*keys_guard {
        // 🌟 1. 剥离外衣：还原为原生 DER 字节数组
        let private_key_der = BASE64_STANDARD.decode(&secure_keys.sign_private)
            .map_err(|e| format!("签名私钥 Base64 解码失败: {}", e))?;

        // 🌟 2. 注入灵魂：解析出真正的 ECDSA P-256 签名私钥对象
        let signing_key = SigningKey::from_pkcs8_der(&private_key_der)
            .map_err(|e| format!("ECDSA 私钥解析失败: {}", e))?;
            
        // 🌟 3. 执行签名
        let signature: Signature = signing_key.sign(payload.as_bytes());
        
        // 🌟 4. 穿上外衣：编码为 Base64 返回给前端
        Ok(BASE64_STANDARD.encode(signature.to_bytes()))
    } else {
        Err("Vault 未装载，无法签名！".to_string())
    }
}

#[tauri::command]
pub async fn decrypt_message_cmd(
    key_state: State<'_, KeyManager>,
    ciphertext: String,
) -> Result<String, String> {
    // 🌟 提前释放锁逻辑：克隆私钥字符串，读锁瞬间释放
    let encrypt_private_str = {
        let keys_guard = key_state.keys.read().await;
        if let Some(secure_keys) = &*keys_guard {
            secure_keys.encrypt_private.clone()
        } else {
            return Err("Vault 未装载，无法解密！".to_string());
        }
    }; // <--- 读锁在这里被销毁释放，绝对安全了

    let private_key_der = BASE64_STANDARD.decode(&encrypt_private_str)
        .map_err(|e| format!("私钥解码失败: {}", e))?;
    let private_key = RsaPrivateKey::from_pkcs8_der(&private_key_der)
        .map_err(|e| format!("RSA 私钥解析失败: {}", e))?;
    let encrypted_bytes = BASE64_STANDARD.decode(&ciphertext)
        .map_err(|e| format!("密文解码失败: {}", e))?;

    let decrypted_bytes = tokio::task::spawn_blocking(move || {
        let padding = Oaep::new::<Sha256>();
        private_key.decrypt(padding, &encrypted_bytes)
    })
    .await
    .map_err(|_| "线程池调度失败".to_string())?
    .map_err(|e| format!("RSA 解密失败: {}", e))?;

    Ok(BASE64_STANDARD.encode(decrypted_bytes))
}

#[tauri::command]
pub async fn decrypt_message_batch_cmd(
    key_state: State<'_, KeyManager>,
    ciphertexts: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    let encrypt_private_str = {
        let keys_guard = key_state.keys.read().await;
        if let Some(secure_keys) = &*keys_guard {
            secure_keys.encrypt_private.clone()
        } else {
            return Err("Vault 未装载，无法解密！".to_string());
        }
    };

    let private_key_der = BASE64_STANDARD
        .decode(&encrypt_private_str)
        .map_err(|e| format!("私钥解码失败: {}", e))?;
    let private_key = RsaPrivateKey::from_pkcs8_der(&private_key_der)
        .map_err(|e| format!("RSA 私钥解析失败: {}", e))?;

    let arc_key = Arc::new(private_key);
    // 🎯 修复隐患 5：限制最大并发解密任务数，避免打爆线程池
    let semaphore = Arc::new(Semaphore::new(4));
    let mut tasks: Vec<JoinHandle<Option<String>>> = Vec::new();

    for ciphertext in ciphertexts {
        let key_clone = Arc::clone(&arc_key);
        let sem_clone = Arc::clone(&semaphore);
    
        let task = tokio::spawn(async move {
            // ✅ 在 async 块里 .await 拿票，自动限流
            let _permit = sem_clone.acquire().await.ok()?;
    
            let key = key_clone.clone();
            tokio::task::spawn_blocking(move || {
                let encrypted_bytes = BASE64_STANDARD.decode(&ciphertext).ok()?;
                let padding = Oaep::new::<Sha256>();
                key.decrypt(padding, &encrypted_bytes)
                    .ok()
                    .map(|d| BASE64_STANDARD.encode(d))
            })
            .await
            .ok()?   // JoinError
        });
    
        tasks.push(task);
    }

    let mut results = Vec::with_capacity(tasks.len());
    for task in tasks {
        results.push(task.await.unwrap_or(None));
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_public_key_cmd(
    key_state: State<'_, KeyManager>, 
    key_type: String
) -> Result<String, String> {
    let keys_guard = key_state.keys.read().await;
    
    if let Some(secure_keys) = &*keys_guard {
        let key = match key_type.as_str() {
            "sign" => secure_keys.sign_public.clone(),
            "encrypt" => secure_keys.encrypt_public.clone(),
            _ => return Err("未知的公钥类型".to_string()),
        };

        // 🌟 核心修复：如果取出来是空字符串，也当做未装载报错！
        if key.is_empty() {
            return Err("公钥内容为空，金库数据可能已损坏！".to_string());
        }

        Ok(key)
    } else {
        Err("Vault 未装载，无法获取公钥！".to_string())
    }
}

// ==========================================
// 3. 密钥生成与加密备份 (Generate & Backup)
// ==========================================

#[derive(Serialize)]
pub struct GenerateKeysResponse {
    pub sign_private_base64: String,    
    pub encrypt_private_base64: String, 
    pub sign_public_base64: String,     
    pub encrypt_public_base64: String,  
    pub backup_data: String,            
}

#[tauri::command]
pub async fn generate_and_backup_all_keys_cmd(
    second_password: String,
    db_state: State<'_, DbManager>,
    key_state: State<'_, KeyManager>,
) -> Result<GenerateKeysResponse, String> {
    // 🌟 1. 生成 ECDSA P-256 签名密钥对
    let mut rng = OsRng;
    let signing_key = SigningKey::random(&mut rng);
    let ecdsa_priv_der = signing_key.to_pkcs8_der().map_err(|e| format!("ECDSA 私钥导出失败: {}", e))?.to_bytes();
    let ecdsa_pub_der = signing_key.verifying_key().to_public_key_der().map_err(|e| format!("ECDSA 公钥导出失败: {}", e))?.into_vec();

    // 🌟 2. 生成 RSA 2048 加密密钥对
    let rsa_priv = tokio::task::spawn_blocking(move || {
        let mut thread_rng = OsRng;
        RsaPrivateKey::new(&mut thread_rng, 2048)
    })
    .await
    .map_err(|_| "RSA 生成线程调度失败".to_string())?
    .map_err(|e| format!("RSA 密钥生成失败: {}", e))?;

    let rsa_priv_der = rsa_priv.to_pkcs8_der().map_err(|e| format!("RSA 私钥导出失败: {}", e))?.to_bytes();
    let rsa_pub = rsa_priv.to_public_key();
    let rsa_pub_der = rsa_pub.to_public_key_der().map_err(|e| format!("RSA 公钥导出失败: {}", e))?.into_vec();

    // 🌟 3. 转换为 Base64 字符串
    let ecdsa_priv_b64 = BASE64_STANDARD.encode(&ecdsa_priv_der);
    let ecdsa_pub_b64 = BASE64_STANDARD.encode(&ecdsa_pub_der);
    let rsa_priv_b64 = BASE64_STANDARD.encode(&rsa_priv_der);
    let rsa_pub_b64 = BASE64_STANDARD.encode(&rsa_pub_der);

    // 🌟 4. 将两个私钥打包为 JSON 字符串
    let private_keys_payload = serde_json::json!({
        "ecdsa": ecdsa_priv_b64,
        "rsa": rsa_priv_b64
    }).to_string();

    // 🌟 5. 使用二级密码进行高强度 AES-GCM 加密
    let backup_data = tokio::task::spawn_blocking(move || {
        encrypt_backup_payload(&private_keys_payload, &second_password)
    })
    .await
    .map_err(|_| "加密备份线程调度失败".to_string())?
    .map_err(|e| e)?;

    // 🌟 6. 保存到本地数据库
    let items_to_save = vec![
        KeyStoreItem {
            key_name: "sign_public_key".to_string(),
            payload: ecdsa_pub_b64.clone(),
        },
        KeyStoreItem {
            key_name: "encrypt_public_key".to_string(),
            payload: rsa_pub_b64.clone(),
        },
        KeyStoreItem {
            key_name: "encrypted_private_keys".to_string(),
            payload: backup_data.clone(),
        },
    ];

    let app_db = db_state.get_db().map_err(|e| format!("获取数据库连接失败: {}", e))?;

    app_db.upsert_key_store_items(items_to_save)
        .map_err(|e| format!("批量保存密钥到数据库失败: {}", e))?;

    // 🌟 7. 装载进内存金库 (Vault)
    let mut keys_guard = key_state.keys.write().await;
    *keys_guard = Some(SecureKeys {
        sign_private: ecdsa_priv_b64.clone(),
        encrypt_private: rsa_priv_b64.clone(),
        sign_public: ecdsa_pub_b64.clone(),
        encrypt_public: rsa_pub_b64.clone(),
    });

    // 🌟 8. 返回结果
    Ok(GenerateKeysResponse {
        sign_private_base64: ecdsa_priv_b64,
        encrypt_private_base64: rsa_priv_b64,
        sign_public_base64: ecdsa_pub_b64,
        encrypt_public_base64: rsa_pub_b64,
        backup_data,
    })
}

/// 辅助函数：使用 PBKDF2 派生密钥并使用 AES-256-GCM 加密数据
fn encrypt_backup_payload(payload: &str, password: &str) -> Result<String, String> {
    let mut rng = OsRng;

    let mut salt = [0u8; 16];
    rng.fill_bytes(&mut salt);

    let mut nonce_bytes = [0u8; 12];
    rng.fill_bytes(&mut nonce_bytes);

    let mut derived_key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, 600_000, &mut derived_key);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&derived_key));
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, payload.as_bytes())
        .map_err(|e| format!("AES-GCM 加密失败: {:?}", e))?;

    let mut final_data = Vec::with_capacity(salt.len() + nonce_bytes.len() + ciphertext.len());
    final_data.extend_from_slice(&salt);
    final_data.extend_from_slice(&nonce_bytes);
    final_data.extend_from_slice(&ciphertext);

    Ok(BASE64_STANDARD.encode(&final_data))
}


// ==========================================
// 4. 密钥恢复与装载 (Restore & Load)
// ==========================================

#[tauri::command]
pub async fn restore_and_load_keys_cmd(
    db_state: State<'_, DbManager>,
    key_state: State<'_, KeyManager>,
    second_password: String,
    sign_pub_base64: String,
    encrypt_pub_base64: String,
    encrypted_backup_base64: String,
) -> Result<(), String> {
    
    
    // 1. 将 Base64 密文解码为二进制
    let encrypted_bytes = BASE64_STANDARD.decode(&encrypted_backup_base64)
        .map_err(|_| "备份数据 Base64 解码失败".to_string())?;

    // 2. 阻塞线程解密 (PBKDF2)
    let decrypted_json_str = tokio::task::spawn_blocking(move || {
        decrypt_backup_payload(&encrypted_bytes, &second_password)
    })
    .await
    .map_err(|_| "解密线程调度失败".to_string())?
    .map_err(|e| e)?;

    // 3. 解析 JSON，提取双私钥
    let parsed_keys: Value = serde_json::from_str(&decrypted_json_str)
        .map_err(|_| "解密后的私钥包格式错误".to_string())?;
        
    let sign_priv_base64 = parsed_keys["ecdsa"].as_str()
        .ok_or("缺失 ECDSA 私钥")?.to_string();
    let encrypt_priv_base64 = parsed_keys["rsa"].as_str()
        .ok_or("缺失 RSA 私钥")?.to_string();

    // 4. 🌟 批量保存至本地 SQLite 数据库
    let app_db = db_state.get_db().map_err(|e| format!("获取数据库连接失败: {}", e))?;
    
    let items_to_save = vec![
        KeyStoreItem {
            key_name: "sign_public_key".to_string(),
            payload: sign_pub_base64.clone(),
        },
        KeyStoreItem {
            key_name: "encrypt_public_key".to_string(),
            payload: encrypt_pub_base64.clone(),
        },
        KeyStoreItem {
            key_name: "encrypted_private_keys".to_string(),
            payload: encrypted_backup_base64.clone(),
        },
    ];

    app_db.upsert_key_store_items(items_to_save)
        .map_err(|e| format!("批量保存密钥到数据库失败: {}", e))?;

    // 5. 装载进内存金库 (Vault)
    let mut keys_guard = key_state.keys.write().await;
    *keys_guard = Some(SecureKeys {
        sign_private: sign_priv_base64,
        encrypt_private: encrypt_priv_base64,
        sign_public: sign_pub_base64,
        encrypt_public: encrypt_pub_base64,
    });

    println!("✅ 历史密钥恢复并装载成功！");
    Ok(())
}

/// 辅助函数：解密服务器下发的备份数据
fn decrypt_backup_payload(data: &[u8], password: &str) -> Result<String, String> {
    if data.len() < 16 + 12 + 16 {
        return Err("备份数据已损坏或长度异常".to_string());
    }

    let salt = &data[0..16];
    let nonce_bytes = &data[16..28];
    let ciphertext = &data[28..];

    let mut derived_key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, 600_000, &mut derived_key);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&derived_key));
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext_bytes = cipher.decrypt(nonce, ciphertext)
        .map_err(|_| "密码错误或数据被篡改".to_string())?;

    String::from_utf8(plaintext_bytes)
        .map_err(|_| "解密后的明文不是合法的 UTF-8 字符串".to_string())
}


// ==========================================
// 5. 修改保险箱密码 (Change Password)
// ==========================================
#[tauri::command]
pub async fn change_backup_password_cmd(
    db_state: State<'_, DbManager>,
    key_state: State<'_, KeyManager>,
    old_password: String,
    new_password: String,
) -> Result<String, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;

    let encrypted_backup = app_db
        .get_key_store_item("encrypted_private_keys")
        .map_err(|e| e.to_string())?
        .ok_or("缺失密文数据")?
        .payload;

    let encrypted_bytes = BASE64_STANDARD
        .decode(&encrypted_backup)
        .map_err(|_| "密文解码失败".to_string())?;

    // 验证旧密码
    let _ = tokio::task::spawn_blocking(move || {
        decrypt_backup_payload(&encrypted_bytes, &old_password)
    })
    .await
    .map_err(|_| "解密线程失败".to_string())?
    .map_err(|_| "原二次密码错误，拒绝修改！".to_string())?;

    // 从内存取明文
    let keys_guard = key_state.keys.read().await;
    let keys = keys_guard.as_ref().ok_or("密钥未装载，请先确保已登录")?;

    let private_keys_payload = serde_json::json!({
        "ecdsa": keys.sign_private,
        "rsa": keys.encrypt_private
    })
    .to_string();

    // 用新密码重新加密
    let new_backup_base64 = tokio::task::spawn_blocking(move || {
        encrypt_backup_payload(&private_keys_payload, &new_password)
    })
    .await
    .map_err(|_| "加密线程调度失败".to_string())?
    .map_err(|e| e)?;

    // 🎯 修复 Bug 4：写回数据库，不能只返回给前端了事
    drop(keys_guard); // 提前释放读锁，避免 get_db 之后卡住
    app_db
        .upsert_key_store_items(vec![KeyStoreItem {
            key_name: "encrypted_private_keys".to_string(),
            payload: new_backup_base64.clone(),
        }])
        .map_err(|e| format!("新密文写入数据库失败: {}", e))?;

    println!("✅ 保险箱密码修改成功，新密文已落库。");
    Ok(new_backup_base64) // 仍然返回给前端，以便做备份导出
}