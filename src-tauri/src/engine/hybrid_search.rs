use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;
use serde_json::{json, Value};

// 🌟 使用 Enum 代替 JS 的 String，绝对的类型安全！
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum QueryIntent {
    Keyword,
    Semantic,
    Balanced,
}

impl Default for QueryIntent {
    fn default() -> Self {
        Self::Balanced
    }
}

/// 分析查询意图，决定 RRF 融合时的权重倾向
pub fn analyze_query_intent(query: &str) -> QueryIntent {
    // 🌟 使用 OnceLock 确保正则只在应用启动时编译一次，极致性能
    static CODE_REGEX: OnceLock<Regex> = OnceLock::new();
    let code_re = CODE_REGEX.get_or_init(|| {
        // (?i) 表示忽略大小写
        Regex::new(r"(?i)[{}\[\]()]|=>|===|\.[a-zA-Z]|error|exception").unwrap()
    });

    static REF_REGEX: OnceLock<Regex> = OnceLock::new();
    let ref_re = REF_REGEX.get_or_init(|| {
        Regex::new(r"(相比|区别|不同|之前|那个|旧的|原来)").unwrap()
    });

    // 1. 强代码/报错特征
    if code_re.is_match(query) {
        return QueryIntent::Keyword;
    }

    // 2. 指代/对比特征
    if ref_re.is_match(query) {
        return QueryIntent::Balanced;
    }

    // 3. 长句特征：使用 chars().count() 正确计算中文字符长度，避免按字节串计算出错
    if query.chars().count() > 30 {
        return QueryIntent::Semantic;
    }

    QueryIntent::Balanced
}

/// 纯净版 RRF 混合重排算法
/// 现在所有文档均以 `Value` 表示，约定每个文档对象至少包含：
/// - "id": String
/// - "similarity": f64        (可选)
/// - "text_content": String   (可选)
/// - "score": f64             (由本函数写入)
pub fn reciprocal_rank_fusion(
    keyword_results: Vec<Value>,
    semantic_results: Vec<Value>,
    intent: QueryIntent,
    k: f32, // 建议默认传 30.0
) -> Vec<Value> {
    
    // 1. 动态权重分配 (Rust 的 match 语法极其清爽)
    let (keyword_weight, semantic_weight) = match intent {
        QueryIntent::Keyword => (1.6, 0.4),
        QueryIntent::Semantic => (0.4, 1.6),
        QueryIntent::Balanced => (1.0, 1.0),
    };

    // 存储最终分数的 HashMap。Key 是文档 ID，Value 是 (文档对象, RRF分数)
    let mut combined_scores: HashMap<String, (Value, f32)> = HashMap::new();

    // 2. 处理关键词排名
    for (index, doc) in keyword_results.into_iter().enumerate() {
        let id = doc.get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        if id.is_empty() {
            continue; // 忽略没有 id 的文档
        }
        let rank = (index + 1) as f32;
        let rrf_score = (1.0 / (k + rank)) * keyword_weight;
        combined_scores.insert(id, (doc, rrf_score));
    }

    // 3. 处理语义排名
    for (index, doc) in semantic_results.into_iter().enumerate() {
        let id = doc.get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let rank = (index + 1) as f32;
        let rrf_score = (1.0 / (k + rank)) * semantic_weight;

        // 使用 entry API 合并分数
        combined_scores
            .entry(id)
            .and_modify(|(_, score)| *score += rrf_score)
            .or_insert((doc, rrf_score));
    }

    // 4. 将分数写入每个文档的 "score" 字段，并收集为 Vec<Value>
    let mut final_results: Vec<Value> = combined_scores
        .into_values()
        .map(|(mut doc, total_score)| {
            doc["score"] = json!(total_score);
            doc
        })
        .collect();

    // 5. 根据 "score" 字段降序排序
    final_results.sort_by(|a, b| {
        let score_a = a.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let score_b = b.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
        // 降序：b 与 a 比较
        score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
    });

    final_results
}