// src/commands/auth_cmd.rs
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use serde_json::json;
use fs_extra::dir::{copy, CopyOptions};
use std::sync::Arc;

#[tauri::command]
pub async fn login_success_init_db(user_id: String, app_handle: AppHandle) -> Result<(), String> {
    let default_app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| "无法获取系统 AppData 目录".to_string())?;

    let global_config_path = default_app_data.join("config.json");

    let mut base_storage_path = default_app_data;
    if let Ok(config_str) = fs::read_to_string(&global_config_path) {
        if let Ok(config_json) = serde_json::from_str::<serde_json::Value>(&config_str) {
            if let Some(custom_path) = config_json.get("storage_path").and_then(|p| p.as_str()) {
                base_storage_path = PathBuf::from(custom_path);
            }
        }
    }

    let user_dir = base_storage_path.join(format!("user_{}", user_id));
    if !user_dir.exists() {
        fs::create_dir_all(&user_dir).map_err(|e| format!("创建用户主目录失败: {}", e))?;
    }

    for sub in &["avatars", "images", "videos", "attachments"] {
        let sub_dir = user_dir.join(sub);
        if !sub_dir.exists() {
            fs::create_dir_all(&sub_dir).ok();
        }
    }

    let db_path = user_dir.join("main.db");
    let app_db = crate::db::AppDb::new(&db_path, user_dir.clone())
        .map_err(|e| e.to_string())?;

    {
        let manager = app_handle.state::<crate::db::DbManager>();
        let mut db_guard = manager.current_db.lock().unwrap();
        *db_guard = Some(app_db.clone());
    }

    println!("✅ 账号 {} 数据库挂载于: {:?}", user_id, db_path);

    let data_dir = user_dir.to_str().ok_or("路径非UTF-8")?;
    crate::engine::vector_index::init_indexes(data_dir, &app_db)
        .map_err(|e| format!("向量索引初始化失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_app_dir_cmd(app_handle: AppHandle) -> Result<String, String> {
    let default_app_data = app_handle.path().app_data_dir()
        .map_err(|_| "Error".to_string())?;
    let global_config_path = default_app_data.join("config.json");

    let mut base_storage_path = default_app_data;
    if let Ok(config_str) = fs::read_to_string(&global_config_path) {
        if let Ok(config_json) = serde_json::from_str::<serde_json::Value>(&config_str) {
            if let Some(custom_path) = config_json.get("storage_path").and_then(|p| p.as_str()) {
                base_storage_path = PathBuf::from(custom_path);
            }
        }
    }

    Ok(base_storage_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn migrate_app_data(
    user_id: String,
    new_path: String,
    app_handle: AppHandle
) -> Result<(), String> {
    println!("📦 迁移请求 → user_id: {}, new_path: {}", user_id, new_path);

    let default_app_data = app_handle.path().app_data_dir()
        .map_err(|_| "Error".to_string())?;
    let global_config_path = default_app_data.join("config.json");

    // 读取当前旧路径
    let mut old_path = default_app_data.clone();
    if let Ok(config_str) = fs::read_to_string(&global_config_path) {
        if let Ok(config_json) = serde_json::from_str::<serde_json::Value>(&config_str) {
            if let Some(custom) = config_json.get("storage_path").and_then(|p| p.as_str()) {
                old_path = PathBuf::from(custom);
            }
        }
    }

    let new_p = Path::new(&new_path);
    if !old_path.exists() || old_path == new_p {
        return Ok(());
    }
    
    // ① 关闭 DB
    {
        let manager = app_handle.state::<crate::db::DbManager>();
        let mut db_guard = manager.current_db.lock().unwrap();
        if let Some(db) = db_guard.take() {
            drop(db_guard);
            println!("🔍 close 前 Arc 引用计数: {}", Arc::strong_count(&db.conn));
            match db.close() {
                Ok(_) => println!("✅ DB 已关闭"),
                Err(e) => println!("❌ DB close 失败: {}", e),
            }
        }
    }

    // ③ 等待 OS 释放句柄
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // ④ 拷贝到新路径
    if !new_p.exists() {
        fs::create_dir_all(new_p).map_err(|e| format!("创建新目录失败: {}", e))?;
    }
    let mut options = CopyOptions::new();
    options.overwrite = true;
    options.content_only = true;
    copy(old_path.as_path(), new_p, &options)
        .map_err(|e| format!("拷贝文件失败: {}", e))?;

    // ⑤ 更新 AppData 里的 config.json 指针
    fs::write(&global_config_path, json!({ "storage_path": new_path }).to_string())
        .map_err(|e| format!("保存配置失败: {}", e))?;
    println!("📝 config.json 指针已更新 → {}", new_path);

    // ⑥ 重新挂载新路径的 DB
    crate::commands::auth_cmd::login_success_init_db(user_id.clone(), app_handle.clone()).await?;

    // ⑦ 后台清理旧目录
    let old_path_clone = old_path.clone();
    let default_app_data_clone = default_app_data.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        if old_path_clone == default_app_data_clone {
            // 旧路径是 AppData：只删用户数据子目录，保留 config.json 等文件
            let user_dir = old_path_clone.join(format!("user_{}", user_id));
            if user_dir.exists() {
                match fs::remove_dir_all(&user_dir) {
                    Ok(_) => println!("✅ 旧用户目录清理完成"),
                    Err(e) => println!("⚠️ 旧用户目录清理失败: {}", e),
                }
            }
        } else {
            // 旧路径是自定义路径：整个删掉
            match fs::remove_dir_all(&old_path_clone) {
                Ok(_) => println!("✅ 旧目录清理完成"),
                Err(e) => println!("⚠️ 旧目录清理失败（已忽略）: {}", e),
            }
        }
    });

    Ok(())
}