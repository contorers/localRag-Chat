use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use regex::{Regex, Captures};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use reqwest::header::AUTHORIZATION;
use std::sync::LazyLock;

// ============================================================
// Prompt 常量
// ============================================================
const PROMPT_GLOBAL_SUMMARY: &str = r#"You are a dialogue compressor for semantic search.
Process each message independently.
Keep only messages that contain useful searchable information (goals, decisions, bugs, fixes, APIs, libraries, technical explanations, constraints, instructions, project names, error messages).
Discard greetings, thanks, emojis, acknowledgements and small talk.
For each kept message:
- Rewrite as one concise, self-contained sentence.
- Preserve the original language and technical keywords.
- Keep the meaning unchanged.
- Do not merge messages or infer context.
- Keep it as short as possible.
- Never exceed 500 characters.
Return ONLY:
[
  {
    "id":123,
    "compressed_text":"..."
  }
]

Return [] if nothing is kept."#;

const PROMPT_EPOCH_SUMMARY: &str = r#"You are a long-term context consolidation engine.

Task:
Replace [Past Memory] and [Recent Dialogue] with a compact memory that preserves all information necessary to continue the conversation naturally.

Rules:
- Recent dialogue overrides past memory on conflicts.
- Preserve user identity, preferences, ongoing tasks, decisions, conclusions, constraints, and important context.
- Remove repetition, pleasantries, AI self-descriptions, and obsolete or temporary details.
- Compress by rewriting, not by discarding useful information.
- Preserve all information that could affect future responses.
- Output a concise paragraph in Chinese without headings or bullet points."#;

const PROMPT_FACT_EXTRACTION: &str = r#"Task:
Extract ONLY observable user facts and user intents.
---
Valid outputs:
[F] USER_FACT
Explicit user statements or stable attributes:
- "I am a backend developer"
- "I use Node.js"
[I] USER_INTENT
What the user is trying to do (inferred from what they asked or did):
- "User is evaluating their ability to build web projects"
- "User is trying to optimize RAG accuracy"
---
STRICT RULES:
1. Do NOT infer skill level
2. Do NOT evaluate ability
3. Do NOT assign labels like beginner/intermediate/advanced
4. Only describe observable behavior or explicit intent
5. No summaries, no reasoning
6. If the same thing can be expressed as [F] or [I], prefer [F]
---
Output JSON:
{
  "facts": ["[F] ...", "[I] ..."]
}"#;

// ============================================================
// 核心：安全的字符串截断工具
// ============================================================
const PUNCTUATIONS: [&str; 7] = ["\n", "。", "！", "？", ". ", "! ", "? "];

pub fn get_safe_head(text: &str, target_len: i64) -> String {
    let target_len = target_len as usize;
    let char_count = text.chars().count();
    if char_count <= target_len {
        return text.to_string();
    }

    let candidate: String = text.chars().take(target_len).collect();

    let mut best_char_idx: i64 = -1;

    for &p in PUNCTUATIONS.iter() {
        if let Some(byte_idx) = candidate.rfind(p) {
            let char_idx = candidate[..byte_idx].chars().count();
            let p_len = p.chars().count();
            let end_idx = (char_idx + p_len) as i64;
            if end_idx > best_char_idx {
                best_char_idx = end_idx;
            }
        }
    }

    let max_drop = std::cmp::min(150, (target_len as i64) / 2);

    if best_char_idx != -1 && (target_len as i64) - best_char_idx <= max_drop {
        return candidate.chars().take(best_char_idx as usize).collect();
    }

    if let Some(byte_idx) = candidate.rfind(' ') {
        let space_char_idx = candidate[..byte_idx].chars().count();
        if (target_len as i64) - (space_char_idx as i64) <= 50 {
            return candidate.chars().take(space_char_idx).collect();
        }
    }

    candidate
}

pub fn get_safe_tail(text: &str, target_len: i64) -> String {
    let char_count = text.chars().count();
    let target_len_usize = target_len as usize;

    if char_count <= target_len_usize {
        return text.to_string();
    }

    let skip_count = char_count - target_len_usize;
    let candidate: String = text.chars().skip(skip_count).collect();

    let cand_len = candidate.chars().count();
    let mut best_idx = cand_len;

    for &p in PUNCTUATIONS.iter() {
        if let Some(byte_idx) = candidate.find(p) {
            let char_idx = candidate[..byte_idx].chars().count();
            let end_idx = char_idx + p.chars().count();
            if end_idx < best_idx {
                best_idx = end_idx;
            }
        }
    }

    let max_drop = std::cmp::min(150_i64, target_len / 2);

    if best_idx != cand_len && (best_idx as i64) <= max_drop {
        return candidate.chars().skip(best_idx).collect();
    }

    if let Some(byte_idx) = candidate.find(' ') {
        let space_char_idx = candidate[..byte_idx].chars().count();
        if space_char_idx <= 50 {
            return candidate.chars().skip(space_char_idx + 1).collect();
        }
    }

    candidate
}

// ============================================================
// 修改为接受 &Value，而非 &Message
// ============================================================
// 正则只编译一次，全局复用，避免每次调用函数都重新编译
static CODE_BLOCK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)```(\w*)\n(.*?)```").unwrap()
});
 
pub fn clean_message_content(msg: &Value, max_user_len: i64, max_ai_len: i64) -> String {
    let mut content = msg
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
 
    // 折叠超长代码块
    content = CODE_BLOCK_RE
        .replace_all(&content, |caps: &regex::Captures| {
            let lang = caps.get(1).map_or("", |m| m.as_str());
            let code_content = caps.get(2).map_or("", |m| m.as_str());
            let lines: Vec<&str> = code_content.split('\n').collect();
            if lines.len() > 25 {
                let head = lines[..10].join("\n");
                let tail = lines[lines.len() - 5..].join("\n");
                let omitted = lines.len() - 15;
                format!(
                    "```{}\n{}\n\n... [Code Folded: {} lines omitted] ...\n\n{}\n```",
                    lang, head, omitted, tail
                )
            } else {
                caps.get(0).unwrap().as_str().to_string()
            }
        })
        .to_string();
 
    let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
 
    // 根据角色决定截断参数；其他角色（system/tool等）直接跳过截断逻辑
    let (max_len, head_ratio, label) = match role {
        "assistant" => (max_ai_len as usize, 0.9, "AI Text Truncated"),
        "user" => (max_user_len as usize, 0.75, "User Text Truncated"),
        _ => return content,
    };
 
    // 字节长度 >= 字符长度，字节数都没超就不用做昂贵的 chars().count()
    if content.len() < max_len {
        return content;
    }
 
    let char_count = content.chars().count();
    if char_count > max_len {
        let head_len = (max_len as f64 * head_ratio) as usize;
        let tail_ratio = 1.0 - head_ratio;
        let tail_len = (max_len as f64 * tail_ratio) as usize;
        content = format!(
            "{}\n\n...[{}]...\n\n{}",
            get_safe_head(&content, head_len as i64),
            label,
            get_safe_tail(&content, tail_len as i64)
        );
    }
 
    content
}

pub fn build_history_text_with_window(
    msgs: Vec<Value>,
    max_user_len: i64,
    max_ai_len: i64,
    max_total_len: i64,
) -> String {
    let mut selected: Vec<String> = Vec::new();
    let mut total_len: i64 = 0;

    for m in msgs.iter().rev() {
        let cleaned = clean_message_content(m, max_user_len, max_ai_len);

        let id = m
            .get("id")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let role = m
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let role_label = match role {
            "user" => "USER",
            "assistant" => "AI",
            _ => role,
        };

        let line = format!(
            "[ID: {}] [{}]: {}",
            id,
            role_label,
            cleaned
        );

        let line_len = line.chars().count() as i64;

        if total_len + line_len + 1 > max_total_len {
            if selected.is_empty() {
                // 为前缀和后缀预留长度
                let prefix = format!("[ID: {}] [{}]: ", id, role_label);
                let suffix = "...[Truncated]";
                let reserved =
                    prefix.chars().count() + suffix.chars().count();

                let available = max_total_len
                    .saturating_sub(reserved as i64)
                    .max(0) as usize;

                let truncated_cleaned: String = cleaned
                    .chars()
                    .take(available)
                    .collect();

                selected.insert(
                    0,
                    format!(
                        "{}{}{}",
                        prefix,
                        truncated_cleaned,
                        suffix
                    ),
                );
            }

            break;
        }

        selected.insert(0, line);
        total_len += line_len + 1;
    }

    let dropped = msgs.len().saturating_sub(selected.len());

    let prefix = if dropped > 0 {
        format!("...[Earlier {} messages omitted]...\n", dropped)
    } else {
        String::new()
    };

    format!("{}{}", prefix, selected.join("\n"))
}

pub fn truncate_bullet_summary(summary: &str, max_len: i64) -> String {
    let max_len = max_len as usize;

    let char_count = summary.chars().count();
    if char_count <= max_len {
        return summary.to_string();
    }

    let lines: Vec<&str> = summary
        .split('\n')
        .filter(|l| !l.trim().is_empty())
        .collect();

    let mut kept: Vec<String> = Vec::new();
    let mut total: usize = 0;

    for line in &lines {
        let line_len = line.chars().count() + 1;
        if total + line_len > max_len {
            break;
        }
        kept.push(line.to_string());
        total += line_len;
    }

    if kept.is_empty() && !lines.is_empty() {
        let truncated_first_line: String = lines[0].chars().take(max_len).collect();
        return format!("{}...", truncated_first_line);
    }

    kept.join("\n")
}

fn clean_summary_output(raw: &str, enforce_bullet: bool) -> String {
    let re = Regex::new(r"(?im)^(最新|最终|更新后)?(摘要|总结|Summary|Index|事实)[：:]\s*").unwrap();
    let mut result = re.replace_all(raw.trim(), "").trim().to_string();

    if !enforce_bullet {
        return result;
    }

    result = result
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| {
            if line.starts_with("-") {
                line.to_string()
            } else {
                format!("- {}", line)
            }
        })
        .collect::<Vec<String>>()
        .join("\n");

    result
}

// ============================================================
// 核心 LLM 请求客户端
// ============================================================
pub async fn request_and_clean_llm(
    app_db: State<'_, crate::db::DbManager>, // Tauri 必需的数据库状态注入
    model: Value,                            // 对应 JS: model
    messages: Vec<Value>,                    // 对应 JS: messages
    config_obj: Value,                       // 对应 JS: configObj
) -> Result<String, String> {
    let client = Client::new();

    // 1:1 还原 JS 默认值逻辑
    let actual_max_tokens = config_obj.get("maxTokens").and_then(|v| v.as_i64()).unwrap_or(512);
    let actual_temp = config_obj.get("temperature").and_then(|v| v.as_f64()).unwrap_or(0.1);
    let response_format = config_obj.get("responseFormat").and_then(|v| v.as_str()).unwrap_or("text");

    // 1:1 还原 JS model 字段提取
    let compress_api_key = model.get("compressApiKey").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let model_name = model.get("name").and_then(|v| v.as_str()).unwrap_or("gpt-3.5-turbo");
    let url = model.get("baseUrl").and_then(|v| v.as_str()).ok_or("缺少 LLM URL 配置".to_string())?;
    let include_usage = model.get("includeUsage").and_then(|v| v.as_bool());

    let request_body = json!({
        "model": model_name,
        "messages": messages,
        "stream": false,
        "temperature": actual_temp,
        "max_tokens": actual_max_tokens,
        "response_format": if compress_api_key.is_some() {
            json!({ "type": response_format })
        } else {
            json!(response_format)
        },
        "stream_options": if let Some(val) = include_usage {
            json!({ "include_usage": val })
        } else {
            json!(null)
        },
    });

    let mut request = client
    .post(url.trim_end_matches('/'))
    .json(&request_body);

    if let Some(key) = compress_api_key {
        request = request.header(AUTHORIZATION, format!("Bearer {}", key));
    }

    let resp = request.send().await.map_err(|e| format!("请求失败: {}", e))?;

    let raw_data: Value = resp.json().await.map_err(|e| format!("JSON解析失败: {}", e))?;

    // 1:1 还原 JS: await AIChatService.incrementToken(rawData, model);
    if let Err(e) = increment_token(app_db, &raw_data, &model).await {
        eprintln!("[Token] 记录失败: {}", e);
    }

    // 1:1 还原: console.log("[LLM Raw Response]:", rawData);
    println!("[LLM Raw Response]: {}", raw_data);

    let mut llm_response = raw_data.clone();

    // 1:1 还原 JS: if ((rawData.code === 200 || rawData.code === "200") && rawData.data)
    let code_ok = raw_data.get("code").map_or(false, |c| {
        c.as_i64() == Some(200) || c.as_str() == Some("200")
    });

    if code_ok {
        if let Some(data) = raw_data.get("data") {
            llm_response = data.clone();

            // 1:1 还原 JS: if (typeof llmResponse === "string")
            if let Some(data_str) = llm_response.as_str() {
                let trimmed = data_str.trim();
                if trimmed.starts_with('{') || trimmed.starts_with('[') {
                    match serde_json::from_str::<Value>(trimmed) {
                        Ok(parsed) => llm_response = parsed,
                        Err(_) => eprintln!("[LLM Service] JSON 解析跳过，视为原始字符串"),
                    }
                }
            }
        }
    }

    // 1:1 还原 content 提取
    let content = llm_response.pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .or_else(|| raw_data.pointer("/data/choices/0/message/content").and_then(|v| v.as_str()));

    let content_str = match content {
        Some(c) => c,
        None => {
            // 1:1 还原 JS: console.error + throw new Error
            eprintln!("[LLM Service] 异常数据结构: {}", raw_data);
            return Err("[LLM Service] 接口未返回有效 content".to_string());
        }
    };

    let re = Regex::new(r"(?is)<think>.*?</think>").unwrap();
    let cleaned = re.replace_all(content_str, "");

    Ok(cleaned.trim().to_string())
}

pub async fn increment_token(
    app_db: State<'_, crate::db::DbManager>,
    raw_data: &Value,
    config: &Value,
) -> Result<(), String> {
    let db = app_db.get_db().map_err(|e| e.to_string())?;

    let mut final_data = raw_data.clone();
    if let Some(data_val) = raw_data.get("data") {
        if let Some(data_str) = data_val.as_str() {
            match serde_json::from_str::<Value>(data_str) {
                Ok(parsed) => final_data = parsed,
                Err(e) => {
                    eprintln!("[Token] 解析 rawData.data 失败: {}", e);
                    return Ok(());
                }
            }
        } else if data_val.is_object() {
            final_data = data_val.clone();
        }
    }

    let usage = match final_data.get("usage") {
        Some(u) => u,
        None => {
            eprintln!("[Token] 跳过日志记录：usage 缺失");
            return Ok(());
        }
    };

    let prompt_tokens = usage.get("prompt_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
    let completion_tokens = usage.get("completion_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
    let total_tokens = usage.get("total_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
    if total_tokens <= 0 {
        return Ok(());
    }

    let content = final_data.pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let snippet: String = content.chars().take(15).collect();
    let brief = if snippet.is_empty() { "上下文压缩/重写".to_string() } else { snippet };

    let model_name = config.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let payload = json!({
        "tokensInput": prompt_tokens,
        "tokensOutput": completion_tokens,
        "tokensTotal": total_tokens,
        "brief": brief,
        "comment": "历史记忆压缩以及重写"
    });

    db.add_token_log("paidToken", &model_name, timestamp, payload)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================
// ✅ 核心三大接口业务逻辑 (纯 Rust)
// ============================================================
#[tauri::command]
pub async fn run_rolling_chat_summary(
    app_db: State<'_, crate::db::DbManager>,
    msgs: Vec<Value>,
    mut model: Value,             
) -> Result<String, String> {
    if msgs.is_empty() {
        return Ok(String::new());  
    }

    let threshold = model.get("compressThreshold")
        .and_then(|v| v.as_i64())
        .unwrap_or(2000) as usize;

    let max_user_len = (threshold as f64 * 0.10) as i64;
    let max_ai_len = (threshold as f64 * 0.10) as i64;
    let max_history_len = (threshold as f64 * 0.75) as i64;
    let max_summary_len = (threshold as f64 * 0.10) as i64;

    let history_text = build_history_text_with_window(
        msgs.clone(),
        max_user_len,
        max_ai_len,
        max_history_len,
    );

    let system_prompt = model.get("promptGlobalSummary")
        .and_then(|v| v.as_str())
        .unwrap_or(PROMPT_GLOBAL_SUMMARY);

    let user_prompt = history_text;

    let max_summary_tokens = model.get("maxSummaryTokens")
        .and_then(|v| v.as_i64())
        .unwrap_or(512);

    let messages = vec![
        json!({"role": "system", "content": system_prompt}),
        json!({"role": "user", "content": user_prompt}),
    ];

    println!("system_prompt: {}", system_prompt);
    println!("user_prompt: {}", user_prompt);

    let config = json!({
        "temperature": 0.1,
        "maxTokens": max_summary_tokens,
        "responseFormat": "text"
    });

    let raw_result = match request_and_clean_llm(app_db, model, messages, config).await {
        Ok(res) => res,
        Err(e) => {
            eprintln!("[Memory] 滚动摘要 API 请求失败: {}", e);
            return Ok(String::new());   // 原来返回 old_summary
        }
    };
    println!("[Memory] raw_result: {}", raw_result);
    let mut final_summary = clean_summary_output(&raw_result, true);

    let lower = final_summary.to_lowercase();
    let invalid_keywords = ["null", "undefined", "[]"];
    let cleaned_length = final_summary
        .replace(&['-', '[', ']', ' ', '\n'][..], "")
        .chars()
        .count();

    if cleaned_length < 3 || invalid_keywords.iter().any(|k| lower.contains(k)) {
        return Ok(String::new());   // 原来返回 old_summary
    }

    if final_summary.chars().count() > max_summary_len as usize {
        final_summary = truncate_bullet_summary(&final_summary, max_summary_len as i64);
    }

    Ok(final_summary)
}

#[tauri::command]
pub async fn run_epoch_memory_chat_epoch_summary(
    app_db: State<'_, crate::db::DbManager>,
    msgs: Vec<Value>,
    old_summary: String,
    model: Value, // 移除了多余的 mut
) -> Result<String, String> {
    if msgs.is_empty() {
        return Ok(old_summary);
    }

    let max_token = model.get("cacheTokenLimit").and_then(|v| v.as_i64()).unwrap_or(4000);
    let msg_count = msgs.len().max(1) as f64;
    let avg_chars = (max_token as f64 * 0.8 * 1.5 / msg_count) as i64;
    
    let dynamic_user_len = (avg_chars as f64 * 0.8) as i64;
    let dynamic_ai_len   = (avg_chars as f64 * 1.2) as i64;
    let max_output_len   = (max_token as f64 * 0.15) as i64; // 修正了拼写

    let clean_history_text = msgs.iter().map(|m| {
        let cleaned = clean_message_content(m, dynamic_user_len, dynamic_ai_len);
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let role_label = if role.to_lowercase() == "user" { "USER" } else { "AI" };
        format!("[{}]: {}", role_label, cleaned.trim())
    }).collect::<Vec<String>>().join("\n\n");

    let system_prompt = model.get("promptEpochSummary")
        .and_then(|v| v.as_str())
        .unwrap_or(PROMPT_EPOCH_SUMMARY)
        .to_string();

    let user_prompt = format!(
        "[Past Memory]:\n{}\n\n[Recent Dialogue]:\n{}\n\n[Output]:",
        if old_summary.is_empty() { "None" } else { &old_summary },
        clean_history_text
    );

    let messages = vec![
        json!({"role": "system", "content": system_prompt}),
        json!({"role": "user", "content": user_prompt}),
    ];

    println!("system_prompt: {}", system_prompt);
    println!("user_prompt: {}", user_prompt);

    let config = json!({
        "temperature": 0.1,
        "maxTokens": max_output_len, // 修正为下划线，以符合常见大模型 API 标准
        "responseFormat": "text"     // 同理，如果底层要下划线，这个最好也改
    });

    let raw = match request_and_clean_llm(app_db, model, messages, config).await {
        Ok(res) => res,
        Err(e) => {
            // 加上错误日志，防止变成“瞎子”
            println!("Epoch summary LLM request failed: {:?}", e);
            return Ok(old_summary);
        }
    };

    let new_summary = clean_summary_output(&raw, false);
    if new_summary.chars().count() < 10 {
        return Ok(old_summary);
    }

    Ok(new_summary)
}

#[tauri::command]
pub async fn extract_memory_facts_with_llm(
    app_db: State<'_, crate::db::DbManager>,
    msgs: Vec<Value>,
    mut model: Value,
) -> Result<Vec<String>, String> {
    if msgs.is_empty() {
        return Ok(vec![]);
    }

    let max_token = model.get("compressThreshold").and_then(|v| v.as_i64()).unwrap_or(4000) as f64;
    let msg_count = msgs.len().max(1) as f64;
    let avg_chars = (max_token * 0.8 * 1.5 / msg_count) as i64;
    let dynamic_user_len = (avg_chars as f64 * 1.8) as i64;
    let dynamic_ai_len = (150_i64).max((avg_chars as f64 * 0.2) as i64);

    let history_text = msgs.iter().map(|m| {
        let cleaned = clean_message_content(m, dynamic_user_len, dynamic_ai_len);
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let role_label = if role.to_lowercase() == "user" { "USER" } else { "AI" };
        format!("---[{}]---\n{}", role_label, cleaned.trim())
    }).collect::<Vec<String>>().join("\n\n");

    let actual_input_len = history_text.chars().count();

    let configured_max_output = model.get("compressThreshold").and_then(|v| v.as_i64())
        .or_else(|| model.get("maxExtractionTokens").and_then(|v| v.as_i64()))
        .unwrap_or_else(|| (max_token * 0.05).ceil() as i64);

    let dynamic_tokens = (actual_input_len as f64 * 0.1).ceil() as i64;
    let final_max_tokens = std::cmp::max(500, std::cmp::min(dynamic_tokens, configured_max_output));

    let system_prompt = model.get("promptFactExtraction")
        .and_then(|v| v.as_str())
        .unwrap_or(PROMPT_FACT_EXTRACTION)
        .to_string();

    let user_prompt = format!("[Dialogue]:\n{}\n\n[Output JSON]:", history_text);

    let messages = vec![
        json!({"role": "system", "content": system_prompt}),
        json!({"role": "user", "content": user_prompt}),
    ];

    println!("system_prompt: {}", system_prompt);
    println!("user_prompt: {}", user_prompt);

    let config = json!({
        "temperature": 0.1,
        "maxTokens": final_max_tokens,      // 注意下划线命名
        "responseFormat": "json_object"
    });
    let raw_result = match request_and_clean_llm(app_db, model, messages,config).await {
        Ok(res) => res,
        Err(e) => {
            eprintln!("[Fact Extraction] 请求失败: {}", e);
            return Ok(vec![]);
        }
    };

    let clean_json = raw_result.replace("```json", "").replace("```", "").trim().to_string();
    let parsed: Value = match serde_json::from_str(&clean_json) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[Fact Extraction] JSON 解析失败: {}", e);
            return Ok(vec![]);
        }
    };

    let raw_facts = parsed.get("facts")
        .or_else(|| parsed.get("fats"))
        .or_else(|| parsed.get("fact"))
        .or_else(|| parsed.get("items"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut result_facts = Vec::new();
    for fact_val in raw_facts {
        if let Some(text) = fact_val.as_str() {
            let trimmed = text.trim();
            if trimmed.chars().count() >= 2 {
                result_facts.push(trimmed.to_string());
            }
        }
    }

    Ok(result_facts)
}