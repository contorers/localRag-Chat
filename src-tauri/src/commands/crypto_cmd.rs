// src/commands/crypto_cmd.rs
use crate::db;
use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use std::io::Cursor;
use image::imageops::FilterType;
use crate::db::crypto::{KeyStoreItem, RoomKey, UserPublicKey};

// --- Room Keys Commands ---
#[tauri::command]
pub async fn get_room_key_cmd(db_state: State<'_, crate::db::DbManager>, room_id: String, key_version: i64) -> Result<Option<RoomKey>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_room_key(&room_id, key_version).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_room_keys_cmd(db_state: State<'_, crate::db::DbManager>, keys: Vec<RoomKey>) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.upsert_room_keys(keys).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_room_key_cmd(db_state: State<'_, crate::db::DbManager>, room_id: String, key_version: i64) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_room_key(&room_id, key_version).map_err(|e| e.to_string())
}

// --- User Public Keys Commands ---
#[tauri::command]
pub async fn get_user_public_keys_cmd(
    db_state: State<'_, crate::db::DbManager>, 
    user_ids: Vec<String>
) -> Result<Vec<UserPublicKey>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_user_public_keys(user_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_user_public_keys_cmd(db_state: State<'_, crate::db::DbManager>, keys: Vec<UserPublicKey>) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.upsert_user_public_keys(keys).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_user_public_key_cmd(db_state: State<'_, crate::db::DbManager>, user_id: String) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_user_public_key(&user_id).map_err(|e| e.to_string())
}

// --- Key Store Commands ---
#[tauri::command]
pub async fn get_key_store_item_cmd(
    db_state: State<'_, crate::db::DbManager>, 
    key_name: String
) -> Result<Option<KeyStoreItem>, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.get_key_store_item(&key_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_key_store_items_cmd(
    db_state: State<'_, crate::db::DbManager>, 
    items: Vec<KeyStoreItem>
) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.upsert_key_store_items(items).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn has_keys_cmd(
    db_state: State<'_, crate::db::DbManager>, 
    key_names: Vec<String>
) -> Result<bool, String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.has_keys(key_names).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_key_store_item_cmd(
    db_state: State<'_, crate::db::DbManager>, 
    key_name: String
) -> Result<(), String> {
    let app_db = db_state.get_db().map_err(|e| e.to_string())?;
    app_db.delete_key_store_item(&key_name).map_err(|e| e.to_string())
}