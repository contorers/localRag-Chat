use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use itertools::Itertools;
use std::sync::LazyLock;
use jieba_rs::Jieba;

// 引入你的模块
use crate::engine::embedding::EmbeddingEngine;
use crate::engine::embedding_cmd::{SearchRecord,SearchResult,get_embedding,search_vectors};
//use crate::engine::vector_index::{add_message_vector,add_fact_vector,search_messages,search_facts};
use crate::engine::vector_index::{
    FACT_INDEX, add_message_vector, add_fact_vector, search_messages, search_facts
};
use crate::engine::llm_service::{clean_message_content,run_rolling_chat_summary, run_epoch_memory_chat_epoch_summary, extract_memory_facts_with_llm};
use crate::engine::hybrid_search::{analyze_query_intent, reciprocal_rank_fusion, QueryIntent};
use crate::db::ai::{
    ChatListItem, ChatMessageItem, DefaultModelData, DepositItem, 
    ModelItem, ProviderItem, SystemSettingData, TokenLogItem, VectorItem,
};

// ============================================================================
// 外部 LLM 请求 (异步占位符)
// ============================================================================

// #[tauri::command]
// pub async fn semantic_search(
//     query: String,
//     limit: usize,
//     app_db: State<'_, crate::db::DbManager>,
// ) -> Result<Vec<ChatMessageItem>, String> {
//     // 1. 查询文本转向量
//     let query_vector = EmbeddingEngine::encode_global(&query)?;
//     let db = app_db.get_db()?; 
//     // 2. usearch 找最相似的 message_id
//     let similar = search_similar(&query_vector, limit)?;
//     let ids: Vec<u64> = similar.iter().map(|(id, _)| *id).collect();

//     // 3. 去 SQLite 拉完整消息
//     let messages = db.query_messages_by_ids(&ids).await?;
//     Ok(messages)
// }

// 占位：纯文本检索
/// 在指定会话中搜索消息
#[tauri::command]
pub fn search_chat_messages(
    app_db: State<'_, crate::db::DbManager>,
    keyword: &str,
    chatId: Option<i64>, // 🌟 改成 Option，一个接口搞定全局和局部！
) -> Result<Vec<Value>, String> { // 🌟 必须返回 Result，错误信息变成 String 抛给前端
    
    // 1. 获取数据库实例 (如果失败，? 会自动把 String 错误抛给前端)
    let db = app_db.get_db()?; 

    // 2. 调用底层终极搜索函数
    // map_err 的作用是把 rusqlite::Error 转换成前端能看懂的 String 错误
    let rows = db.search_messages(keyword, chatId)
        .map_err(|e| format!("数据库搜索失败: {}", e))?;

    // 3. 组装前端需要的数据格式
    let mut results = Vec::new();
    for (id, cid, payload_str) in rows {
        // payload 是字符串，我们需要把它反序列化回 JSON 对象
        // 如果解析失败，给个空对象兜底，防止整个接口崩溃
        let mut json_obj: Value = serde_json::from_str(&payload_str)
            .unwrap_or_else(|_| serde_json::json!({}));
        
        // 可选体验优化：把 SQLite 的真实 id 和 chat_id 动态塞进返回的 JSON 里
        // 这样前端就不需要到处猜这个数据属于哪个聊天了
        if let Some(obj) = json_obj.as_object_mut() {
            obj.insert("sqlite_id".to_string(), serde_json::json!(id));
            obj.insert("chat_id".to_string(), serde_json::json!(cid));
        }

        results.push(json_obj);
    }

    Ok(results) // 成功返回
}


// 辅助提取 payload 里的 role 和 content
fn extract_role_content(payload: &str) -> (String, String) {
    if let Ok(v) = serde_json::from_str::<Value>(payload) {
        let role = v.get("role").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let content = v.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
        (role, content)
    } else {
        (String::new(), String::new())
    }
}

// ============================================================================
// 文本清洗与智能提取 
// ============================================================================
static SKIP_LANGS_REGEX: OnceLock<Regex> = OnceLock::new();
static IMG_REGEX: OnceLock<Regex> = OnceLock::new();
static LINK_REGEX: OnceLock<Regex> = OnceLock::new();
static DECORATION_REGEX: OnceLock<Regex> = OnceLock::new();
static TABLE_ROW_REGEX: OnceLock<Regex> = OnceLock::new();
static TABLE_LINE_REGEX: OnceLock<Regex> = OnceLock::new();
static MULTI_NEWLINE_REGEX: OnceLock<Regex> = OnceLock::new();
static MULTI_SPACE_REGEX: OnceLock<Regex> = OnceLock::new();

pub fn smart_extract_for_code(content: &str) -> String {
    if content.is_empty() { return String::new(); }

    let skip_langs = SKIP_LANGS_REGEX.get_or_init(|| Regex::new(r"^(?i)(mermaid|svg|latex|tex|plantuml|dot|drawio)\s*").unwrap());
    let img_re = IMG_REGEX.get_or_init(|| Regex::new(r"!\[.*?\]\(.*?\)").unwrap());
    let link_re = LINK_REGEX.get_or_init(|| Regex::new(r"\[(.*?)\]\(.*?\)").unwrap());
    let deco_re = DECORATION_REGEX.get_or_init(|| Regex::new(r"[#*>`~]").unwrap());
    let table_row_re = TABLE_ROW_REGEX.get_or_init(|| Regex::new(r"(?m)^\|.*\|$").unwrap());
    let table_line_re = TABLE_LINE_REGEX.get_or_init(|| Regex::new(r"(?m)^\s*[-|]+\s*$").unwrap());
    let multi_nl_re = MULTI_NEWLINE_REGEX.get_or_init(|| Regex::new(r"\n{3,}").unwrap());
    let multi_sp_re = MULTI_SPACE_REGEX.get_or_init(|| Regex::new(r"[ \t]+").unwrap());

    let normalized = content.replace("\\n", "\n");
    let tokens: Vec<&str> = normalized.split("```").collect();
    let mut final_parts = Vec::new();

    for (i, token) in tokens.iter().enumerate() {
        let trimmed_token = token.trim();
        if trimmed_token.is_empty() { continue; }

        if i % 2 == 1 {
            let lang_line = token.lines().next().unwrap_or("");
            if skip_langs.is_match(lang_line) {
                final_parts.push("[图表已省略]".to_string());
            } else {
                final_parts.push(format!("```{}```", token));
            }
        } else {
            let mut cleaned = img_re.replace_all(token, "[Image]").to_string();
            cleaned = link_re.replace_all(&cleaned, "$1").to_string();
            cleaned = deco_re.replace_all(&cleaned, "").to_string();
            cleaned = table_row_re.replace_all(&cleaned, "").to_string();
            cleaned = table_line_re.replace_all(&cleaned, "").to_string();
            cleaned = multi_nl_re.replace_all(&cleaned, "\n\n").to_string();
            cleaned = multi_sp_re.replace_all(&cleaned, " ").to_string();
            
            let final_clean = cleaned.trim();
            if !final_clean.is_empty() {
                final_parts.push(final_clean.to_string());
            }
        }
    }
    final_parts.join("\n").trim().to_string()
}

pub fn clean_for_llm_summary(text: &str) -> String {
    if text.is_empty() { return String::new(); }
    
    let img_re = IMG_REGEX.get_or_init(|| Regex::new(r"!\[.*?\]\(.*?\)").unwrap());
    let table_line_re = TABLE_LINE_REGEX.get_or_init(|| Regex::new(r"(?m)^\s*[-|]+\s*$").unwrap());
    let multi_nl_re = MULTI_NEWLINE_REGEX.get_or_init(|| Regex::new(r"\n{3,}").unwrap());
    let multi_sp_re = MULTI_SPACE_REGEX.get_or_init(|| Regex::new(r"[ \t]+").unwrap());

    let mut cleaned = img_re.replace_all(text, "[图片/文件]").to_string();
    cleaned = table_line_re.replace_all(&cleaned, "").to_string();
    cleaned = multi_nl_re.replace_all(&cleaned, "\n\n").to_string();
    cleaned = multi_sp_re.replace_all(&cleaned, " ").to_string();
    
    cleaned.trim().to_string()
}

// ============================================================================
// 超高性能指纹哈希
// ============================================================================
pub fn cyrb64_hash_to_int(s: &str, seed: u32) -> u64 {
    let mut h1: u32 = 0xdeadbeef ^ seed;
    let mut h2: u32 = 0x41c6ce57 ^ seed;

    for byte in s.bytes() {
        let ch = byte as u32;
        h1 = (h1 ^ ch).wrapping_mul(2654435761);
        h2 = (h2 ^ ch).wrapping_mul(1597334677);
    }
    h1 = (h1 ^ (h1 >> 16)).wrapping_mul(2246822507);
    h1 ^= h2 ^ (h2 >> 13).wrapping_mul(3266489909);
    h2 = (h2 ^ (h2 >> 16)).wrapping_mul(2246822507);
    h2 ^= h1 ^ (h1 >> 13).wrapping_mul(3266489909);

    let high = (2097151 & h2) as u64;
    let low = h1 as u64;
    
    (high * 4294967296) + low
}

// ============================================================================
// 工具类 
// ============================================================================

fn bytes_to_f32_slice(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect()
}

fn chat_message_to_value(msg: &ChatMessageItem) -> Value {
    // 1. 尝试把 payload 字符串解析成 Value
    let mut obj = serde_json::from_str::<Value>(&msg.payload)
        .unwrap_or(Value::Null);

    // 2. 确保 obj 是一个 Object
    if let Value::Object(ref mut map) = obj {
        map.insert("id".to_string(), json!(msg.id));
        map.insert("chat_id".to_string(), json!(msg.chat_id));
        map.insert("timestamp".to_string(), json!(msg.timestamp));
    } else {
        // 如果 payload 不是合法 JSON Object，就重新建一个包含所有字段的对象
        obj = json!({
            "id": msg.id,
            "chat_id": msg.chat_id,
            "timestamp": msg.timestamp,
            "payload": msg.payload,  // 或者直接保留原字符串
        });
    }

    obj
}
// ============================================================================
// 主函数：混合检索大一统 
// ============================================================================
#[derive(Serialize)]
pub struct HybridContextResult {
    pub facts: Vec<String>,
    pub qa_context: Vec<String>,
}

#[tauri::command]
pub async fn get_relevant_context_all_hybrid(
    app_db: State<'_, crate::db::DbManager>,
    userInput: String,
    currentChatId: i64,
    excludeIds: Vec<i64>,
    modelConfig: Option<Value>,
) -> Result<HybridContextResult, String> {
    
    let exclude_id_set: HashSet<i64> = excludeIds.into_iter().collect();
    let final_query = userInput.trim();
    let config = modelConfig.unwrap_or(Value::Null);

    let keyword_query = extract_keyword_query(final_query);
    let query_vector = get_embedding(&final_query).ok();
 
    let db = app_db.get_db().map_err(|e| e.to_string())?;

    let vector_search_limit = config.get("vectorSearchLimit").and_then(|v| v.as_i64()).unwrap_or(8) as usize;
    let db_fact_vector_limit = config.get("dbFactVectorLimit").and_then(|v| v.as_i64()).unwrap_or(8) as usize;
    let fact_threshold = config.get("factSimilarityThreshold").and_then(|v| v.as_f64()).unwrap_or(0.72) as f32;
    let k = config.get("rrfConstantK").and_then(|v| v.as_f64()).unwrap_or(30.0) as f32;
    
    // ============================================================================
    // 🌟 1. 内存向量检索 (极速，仅返回 ID 和 Score)
    // ============================================================================
    
    // 假设你的底层函数能在找不到 query_vector 时安全返回空结果
    let raw_message_results = if let Some(ref q_vec) = query_vector {
        search_messages(q_vec, vector_search_limit * 2,&db).unwrap_or_default()
    } else {
        vec![]
    };

    let raw_fact_results = if let Some(ref q_vec) = query_vector {
        search_facts(q_vec, db_fact_vector_limit * 2,&db).unwrap_or_default()
    } else {
        vec![]
    };
    for (uid, score) in &raw_fact_results {
        println!("[DEBUG] fact_id={}, score={:.4}", uid, score);
    }
    // ============================================================================
    // 🌟 2. 组装 RRF 融合所需的数据 (Messages) 
    // ============================================================================
    
    // 2.1 转换 Semantic 结果 (直接把 u64 变成 i64，并过滤 exclude_ids 和低分)
    // 注意：这里完全不需要查询数据库，极大地节省了性能！
    let semantic_values: Vec<Value> = raw_message_results.into_iter()
        .filter_map(|(uid, score)| {
            let db_id = uid as i64;
            if exclude_id_set.contains(&db_id) || score < fact_threshold {
                None
            } else {
                Some(json!({
                    "id": db_id.to_string(), // RRF 需要 string 类型的 id
                    "score": score
                }))
            }
        })
        .take(vector_search_limit)
        .collect();

    // 2.2 获取关键词搜索结果
    let keyword_results = db.search_messages(&keyword_query, None).map_err(|e| e.to_string())?;
    let mut filtered_keyword: Vec<Value> = Vec::new();
    for (id, _, payload) in keyword_results {
        if !exclude_id_set.contains(&id) {
            let mut json_val: Value = serde_json::from_str(&payload).unwrap_or_default();
            json_val["id"] = json!(id.to_string());
            filtered_keyword.push(json_val);
            if filtered_keyword.len() >= 10 { break; }
        }
    }

    // 2.3 运行 RRF 融合
    let ranked_results = reciprocal_rank_fusion(
        filtered_keyword,
        semantic_values, 
        analyze_query_intent(final_query),
        k,
    );

    // ============================================================================
    // 🌟 3. 事实提取与组装 (Facts - 需要回表查正文)
    // ============================================================================
    let mut core_facts: Vec<String> = Vec::new();
    
    // 先把达到分数阈值的 Fact IDs 挑出来
    let valid_fact_ids: Vec<i64> = raw_fact_results.into_iter()
        .filter(|(_, score)| *score > fact_threshold)
        .map(|(uid, _)| uid as i64)
        .collect();

        if !valid_fact_ids.is_empty() {
            // 🚀 这里直接调用你刚写好的查询方法
            if let Ok(fact_records) = db.query_vectors_by_ids(valid_fact_ids) {
                for record in fact_records {
                    let payload_json: Value = serde_json::from_str(&record.payload).unwrap_or_default();
                    
                    // 提取存放在 payload 里的 textContent
                    if let Some(text) = payload_json.get("textContent").and_then(|v| v.as_str()) {
                        if !text.trim().is_empty() {
                            core_facts.push(text.to_string());
                        }
                    }
                }
            }
        }
    // ============================================================================
    // 🌟 4. 时间衰减计算与上下文组装 (保持你原来的优秀逻辑)
    // ============================================================================
    let candidate_ids: Vec<i64> = ranked_results.iter().filter_map(|r| r.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse::<i64>().ok())).collect();
    let candidate_messages = db.query_messages_by_ids(candidate_ids).map_err(|e| e.to_string())?;

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
    let decay_rate = config.get("timeDecayRate").and_then(|v| v.as_f64()).unwrap_or(0.04);
    let final_context_limit = config.get("finalContextLimit").and_then(|v| v.as_i64()).unwrap_or(5) as usize;

    let mut top_unique_results: Vec<(f64, &Value, &ChatMessageItem)> = ranked_results
        .iter()
        .filter_map(|res| {
            let res_id = res.get("id").and_then(|v| v.as_str()).and_then(|s| s.parse::<i64>().ok())?;
            let meta = candidate_messages.iter().find(|m| m.id == res_id)?;
            let hours_old = (now - meta.timestamp) as f64 / 3600000.0;
            // 注意：RRF 通常输出的是 rrf_score，这里根据你的实际返回字段取值
            let score = res.get("rrf_score").or_else(|| res.get("score")).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let final_score = score * (-decay_rate * hours_old).exp();
            Some((final_score, res, meta))
        })
        .collect();

        top_unique_results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        top_unique_results.truncate(final_context_limit);
    
        let top_chat_ids: Vec<i64> = top_unique_results
            .iter()
            .map(|(_, _, m)| m.chat_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
    
        let target_chats_records = db.query_chat_ids_messages(top_chat_ids, 1000)
            .map_err(|e| e.to_string())?;
        let filtered_target_records: Vec<_> = target_chats_records
            .into_iter()
            .filter(|r| !exclude_id_set.contains(&r.id))
            .collect();
    
        let mut processed_qa_pairs = HashSet::new();
        let min_valid_length = config.get("minValidAiLength")
            .and_then(|v| v.as_i64()).unwrap_or(10) as usize;
    
        let mut formatted_messages = Vec::new();
        for (_, _res, res_msg) in top_unique_results {
            let mut chat_timeline: Vec<_> = filtered_target_records
                .iter()
                .filter(|m| m.chat_id == res_msg.chat_id)
                .collect();
            chat_timeline.sort_by_key(|a| a.id);
    
            let local_idx = chat_timeline.iter().position(|r| r.id == res_msg.id);
            if local_idx.is_none() { continue; }
            let local_idx = local_idx.unwrap();
    
            let (res_role, res_content) = extract_role_content(&res_msg.payload);
            let mut q = String::new();
            let mut a = String::new();
            let mut pair_id = 0i64;
    
            if res_role == "user" {
                if let Some(next_msg) = chat_timeline.get(local_idx + 1) {
                    let (next_role, next_content) = extract_role_content(&next_msg.payload);
                    if next_role == "assistant" && next_content.len() > min_valid_length {
                        pair_id = res_msg.id;
                        q = smart_extract_for_code(&res_content);
                        a = smart_extract_for_code(&next_content);
                    }
                }
            } else if res_role == "assistant" {
                if local_idx > 0 {
                    if let Some(prev_msg) = chat_timeline.get(local_idx - 1) {
                        let (prev_role, prev_content) = extract_role_content(&prev_msg.payload);
                        if prev_role == "user" {
                            pair_id = prev_msg.id;
                            q = smart_extract_for_code(&prev_content);
                            a = smart_extract_for_code(&res_content);
                        }
                    }
                }
            }
    
            if pair_id == 0 || processed_qa_pairs.contains(&pair_id) { continue; }
            processed_qa_pairs.insert(pair_id);
            formatted_messages.push(format!("[History Q&A]:\nQ: {}\nA: {}", q, a));
        }
    
        let mut final_context = Vec::new();
        if !core_facts.is_empty() {
            let lines = core_facts.iter().map(|f| format!("- {}", f)).collect::<Vec<_>>().join("\n");
            final_context.push(format!("[Long-term Facts]\n{}", lines));
        }

        Ok(HybridContextResult {
            facts: final_context,
            qa_context: formatted_messages,
        })
}
// 关键词提取辅助函数
static KEYWORD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[\u4e00-\u9fa5]+|[a-zA-Z0-9+#.-]+").unwrap()
});

static JIEBA: LazyLock<Jieba> = LazyLock::new(Jieba::new);

pub fn extract_keyword_query(input: &str) -> String {
    let tokens: Vec<&str> = KEYWORD_RE.find_iter(input).map(|m| m.as_str()).collect();
    let mut result: Vec<String> = Vec::new();

    for token in tokens {
        if token.chars().any(|c| ('\u{4e00}'..='\u{9fa5}').contains(&c)) {
            let words = JIEBA.cut(token, false);
            // 注意这里：w.word 是分词后的文本
            result.extend(words.into_iter().map(|w| w.word.to_string()));
        } else {
            result.push(token.to_string());
        }
    }

    result.join(" ")
}

// ============================================================================
// 后台静默记忆压缩任务
// ============================================================================
#[tauri::command]
pub async fn run_background_memory_history(
    app_db: State<'_, crate::db::DbManager>,
    chatId: i64,
    summarizedCount: i64,
    modelConfig: Value,
) -> Result<(), String> {
    let db = app_db.get_db().map_err(|e| e.to_string())?;

    let recent_limit = modelConfig
        .get("recentLimit")
        .and_then(|v| v.as_i64())
        .unwrap_or(10);
    let batch_size = modelConfig
        .get("searchLimit")
        .and_then(|v| v.as_i64())
        .unwrap_or(20);

    let total_count = db
        .count_messages_by_chat_id(chatId)
        .map_err(|e| e.to_string())?;
    if total_count - summarizedCount < recent_limit {
        return Ok(());
    }

    // 读取一批未压缩的消息
    let messages_to_compress = db
        .query_messages_slice(chatId, summarizedCount as u32, batch_size as u32)
        .map_err(|e| e.to_string())?;
    if messages_to_compress.is_empty() {
        return Ok(());
    }

    // 构建发送给 LLM 的带 ID 消息列表
    let mut messages_for_llm: Vec<Value> = Vec::new();
    for item in &messages_to_compress {
        let mut val = serde_json::from_str::<Value>(&item.payload)
            .unwrap_or(Value::Null);
        // 清洗 content
        if let Some(c) = val.get("content").and_then(|v| v.as_str()) {
            val["content"] = json!(clean_for_llm_summary(c));
        }
        // 注入消息 ID（LLM 将原样返回，用于回写）
        val["id"] = json!(item.id);
        messages_for_llm.push(val);
    }

    // 调用压缩命令，获得 JSON 数组字符串
    let final_summary = run_rolling_chat_summary(
        app_db.clone(),
        messages_for_llm.clone(),
        modelConfig.clone(),
    )
    .await?;

    // 🛡️ 安全解析：如果为空或报错，退化为空数组
    let compressed_array: Vec<Value> = serde_json::from_str(&final_summary)
        .unwrap_or_default();

    // 将 LLM 成功压缩的结果转为 HashMap，实现 O(1) 快速查找
    let mut compressed_map: HashMap<i64, String> = HashMap::new();
    for item in compressed_array {
        if let (Some(id), Some(text)) = (
            item.get("id").and_then(|v| v.as_i64()),
            item.get("compressed_text").and_then(|v| v.as_str()),
        ) {
            compressed_map.insert(id, text.to_string());
        }
    }

    let mut updates = Vec::new();
    let safe_char_limit = 750;

    // 遍历已经“脱水”过并注入了 ID 的 messages_for_llm
    for val in &messages_for_llm {
        let id = val.get("id").and_then(|v| v.as_i64()).expect("逻辑错误：未找到注入的 ID");
        
        // 1. 决定基础文本：LLM 是否成功压缩了？成功就用压缩的，失败就用脱水原文本
        let base_text = if let Some(compressed_text) = compressed_map.get(&id) {
            compressed_text.clone()
        } else {
            val.get("content").and_then(|v| v.as_str()).unwrap_or("").trim().to_string()
        };

        if base_text.is_empty() {
            continue; 
        }

        // 2. 构造一个临时的 JSON Value 给截断函数用
        // 获取原始的 role，如果没有默认当作 user
        let role = val.get("role").and_then(|v| v.as_str()).unwrap_or("user");
        let mock_msg = json!({
            "role": role,
            "content": base_text
        });

        // 3. 🛡️ 终极防线：执行智能截断与代码折叠！
        // 这样不管大模型返回了多长，或者兜底的原文本有多长，都会被严格限制在 750 字符以内，且保留了首尾语义。
        let text_to_embed = clean_message_content(&mock_msg, safe_char_limit, safe_char_limit);

        // 4. 请求嵌入向量 (此时 text_to_embed 绝对安全，不会爆 Token)
        let embedding = match get_embedding(&text_to_embed) {
            Ok(emb) if !emb.is_empty() => emb,
            Ok(_) | Err(_) => {
                eprintln!("嵌入失败或返回为空 (id {})", id);
                continue; // 容错处理
            }
        };

        let id_u64 = u64::try_from(id).expect("消息 ID 不能为负数");
        add_message_vector(id_u64, &embedding);
        
        // 存入数据库的是经过截断处理的最终文本，保证所见即所得
        updates.push((id, text_to_embed, Some(embedding)));
    }

    // 批量更新消息的 payload.compressed_text 和 embedding
    if !updates.is_empty() {
        db.update_messages_compressed_and_embedding(&updates)
            .map_err(|e| format!("批量更新消息压缩数据失败: {}", e))?;
    }

    // 更新聊天的 summarizedCount（推进已处理的进度）
    let new_summarized_count = summarizedCount + messages_to_compress.len() as i64;
    let changes = json!({
        "summarizedCount": new_summarized_count,
        "summary": ""
    });
    db.update_chat_list(chatId, changes)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================================
// 后台向量提取
// ============================================================================
#[tauri::command]
pub async fn run_background_memory_facts(
    app_db: State<'_, crate::db::DbManager>,
    chatId: i64,
    vectorizedCount: i64,
    modelConfig: Value,
) -> Result<(), String> {
    let db = app_db.get_db().map_err(|e| e.to_string())?;

    let recent_limit = modelConfig.get("recentLimit")
        .and_then(|v| v.as_i64()).unwrap_or(10);
    let batch_size = modelConfig.get("searchLimit")
        .and_then(|v| v.as_i64()).unwrap_or(20);

    let total_count = db.count_messages_by_chat_id(chatId)
        .map_err(|e| e.to_string())?;
    let no_limit = total_count - vectorizedCount;
    if no_limit < recent_limit {
        return Ok(());
    }

    let messages_to_compress = db
        .query_messages_slice(chatId, vectorizedCount as u32, batch_size as u32)
        .map_err(|e| e.to_string())?;
    if messages_to_compress.is_empty() {
        return Ok(());
    }

    // 清洗消息，准备给 LLM 提取事实
    let mut cleaned_items = Vec::new();
    for mut item in messages_to_compress {
        if let Ok(mut val) = serde_json::from_str::<Value>(&item.payload) {
            if let Some(c) = val.get("content").and_then(|v| v.as_str()) {
                val["content"] = json!(clean_for_llm_summary(c));
                item.payload = val.to_string();
            }
        }
        cleaned_items.push(item);
    }

    let cleaned_messages: Vec<Value> = cleaned_items
        .iter()
        .filter_map(|item| {
            let mut val = serde_json::from_str::<Value>(&item.payload).ok()?;
            val["id"] = json!(item.id);
            val["chat_id"] = json!(item.chat_id);
            val["timestamp"] = json!(item.timestamp);
            Some(val)
        })
        .collect();

    // 1. 提取事实（核心步骤）
    let new_facts = match extract_memory_facts_with_llm(app_db.clone(), cleaned_messages, modelConfig).await {
        Ok(facts) => facts,
        Err(e) => {
            eprintln!("[Memory] 事实提取失败: {}", e);
            vec![]
        }
    };

    // 2. 对每个事实清洗并计算向量，然后批量保存
    if !new_facts.is_empty() {
        let mut facts_to_save = Vec::new();
        let re_markdown = Regex::new(r"[\*\-\#\`]").unwrap();
        let is_emoji = |ch: char| -> bool {
            (ch as u32) >= 0x1F300 && (ch as u32) <= 0x1FAFF
                || (ch as u32) >= 0x2600 && (ch as u32) <= 0x27BF
                || (ch as u32) >= 0xFE00 && (ch as u32) <= 0xFE0F
                || (ch as u32) >= 0x200D && (ch as u32) <= 0x200D
        };

        for fact_text in new_facts {
            let mut pure_text = re_markdown.replace_all(&fact_text, "").to_string();
            pure_text = pure_text.chars().filter(|c| !is_emoji(*c)).collect::<String>();
            pure_text = pure_text.trim().to_string();

            if pure_text.len() < 5 {
                continue;
            }

            match get_embedding(&pure_text) {
                Ok(vector_data) => {
                    let fact_id = cyrb64_hash_to_int(&pure_text, 0) as i64;
                    let payload_json = json!({
                        "textContent": pure_text,
                    })
                    .to_string();
                    let embedding_bytes: Vec<u8> = vector_data
                        .iter()
                        .flat_map(|f| f.to_le_bytes())
                        .collect();

                    let id_u64 = u64::try_from(fact_id).expect("消息 ID 不能为负数");
                    let vec_f32 = bytes_to_f32_slice(&embedding_bytes);
                    let is_duplicate = {
                        let guard = FACT_INDEX.read().unwrap();
                        guard.as_ref()
                            .map(|index| index.has_similar(&vec_f32, 0.93))
                            .unwrap_or(false)
                    };
                    
                    if is_duplicate {
                        continue; // 跳过，不写库
                    }
                    add_fact_vector(id_u64 as u64, &vec_f32);

                    facts_to_save.push(VectorItem {
                        id: fact_id,
                        chat_id: chatId,
                        embedding: Some(embedding_bytes),
                        timestamp: SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as i64,
                        payload: payload_json,
                    });
                    
                }
                Err(e) => {
                    eprintln!("[Memory] 事实向量化失败，跳过: {}", e);
                }
            }
        }

        if !facts_to_save.is_empty() {
            if let Err(e) = db.upsert_vectors_batch(facts_to_save) {
                eprintln!("[Memory] 事实批量落库失败: {}", e);
            }
        }
    }

    // 3. 更新游标
    let changes = json!({
        "vectorizedCount": vectorizedCount + cleaned_items.len() as i64
    });
    if let Err(e) = db.update_chat_list(chatId, changes) {
        eprintln!("[Memory] 更新游标失败: {}", e);
    }

    Ok(())
}
  
// ============================================================================
// 纪元压缩
// ============================================================================
#[tauri::command]
pub async fn run_epoch_memory_compression(
    app_db: State<'_, crate::db::DbManager>,
    chatId: i64,
    epochStartIndex: i64,
    modelConfig: Value,
) -> Result<(), String> {
    
    // --- 1. 同步数据库查询区（快速释放连接） ---
    let (original_msg_count, new_messages, old_epoch_summary) = {
        let db = app_db.get_db().map_err(|e| e.to_string())?;

        let cache_message_limit = modelConfig.get("cacheMessageLimit")
            .and_then(|v| v.as_i64()).unwrap_or(100);
        let cache_token_limit = modelConfig.get("cacheTokenLimit")
            .and_then(|v| v.as_i64()).unwrap_or(50000);

        let total_count = db.count_messages_by_chat_id(chatId)
            .map_err(|e| e.to_string())?;
        let uncompressed_count = 0.max(total_count - epochStartIndex);

        if uncompressed_count == 0 {
            return Ok(());
        }

        let new_messages = db
            .query_chat_messages(chatId, epochStartIndex, uncompressed_count as u32)
            .map_err(|e| e.to_string())?;
            
        if new_messages.is_empty() {
            return Ok(());
        }

        let original_msg_count = new_messages.len();

        // 估算 token（使用 chars().count() 而非 len()）
        let mut total_chars = 0usize;
        for m in &new_messages {
            if let Ok(val) = serde_json::from_str::<Value>(&m.payload) {
                if let Some(content) = val.get("content").and_then(|v| v.as_str()) {
                    total_chars += content.chars().count(); 
                }
            }
        }
        
        let current_tokens = total_chars as i64;
        let is_turn_limit_reached = uncompressed_count >= cache_message_limit;
        let is_token_limit_reached = current_tokens >= cache_token_limit;
        
        if !is_turn_limit_reached && !is_token_limit_reached {
            return Ok(());
        }

        println!(
            "🔥 [Epoch Compress] 触发纪元大压缩！原因: 轮数超限[{}], 字数超限[{}]",
            is_turn_limit_reached, is_token_limit_reached
        );

        let old_summary = db.query_chat_list_by_id(chatId)
            .map_err(|e| e.to_string())?
            .and_then(|info| info.payload)
            .and_then(|payload_str| serde_json::from_str::<Value>(&payload_str).ok())
            .and_then(|val| {
                val.get("epochSummary")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_default();

        (original_msg_count, new_messages, old_summary)
    }; 
    // db Guard 释放完毕

    // --- 2. 内存数据清洗区 ---
    let cleaned_messages_for_summary: Vec<Value> = new_messages
        .into_iter()
        .filter_map(|m| {
            let mut val = serde_json::from_str::<Value>(&m.payload).ok()?;
            if let Some(content) = val.get("content").and_then(|v| v.as_str()) {
                val["content"] = json!(clean_for_llm_summary(content));
            }
            val["id"] = json!(m.id);
            val["chat_id"] = json!(m.chat_id);
            Some(val)
        })
        .collect();

    // --- 3. 大模型请求区（仅当有有效消息时执行） ---
    let mut new_epoch_summary = None;

    if !cleaned_messages_for_summary.is_empty() {
        match run_epoch_memory_chat_epoch_summary(
            app_db.clone(),
            cleaned_messages_for_summary,
            old_epoch_summary.clone(),
            modelConfig,
        ).await {
            Ok(s) => new_epoch_summary = Some(s),
            Err(e) => eprintln!("纪元大压缩执行失败，将仅推进游标: {}", e),
        }
    }

    // --- 4. 统一数据库更新区 ---
    let db = app_db.get_db().map_err(|e| e.to_string())?;
    let next_start_index = epochStartIndex + original_msg_count as i64;
    let mut changes = json!({ "epochStartIndex": next_start_index });

    if let Some(summary) = new_epoch_summary {
        if !summary.is_empty() && summary != old_epoch_summary {
            changes["epochSummary"] = json!(summary);
        }
    }

    if let Err(e) = db.update_chat_list(chatId, changes) {
        eprintln!("[Epoch] 最终更新数据库失败: {}", e);
    }

    Ok(())
}