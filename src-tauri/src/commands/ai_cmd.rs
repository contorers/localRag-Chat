use serde_json::Value;
use tauri::{AppHandle, State};
use regex::Regex;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

// 记得引入你上一回合新增的 ProviderItem 和 ModelItem
use crate::db;
use crate::db::ai::{
    ChatListItem, ChatMessageItem, DefaultModelData, DepositItem, 
    ModelItem, ProviderItem, SystemSettingData, TokenLogItem, VectorItem
};

// ==========================================
// 1. 会话列表 (Chat List)
// ==========================================

#[tauri::command]
pub async fn add_chat_list(
    db_state: State<'_, crate::db::DbManager>, 
    model_id: i64, 
    timestamp: i64, 
    payload: String // 接收纯净的扩展字段
) -> Result<i64, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.add_chat_list(model_id, timestamp, &payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_chat_list(
    db_state: State<'_, crate::db::DbManager>, 
    id: i64, 
    limit: u32
) -> Result<Vec<ChatListItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_chat_list(id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_chat_list_by_model_id(
    db_state: State<'_, crate::db::DbManager>, 
    model_id: i64, 
    limit: u32
) -> Result<Vec<ChatListItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_chat_list_by_model_id(model_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_chat_list_by_id(db_state: State<'_, crate::db::DbManager>, id: i64) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_chat_list_by_id(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_chat_list_by_id(
    db_state: State<'_, crate::db::DbManager>, 
    id: i64
) -> Result<Option<ChatListItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_chat_list_by_id(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_chat_list(db_state: State<'_, crate::db::DbManager>, id: i64, changes: Value) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.update_chat_list(id, changes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_chat_list_data(db_state: State<'_, crate::db::DbManager>) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.clear_all_chat_list_data().map_err(|e| e.to_string())
}

// ==========================================
// 2. 聊天消息 (Chat Messages)
// ==========================================

#[tauri::command]
pub async fn add_chat_messages(
    app_handle: tauri::AppHandle,
    db_state: tauri::State<'_, crate::db::DbManager>,
    chat_id: i64, 
    timestamp: i64, 
    embedding: Option<Vec<f32>>, 
    mut payload: serde_json::Value,
    local_images: Option<Vec<Vec<u8>>>,
) -> Result<i64, String> {

    let user_dir = crate::db::get_user_dir(&app_handle).map_err(|e| e.to_string())?;
    let img_dir = user_dir.join("aiImages");
    if !img_dir.exists() {
        std::fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;
    }

    // 统一收集所有图片路径
    let mut all_paths: Vec<serde_json::Value> = Vec::new();

    // 1. 处理本地图片
    if let Some(images) = local_images {
        for bytes in images {
            let file_name = format!("{}.png", uuid::Uuid::new_v4());
            let file_path = img_dir.join(&file_name);
            if std::fs::write(&file_path, &bytes).is_ok() {
                let relative_path = format!("aiImages/{}", file_name);
                all_paths.push(serde_json::Value::String(relative_path));
            }
        }
    }

    // 2. 处理 content 里的网络图片，同样收集到 all_paths
    if let Some(content_val) = payload.get_mut("content") {
        if let Some(content_str) = content_val.as_str() {
            let re = regex::Regex::new(r"!\[.*?\]\((https?://.*?)\)").unwrap();
            let mut new_content = content_str.to_string();

            for cap in re.captures_iter(content_str) {
                let original_url = &cap[1];
                // 把整个 markdown 图片语法也从 content 里删掉
                let markdown_img = &cap[0];
                match reqwest::get(original_url).await {
                    Ok(response) if response.status().is_success() => {
                        if let Ok(bytes) = response.bytes().await {
                            let file_name = format!("{}.png", uuid::Uuid::new_v4());
                            let file_path = img_dir.join(&file_name);
                            if std::fs::write(&file_path, bytes).is_ok() {
                                let relative_path = format!("aiImages/{}", file_name);
                                // content 里把图片语法整个删掉
                                new_content = new_content.replace(markdown_img, "");
                                // 路径收集到 all_paths
                                all_paths.push(serde_json::Value::String(relative_path));
                            }
                        }
                    },
                    _ => eprintln!("Failed to download image: {}", original_url),
                }
            }

            *content_val = serde_json::Value::String(new_content.trim().to_string());
        }
    }

    // 3. 统一写入 file 字段
    if !all_paths.is_empty() {
        payload["file"] = serde_json::Value::Array(all_paths);
    }

    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    let embedding_blob: Option<Vec<u8>> = embedding.map(|v| {
        v.iter().flat_map(|f| f.to_le_bytes()).collect()
    });

    app_db.add_chat_messages(chat_id, timestamp, embedding_blob, payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_chat_messages(
    db_state: State<'_, crate::db::DbManager>, 
    chat_id: i64,
    last_id: i64,
    limit: u32
) -> Result<Vec<ChatMessageItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_chat_messages(chat_id, last_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_messages_by_ids(
    db_state: State<'_, crate::db::DbManager>, 
    ids: Vec<i64>
) -> Result<Vec<ChatMessageItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    
    if ids.is_empty() {
        return Ok(vec![]);
    }
    
    app_db.query_messages_by_ids(ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_chat_ids_messages(
    db_state: State<'_, crate::db::DbManager>, 
    chat_ids: Vec<i64>,
    limit: u32
) -> Result<Vec<ChatMessageItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_chat_ids_messages(chat_ids, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_chat_message_by_chat_id(db_state: State<'_, crate::db::DbManager>, chat_id: i64) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_chat_message_by_chat_id(chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_chat_message_by_id(db_state: State<'_, crate::db::DbManager>, id: i64) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_chat_message_by_id(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_chat_data(db_state: State<'_, crate::db::DbManager>) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.clear_all_chat_data().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn count_messages_by_chat_id(db_state: State<'_, crate::db::DbManager>, chat_id: i64) -> Result<i64, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.count_messages_by_chat_id(chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_messages_slice(
    db_state: State<'_, crate::db::DbManager>, 
    chat_id: i64, 
    offset: u32, 
    limit: u32
) -> Result<Vec<ChatMessageItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_messages_slice(chat_id, offset, limit).map_err(|e| e.to_string())
}

// ==========================================
// 3. 向量存储 (Vectors / RAG)
// ==========================================

#[tauri::command]
pub async fn save_message_vector(
    db_state: State<'_, crate::db::DbManager>, 
    msg_id: i64, 
    vector_json: String // 👈 接收类型改为 String
) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.save_message_vector(msg_id, vector_json).map_err(|e| e.to_string())
}


#[tauri::command]
pub async fn query_recent_messages_with_vectors(
    db_state: State<'_, crate::db::DbManager>, 
    chat_id: i64, 
    limit: u32
) -> Result<Vec<ChatMessageItem>, String> { 
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_recent_messages_with_vectors(chat_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_all_messages_with_vectors(
    db_state: State<'_, crate::db::DbManager>, 
    chat_id: i64
) -> Result<Vec<ChatMessageItem>, String> { 
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_all_messages_with_vectors(chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_vectors_batch(
    db_state: State<'_, crate::db::DbManager>, 
    vectors: Vec<VectorItem>
) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.upsert_vectors_batch(vectors).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_recent_vectors(
    db_state: State<'_, crate::db::DbManager>, 
    limit: u32
) -> Result<Vec<VectorItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_recent_vectors(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn prune_oldest_vectors(db_state: State<'_, crate::db::DbManager>, keep_limit: u32) -> Result<usize, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.prune_oldest_vectors(keep_limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_vectors(db_state: State<'_, crate::db::DbManager>) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.clear_all_vectors().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_vectors_by_chat_id(db_state: State<'_, crate::db::DbManager>, chat_id: i64) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_vectors_by_chat_id(chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_recent_vectors_by_chat_id(
    db_state: State<'_, crate::db::DbManager>, 
    chat_id: i64, 
    limit: u32
) -> Result<Vec<VectorItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.query_recent_vectors_by_chat_id(chat_id, limit).map_err(|e| e.to_string())
}

// ==========================================
// 4. 代币消耗与充值 (Deposits & Tokenlogs)
// ==========================================

#[tauri::command]
pub async fn add_deposit(
    db_state: State<'_, crate::db::DbManager>, 
    deposit_type: String,
    source: String,
    timestamp: i64,
    payload: Value 
) -> Result<i64, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.add_deposit(&deposit_type, &source, timestamp, payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_token_log(
    db_state: State<'_, crate::db::DbManager>, 
    token_type: String,
    model_name: String,
    timestamp: i64,
    payload: Value 
) -> Result<i64, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.add_token_log(&token_type, &model_name, timestamp, payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_paged_deposits(
    db_state: State<'_, crate::db::DbManager>, 
    id: i64, 
    limit: u32
) -> Result<Vec<DepositItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_paged_deposits(id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_paged_tokenlogs(
    db_state: State<'_, crate::db::DbManager>, 
    id: i64, 
    limit: u32
) -> Result<Vec<TokenLogItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_paged_tokenlogs(id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_token_usage_above(db_state: State<'_, crate::db::DbManager>, timestamp: i64) -> Result<i64, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_token_usage_above(timestamp).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_logs_below(db_state: State<'_, crate::db::DbManager>, timestamp: i64) -> Result<usize, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_logs_below(timestamp).map_err(|e| e.to_string())
}

// ==========================================
// 5. 厂商与模型配置 (Providers & Models)
// ==========================================

#[tauri::command]
pub async fn save_provider(
    db_state: State<'_, crate::db::DbManager>, 
    id: Option<i64>, 
    payload: Value
) -> Result<i64, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.save_provider(id, payload).map_err(|e| e.to_string())
}

// ✨ 修复：返回值类型改为 Vec<ProviderItem>
#[tauri::command]
pub async fn get_providers(db_state: State<'_, crate::db::DbManager>, last_id: Option<i64>, limit: i64) -> Result<Vec<ProviderItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_providers(last_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_provider(db_state: State<'_, crate::db::DbManager>, provider_id: i64) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_provider(provider_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_model(
    db_state: State<'_, crate::db::DbManager>, 
    id: Option<i64>, 
    provider_id: i64, 
    model_type: String, 
    is_default: bool, // 前端传来的是 true/false，用 bool 接最方便
    payload: Value
) -> Result<i64, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    // 把 bool 转换为 SQLite 认识的 1 或 0
    let db_is_default = if is_default { 1 } else { 0 };
    app_db.save_model(id, provider_id, &model_type, db_is_default, payload).map_err(|e| e.to_string())
}

// ✨ 修复：返回值类型改为 Vec<ModelItem>
#[tauri::command]
pub async fn get_models(db_state: State<'_, crate::db::DbManager>, provider_id: i64, last_id: Option<i64>, limit: i64) -> Result<Vec<ModelItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_models(provider_id, last_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_model(db_state: State<'_, crate::db::DbManager>, model_id: i64) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_model(model_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_default_model_with_provider(db_state: State<'_, crate::db::DbManager>) -> Result<Option<DefaultModelData>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_default_model_with_provider().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_default_model(db_state: State<'_, crate::db::DbManager>, target_model_id: i64) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.set_default_model(target_model_id).map_err(|e| e.to_string())
}

// ==========================================
// 6. 系统配置 (System Settings)
// ==========================================
#[tauri::command]
pub async fn get_system_settings(id: i64, db_state: State<'_, crate::db::DbManager>) -> Result<Option<SystemSettingData>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_system_settings(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_system_settings_partial(id: i64, payload: String, db_state: State<'_, crate::db::DbManager>) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    // 直接存入黑盒字符串
    app_db.update_system_settings_partial(id, &payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_system_settings(id: i64, payload: String, db_state: State<'_, crate::db::DbManager>) -> Result<usize, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.save_system_settings(id, &payload).map_err(|e| e.to_string())
}