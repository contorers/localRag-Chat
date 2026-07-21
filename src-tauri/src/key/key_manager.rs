use std::sync::Arc;
use tokio::sync::RwLock;
use zeroize::{Zeroize, ZeroizeOnDrop};

// 1. 定义安全的密钥载体
// ZeroizeOnDrop 保证变量离开作用域或被销毁时，内存会被自动擦写为 0
#[derive(Default, Zeroize, ZeroizeOnDrop)]
pub struct SecureKeys {
    pub sign_private: String,
    pub encrypt_private: String,
    pub sign_public: String,
    pub encrypt_public: String,
}

// 2. 定义全局管理器
pub struct KeyManager {
    // 使用读写锁保证多线程安全，使用 Option 代表密钥是否已装载
    pub keys: Arc<RwLock<Option<SecureKeys>>>,
}

impl KeyManager {
    pub fn new() -> Self {
        Self {
            keys: Arc::new(RwLock::new(None)),
        }
    }

    // 登出时调用：彻底销毁内存中的密钥
    pub async fn reset(&self) {
        let mut write_guard = self.keys.write().await;
        // 当赋值为 None 时，旧的 SecureKeys 会被 Drop，触发 ZeroizeOnDrop 自动清空内存
        *write_guard = None;
        println!("[Rust Vault] 🧹 所有密钥已从内存中安全擦除！");
    }
}