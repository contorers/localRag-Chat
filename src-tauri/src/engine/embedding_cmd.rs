use crate::engine::embedding::EmbeddingEngine;
use serde::{Deserialize, Serialize};
use tauri::Manager; // 必须引入，提供 path() 方法
use tauri::Emitter;
use serde_json::json;

// 🌟 定义数据库记录结构
#[derive(Deserialize, Debug)]
pub struct SearchRecord {
    pub id: String,
    pub vector: Vec<f32>,
}

// 🌟 定义返回结果结构
#[derive(Serialize, Debug)]
pub struct SearchResult {
    pub id: String,
    pub score: f32,
}

// ============================================================================
// Tauri 命令：初始化嵌入引擎
// ============================================================================
#[tauri::command]
pub async fn init_embedding(app_handle: tauri::AppHandle) -> Result<(), String> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;

    let model_path = resource_dir
        .join("models/gte-small/model_quantized.onnx")
        .to_str()
        .ok_or("模型路径非UTF-8")?
        .to_string();

    let tokenizer_path = resource_dir
        .join("models/gte-small/tokenizer.json")
        .to_str()
        .ok_or("分词器路径非UTF-8")?
        .to_string();

    let handle = app_handle.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // 阶段1：开始加载
        handle.emit("embedding_progress", json!({
            "stage": "starting",
            "percent": 10,
            "message": "正在启动引擎..."
        })).ok();

        // 阶段2：加载 tokenizer（在 EmbeddingEngine::new 内部做，这里先发事件）
        handle.emit("embedding_progress", json!({
            "stage": "tokenizer",
            "percent": 30,
            "message": "正在加载分词器..."
        })).ok();

        // 阶段3：加载模型（最耗时）
        handle.emit("embedding_progress", json!({
            "stage": "model",
            "percent": 50,
            "message": "正在加载模型文件..."
        })).ok();

        // 真正执行初始化
        let result = EmbeddingEngine::init_global(&model_path, &tokenizer_path);

        match &result {
            Ok(_) => {
                // 成功
                handle.emit("embedding_progress", json!({
                    "stage": "ready",
                    "percent": 100,
                    "message": "模型加载完成！"
                })).ok();
            }
            Err(e) => {
                // 失败
                handle.emit("embedding_progress", json!({
                    "stage": "error",
                    "percent": 0,
                    "message": format!("加载失败: {}", e)
                })).ok();
            }
        }

        result
    })
    .await
    .map_err(|e| e.to_string())?
}

// ============================================================================
// Tauri 命令：获取文本向量
// ============================================================================
#[tauri::command]
pub fn get_vector_embedding(text: &str) -> Result<Vec<f32>, String> {
    EmbeddingEngine::encode_global(text)
}

// ============================================================================
// 内部函数：供后台任务调用的向量化（复用 get_embedding）
// ============================================================================
pub fn get_embedding(text: &str) -> Result<Vec<f32>, String> {
    EmbeddingEngine::encode_global(text)
}

// ============================================================================
// 内部高性能向量搜索（非 Tauri 命令）
// ============================================================================
pub fn search_vectors(
    query_vector: &[f32],
    records: &[SearchRecord],
    limit: usize,
) -> Vec<SearchResult> {
    let mut results: Vec<SearchResult> = records
        .iter()
        .filter_map(|record| {
            if record.vector.len() != query_vector.len() {
                return None; // 维度不匹配直接丢弃
            }
            let score: f32 = query_vector
                .iter()
                .zip(record.vector.iter())
                .map(|(a, b)| a * b)
                .sum();
            Some(SearchResult {
                id: record.id.clone(),
                score,
            })
        })
        .collect();

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    results
}

// ============================================================================
// Tauri 命令：前端可直接调用的向量搜索接口
// ============================================================================
#[tauri::command]
pub fn search_vectors_command(
    query_vector: Vec<f32>,
    records: Vec<SearchRecord>,
    limit: usize,
) -> Vec<SearchResult> {
    search_vectors(&query_vector, &records, limit)
}