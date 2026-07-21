/**
 * llmService.js  ←→  context_service.rs  接口契约
 *
 * 三个函数作为 Tauri `invoke` 命令被 Rust 侧调用。
 * JS 侧不改逻辑，只需把入参/出参格式与 Rust 结构体对齐。
 *
 * Rust 侧占位签名（context_service.rs 中的 TODO 函数）
 * 最终会通过 tauri::command 转发到这里。
 *
 * ============================================================
 * 字段命名规则（Tauri 默认 camelCase <-> snake_case 互转）
 * ============================================================
 * Rust Message { id, chat_id, role, content, reasoning, timestamp, model }
 *   → JS  { id, chatId, role, content, reasoning, timestamp, model }
 *
 * Rust ModelConfig { cache_token_limit, compress_threshold, ... }
 *   → JS  { cacheTokenLimit, compressThreshold, ... }
 *
 * Rust FactItem { text_content }
 *   → JS  { textContent }
 */

import { chatAIApi, chatUserAIApi } from "../../api/ai";
import { AIChatService } from "../../service/aiChatService";

// ============================================================
// Prompt 常量
// ============================================================
const PROMPTS = {
  GLOBAL_SUMMARY: `
You are a fact-index maintainer, not a summarizer.

Task: Merge [Old Index] and [New Dialogue] into an updated fact index.

Rules:
- Retain all existing facts unless directly contradicted by new content
- When conflict occurs: new facts override old facts on the same topic
- Do not interpret, infer, generalize, or add background context
- Each entry must be traceable to an explicit statement in the source dialogue

Output format:
- One fact per line, starting with "- "
- Chinese preferred
- No prefix header (e.g. no "摘要:" or "Summary:")
`.trim(),

  SEGMENT_SUMMARY: `
You are a fact recorder, not a summarizer.

Task: Extract verbatim-level facts from the dialogue for future retrieval.

Include:
- Explicit statements by the user (decisions, preferences, names, values)
- Concrete actions or outcomes mentioned
- Specific technical terms, project names, or identifiers

Exclude:
- Any inference, interpretation, or generalization
- AI responses, explanations, or self-descriptions
- Vague or unverifiable statements

Output format:
- One fact per line, starting with "- "
- Max 50 characters per line
- Chinese preferred
- If nothing qualifies, output exactly: - [无有效事实]
`.trim(),

  EPOCH_SUMMARY: `
You are a long-term memory consolidation engine.

Task: Merge [Past Memory] and [Recent Dialogue] into a single consolidated memory base.

Priority order (what to preserve when space is limited):
1. User identity, long-term preferences, and persistent settings
2. Unresolved tasks and open questions
3. Key technical decisions and conclusions
4. General background context

Rules:
- Recent dialogue overrides past memory on conflicts
- Drop: pleasantries, repetition, AI self-descriptions, temporary context
- Output: continuous prose in Chinese, no bullet points, no prefix header
`.trim(),

  FACT_EXTRACTION: `
Task:
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
}`.trim(),
};

// ============================================================
// 核心 LLM 请求
// ============================================================
async function requestAndCleanLLM(model, messages, configObj) {
  const actualMaxTokens = configObj?.maxTokens || 512;
  const actualTemp = configObj?.temperature ?? 0.1;
  const responseFormat = configObj?.responseFormat || "text";
  const apiKey = model?.apiKey;

  let response = null;

  if (apiKey) {
    response = await chatUserAIApi(
      model.baseUrl,
      {
        model: model.name,
        messages,
        stream: false,
        temperature: actualTemp,
        max_tokens: actualMaxTokens,
        response_format: { type: responseFormat },
      },
      null,
      apiKey
    );
  } else {
    response = await chatAIApi(model.compressPath, {
      messages,
      stream: false,
      temperature: actualTemp,
      max_tokens: actualMaxTokens,
      response_format: responseFormat,
    });
  }

  const rawData = await response.json();

  if (!apiKey) {
    await AIChatService.incrementToken(rawData, model);
  }

  let llmResponse = rawData;
  if ((rawData.code === 200 || rawData.code === "200") && rawData.data) {
    llmResponse = rawData.data;
    if (typeof llmResponse === "string") {
      try {
        if (llmResponse.trim().startsWith("{") || llmResponse.trim().startsWith("[")) {
          llmResponse = JSON.parse(llmResponse);
        }
      } catch (e) {
        // 视为原始字符串
      }
    }
  }

  const content =
    llmResponse?.choices?.[0]?.message?.content ||
    rawData?.data?.choices?.[0]?.message?.content;

  if (!content) throw new Error("[LLM Service] 接口未返回有效 content");

  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// ============================================================
// 截断工具函数
// ============================================================
const PUNCTUATIONS = ["\n", "。", "！", "？", ". ", "! ", "? "];

function getSafeHead(text, targetLen) {
  if (text.length <= targetLen) return text;
  const candidate = text.slice(0, targetLen);
  let bestIdx = -1;
  for (const p of PUNCTUATIONS) {
    const idx = candidate.lastIndexOf(p);
    if (idx !== -1 && idx + p.length > bestIdx) bestIdx = idx + p.length;
  }
  const maxDrop = Math.min(150, targetLen * 0.5);
  if (bestIdx !== -1 && targetLen - bestIdx <= maxDrop) return candidate.slice(0, bestIdx);
  const lastSpace = candidate.lastIndexOf(" ");
  if (lastSpace !== -1 && targetLen - lastSpace <= 50) return candidate.slice(0, lastSpace);
  return candidate;
}

function getSafeTail(text, targetLen) {
  if (text.length <= targetLen) return text;
  const candidate = text.slice(-targetLen);
  let bestIdx = candidate.length;
  for (const p of PUNCTUATIONS) {
    const idx = candidate.indexOf(p);
    if (idx !== -1 && idx < bestIdx) bestIdx = idx + p.length;
  }
  const maxDrop = Math.min(150, targetLen * 0.5);
  if (bestIdx !== candidate.length && bestIdx <= maxDrop) return candidate.slice(bestIdx);
  const firstSpace = candidate.indexOf(" ");
  if (firstSpace !== -1 && firstSpace <= 50) return candidate.slice(firstSpace + 1);
  return candidate;
}

function cleanMessageContent(message, maxUserLen, maxAiLen) {
  let content = message.content || "";

  content = content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, codeContent) => {
    const lines = codeContent.split("\n");
    if (lines.length > 25) {
      const head = lines.slice(0, 10).join("\n");
      const tail = lines.slice(-5).join("\n");
      return `\`\`\`${lang}\n${head}\n\n... [Code Folded: ${lines.length - 15} lines omitted] ...\n\n${tail}\n\`\`\``;
    }
    return match;
  });

  if (message.role === "assistant") {
    if (content.length > maxAiLen) {
      const headLen = Math.floor(maxAiLen * 0.9);
      const tailLen = Math.floor(maxAiLen * 0.1);
      content =
        getSafeHead(content, headLen) +
        "\n\n...[AI Text Truncated]...\n\n" +
        getSafeTail(content, tailLen);
    }
  } else if (message.role === "user") {
    if (content.length > maxUserLen) {
      const headLen = Math.floor(maxUserLen * 0.75);
      const tailLen = Math.floor(maxUserLen * 0.25);
      content =
        getSafeHead(content, headLen) +
        "\n\n...[User Text Truncated]...\n\n" +
        getSafeTail(content, tailLen);
    }
  }

  return content;
}

function buildHistoryTextWithWindow(messages, maxUserLen, maxAiLen, maxTotalLen) {
  const reversed = [...messages].reverse();
  const selected = [];
  let totalLen = 0;

  for (const m of reversed) {
    const cleaned = cleanMessageContent(m, maxUserLen, maxAiLen);
    const line = `[${m.role === "user" ? "USER" : "AI"}]: ${cleaned}`;
    if (totalLen + line.length + 1 > maxTotalLen) {
      if (selected.length === 0) {
        selected.unshift(
          `[${m.role === "user" ? "USER" : "AI"}]: ${cleaned.slice(0, maxTotalLen)}...[Truncated]`
        );
      }
      break;
    }
    selected.unshift(line);
    totalLen += line.length + 1;
  }

  const dropped = messages.length - selected.length;
  const prefix = dropped > 0 ? `...[Earlier ${dropped} messages omitted]...\n` : "";
  return prefix + selected.join("\n");
}

function truncateBulletSummary(summary, maxLen) {
  if (summary.length <= maxLen) return summary;
  const lines = summary.split("\n").filter((l) => l.trim().length > 0);
  const kept = [];
  let total = 0;
  for (const line of lines) {
    const lineLen = line.length + 1;
    if (total + lineLen > maxLen) break;
    kept.push(line);
    total += lineLen;
  }
  if (kept.length === 0 && lines.length > 0) return lines[0].slice(0, maxLen) + "...";
  return kept.join("\n");
}

function cleanSummaryOutput(raw, enforceBullet = false) {
  let result = raw
    .trim()
    .replace(/^(最新|最终|更新后)?(摘要|总结|Summary|Index|事实)[：:]\s*/im, "")
    .trim();

  if (!enforceBullet) return result;

  result = result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.startsWith("-") ? line : `- ${line}`))
    .join("\n");

  return result;
}

// ============================================================
// ✅ 对外暴露的三个桥接函数
//
// 入参：Rust → JS（经 Tauri invoke，snake_case 自动转 camelCase）
//   messages: Message[]  →  { id, chatId, role, content, reasoning, timestamp, model }
//   modelConfig          →  { cacheTokenLimit, compressThreshold, ... }
//
// 出参：JS → Rust
//   runRollingChatSummary         → string
//   runEpochMemoryChatEpochSummary → string
//   extractMemoryFactsWithLLM     → { textContent: string }[]
//                                    ↑ Rust 侧 FactItem.text_content
// ============================================================

/**
 * 滚动摘要（对应 Rust run_rolling_chat_summary 占位）
 *
 * @param {Array}  messagesToSummarize  - Rust Message[] (camelCase)
 * @param {string} oldSummary
 * @param {Object} modelConfig          - Rust ModelConfig (camelCase)
 * @returns {Promise<string>}
 */
export async function runRollingChatSummary(messagesToSummarize, oldSummary = "", modelConfig) {
  if (!messagesToSummarize?.length) return oldSummary;

  const threshold     = modelConfig?.compressThreshold;
  const maxUserLen    = Math.floor(threshold * 0.10);
  const maxAiLen      = Math.floor(threshold * 0.10);
  const maxHistoryLen = Math.floor(threshold * 0.75);
  const maxSummaryLen = Math.floor(threshold * 0.10);

  const historyText = buildHistoryTextWithWindow(
    messagesToSummarize,
    maxUserLen,
    maxAiLen,
    maxHistoryLen
  );

  const isGlobalMerge = !!oldSummary;
  const systemPrompt = isGlobalMerge
    ? modelConfig?.promptGlobalSummary  || PROMPTS.GLOBAL_SUMMARY
    : modelConfig?.promptSegmentSummary || PROMPTS.SEGMENT_SUMMARY;

  const userPrompt = isGlobalMerge
    ? `[Old Index]:\n${oldSummary}\n\n[New Dialogue]:\n${historyText}\n\n[Output]:`
    : `[Dialogue]:\n${historyText}\n\n[Output]:`;

  const finalMaxTokens = isGlobalMerge ? modelConfig?.maxSummaryTokens || 600 : 150;

  try {
    const raw = await requestAndCleanLLM(
      modelConfig,
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      { maxTokens: finalMaxTokens, temperature: 0.1, responseFormat: "text" }
    );

    let finalSummary = cleanSummaryOutput(raw, true);

    const invalidSummaries = ["无有效事实", "暂无摘要", "null", "undefined", "[]"];
    if (
      !finalSummary ||
      finalSummary.replace(/[-\[\]\s]/g, "").length < 3 ||
      invalidSummaries.some((kw) => finalSummary.toLowerCase().includes(kw))
    ) {
      console.warn("[Memory] 摘要无效，退回旧摘要:", finalSummary);
      return oldSummary;
    }

    if (finalSummary.length > maxSummaryLen) {
      finalSummary = truncateBulletSummary(finalSummary, maxSummaryLen);
    }

    return finalSummary;
  } catch (error) {
    console.error("[Memory] 滚动摘要失败:", error.message);
    return oldSummary;
  }
}

/**
 * 纪元大摘要（对应 Rust run_epoch_memory_chat_epoch_summary 占位）
 *
 * @param {Array}  messagesToSummarize
 * @param {string} oldEpochSummary
 * @param {Object} modelConfig
 * @returns {Promise<string>}
 */
export async function runEpochMemoryChatEpochSummary(
  messagesToSummarize,
  oldEpochSummary,
  modelConfig
) {
  if (!messagesToSummarize?.length) return oldEpochSummary || "";

  const maxToken = modelConfig?.cacheTokenLimit;
  const msgCount = messagesToSummarize.length;
  const maxSafeInputChars = Math.floor(maxToken * 0.8 * 1.5);
  const avgChars = Math.floor(maxSafeInputChars / msgCount);
  const dynamicUserLen = Math.floor(avgChars * 0.8);
  const dynamicAiLen   = Math.floor(avgChars * 1.2);

  const cleanHistoryText = messagesToSummarize
    .map((m) => {
      const cleaned = cleanMessageContent(m, dynamicUserLen, dynamicAiLen);
      return `[${m.role === "user" ? "USER" : "AI"}]: ${cleaned.trim()}`;
    })
    .join("\n\n");

  // 修复原 JS 中 actualInputLen 未定义的 bug
  const actualInputLen = cleanHistoryText.length;

  const theoreticalMax = Math.ceil(maxToken * 0.05);
  const dynamicTokens  = modelConfig?.compressThreshold;
  const finalMaxTokens = Math.min(dynamicTokens, theoreticalMax);

  console.log(`[Epoch Summary] 输入[${actualInputLen}字符] → 分配[${finalMaxTokens}]Token`);

  const systemPrompt = modelConfig?.promptEpochSummary || PROMPTS.EPOCH_SUMMARY;
  const userPrompt =
    `[Past Memory]:\n${oldEpochSummary || "None"}\n\n` +
    `[Recent Dialogue]:\n${cleanHistoryText}\n\n` +
    `[Output]:`;

  try {
    const raw = await requestAndCleanLLM(
      modelConfig,
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      { maxTokens: finalMaxTokens, temperature: 0.1, responseFormat: "text" }
    );

    const newEpochSummary = cleanSummaryOutput(raw, false);

    if (!newEpochSummary || newEpochSummary.length < 10) {
      console.warn("[Epoch] 摘要无效，退回旧纪元摘要");
      return oldEpochSummary || "";
    }

    return newEpochSummary;
  } catch (error) {
    console.error("[Epoch] 纪元大摘要生成失败:", error);
    return oldEpochSummary || "";
  }
}

/**
 * 用户事实提取（对应 Rust extract_memory_facts_with_llm 占位）
 *
 * 出参格式：{ textContent: string }[]
 * 对应 Rust FactItem { text_content: String }
 * （Tauri 序列化：snake_case ↔ camelCase 自动转换）
 *
 * @param {Array}  messagesToSummarize
 * @param {Object} modelConfig
 * @returns {Promise<Array<{ textContent: string }>>}
 */
export async function extractMemoryFactsWithLLM(messagesToSummarize, modelConfig) {
  if (!messagesToSummarize?.length) return [];

  const maxToken = modelConfig?.cacheTokenLimit;
  const msgCount = messagesToSummarize.length;
  const maxSafeInputChars = Math.floor(maxToken * 0.8 * 1.5);
  const avgChars = Math.floor(maxSafeInputChars / msgCount);

  const dynamicUserLen = Math.floor(avgChars * 1.8);
  const dynamicAiLen   = Math.max(150, Math.floor(avgChars * 0.2));

  const historyText = messagesToSummarize
    .map((m) => {
      const cleaned = cleanMessageContent(m, dynamicUserLen, dynamicAiLen);
      return `---[${m.role === "user" ? "USER" : "AI"}]---\n${cleaned.trim()}`;
    })
    .join("\n\n");

  const actualInputLen = historyText.length;
  const configuredMaxOutput =
    modelConfig?.compressThreshold ||
    modelConfig?.maxExtractionTokens ||
    Math.ceil(maxToken * 0.05);

  const dynamicTokens  = Math.ceil(actualInputLen * 0.1);
  const finalMaxTokens = Math.max(500, Math.min(dynamicTokens, configuredMaxOutput));

  console.log(
    `[Fact Extraction] 窗口[${maxToken}] → User[${dynamicUserLen}]/AI[${dynamicAiLen}] → 输出[${finalMaxTokens}]Token`
  );

  const systemPrompt = modelConfig?.promptFactExtraction || PROMPTS.FACT_EXTRACTION;
  const userPrompt   = `[Dialogue]:\n${historyText}\n\n[Output JSON]:`;

  try {
    const raw = await requestAndCleanLLM(
      modelConfig,
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      { maxTokens: finalMaxTokens, temperature: 0.1, responseFormat: "json_object" }
    );

    let parsedData;
    try {
      const cleanJson = raw.replace(/```json|```/g, "").trim();
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error("[Fact Extraction] JSON 解析失败:", parseErr);
      return [];
    }

    // 容错：兼容模型可能输出 facts / fats / fact / items
    const rawFacts =
      Array.isArray(parsedData?.facts) ? parsedData.facts :
      Array.isArray(parsedData?.fats)  ? parsedData.fats  :
      Array.isArray(parsedData?.fact)  ? parsedData.fact  :
      Array.isArray(parsedData?.items) ? parsedData.items :
      [];

    /**
     * ⚠️  出参对齐：返回 { textContent } 而非原来的 { textContent, importance }
     *
     * 原 JS 版本返回 { textContent, importance: 5 }，
     * 但 Rust FactItem 只有 text_content 字段。
     * 如果后续 Rust 侧需要 importance，在 FactItem 结构体里加字段即可，
     * 届时同步恢复 importance 字段即可。
     */
    return rawFacts
      .map((text) => (typeof text === "string" ? text.trim() : ""))
      .filter((text) => text.length >= 2)
      .map((textContent) => ({ textContent }));

  } catch (error) {
    console.error("[Fact Extraction] 提取失败:", error.message);
    return [];
  }
}