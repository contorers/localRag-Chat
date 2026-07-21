// src/db/im.rs
use super::AppDb; // 引入 mod.rs 里的 AppDb
use rusqlite::{OptionalExtension, Result}; // 👈 必须引入 OptionalExtension 才能用 .optional()
use serde::{Deserialize, Serialize}; // 👈 必须引入 serde 用于前后端数据序列化


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomKey {
    pub id: Option<i64>, // 本地自增 ID，插入时传 None 即可
    pub room_id: String,
    pub key_version: i64,
    pub timestamp: i64,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPublicKey {
    pub user_id: String,
    pub update_time: i64,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStoreItem {
    pub key_name: String,
    pub payload: String,
}


impl AppDb {

// ==========================================
// 表 1：room_keys (群组加密密钥)
// ==========================================

pub fn get_room_key(&self, room_id: &str, key_version: i64) -> Result<Option<RoomKey>> {
    let guard = self.conn.lock().unwrap();
    guard.query_row(
        "SELECT id, room_id, key_version, timestamp, payload FROM room_keys WHERE room_id = ?1 AND key_version = ?2",
        rusqlite::params![room_id, key_version],
        |row| Ok(RoomKey {
            id: row.get(0)?,
            room_id: row.get(1)?,
            key_version: row.get(2)?,
            timestamp: row.get(3)?,
            payload: row.get(4)?,
        })
    ).optional()
}

pub fn upsert_room_keys(&self, keys: Vec<RoomKey>) -> Result<()> {
    if keys.is_empty() { return Ok(()); }
    let mut guard = self.conn.lock().unwrap();
    let tx = guard.transaction()?;

    let mut stmt = tx.prepare(
        "INSERT INTO room_keys (room_id, key_version, timestamp, payload)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(room_id, key_version) DO UPDATE SET
            timestamp = excluded.timestamp,
            payload = excluded.payload"
    )?;

    for key in keys {
        stmt.execute(rusqlite::params![key.room_id, key.key_version, key.timestamp, key.payload])?;
    }
    drop(stmt);
    tx.commit()?;
    Ok(())
}

pub fn delete_room_key(&self, room_id: &str, key_version: i64) -> Result<()> {
    let guard = self.conn.lock().unwrap();
    guard.execute(
        "DELETE FROM room_keys WHERE room_id = ?1 AND key_version = ?2",
        rusqlite::params![room_id, key_version],
    )?;
    Ok(())
}

// ==========================================
// 表 2：user_public_keys (用户公钥/身份密钥)
// ==========================================

pub fn get_user_public_keys(&self, user_ids: Vec<String>) -> Result<Vec<UserPublicKey>> {
    let guard = self.conn.lock().unwrap();
    // 提前准备 SQL 语句，极速复用
    let mut stmt = guard.prepare(
        "SELECT user_id, update_time, payload FROM user_public_keys WHERE user_id = ?1"
    )?;
    
    let mut results = Vec::with_capacity(user_ids.len());
    
    for uid in user_ids {
        if let Ok(Some(key)) = stmt.query_row(rusqlite::params![uid], |row| {
            Ok(UserPublicKey {
                user_id: row.get(0)?,
                update_time: row.get(1)?,
                payload: row.get(2)?,
            })
        }).optional() {
            results.push(key);
        }
    }
    
    Ok(results)
}

pub fn upsert_user_public_keys(&self, keys: Vec<UserPublicKey>) -> Result<()> {
    if keys.is_empty() { return Ok(()); }
    let mut guard = self.conn.lock().unwrap();
    let tx = guard.transaction()?;

    let mut stmt = tx.prepare(
        "INSERT INTO user_public_keys (user_id, update_time, payload)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET
            update_time = excluded.update_time,
            payload = excluded.payload"
    )?;

    for key in keys {
        stmt.execute(rusqlite::params![key.user_id, key.update_time, key.payload])?;
    }
    drop(stmt);
    tx.commit()?;
    Ok(())
}

pub fn delete_user_public_key(&self, user_id: &str) -> Result<()> {
    let guard = self.conn.lock().unwrap();
    guard.execute("DELETE FROM user_public_keys WHERE user_id = ?1", rusqlite::params![user_id])?;
    Ok(())
}

// ==========================================
// 表 3：key_store (本地私钥及其他加密素材存储)
// ==========================================

pub fn get_key_store_item(&self, key_name: &str) -> Result<Option<KeyStoreItem>> {
    let guard = self.conn.lock().unwrap();
    guard.query_row(
        "SELECT key_name, payload FROM key_store WHERE key_name = ?1",
        rusqlite::params![key_name],
        |row| Ok(KeyStoreItem {
            key_name: row.get(0)?,
            payload: row.get(1)?,
        })
    ).optional()
}

pub fn upsert_key_store_items(&self, items: Vec<KeyStoreItem>) -> Result<()> {
    if items.is_empty() { return Ok(()); }
    let mut guard = self.conn.lock().unwrap();
    let tx = guard.transaction()?;

    let mut stmt = tx.prepare(
        "INSERT INTO key_store (key_name, payload)
         VALUES (?1, ?2)
         ON CONFLICT(key_name) DO UPDATE SET
            payload = excluded.payload"
    )?;

    for item in items {
        stmt.execute(rusqlite::params![item.key_name, item.payload])?;
    }
    drop(stmt);
    tx.commit()?;
    Ok(())
}

pub fn has_keys(&self, key_names: Vec<String>) -> Result<bool> {
    if key_names.is_empty() {
        return Ok(true);
    }

    let guard = self.conn.lock().unwrap();
    
    // 动态生成占位符 (?, ?, ?)
    let placeholders = vec!["?"; key_names.len()].join(", ");
    let sql = format!(
        "SELECT COUNT(*) FROM key_store WHERE key_name IN ({})",
        placeholders
    );

    // 执行查询，传入动态参数
    let count: i64 = guard.query_row(
        &sql,
        rusqlite::params_from_iter(key_names.iter()),
        |row| row.get(0),
    )?;

    // 如果查到的数量和我们要查的数组长度一致，说明全都有
    Ok(count == key_names.len() as i64)
}

pub fn delete_key_store_item(&self, key_name: &str) -> Result<()> {
    let guard = self.conn.lock().unwrap();
    guard.execute(
        "DELETE FROM key_store WHERE key_name = ?1",
        rusqlite::params![key_name],
    )?;
    Ok(())
}

}