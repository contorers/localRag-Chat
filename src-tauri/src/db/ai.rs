use super::AppDb;
use rusqlite::{OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::engine::memory_service::extract_keyword_query;
// ==========================================
// 1. 全局结构体定义 (统一使用 Struct 透传)
// ==========================================

#[derive(Serialize, Deserialize,Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatListItem {
    pub id: i64,
    pub model_id: i64,
    pub timestamp: i64,
    pub payload: Option<String>,
}

#[derive(Serialize, Deserialize,Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageItem {
    pub id: i64,
    pub chat_id: i64,
    pub timestamp: i64,
    pub embedding: Option<Vec<u8>>,
    pub payload: String, 
}

#[derive(Serialize, Deserialize,Clone)]
#[serde(rename_all = "camelCase")]
pub struct VectorItem {
    pub id: i64,
    pub chat_id: i64,
    pub timestamp: i64,
    pub embedding: Option<Vec<u8>>,
    pub payload: String, 
}

#[derive(Serialize, Deserialize,Clone)]
#[serde(rename_all = "camelCase")]
pub struct DepositItem {
    pub id: i64,
    pub timestamp: i64,
    pub deposit_type: String,
    pub source: String,
    pub payload: String,
}

#[derive(Serialize, Deserialize,Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenLogItem {
    pub id: i64,
    pub timestamp: i64,
    pub token_type: String,
    pub model_name: String,
    pub payload: String,
}

#[derive(Serialize, Deserialize,Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderItem {
    pub id: i64,
    pub payload: String,
}

#[derive(Serialize, Deserialize,Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelItem {
    pub id: i64,
    pub provider_id: i64,
    pub model_type: Option<String>,
    pub is_default: bool, 
    pub payload: String,
}

#[derive(Serialize, Deserialize,Clone)]
#[serde(rename_all = "camelCase")]
pub struct DefaultModelData {
    pub model_id: i64,
    pub model_payload: String,
    pub provider_id: i64,
    pub provider_payload: String,
}

#[derive(Serialize, Deserialize,Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemSettingData {
    pub id: i64,
    pub payload: String,
}

// 辅助工具方法
fn current_timestamp() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

impl AppDb {
    // ==========================================
    // 2. 表: chat_list (会话列表) 操作
    // ==========================================
    pub fn add_chat_list(&self, model_id: i64, timestamp: i64, payload: &str) -> Result<i64> {
        let guard = self.conn.lock().unwrap();
        guard.execute(
            "INSERT INTO chat_list (model_id, timestamp, payload) VALUES (?1, ?2, ?3)",
            rusqlite::params![model_id, timestamp, payload],
        )?;
        Ok(guard.last_insert_rowid())
    }

    pub fn query_chat_list(&self, id: i64, limit: u32) -> Result<Vec<ChatListItem>> {
        let guard = self.conn.lock().unwrap();
        let mut stmt = guard.prepare(
            "SELECT id, model_id, timestamp, payload 
             FROM chat_list 
             WHERE id < ?1 
             ORDER BY id DESC LIMIT ?2"
        )?;
        
        let iter = stmt.query_map(rusqlite::params![id, limit], |row| {
            Ok(ChatListItem {
                id: row.get(0)?,
                model_id: row.get(1)?,
                timestamp: row.get(2)?,
                payload: row.get(3)?,
            })
        })?;
        iter.collect()
    }

    pub fn query_chat_list_by_model_id(&self, model_id: i64, limit: u32) -> Result<Vec<ChatListItem>> {
        let guard = self.conn.lock().unwrap();
        let mut stmt = guard.prepare(
            "SELECT id, model_id, timestamp, payload FROM chat_list WHERE model_id = ?1 ORDER BY timestamp DESC LIMIT ?2"
        )?;

        let iter = stmt.query_map(rusqlite::params![model_id, limit], |row| {
            Ok(ChatListItem {
                id: row.get(0)?,
                model_id: row.get(1)?,
                timestamp: row.get(2)?,
                payload: row.get(3)?,
            })
        })?;
        iter.collect()
    }

    pub fn query_chat_list_by_id(&self, id: i64) -> Result<Option<ChatListItem>> {
        let guard = self.conn.lock().unwrap();
        guard.query_row(
            "SELECT id, model_id, timestamp, payload FROM chat_list WHERE id = ?1 LIMIT 1",
            rusqlite::params![id],
            |row| {
                Ok(ChatListItem {
                    id: row.get(0)?,
                    model_id: row.get(1)?,
                    timestamp: row.get(2)?,
                    payload: row.get(3)?,
                })
            }
        ).optional()
    }

    pub fn update_chat_list(&self, id: i64, mut changes: Value) -> Result<()> {
        let guard = self.conn.lock().unwrap();
        
        let model_id = changes.get("modelId").and_then(|v| v.as_i64());
        let timestamp = changes.get("timestamp").and_then(|v| v.as_i64());
        
        if let Some(obj) = changes.as_object_mut() {
            obj.remove("id");
            obj.remove("modelId");
            obj.remove("timestamp");
        }
        
        let changes_str = changes.to_string();
        
        guard.execute(
            "UPDATE chat_list 
             SET model_id = COALESCE(?1, model_id),
                 timestamp = COALESCE(?2, timestamp),
                 payload = json_patch(payload, ?3)
             WHERE id = ?4",
            rusqlite::params![model_id, timestamp, changes_str, id],
        )?;
        
        Ok(())
    }

    pub fn delete_chat_list_by_id(&self, id: i64) -> Result<()> {
        let guard = self.conn.lock().unwrap();
        guard.execute("DELETE FROM chat_list WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn clear_all_chat_list_data(&self) -> Result<()> {
        let mut guard = self.conn.lock().unwrap();
        let tx = guard.transaction()?;
        tx.execute("DELETE FROM chat_list", [])?;
        tx.commit()?;
        Ok(())
    }

    // ==========================================
    // 3. 表: chat_messages (聊天消息) 操作
    // ==========================================
    pub fn add_chat_messages(
        &self, 
        chat_id: i64, 
        timestamp: i64, 
        embedding: Option<Vec<u8>>,
        payload: Value,
    ) -> Result<i64> {
        let payload_str = payload.to_string();
        
        let embedding_blob: Option<Vec<u8>> = embedding.map(|v| {
            v.iter().flat_map(|f| f.to_le_bytes()).collect()
        });
    
        let mut guard = self.conn.lock().unwrap();
        let tx = guard.transaction()?;
        
        // 1. 写入主表
        tx.execute(
            "INSERT INTO chat_messages (chat_id, timestamp, embedding, payload) 
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![chat_id, timestamp, embedding_blob, payload_str],
        )?;
        
        // 2. 获取刚才插入的 ID
        let msg_id = tx.last_insert_rowid();
    
        // 3. 提取文本并用 jieba 分词 (你需要保证当前文件能访问到 extract_keyword_query)
        let content = payload.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let reasoning = payload.get("reasoning").and_then(|v| v.as_str()).unwrap_or("");
        
        let segmented_content = extract_keyword_query(content);
        let segmented_reasoning = extract_keyword_query(reasoning);
    
        // 4. 写入 FTS 虚拟表 (rowid 必须和主表 id 强绑定)
        tx.execute(
            "INSERT INTO chat_messages_fts (rowid, content, reasoning) 
             VALUES (?1, ?2, ?3)",
            rusqlite::params![msg_id, segmented_content, segmented_reasoning],
        )?;
    
        tx.commit()?;
        Ok(msg_id)
    }

    pub fn update_messages_compressed_and_embedding(
        &self,
        updates: &[(i64, String, Option<Vec<f32>>)],
    ) -> rusqlite::Result<()> {
        let mut guard = self.conn.lock().unwrap();
        let tx = guard.transaction()?;
    
        for (msg_id, compressed_text, embedding) in updates {
            let embedding_blob: Option<Vec<u8>> = embedding.as_ref().map(|vec| {
                vec.iter().flat_map(|f| f.to_le_bytes()).collect()
            });
    
            tx.execute(
                "UPDATE chat_messages 
                 SET 
                   embedding = ?1,
                   payload = json_set(payload, '$.compressed_text', ?2)
                 WHERE id = ?3",
                rusqlite::params![embedding_blob, compressed_text, msg_id],
            )?;
        }
    
        tx.commit()?;
        Ok(())
    }

    pub fn query_chat_messages(&self, chat_id: i64, last_id: i64, limit: u32) -> Result<Vec<ChatMessageItem>> {
        let guard = self.conn.lock().unwrap();
        let mut stmt = guard.prepare(
            "SELECT id, chat_id, timestamp,embedding, payload 
             FROM chat_messages 
             WHERE chat_id = ?1 AND id < ?2 
             ORDER BY id DESC LIMIT ?3"
        )?;
    
        let iter = stmt.query_map(rusqlite::params![chat_id, last_id, limit], |row| {
            Ok(ChatMessageItem {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                timestamp: row.get(2)?,
                embedding:row.get(3)?,
                payload: row.get(4)?,
            })
        })?;
    
        let mut results: Vec<ChatMessageItem> = iter.collect::<Result<_, _>>()?;
        results.reverse(); // 返回前端时按时间正序
        Ok(results)
    }

    pub fn query_messages_by_ids(&self, ids: Vec<i64>) -> Result<Vec<ChatMessageItem>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }

        let guard = self.conn.lock().unwrap();
        
        // 根据传入的 ID 数量动态生成占位符 "?, ?, ?"
        let placeholders = vec!["?"; ids.len()].join(", ");
        
        // 🚨 核心修正：直接 WHERE id IN (...)，没有 LIMIT，不需要分页！
        let sql = format!(
            "SELECT id, chat_id, timestamp,embedding, payload 
             FROM chat_messages 
             WHERE id IN ({})",
            placeholders
        );

        let mut stmt = guard.prepare(&sql)?;

        let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len());
        for id in &ids {
            params.push(id);
        }

        let iter = stmt.query_map(params.as_slice(), |row| {
            Ok(ChatMessageItem {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                timestamp: row.get(2)?,
                embedding:row.get(3)?,
                payload: row.get(4)?,
            })
        })?;

        let results: Vec<ChatMessageItem> = iter.collect::<Result<_, _>>()?;
        Ok(results)
    }

    pub fn query_chat_ids_messages(&self, chat_ids: Vec<i64>, limit: u32) -> Result<Vec<ChatMessageItem>> {
        if chat_ids.is_empty() { return Ok(Vec::new()); }
        let guard = self.conn.lock().unwrap();
        let mut results = Vec::new();
        
        let mut stmt = guard.prepare(
            "SELECT id, chat_id, timestamp,embedding, payload 
             FROM chat_messages 
             WHERE chat_id = ?1 
             ORDER BY timestamp ASC 
             LIMIT ?2"
        )?;

        for chat_id in chat_ids {
            let iter = stmt.query_map(rusqlite::params![chat_id, limit], |row| {
                Ok(ChatMessageItem {
                    id: row.get(0)?,
                    chat_id: row.get(1)?,
                    timestamp: row.get(2)?,
                    embedding:row.get(3)?,
                    payload: row.get(4)?,
                })
            })?;
            for item in iter {
                results.push(item?);
            }
        }
        Ok(results)
    }

    pub fn delete_chat_message_by_chat_id(&self, chat_id: i64) -> Result<()> {
        let mut guard = self.conn.lock().unwrap();
        let tx = guard.transaction()?;
    
        // 🚨 关键：先通过子查询删 FTS 表里的关联数据
        tx.execute(
            "DELETE FROM chat_messages_fts WHERE rowid IN (SELECT id FROM chat_messages WHERE chat_id = ?1)", 
            rusqlite::params![chat_id]
        )?;
    
        // 再删主表
        tx.execute("DELETE FROM chat_messages WHERE chat_id = ?1", rusqlite::params![chat_id])?;
        
        tx.commit()?;
        Ok(())
    }
    
    pub fn delete_chat_message_by_id(&self, id: i64) -> Result<()> {
        let mut guard = self.conn.lock().unwrap();
        let tx = guard.transaction()?;
    
        // 双删
        tx.execute("DELETE FROM chat_messages_fts WHERE rowid = ?1", rusqlite::params![id])?;
        tx.execute("DELETE FROM chat_messages WHERE id = ?1", rusqlite::params![id])?;
        
        tx.commit()?;
        Ok(())
    }
    
    pub fn clear_all_chat_data(&self) -> Result<()> {
        let mut guard = self.conn.lock().unwrap();
        let tx = guard.transaction()?;
        
        // 双清
        tx.execute("DELETE FROM chat_messages_fts", [])?;
        tx.execute("DELETE FROM chat_messages", [])?;
        
        tx.commit()?;
        Ok(())
    }

    pub fn search_messages(
        &self,
        keyword: &str,
        chat_id: Option<i64>,
    ) -> Result<Vec<(i64, i64, String)>> {
        let conn = self.conn.lock().unwrap();
        
        // 🚨 核心逻辑：对用户的搜索词也进行 Jieba 分词
        let segmented_keyword = extract_keyword_query(keyword);
        
        // FTS5 MATCH 语法构建：为了精确度，通常我们把它包在双引号里变成 phrase match
        // 比如分词结果是 "你好 世界"，变成 "\"你好 世界\"" 
        let match_query = format!("\"{}\"", segmented_keyword.replace("\"", "\"\""));
    
        let (sql, params_vec): (String, Vec<rusqlite::types::Value>) = match chat_id {
            Some(cid) => {
                let s = r#"
                    SELECT m.id, m.chat_id, m.payload 
                    FROM chat_messages m
                    JOIN chat_messages_fts f ON m.id = f.rowid
                    WHERE chat_messages_fts MATCH ?1 
                      AND m.chat_id = ?2
                    ORDER BY bm25(chat_messages_fts, 2.0, 1.0) ASC
                    LIMIT 100;
                "#.to_string();
                (s, vec![match_query.into(), cid.into()])
            }
            None => {
                let s = r#"
                    SELECT m.id, m.chat_id, m.payload 
                    FROM chat_messages m
                    JOIN chat_messages_fts f ON m.id = f.rowid
                    WHERE chat_messages_fts MATCH ?1
                    ORDER BY bm25(chat_messages_fts, 1.0, 1.0) ASC
                    LIMIT 200;
                "#.to_string();
                (s, vec![match_query.into()])
            }
        };
    
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }
    
    // ==========================================
    // 4. RAG 与 向量持久化操作
    // ==========================================
    pub fn count_messages_by_chat_id(&self, chat_id: i64) -> Result<i64> {
        let guard = self.conn.lock().unwrap();
        guard.query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE chat_id = ?1",
            rusqlite::params![chat_id],
            |row| row.get(0)
        )
    }

    pub fn query_messages_slice(&self, chat_id: i64, offset: u32, limit: u32) -> Result<Vec<ChatMessageItem>> {
        let guard = self.conn.lock().unwrap();
        let mut stmt = guard.prepare(
            "SELECT id, chat_id, timestamp,embedding, payload 
             FROM chat_messages 
             WHERE chat_id = ?1 
             ORDER BY timestamp ASC 
             LIMIT ?2 OFFSET ?3"
        )?;

        let iter = stmt.query_map(rusqlite::params![chat_id, limit, offset], |row| {
            Ok(ChatMessageItem {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                timestamp: row.get(2)?,
                embedding:row.get(3)?,
                payload: row.get(4)?,
            })
        })?;
        iter.collect()
    }

    pub fn save_message_vector(&self, msg_id: i64, vector_json: String) -> Result<()> {
        let guard = self.conn.lock().unwrap();
        
        // 🌟 核心：删除了 serde_json 的序列化，直接使用传入的 vector_json 字符串
        guard.execute(
            "UPDATE chat_messages SET embedding = ?1 WHERE id = ?2",
            rusqlite::params![vector_json, msg_id],
        )?;
        Ok(())
    }

    pub fn query_recent_messages_with_vectors(&self, chat_id: i64, limit: u32) -> Result<Vec<ChatMessageItem>> {
        let guard = self.conn.lock().unwrap();
        let mut stmt = guard.prepare(
           "SELECT id, chat_id, timestamp, embedding, payload FROM chat_messages 
             WHERE chat_id = ?1 AND embedding IS NOT NULL
             ORDER BY timestamp DESC LIMIT ?2"
        )?;
        
        let iter = stmt.query_map(rusqlite::params![chat_id, limit], |row| {
            Ok(ChatMessageItem {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                timestamp: row.get(2)?,
                embedding:row.get(3)?,
                payload: row.get(4)?,
            })
        })?;
        iter.collect()
    }
    
    pub fn query_all_messages_with_vectors(&self, chat_id: i64) -> Result<Vec<ChatMessageItem>> {
        let guard = self.conn.lock().unwrap();
        let mut stmt = guard.prepare(
            "SELECT id, chat_id, timestamp,embedding, payload FROM chat_messages 
             WHERE chat_id = ?1 AND embedding IS NOT NULL
             ORDER BY timestamp DESC"
        )?;
        
        let iter = stmt.query_map(rusqlite::params![chat_id], |row| {
            Ok(ChatMessageItem {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                timestamp: row.get(2)?,
                embedding:row.get(3)?,
                payload: row.get(4)?,
            })
        })?;
        iter.collect()
    }

    pub fn upsert_vectors_batch(&self, vectors: Vec<VectorItem>) -> Result<()> {
        if vectors.is_empty() { return Ok(()); }
        
        let mut guard = self.conn.lock().unwrap();
        // 开启事务，批量插入的核心
        let tx = guard.transaction()?; 
    
        let mut stmt = tx.prepare(
            "INSERT INTO vectors (id, chat_id, timestamp,embedding, payload)
             VALUES (?1, ?2, ?3, ?4 ,?5)
             ON CONFLICT(id) DO UPDATE SET
                chat_id = excluded.chat_id,
                timestamp = excluded.timestamp,
                embedding = excluded.embedding,
                payload = excluded.payload"
        )?;
    
        for vec in vectors {
            stmt.execute(rusqlite::params![
                vec.id, 
                vec.chat_id, 
                vec.timestamp, 
                vec.embedding, 
                vec.payload
            ])?;
        }
        
        drop(stmt);
        tx.commit()?;
        Ok(())
    }

    pub fn query_recent_vectors(&self, limit: u32) -> Result<Vec<VectorItem>> {
        let guard = self.conn.lock().unwrap();
        let mut stmt = guard.prepare(
            "SELECT id, chat_id, timestamp,embedding, payload 
             FROM vectors 
             ORDER BY timestamp DESC 
             LIMIT ?1"
        )?;
    
        let iter = stmt.query_map(rusqlite::params![limit], |row| {
            Ok(VectorItem {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                timestamp: row.get(2)?,
                embedding: row.get(3)?,
                payload: row.get(4)?,
            })
        })?;
        iter.collect()
    }

    pub fn query_recent_vectors_by_chat_id(&self, chat_id: i64, limit: u32) -> Result<Vec<VectorItem>> {
        let guard = self.conn.lock().unwrap();
        let mut stmt = guard.prepare(
            "SELECT id, chat_id, timestamp,embedding, payload 
             FROM vectors 
             WHERE chat_id = ?1 
             ORDER BY timestamp DESC 
             LIMIT ?2"
        )?;

        let iter = stmt.query_map(rusqlite::params![chat_id, limit], |row| {
            Ok(VectorItem {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                timestamp: row.get(2)?,
                embedding: row.get(3)?,
                payload: row.get(4)?,
            })
        })?;
        iter.collect()
    }

    pub fn query_vectors_by_ids(&self, ids: Vec<i64>) -> Result<Vec<VectorItem>> {
        // ⚠️ 极其重要：防止传入空数组导致 SQL 语法错误 (IN 里面不能为空)
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let guard = self.conn.lock().unwrap();

        // 动态生成对应数量的 "?"，比如传入 3 个 id，就会生成 "?, ?, ?"
        let placeholders = vec!["?"; ids.len()].join(", ");
        
        let sql = format!(
            "SELECT id, chat_id, timestamp, embedding, payload 
             FROM vectors 
             WHERE id IN ({})",
            placeholders
        );

        let mut stmt = guard.prepare(&sql)?;

        // 使用 params_from_iter 展开数组并安全绑定参数
        let iter = stmt.query_map(rusqlite::params_from_iter(ids), |row| {
            Ok(VectorItem {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                timestamp: row.get(2)?,
                embedding: row.get(3)?,
                payload: row.get(4)?,
            })
        })?;

        iter.collect()
    }
    
    pub fn prune_oldest_vectors(&self, keep_limit: u32) -> Result<usize> {
        let guard = self.conn.lock().unwrap();
        let deleted = guard.execute(
            "DELETE FROM vectors WHERE id NOT IN (
                SELECT id FROM vectors ORDER BY timestamp DESC LIMIT ?1
            )",
            rusqlite::params![keep_limit],
        )?;
        Ok(deleted)
    }

    pub fn clear_all_vectors(&self) -> Result<()> {
        let guard = self.conn.lock().unwrap();
        guard.execute("DELETE FROM vectors", [])?;
        Ok(())
    }

    pub fn delete_vectors_by_chat_id(&self, chat_id: i64) -> Result<()> {
        let guard = self.conn.lock().unwrap();
        guard.execute("DELETE FROM vectors WHERE chat_id = ?1", rusqlite::params![chat_id])?;
        Ok(())
    }

    // ==========================================
    // 5. 代币与资产日志 (Deposits & Tokenlogs)
    // ==========================================
    pub fn add_deposit(&self, deposit_type: &str, source: &str, timestamp: i64, payload: Value) -> Result<i64> {
        let payload_str = payload.to_string();
        let guard = self.conn.lock().unwrap();
        guard.execute(
            "INSERT INTO deposits (timestamp, deposit_type, source, payload) 
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![timestamp, deposit_type, source, payload_str],
        )?;
        Ok(guard.last_insert_rowid())
    }

    pub fn add_token_log(&self, token_type: &str, model_name: &str, timestamp: i64, payload: Value) -> Result<i64> {
        let payload_str = payload.to_string();
        let guard = self.conn.lock().unwrap();
        guard.execute(
            "INSERT INTO tokenlogs (timestamp, token_type, model_name, payload) 
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![timestamp, token_type, model_name, payload_str],
        )?;
        Ok(guard.last_insert_rowid())
    }

    pub fn get_paged_deposits(&self, id: i64, limit: u32) -> Result<Vec<DepositItem>> {
        let guard = self.conn.lock().unwrap();
        let query_sql = if id == 0 {
            "SELECT id, timestamp, deposit_type, source, payload FROM deposits ORDER BY id DESC LIMIT ?1"
        } else {
            "SELECT id, timestamp, deposit_type, source, payload FROM deposits WHERE id < ?1 ORDER BY id DESC LIMIT ?2"
        };

        let mut stmt = guard.prepare(query_sql)?;
        let mapper = |row: &rusqlite::Row| -> rusqlite::Result<DepositItem> {
            Ok(DepositItem {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                deposit_type: row.get(2)?,
                source: row.get(3)?,
                payload: row.get(4)?,
            })
        };

        let iter = if id == 0 {
            stmt.query_map(rusqlite::params![limit], mapper)?
        } else {
            stmt.query_map(rusqlite::params![id, limit], mapper)?
        };
        iter.collect()
    }

    pub fn get_paged_tokenlogs(&self, id: i64, limit: u32) -> Result<Vec<TokenLogItem>> {
        let guard = self.conn.lock().unwrap();
        let query_sql = if id == 0 {
            "SELECT id, timestamp, token_type, model_name, payload FROM tokenlogs ORDER BY id DESC LIMIT ?1"
        } else {
            "SELECT id, timestamp, token_type, model_name, payload FROM tokenlogs WHERE id < ?1 ORDER BY id DESC LIMIT ?2"
        };

        let mut stmt = guard.prepare(query_sql)?;
        let mapper = |row: &rusqlite::Row| -> rusqlite::Result<TokenLogItem> {
            Ok(TokenLogItem {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                token_type: row.get(2)?,
                model_name: row.get(3)?,
                payload: row.get(4)?,
            })
        };

        let iter = if id == 0 {
            stmt.query_map(rusqlite::params![limit], mapper)?
        } else {
            stmt.query_map(rusqlite::params![id, limit], mapper)?
        };
        iter.collect()
    }

    pub fn get_token_usage_above(&self, timestamp: i64) -> Result<i64> {
        let guard = self.conn.lock().unwrap();
        guard.query_row(
            "SELECT SUM(CAST(json_extract(payload, '$.tokensTotal') AS INTEGER)) 
             FROM tokenlogs 
             WHERE timestamp >= ?1",
            rusqlite::params![timestamp],
            |row| {
                let total: Option<i64> = row.get(0)?;
                Ok(total.unwrap_or(0))
            }
        )
    }

    pub fn delete_logs_below(&self, timestamp: i64) -> Result<usize> {
        let mut guard = self.conn.lock().unwrap();
        let tx = guard.transaction()?;
        
        let count1 = tx.execute("DELETE FROM deposits WHERE timestamp < ?1", rusqlite::params![timestamp])?;
        let count2 = tx.execute("DELETE FROM tokenlogs WHERE timestamp < ?1", rusqlite::params![timestamp])?;
        
        tx.commit()?;
        Ok(count1 + count2)
    }

    // ==========================================
    // 6. 厂商与模型管理 (Providers & Models)
    // ==========================================
    
    // --- 厂商操作 ---
    pub fn save_provider(&self, id: Option<i64>, payload: Value) -> Result<i64> {
        let guard = self.conn.lock().unwrap();
        let payload_str = payload.to_string(); 
    
        if let Some(actual_id) = id {
            guard.execute(
                "UPDATE api_providers SET payload = json_patch(payload, ?1) WHERE id = ?2",
                rusqlite::params![payload_str, actual_id],
            )?;
            Ok(actual_id)
        } else {
            guard.execute(
                "INSERT INTO api_providers (payload) VALUES (?1)",
                rusqlite::params![payload_str],
            )?;
            Ok(guard.last_insert_rowid())
        }
    }

    pub fn get_providers(&self, last_id: Option<i64>, limit: i64) -> Result<Vec<ProviderItem>> {
        let guard = self.conn.lock().unwrap();
        let query_limit = if limit <= 0 { 20 } else { limit };
        let cursor_id = last_id.unwrap_or(i64::MAX);

        let mut stmt = guard.prepare(
            "SELECT id, payload FROM api_providers WHERE id < ?1 ORDER BY id DESC LIMIT ?2"
        )?;

        let iter = stmt.query_map(rusqlite::params![cursor_id, query_limit], |row| {
            Ok(ProviderItem {
                id: row.get(0)?,
                payload: row.get(1)?,
            })
        })?;

        iter.collect()
    }

    pub fn delete_provider(&self, provider_id: i64) -> Result<()> {
        let mut guard = self.conn.lock().unwrap();
        let tx = guard.transaction()?;
        tx.execute("DELETE FROM api_models WHERE provider_id = ?1", rusqlite::params![provider_id])?;
        tx.execute("DELETE FROM api_providers WHERE id = ?1", rusqlite::params![provider_id])?;
        tx.commit()?;
        Ok(())
    }

    // --- 模型操作 ---
    pub fn save_model(
        &self, 
        id: Option<i64>, 
        provider_id: i64, 
        model_type: &str, 
        is_default: i64, 
        payload: Value
    ) -> Result<i64> {
        let guard = self.conn.lock().unwrap();
        let payload_str = payload.to_string();

        if let Some(actual_id) = id {
            guard.execute(
                "UPDATE api_models SET 
                    provider_id = ?1, 
                    model_type = ?2, 
                    is_default = ?3, 
                    payload = json_patch(payload, ?4) 
                 WHERE id = ?5",
                rusqlite::params![provider_id, model_type, is_default, payload_str, actual_id],
            )?;
            Ok(actual_id)
        } else {
            guard.execute(
                "INSERT INTO api_models (provider_id, model_type, is_default, payload) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![provider_id, model_type, is_default, payload_str],
            )?;
            Ok(guard.last_insert_rowid())
        }
    }

    pub fn get_models(&self, provider_id: i64, last_id: Option<i64>, limit: i64) -> Result<Vec<ModelItem>> {
        let guard = self.conn.lock().unwrap();
        let cursor_id = last_id.unwrap_or(i64::MAX);

        let mut stmt = guard.prepare(
            "SELECT id, provider_id, model_type, is_default, payload 
             FROM api_models 
             WHERE provider_id = ?1 AND id < ?2 
             ORDER BY id DESC LIMIT ?3"
        )?;

        let iter = stmt.query_map(rusqlite::params![provider_id, cursor_id, limit], |row| {
            let is_def: i64 = row.get(3)?;
            Ok(ModelItem {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                model_type: row.get(2)?, 
                is_default: is_def == 1,
                payload: row.get(4)?,
            })
        })?;

        iter.collect()
    }

    pub fn delete_model(&self, model_id: i64) -> Result<()> {
        let guard = self.conn.lock().unwrap();
        guard.execute("DELETE FROM api_models WHERE id = ?1", rusqlite::params![model_id])?;
        Ok(())
    }

    pub fn get_default_model_with_provider(&self) -> Result<Option<DefaultModelData>> {
        let guard = self.conn.lock().unwrap();
        
        let mut stmt = guard.prepare(
            "SELECT 
                m.id as model_id, 
                m.payload as model_payload, 
                p.id as provider_id, 
                p.payload as provider_payload 
             FROM api_models m 
             JOIN api_providers p ON m.provider_id = p.id 
             WHERE m.is_default = 1 
               AND (m.model_type = 'text' OR m.model_type IS NULL OR m.model_type = '') 
             ORDER BY m.id DESC 
             LIMIT 1"
        )?;
    
        let result = stmt.query_row([], |row| {
            Ok(DefaultModelData {
                model_id: row.get(0)?,
                model_payload: row.get(1)?,
                provider_id: row.get(2)?,
                provider_payload: row.get(3)?,
            })
        }).optional()?;
    
        Ok(result)
    }

    pub fn set_default_model(&self, target_model_id: i64) -> Result<()> {
        let mut guard = self.conn.lock().unwrap();
        let tx = guard.transaction()?;
        
        tx.execute(
            "UPDATE api_models SET is_default = 0 WHERE model_type = 'text' AND is_default = 1", 
            []
        )?;
        
        tx.execute(
            "UPDATE api_models SET is_default = 1 WHERE id = ?1", 
            rusqlite::params![target_model_id]
        )?;
        
        tx.commit()?;
        Ok(())
    }

    // ==========================================
    // 7. 系统配置与 RAG 底层调优 (System Settings)
    // ==========================================
    pub fn get_system_settings(&self, id: i64) -> Result<Option<SystemSettingData>> {
        let guard = self.conn.lock().unwrap();
        let mut stmt = guard.prepare("SELECT id, payload FROM system_settings WHERE id = ?1 LIMIT 1")?;
        
        let result = stmt.query_row(rusqlite::params![id], |row| {
            Ok(SystemSettingData {
                id: row.get(0)?,
                payload: row.get(1)?,
            })
        }).optional()?;
        
        Ok(result)
    }

    pub fn update_system_settings_partial(&self, id: i64, partial_payload: &str) -> Result<()> {
        let guard = self.conn.lock().unwrap();
        
        // 使用 SQLite 的 json_patch 函数进行局部合并
        let mut stmt = guard.prepare(
            "UPDATE system_settings SET payload = json_patch(payload, ?2) WHERE id = ?1"
        )?;
        
        stmt.execute(rusqlite::params![id, partial_payload])?;
        Ok(())
    }
    
    pub fn save_system_settings(&self, id: i64, payload_str: &str) -> Result<usize> {
        let guard = self.conn.lock().unwrap();
        let updated = guard.execute(
            "INSERT INTO system_settings (id, payload) 
             VALUES (?1, ?2)
             ON CONFLICT(id) DO UPDATE SET 
             payload = json_patch(payload, ?2)",
            rusqlite::params![id, payload_str],
        )?;
        Ok(updated)
    }
}