use regex::Regex;
use std::sync::OnceLock;

// ==========================================
// 1. 路由器规则正则字典 (全局单例编译，极致性能)
// ==========================================
static CONTEXT_DEPENDENT_REGEX: OnceLock<Regex> = OnceLock::new();
static SOCIAL_FILLERS_REGEX: OnceLock<Regex> = OnceLock::new();
static TECH_ENTITIES_REGEX: OnceLock<Regex> = OnceLock::new();
static QUERY_KEYWORDS_REGEX: OnceLock<Regex> = OnceLock::new();
static MEANINGLESS_SHORT_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_context_re() -> &'static Regex {
    // (?i) 忽略大小写
    CONTEXT_DEPENDENT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)(这|那|它|他|她|此|该|前者|后者|之前|刚才|上文|上面|下面|为什么|怎么|咋|何|啥|报错|异常|失败|不行|不对|缺点|继续|然后|另外|还有|其次|如果|why|how|what)").unwrap()
    })
}

fn get_social_re() -> &'static Regex {
    SOCIAL_FILLERS_REGEX.get_or_init(|| {
        Regex::new(r"(?i)^(你好|您好|hi|hello|在吗|谢谢|好的|收到|ok|懂了|明白了|拜拜|再见|哈|嗯|哦|噢)$").unwrap()
    })
}

fn get_tech_re() -> &'static Regex {
    TECH_ENTITIES_REGEX.get_or_init(|| {
        Regex::new(r"(?i)(vue|pinia|netty|kafka|redis|sql|java|spring|context|token|id)").unwrap()
    })
}

fn get_query_re() -> &'static Regex {
    QUERY_KEYWORDS_REGEX.get_or_init(|| {
        Regex::new(r"(?i)(为什么|怎么|啥|如何|咋|why|how|继续|然后|对吗)").unwrap()
    })
}

fn get_meaningless_re() -> &'static Regex {
    MEANINGLESS_SHORT_REGEX.get_or_init(|| {
        Regex::new(r"(?i)^(好的|继续|是吗|怎么说|这就是|what|why|ok|yes|不行|不对)$").unwrap()
    })
}

// ==========================================
// 🌟 判断用户输入是否需要去大模型重写
// ==========================================
#[tauri::command]
pub fn needs_rewriting(text: String) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return false;
    }

    // 1. 绝对安全的放行：纯代码块
    if t.starts_with("```") {
        return false;
    }

    // 2. 社交/闲聊拦截
    if get_social_re().is_match(t) {
        return false;
    }

    // 3. 代词校验 (最高优)
    if get_context_re().is_match(t) {
        return true;
    }

    // 4. 实体词绕过
    if get_tech_re().is_match(t) {
        return false;
    }

    // 🌟 核心优化：无需用正则替换，直接利用 Rust 原生的 chars() 过滤出字母、数字、汉字
    // is_alphanumeric() 天然支持 Unicode（即包含汉字、英文字母、数字）
    let pure_text_len = t.chars().filter(|c| c.is_alphanumeric()).count();

    // 5. 极短文本过滤
    if pure_text_len <= 4 {
        return get_query_re().is_match(t);
    }

    // 6. 长度放行
    if pure_text_len > 20 {
        return false;
    }

    // 7. 终极兜底（修复“黑洞”）
    true
}

// ==========================================
// 🌟 判断当前文本是否具有检索价值
// ==========================================
#[tauri::command]
pub fn should_trigger_rag(final_query: String) -> bool {
    let t = final_query.trim();
    if t.is_empty() {
        return false;
    }

    if get_social_re().is_match(t) {
        return false;
    }

    if get_meaningless_re().is_match(t) {
        return false;
    }

    // 极短文本且没有技术名词的，拦截
    let char_count = t.chars().count();
    if char_count <= 3 && !get_tech_re().is_match(t) {
        return false;
    }

    true
}

// ==========================================
// 🛡️ 隐私信息脱敏模块 (PII Sanitization)
// ==========================================
struct PrivacyRule {
    pattern: Regex,
    replacement: &'static str,
}

static PRIVACY_RULES: OnceLock<Vec<PrivacyRule>> = OnceLock::new();

fn get_privacy_rules() -> &'static Vec<PrivacyRule> {
    PRIVACY_RULES.get_or_init(|| {
        vec![
            // 1. 邮箱地址
            PrivacyRule {
                pattern: Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap(),
                replacement: "[EMAIL_REDACTED]",
            },
            // 2. 手机号 (使用 \b 单词边界替代零宽断言)
            PrivacyRule {
                pattern: Regex::new(r"\b(?:\+?86\s?)?1[3-9]\d{9}\b").unwrap(),
                replacement: "[PHONE_REDACTED]",
            },
            // 3. 座机号码
            PrivacyRule {
                pattern: Regex::new(r"\b0\d{2,3}[-\s]?\d{7,8}\b").unwrap(),
                replacement: "[LANDLINE_REDACTED]",
            },
            // 4. 身份证号
            PrivacyRule {
                pattern: Regex::new(r"\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|10|11|12)(?:0[1-9]|[1-2]\d|30|31)\d{3}[\dXx]\b").unwrap(),
                replacement: "[ID_CARD_REDACTED]",
            },
            // 5. 统一社会信用代码
            PrivacyRule {
                pattern: Regex::new(r"\b[1-9A-GY][1239][1-5][0-9]{5}[0-9A-Z]{10}\b").unwrap(),
                replacement: "[USCI_REDACTED]",
            },
            // 6. MAC 地址
            PrivacyRule {
                pattern: Regex::new(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b").unwrap(),
                replacement: "[MAC_ADDRESS_REDACTED]",
            },
            // 7. 银行卡号/信用卡号
            PrivacyRule {
                pattern: Regex::new(r"\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|62\d{14,17}|3[47]\d{13}|[1-9]\d{15,18})\b").unwrap(),
                replacement: "[BANK_CARD_REDACTED]",
            },
            // 8. JWT Token
            PrivacyRule {
                pattern: Regex::new(r"\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b").unwrap(),
                replacement: "[JWT_TOKEN_REDACTED]",
            },
            // 9. API 密钥
            PrivacyRule {
                pattern: Regex::new(r"\b(sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})\b").unwrap(),
                replacement: "[API_KEY_REDACTED]",
            },
            // 10. GitHub Token
            PrivacyRule {
                pattern: Regex::new(r"\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}\b").unwrap(),
                replacement: "[GITHUB_TOKEN_REDACTED]",
            },
            // 11. Slack Token
            PrivacyRule {
                pattern: Regex::new(r"\bxox[baprs]-[0-9]{10,13}-[a-zA-Z0-9]{24,34}\b").unwrap(),
                replacement: "[SLACK_TOKEN_REDACTED]",
            },
            // 12. URL Auth 密码
            // 🌟 核心技巧：利用捕获组 () 替换掉原来不支持的 (?<=...) 零宽断言
            // ${1} 代表匹配到的协议部分，${3} 代表 @ 符号。中间的密码部分被替换。
            PrivacyRule {
                pattern: Regex::new(r"([a-zA-Z0-9+.-]+://)([^:\s]+:[^@\s]+)(@)").unwrap(),
                replacement: "${1}[URL_AUTH_REDACTED]${3}",
            },
            // 13. 私钥 (跨行匹配)
            // 🌟 (?s) 标志使得 . 可以匹配换行符，等效于 JS 的 [\s\S]*?
            PrivacyRule {
                pattern: Regex::new(r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----").unwrap(),
                replacement: "[PRIVATE_KEY_REDACTED]",
            },
        ]
    })
}

#[tauri::command]
pub fn sanitize_privacy_info(text: String) -> String {
    if text.is_empty() {
        return text;
    }

    let mut sanitized_text = text;

    // 依次经过每一个正则管道的洗礼
    for rule in get_privacy_rules() {
        // replace_all 会自动处理全局匹配
        sanitized_text = rule.pattern.replace_all(&sanitized_text, rule.replacement).to_string();
    }

    sanitized_text
}