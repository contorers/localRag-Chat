// src/lib.rs
mod commands;
mod db; // 引入刚才建好的路由层
mod key;
mod engine;

use argon2::Argon2;
use tauri::Manager;
use tauri_plugin_stronghold::Builder;
use tokio::sync::Mutex;
use std::sync::Arc;
use crate::key::key_manager::KeyManager;
use engine::embedding::EmbeddingEngine;
use crate::engine::vector_index::{save_indexes}; 
use std::fs;
use std::path::PathBuf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            Builder::new(|password| {
                let salt = b"my-app-salt-32bytes-long-ok!";
                let argon2 = Argon2::default();
                let mut output_key = [0u8; 32];
                argon2
                    .hash_password_into(password.as_bytes(), salt, &mut output_key)
                    .expect("Argon2 key derivation failed");
                output_key.to_vec()
            })
            .build(),
        )
        .register_uri_scheme_protocol("user-data", |app, request| {
            let app_handle = app.app_handle();
            let user_dir = crate::db::get_user_dir(app_handle).unwrap_or_else(|_| std::path::PathBuf::new());
            
            let path_str = request.uri().path();
            let relative_path = path_str.strip_prefix('/').unwrap_or(path_str);
            let decoded_path = relative_path.replace("%20", " ");
            
            // 1. 初步拼接路径
            let expected_path = user_dir.join(decoded_path);

            // 🌟 核心防御：防止目录穿越 (Path Traversal)
            // canonicalize() 会解析掉所有的 ../ 和 ./，计算出真实的物理绝对路径
            if let (Ok(canonical_target), Ok(canonical_base)) = (expected_path.canonicalize(), user_dir.canonicalize()) {
                
                // 2. 绝对信任校验：解析后的真实路径，必须以 user_dir 的真实路径开头
                if canonical_target.starts_with(&canonical_base) {
                    
                    // 3. 校验通过，允许读取
                    if let Ok(bytes) = std::fs::read(&canonical_target) {
                        return tauri::http::Response::builder()
                            .header("Access-Control-Allow-Origin", "*")
                            .body(bytes)
                            .unwrap();
                    }
                } else {
                    // 警告：检测到越权访问尝试！
                    eprintln!("安全拦截：尝试越权访问 {:?}", canonical_target);
                }
            }

            // 一切异常、文件不存在、越权，统一返回 403 或 404，不泄露系统信息
            tauri::http::Response::builder()
                .status(403)
                .body(Vec::new())
                .unwrap()
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let data_dir = window.app_handle()
                    .path()
                    .app_data_dir()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_string();
                let _ = crate::engine::vector_index::save_indexes(&data_dir);
            }
        })
        .setup(|app| {
            let exe_dir = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();

            let dll_path = exe_dir.join("onnxruntime.dll");
            println!("DLL 路径: {:?}, 存在: {}", dll_path, dll_path.exists());

            assert!(
                ort::init_from(dll_path).expect("DLL 路径无效").commit(),
                "ORT 初始化失败"
            );

            // 🌟 注入一个空的数据库管理器，等待用户登录后填入
            app.manage(db::DbManager::new());
        
            app.manage(KeyManager::new());
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // =======================================
            // 💾 密钥查询/数据操作的指令
            // =======================================

            //crypto RoomKeys模块
            commands::crypto_cmd::get_room_key_cmd,
            commands::crypto_cmd::upsert_room_keys_cmd,
            commands::crypto_cmd::delete_room_key_cmd,


            //crypto UserPublicKeys模块
            commands::crypto_cmd::get_user_public_keys_cmd,
            commands::crypto_cmd::upsert_user_public_keys_cmd,
            commands::crypto_cmd::delete_user_public_key_cmd,

            //crypto KeyStore模块

            commands::crypto_cmd::get_key_store_item_cmd,
            commands::crypto_cmd::upsert_key_store_items_cmd,
            commands::crypto_cmd::has_keys_cmd,
            commands::crypto_cmd::delete_key_store_item_cmd,


            // =======================================
            // 💾 ai模块专属数据库的指令
            // =======================================
            commands::ai_cmd::add_chat_list,
            commands::ai_cmd::query_chat_list,
            commands::ai_cmd::query_chat_list_by_model_id,
            commands::ai_cmd::delete_chat_list_by_id,
            commands::ai_cmd::query_chat_list_by_id,
            commands::ai_cmd::update_chat_list,
            commands::ai_cmd::clear_all_chat_list_data,
            commands::ai_cmd::add_chat_messages,
            commands::ai_cmd::query_chat_messages,
            commands::ai_cmd::query_messages_by_ids,
            commands::ai_cmd::query_chat_ids_messages,
            commands::ai_cmd::delete_chat_message_by_chat_id,
            commands::ai_cmd::delete_chat_message_by_id,
            commands::ai_cmd::clear_all_chat_data,
            commands::ai_cmd::count_messages_by_chat_id,
            commands::ai_cmd::query_messages_slice,
            commands::ai_cmd::save_message_vector,
            commands::ai_cmd::query_recent_messages_with_vectors,
            commands::ai_cmd::query_all_messages_with_vectors,
            commands::ai_cmd::upsert_vectors_batch,
            commands::ai_cmd::query_recent_vectors,
            commands::ai_cmd::prune_oldest_vectors,
            commands::ai_cmd::clear_all_vectors,
            commands::ai_cmd::delete_vectors_by_chat_id,
            commands::ai_cmd::query_recent_vectors_by_chat_id,
            commands::ai_cmd::add_deposit,
            commands::ai_cmd::add_token_log,
            commands::ai_cmd::get_paged_deposits,
            commands::ai_cmd::get_paged_tokenlogs,
            commands::ai_cmd::get_token_usage_above,
            commands::ai_cmd::delete_logs_below,
            commands::ai_cmd::save_provider,
            commands::ai_cmd::get_providers,
            commands::ai_cmd::delete_provider,
            commands::ai_cmd::save_model,
            commands::ai_cmd::get_models,
            commands::ai_cmd::delete_model,
            commands::ai_cmd::get_default_model_with_provider,
            commands::ai_cmd::set_default_model,
            commands::ai_cmd::get_system_settings,
            commands::ai_cmd::update_system_settings_partial,
            commands::ai_cmd::save_system_settings,


            // =======================================
            // 🔐 登录挂载专属数据库的指令
            // =======================================
            commands::auth_cmd::login_success_init_db,
            commands::auth_cmd::get_app_dir_cmd,
            commands::auth_cmd::migrate_app_data,

             // =======================================
            //  用户公私钥相关的指令
            // =======================================
            key::key_cmd::load_keys_to_vault_cmd,
            key::key_cmd::is_vault_loaded_cmd,
            key::key_cmd::reset_vault_cmd,
            key::key_cmd::sign_message_cmd,
            key::key_cmd::decrypt_message_cmd,
            key::key_cmd::decrypt_message_batch_cmd,
            key::key_cmd::get_public_key_cmd,
            key::key_cmd::generate_and_backup_all_keys_cmd,
            key::key_cmd::restore_and_load_keys_cmd,
            key::key_cmd::change_backup_password_cmd,

            // =======================================
            // 🔐 embedding的指令
            // =======================================
            engine::embedding_cmd::init_embedding,
            engine::embedding_cmd::get_vector_embedding,

            // =======================================
            // 🔐 memory_service的指令
            // =======================================
            engine::memory_service::get_relevant_context_all_hybrid,
            engine::memory_service::run_background_memory_history,
            engine::memory_service::run_background_memory_facts,
            engine::memory_service::run_epoch_memory_compression,
            engine::memory_service::search_chat_messages,
            //engine::memory_service::semantic_search,

            // =======================================
            // 🔐 llm_service的指令
            // =======================================
            engine::llm_service::run_rolling_chat_summary,
            engine::llm_service::run_epoch_memory_chat_epoch_summary,
            engine::llm_service::extract_memory_facts_with_llm,

        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
