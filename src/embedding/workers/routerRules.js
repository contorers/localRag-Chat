// routerRules.js

// 1. 扩充后的语义字典（⚠️ 严禁使用 /g 标志）
// 将词汇按类型分组，方便后期维护。使用 i 忽略英文大小写。
const CONTEXT_DEPENDENT_REGEX = new RegExp(
    [
      "这|那|它|他|她|此|该",                // 实体指代
      "前者|后者|之前|刚才|上文|上面|下面", // 空间与时间指代
      "为什么|怎么|咋|何|啥",               // 追问动机
      "报错|异常|失败|不行|不对|缺点",      // 状态反馈
      "继续|然后|另外|还有|其次|如果",      // 逻辑延续
      "why|how|what"                        // 补充常见英文短句追问
    ].join("|"),
    "i" 
  );
  const SOCIAL_FILLERS_REGEX = /^(你好|您好|hi|hello|在吗|谢谢|好的|收到|ok|懂了|明白了|拜拜|再见|哈|嗯|哦|噢)$/i;
  const TECH_ENTITIES_REGEX = /vue|pinia|netty|kafka|redis|sql|java|spring|context|token|id/i;
  /**
   * 判断用户输入是否需要去大模型重写
   * @param {string} text - 用户的当前输入
   * @returns {boolean} - true 代表需要重写，false 代表可以直接搜
   */
  export function needsRewriting(text) {
    if (!text) return false;
    const t = text.trim();
    if (!t) return false;
  
    // 1. 绝对安全的放行：纯代码块
    if (t.startsWith('```')) return false;
  
    // 2. 社交/闲聊拦截
    if (SOCIAL_FILLERS_REGEX.test(t)) return false;
  
    // 3. 代词校验 (最高优)：只要有代词（它、他、这个、那个、这里），多长都得重写找上下文
    if (CONTEXT_DEPENDENT_REGEX.test(t)) {
      return true;
    }
  
    // 4. 实体词绕过：输入里已经有了硬核技术词，通常是独立问题，不需要重写
    if (TECH_ENTITIES_REGEX.test(t)) {
      return false;
    }
  
    const pureText = t.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  
    // 5. 极短文本过滤
    if (pureText.length <= 4) {
      // 只有明确的追问词才重写，其他的短词（如“好的”、“确实”）直接放行
      const QUERY_KEYWORDS = /为什么|怎么|啥|如何|咋|why|how|继续|然后|对吗/i;
      return QUERY_KEYWORDS.test(t); 
    }
  
    // 6. 长度放行：超过 20 个字，且没有代词，信息量绝对足够了
    if (pureText.length > 20) { 
      return false;
    }
  
    // 🌟 7. 终极兜底（修复“黑洞”）：
    // 运行到这里的，是长度在 5 ~ 20 之间，既没技术名词、又没代词的短句。
    // 比如：“能不能详细说说”、“具体是怎么做的”、“还有其他方案吗”
    // 这些话 100% 需要结合上下文，所以默认交由 LLM 处理！
    return true; 
  }

/**
 * 判断当前文本是否具有检索价值（是否应该触发 RAG / getRelevantContextHybrid）
 * @param {string} finalQuery - 准备去检索的文本（可能是原始输入，也可能是重写后的文本）
 * @returns {boolean} - true 代表有价值去搜，false 代表直接跳过 RAG
 */
export function shouldTriggerRAG(finalQuery) {
  if (!finalQuery) return false;
  const t = finalQuery.trim();
  
  // 1. 社交/闲聊绝对不查库（查出来的也是废话）
  if (SOCIAL_FILLERS_REGEX.test(t)) return false;

  // 2. 纯短语指令或无意义语气词拦截（防止触发上一轮的“这就是”导致串台）
  const MEANINGLESS_SHORT_REGEX = /^(好的|继续|是吗|怎么说|这就是|what|why|ok|yes|不行|不对)$/i;
  if (MEANINGLESS_SHORT_REGEX.test(t)) return false;

  // 3. 极短文本且没有技术名词的，拦截
  // 例如用户只发了 "如何"，这没法搜
  if (t.length <= 3 && !TECH_ENTITIES_REGEX.test(t)) return false;

  return true;
}
// ==========================================
// 🛡️ 隐私信息脱敏模块 (PII Sanitization)
// ==========================================

// 2. 隐私数据正则字典 (⚠️ 此处必须使用 /g 进行全局匹配和替换)
const PRIVACY_REGEX_RULES = [
  // ==========================================
  // 1. 个人与企业身份/联系方式 (PII)
  // ==========================================
  {
    name: '邮箱地址',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_REDACTED]'
  },
  {
    name: '手机号(中国大陆)',
    // 匹配 13x-19x 开头的 11 位数字。
    // 🌟 重点：使用零宽断言确保独立 11 位数，避免误杀 18 位订单号中间的数字。
    pattern: /(?<!\d)(?:\+?86\s?)?1[3-9]\d{9}(?!\d)/g,
    replacement: '[PHONE_REDACTED]'
  },
  {
    name: '座机号码(中国大陆)',
    // 匹配 010-12345678, 0755-1234567, 或者不带区号连字符的格式
    pattern: /(?<!\d)0\d{2,3}[-\s]?\d{7,8}(?!\d)/g,
    replacement: '[LANDLINE_REDACTED]'
  },
  {
    name: '身份证号(中国大陆)',
    // 18位标准身份证号严谨正则，校验出生年份(18xx-20xx)和日期
    pattern: /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|10|11|12)(?:0[1-9]|[1-2]\d|30|31)\d{3}[\dXx](?!\d)/g,
    replacement: '[ID_CARD_REDACTED]'
  },
  {
    name: '统一社会信用代码(中国大陆企业)',
    // 18位企业税号/信用代码，包含数字和特定大写字母（规范中排除了I、O、Z、S、V）
    pattern: /(?<![0-9A-Z])[1-9A-GY]{1}[1239]{1}[1-5]{1}[0-9]{5}[0-9A-Z]{10}(?![0-9A-Z])/g,
    replacement: '[USCI_REDACTED]'
  },
  {
    name: 'MAC 地址',
    // 匹配常见的 MAC 地址格式 (如 00:1A:2B:3C:4D:5E 或 00-1A-2B-3C-4D-5E)，网络排障日志中常泄露
    pattern: /(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g,
    replacement: '[MAC_ADDRESS_REDACTED]'
  },

  // ==========================================
  // 2. 财务与交易数据 (PCI DSS)
  // ==========================================
  {
    name: '银行卡号/信用卡号',
    // 匹配 14 到 19 位的连续数字（覆盖银联、Visa、MasterCard等主流银行卡）
    // ⚠️ 注意：这有较小概率误杀 16-19 位的 Snowflake ID (雪花算法生成的主键)，若你的业务大量打印长整型 ID，需谨慎使用或增加上下文校验
    pattern: /(?<!\d)(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|62\d{14,17}|3[47]\d{13}|[1-9]\d{15,18})(?!\d)/g,
    replacement: '[BANK_CARD_REDACTED]'
  },

  // ==========================================
  // 3. 开发者敏感凭证 (Secrets & Credentials)
  // ==========================================
  {
    name: 'JWT Token / Bearer Token',
    // 匹配标准的 JWT 格式 (eyJ 开头，包含两个点号的超长字符串)
    pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    replacement: '[JWT_TOKEN_REDACTED]'
  },
  {
    name: '常见 API 密钥 (OpenAI / Anthropic / AWS)',
    // 匹配 sk- 开头的长字符串，或 AKIA 开头的 AWS 密钥
    pattern: /(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})/g,
    replacement: '[API_KEY_REDACTED]'
  },
  {
    name: 'GitHub 访问令牌 (PAT)',
    // GitHub 的 Token 具有非常固定的前缀格式 (ghp_ 个人, gho_ OAuth, ghs_ Server 等)
    pattern: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g,
    replacement: '[GITHUB_TOKEN_REDACTED]'
  },
  {
    name: 'Slack 机器人/用户 Token',
    // 匹配 xoxb- (Bot) 或 xoxp- (User) 等前缀格式
    pattern: /xox[baprs]-[0-9]{10,13}-[a-zA-Z0-9]{24,34}/g,
    replacement: '[SLACK_TOKEN_REDACTED]'
  },
  {
    name: 'URL 基础认证 / 数据库连接串密码',
    // 匹配如 mongodb://admin:pass123@localhost:27017 中的 admin:pass123
    // 🌟 重点：只替换凭证部分，保留协议和目标主机，从而在脱敏的同时，依然能知道报错连的是哪个库
    pattern: /(?<=[a-zA-Z0-9+.-]+:\/\/)[^:\s]+:[^@\s]+(?=@)/g,
    replacement: '[URL_AUTH_REDACTED]'
  },
  {
    name: '私钥 (RSA / EC / OpenSSH)',
    // 匹配各类 PEM 格式的私钥证书
    // 🌟 重点：使用 [\s\S]*? 匹配跨行的 base64 内容，直到遇到 END。防止因报错把整个证书内容打印到日志中
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[PRIVATE_KEY_REDACTED]'
  }
];

// 💡 提示：为什么不拦截 IP 地址？
// 因为全栈开发经常粘贴带有 127.0.0.1:8080 或 192.168.x.x 的微服务报错日志。拦截 IP 容易破坏调试上下文。

/**
 * 过滤并脱敏用户输入中的敏感隐私信息
 * @param {string} text - 用户的原始输入或报错日志
 * @returns {string} - 脱敏后的安全文本
 */
export function sanitizePrivacyInfo(text) {
  if (!text || typeof text !== 'string') return text;

  let sanitizedText = text;

  PRIVACY_REGEX_RULES.forEach(rule => {
    sanitizedText = sanitizedText.replace(rule.pattern, rule.replacement);
  });

  return sanitizedText;
}