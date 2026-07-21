// src/db/mod.rs
use rusqlite::{Connection, Result};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub mod ai;
pub mod crypto;

// ============================================================================
// 1. 结构体定义 (Structs)
// ============================================================================

#[derive(Clone)]
pub struct AppDb {
    pub conn: Arc<Mutex<Connection>>,
    pub user_dir: PathBuf,
}

/// 全局数据库管理器，由 Tauri State 管理
pub struct DbManager {
    pub current_db: Mutex<Option<AppDb>>,
}

// ============================================================================
// 2. 核心逻辑实现 (Implementations)
// ============================================================================

impl DbManager {
    pub fn new() -> Self {
        Self {
            current_db: Mutex::new(None),
        }
    }

    /// 🌟 核心：大厂封装的终极语法糖
    pub fn get_db(&self) -> Result<AppDb, String> {
        let guard = self.current_db.lock().unwrap();
        // 如果有值，就克隆一份指针丢出去；如果是 None，直接抛出 String 类型的错误
        guard
            .clone()
            .ok_or_else(|| "🔴 数据库未挂载，用户尚未登录或会话已过期".to_string())
    }
}

impl AppDb {
    pub fn new<P: AsRef<Path>>(db_path: P, user_dir: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // 开启 WAL 模式，极大提升并发读写性能（非常适合 IM 这种高频读写的 Local-First 场景）
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        for sql in CORE_SCHEMA_SQL.split(';').filter(|s| !s.trim().is_empty()) {
            if let Err(e) = conn.execute(sql, []) {
                eprintln!("执行失败: {}\n错误: {}", sql, e);
            }
        }
        // 🌟 执行分离出来的顶层 SQL 常量，代码瞬间清爽
        conn.execute_batch(CORE_SCHEMA_SQL)?;

        println!("🚀 SQLite 核心架构初始化完毕，20 张表及其联合索引已挂载！");

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            user_dir,
        })
    }

    pub fn close(self) -> rusqlite::Result<()> {
        let count = Arc::strong_count(&self.conn);
        println!("🔍 关闭时 Arc 引用计数: {}", count);

        // 尝试拿到 Arc 的唯一所有权
        match Arc::try_unwrap(self.conn) {
            Ok(mutex) => {
                let conn = mutex.into_inner().unwrap();
                // WAL checkpoint：把 WAL 文件内容写回主库，之后 -wal/-shm 才能被删
                conn.pragma_update(None, "wal_checkpoint", "TRUNCATE")?;
                // conn 在这里 drop，rusqlite 自动关闭文件句柄
                drop(conn);
                Ok(())
            }
            Err(_arc) => {
                println!("❌ 还有 {} 个引用未释放", Arc::strong_count(&_arc));
                // Arc 还有其他引用者，无法独占关闭
                // 至少做一次 checkpoint
                let arc = _arc;
                let conn = arc.lock().unwrap();
                conn.pragma_update(None, "wal_checkpoint", "TRUNCATE")?;
                Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
                    Some("连接还有其他引用，无法完全关闭".to_string()),
                ))
            }
        }
    }
}

// ============================================================================
// 3. 辅助函数 (Helpers)
// ============================================================================

pub fn get_user_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let manager = app_handle.state::<crate::db::DbManager>();
    let db_guard = manager.current_db.lock().unwrap();

    if let Some(app_db) = db_guard.as_ref() {
        Ok(app_db.user_dir.clone())
    } else {
        Err("本地数据库未挂载，用户可能未登录".to_string())
    }
}

// ============================================================================
// 4. 数据库初始化 DDL (建表、索引与 FTS5 触发器)
// ============================================================================
// 将一大片 SQL 移到底部（或者单独的模块）作为常量，避免污染核心业务逻辑的阅读体验
const CORE_SCHEMA_SQL: &str = r#"
BEGIN;

-- ==========================================
-- 1. AI 与 系统设置 (AI & Settings)
-- ==========================================
CREATE TABLE IF NOT EXISTS api_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER,
    model_type TEXT,
    is_default INTEGER, -- 0 or 1
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_models_provider ON api_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_api_models_type ON api_models(model_type);

CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL
);

-- ==========================================
-- 2. 聊天与本地 RAG (Chat & Vectors)
-- ==========================================
CREATE TABLE IF NOT EXISTS chat_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER,
    timestamp INTEGER,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_list_model_time ON chat_list(model_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    timestamp INTEGER,
    embedding BLOB,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_time ON chat_messages(chat_id, timestamp DESC);

-- FTS5 全文检索引擎
CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
    content,
    reasoning,     
    tokenize='unicode61'     
);


CREATE TABLE IF NOT EXISTS vectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    timestamp INTEGER,
    embedding BLOB,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vectors_chat_id ON vectors(chat_id);

-- ==========================================
-- 3. 财务流水 (Finance)
-- ==========================================
CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER,
    deposit_type TEXT,
    source TEXT,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deposits_time ON deposits(timestamp DESC);

CREATE TABLE IF NOT EXISTS tokenlogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER,
    token_type TEXT,
    model_name TEXT,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokenlogs_time ON tokenlogs(timestamp DESC);

-- ==========================================
-- 4. 核心通信与用户关系 (IM Core)
-- ==========================================
CREATE TABLE IF NOT EXISTS messages (
    client_msg_id TEXT PRIMARY KEY,   
    id TEXT UNIQUE,                   
    room_id TEXT NOT NULL,
    timestamp INTEGER,
    file BLOB,
    payload TEXT NOT NULL,
    sync_status INTEGER DEFAULT 0 
);
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id, id DESC);

CREATE TABLE IF NOT EXISTS sessions (
    room_id TEXT PRIMARY KEY,
    type INTEGER,             
    owner_id TEXT,            
    unique_key TEXT,          
    unread_count INTEGER DEFAULT 0, 
    is_top INTEGER DEFAULT 0,       
    last_msg_time INTEGER DEFAULT 0,
    update_time INTEGER,      
    payload TEXT NOT NULL,    
    sync_status INTEGER DEFAULT 0 
);
CREATE INDEX IF NOT EXISTS idx_sessions_top_update ON sessions(is_top DESC, update_time DESC);

CREATE TABLE IF NOT EXISTS contacts (
    user_id TEXT PRIMARY KEY,
    name TEXT,
    avatar TEXT,            
    local_avatar_path TEXT, 
    version INTEGER,        
    update_time INTEGER,
    payload TEXT            
);

CREATE TABLE IF NOT EXISTS friend_requests (
    request_id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,       
    receiver_id TEXT NOT NULL,     
    status INTEGER,                
    create_time INTEGER NOT NULL,  
    update_time INTEGER,           
    payload TEXT,                  
    sync_status INTEGER DEFAULT 0 
);
CREATE INDEX IF NOT EXISTS idx_receiver_id ON friend_requests(receiver_id);
CREATE INDEX IF NOT EXISTS idx_sender_id ON friend_requests(sender_id);

CREATE TABLE IF NOT EXISTS group_requests (
    request_id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,       
    receiver_id TEXT NOT NULL,     
    room_id TEXT NOT NULL,         
    status INTEGER,                
    create_time INTEGER NOT NULL,  
    update_time INTEGER,           
    payload TEXT,                  
    sync_status INTEGER DEFAULT 0  
);
CREATE INDEX IF NOT EXISTS idx_group_req_receiver ON group_requests(receiver_id);
CREATE INDEX IF NOT EXISTS idx_group_req_sender ON group_requests(sender_id);
CREATE INDEX IF NOT EXISTS idx_group_req_room ON group_requests(room_id);

CREATE TABLE IF NOT EXISTS friends (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE,               
    update_time INTEGER,               
    status INTEGER DEFAULT 0,
    payload TEXT,           
    sync_status INTEGER DEFAULT 0      
);
CREATE INDEX IF NOT EXISTS idx_friends_time ON friends(update_time DESC);

CREATE TABLE IF NOT EXISTS members (
    id TEXT,                    
    room_id TEXT,
    user_id TEXT,
    update_time INTEGER,
    room_status INTEGER DEFAULT 0,
    payload TEXT NOT NULL,
    sync_status INTEGER DEFAULT 0,      
    PRIMARY KEY (room_id, user_id) 
);
CREATE INDEX IF NOT EXISTS idx_members_room_time_id ON members(room_id, update_time DESC, id DESC);

CREATE TABLE IF NOT EXISTS head_img (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT UNIQUE, 
    timestamp INTEGER,
    avatar_name TEXT,
    file_path TEXT NOT NULL,
    payload BLOB NOT NULL,
    sync_status INTEGER DEFAULT 0 
);
CREATE INDEX IF NOT EXISTS idx_head_img_time ON head_img(timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_head_img_server_id ON head_img(server_id);
CREATE INDEX IF NOT EXISTS idx_head_img_avatar ON head_img(avatar_name);

CREATE TABLE IF NOT EXISTS topic_status (
    id TEXT PRIMARY KEY,
    timestamp INTEGER,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topic_status_timestamp ON topic_status(timestamp);

-- ==========================================
-- 5. 端到端加密密钥存储 (Crypto & E2EE)
-- ==========================================
CREATE TABLE IF NOT EXISTS room_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    key_version INTEGER NOT NULL,
    timestamp INTEGER,
    payload TEXT NOT NULL,
    UNIQUE(room_id, key_version) 
);

CREATE TABLE IF NOT EXISTS user_public_keys (
    user_id TEXT PRIMARY KEY,
    update_time INTEGER,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS key_store (
    key_name TEXT PRIMARY KEY, 
    payload TEXT NOT NULL
);

-- ==========================================
-- 6. 系统临时提示 (system & redhot)
-- ==========================================
CREATE TABLE IF NOT EXISTS system_status (
    id TEXT PRIMARY KEY CHECK (id = 'global'), 
    payload TEXT NOT NULL,                     
    updated_time INTEGER NOT NULL              
);

COMMIT;
"#;