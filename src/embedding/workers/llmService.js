// llmService.js
import { chatUserAIApi } from "../api/ai";

/**
 * 💡 核心抽取：通用的 LLM 请求与清洗器
 */
async function requestAndCleanLLM(model, messages, configObj) {
  const actualMaxTokens = configObj?.maxTokens || 512;
  const actualTemp = configObj?.temperature || 0.1;
  const responseFormat = configObj?.responseFormat || "text";
  const apiKey = model?.apiKey;
  let response = null; 
 
    response = await chatUserAIApi(
      model.baseUrl,
      {
        model: model.name,
        messages,
        stream: false,
        temperature: actualTemp,
        max_tokens: actualMaxTokens,
        response_format: {
           type: responseFormat,
        }
      },
      null,
      apiKey
    );
  

  const rawData = await response.json(); 

  let llmResponse = rawData;
  if ((rawData.code === 200 || rawData.code === "200") && rawData.data) {
    llmResponse = rawData.data;
    if (typeof llmResponse === "string") {
      try {
        // 只有在符合 JSON 特征时才解析，否则视为纯文本
        if (
          llmResponse.trim().startsWith("{") ||
          llmResponse.trim().startsWith("[")
        ) {
          llmResponse = JSON.parse(llmResponse);
        }
      } catch (e) {
        console.warn("[LLM Service] JSON 解析跳过，视为原始字符串处理");
        // 这里不 throw，交给下方 choices 取值逻辑兜底
      }
    }
  }

  // 这里的 llmResponse 可能是解析后的对象，也可能是原始 rawData
  const content =
    llmResponse?.choices?.[0]?.message?.content ||
    rawData?.data?.choices?.[0]?.message?.content;

  if (!content) {
    console.error("[LLM Service] 异常数据结构:", rawData);
    throw new Error("[LLM Service] 接口未返回有效 content");
  }

  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * 历史记忆压缩 (滚动摘要生成器)
 * 作用：将一段长对话（结合旧摘要）浓缩成一段精简的全局摘要，用于长期背景知识。
 */
export async function runRollingChatSummary(
  messagesToSummarize,
  oldSummary = "",
  modelConfig // 👈 接收传入的合并配置
) {
  if (!messagesToSummarize?.length) return oldSummary;

  // 🌟 动态获取压缩阈值 (默认 4000)
  const threshold = modelConfig?.compressThreshold || 4000;

  // 动态防线配置：
  const maxUserTextLen = Math.floor(threshold * 0.1);
  const maxAiTextLen = Math.floor(threshold * 0.05);
  const maxHistoryTextLen = Math.floor(threshold * 0.75);
  const maxSummaryLen = Math.floor(threshold * 0.1);

  // 2. 组装待压缩的历史文本
  const historyText = messagesToSummarize
    .map((m) => {
      let content = m.content || "";

      if (m.role === "assistant") {
        content = content.replace(
          /```[\s\S]*?```/g,
          "\n...[Code Omitted]...\n"
        );
        if (content.length > maxAiTextLen) {
          content = content.slice(0, maxAiTextLen) + "...[Truncated]";
        }
      } else if (m.role === "user") {
        if (content.length > maxUserTextLen) {
          const head = Math.floor(maxUserTextLen * 0.75);
          const tail = Math.floor(maxUserTextLen * 0.25);
          content =
            content.slice(0, head) +
            "\n...[User Text Omitted]...\n" +
            content.slice(-tail);
        }
      }

      return `[${m.role.toUpperCase()}]: ${content}`;
    })
    .join("\n");

  // 3. 总容量兜底
  let finalHistoryText = historyText;
  if (finalHistoryText.length > maxHistoryTextLen) {
    console.warn(
      `[Memory] 文本达 ${finalHistoryText.length} 字符，超动态阈值 ${maxHistoryTextLen}，执行截断保护`
    );
    finalHistoryText =
      "...[Previous Omitted]...\n" + finalHistoryText.slice(-maxHistoryTextLen);
  }

  // 判断当前是“全局大合并”还是“增量小片段”
  const isGlobalMerge = !!oldSummary;

  // ==========================================
  // 🌟 核心改造：动态读取 Prompt 提示词，并保留兜底默认值
  // ==========================================
  const systemPrompt = isGlobalMerge
    ? modelConfig?.promptGlobalSummary ||
      `任务：更新并压缩全局对话摘要。\n规则：\n1. 新旧融合：将【旧摘要】与【新对话】无缝合并。\n2. 提炼核心：保留核心的技术决策、关键事实和上下文。\n3. 严格限字：绝对不能超过 200 字！尽量压缩旧信息，给新信息腾出空间。\n4. 格式要求：输出一段连贯的简体中文。直接写正文，绝对不要加“摘要：”或“总结：”这种多余的前缀。`
    : modelConfig?.promptSegmentSummary ||
      `任务：从简短的对话片段中提取核心信息。\n规则：\n1. 只抓重点：只提取核心的技术决策、待办事项或结论。\n2. 挤干水分：删掉所有的客套话、日常闲聊和当下的思考过程。\n3. 严格限字：绝对不能超过 50 字！\n4. 格式要求：输出 1 到 2 个核心要点（使用条目列表形式，如 - xxx），用简体中文。直接写正文，不要加任何前缀。`;

  const userPrompt = isGlobalMerge
    ? `【旧的摘要】:\n${oldSummary}\n\n【需要补充的新对话】:\n${finalHistoryText}\n\nOutput:`
    : `【对话记录】:\n${finalHistoryText}\n\nOutput:`;

  // 🌟 动态获取允许的最大输出 Token (默认 600)
  const finalMaxTokens = isGlobalMerge
    ? modelConfig?.maxSummaryTokens || 600
    : 150;

  try {
    const content = await requestAndCleanLLM(
      modelConfig,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: finalMaxTokens, temperature: 0.1, responseFormat: "text" }
    );

    console.log(
      `[Memory Rolling Summary Raw Output (${
        isGlobalMerge ? "Global" : "Segment"
      })]:\n`,
      content
    );

    // 解析与清洗
    let finalSummary = content.trim();

    // 物理防线：砍掉废话前缀
    finalSummary = finalSummary
      .replace(/^(最新)?摘要[：:]\s*/i, "")
      .replace(/^(最新)?总结[：:]\s*/i, "")
      .replace(/^Summary[：:]\s*/i, "")
      .replace(isGlobalMerge ? /^[\*\-\s]+/g : /^(?![\*\-])/, "")
      .trim();

    if (!finalSummary || finalSummary.length < 5) {
      console.warn("[Memory] 大模型生成的摘要太短或无效，退回旧摘要。");
      return oldSummary;
    }

    // 4. 输出物理裁剪（防滚雪球）
    if (finalSummary.length > maxSummaryLen) {
      console.warn(
        `[Memory] 小模型未遵守字数限制，触发物理裁剪至 ${maxSummaryLen} 字符。`
      );
      let truncated = finalSummary.slice(0, maxSummaryLen);
      const lastPunctuation = truncated.search(/[。！？.!?][^。！？.!?]*$/);
      if (lastPunctuation !== -1) {
        finalSummary = truncated.slice(0, lastPunctuation + 1);
      } else {
        finalSummary = truncated + "...";
      }
    }
    console.log("[Memory Final Summary]:", finalSummary);
    return finalSummary;
  } catch (error) {
    console.error("[Memory] 历史压缩（滚动摘要）失败:", error.message);
    return oldSummary;
  }
}
/**
 * 历史记忆压缩 (缓存纪元大摘要生成器)
 * 作用：将长达几十轮的追加对话浓缩成一段精简的全局摘要，作为下一纪元的缓存基座。
 */
export async function runEpochMemoryChatEpochSummary(messagesToSummarize, oldEpochSummary, modelConfig) {
  if (!messagesToSummarize?.length) return oldEpochSummary || "";

  // ==========================================
  // 🌟 深度清洗待压缩的对话记录 (极大幅度省 Token)
  // ==========================================
  const cleanHistoryText = messagesToSummarize.map(m => {
    let content = m.content || "";

    // 砍掉大段代码块
    content = content.replace(/```[\s\S]*?```/g, "\n...[代码段已省略]...\n");

    // 限制单条消息长度
    if (content.length > 800) {
      if (m.role === 'user') {
        content = content.slice(0, 300) + "\n...[长文已省略]...\n" + content.slice(-300);
      } else {
        content = content.slice(0, 200) + "\n...[AI长解释已省略]...\n" + content.slice(-200);
      }
    }
    
    // 使用纯文本组装，弃用 JSON.stringify
    const roleName = m.role === 'user' ? 'User' : 'AI';
    return `[${roleName}]: ${content.trim()}`;
  }).join("\n\n");


  // ==========================================
  // 🌟 核心改造：基于输入规模动态分配输出 Token (联动 cacheTokenLimit)
  // ==========================================
  
  // 1. 获取系统设定的熔断阈值（兜底 20000）
  const tokenLimit = modelConfig?.cacheTokenLimit || 20000;
  
  // 2. 根据阈值设定一个“理论最大摘要长度”（按照约 5% 的极限压缩率估算）
  // 比如 20000 token 的阈值，最多允许生成 1000 token 的摘要；50000 阈值就允许 2500。
  const theoreticalMax = Math.ceil(tokenLimit * 0.05); 

  // 3. 结合本次【实际清洗后】的文本长度，计算动态额度
  // 防止由于“轮数先达标但字数很少”触发压缩时，给的额度太大导致 AI 废话连篇
  const actualInputTokens = Math.ceil(cleanHistoryText.length * 1);
  const dynamicTokens = Math.ceil(actualInputTokens * 0.15); // 给实际内容的 15% 作为提炼空间

  // 4. 终极合并：保证有下限（至少给500），且不超过理论最大值或绝对封顶（4000）
  const finalMaxTokens = Math.max(
    500, 
    Math.min(dynamicTokens, theoreticalMax, 4000)
  );

  console.log(`[Epoch Summary] 动态额度计算: 实际字数[${actualInputTokens}] -> 分配额度[${finalMaxTokens}] Token`);

  // 1. 组装 Prompt
  const systemPrompt = modelConfig.promptEpochSummary
  || `你是一个无损记忆压缩引擎。请将【过去的记忆摘要】与【最新的一大段对话记录】进行合并与提炼。
规则：
1. 严格保留核心事实、用户偏好设定、关键数据（如代码逻辑、关键日期等）。
2. 抛弃无用的客套话和重复性对话。
3. 如果最新的对话颠覆了过去的设定，以最新对话为准。
4. 输出连贯的文本，直接写正文，不要带“总结：”等前缀。`;

  const userPrompt = `【过去的记忆摘要】：\n${oldEpochSummary || "暂无"}\n\n【最新的对话记录】：\n${cleanHistoryText}\n\nOutput:`;

  try {
    // 3. 传入动态计算好的 finalMaxTokens
    const content = await requestAndCleanLLM(
      modelConfig,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: finalMaxTokens, temperature: 0.1, responseFormat: "text" }
    );

    let newEpochSummary = content.trim();
    
    // 清理可能出现的大模型废话前缀
    newEpochSummary = newEpochSummary
      .replace(/^(最新)?摘要[：:]\s*/i, "")
      .replace(/^(最新)?总结[：:]\s*/i, "")
      .replace(/^Summary[：:]\s*/i, "")
      .trim();

    return newEpochSummary;
  } catch (error) {
    console.error("[Epoch Compression] 纪元大摘要生成失败:", error);
    // 失败时做降级处理，返回原来的摘要，防止把记忆搞丢
    return oldEpochSummary || ""; 
  }
}
/**
 * 记忆事实提取
 */
export async function extractMemoryFactsWithLLM(
  messagesToSummarize,
  modelConfig // 👈 接收传入的合并配置
) {
  if (!messagesToSummarize?.length) return [];

  // 1. 组装历史文本
  const historyText = messagesToSummarize
    .map((m) => {
      let content = m.content || "";

      if (m.role === "assistant") {
        content = content.replace(
          /```[\s\S]*?```/g,
          "\n...[AI Code Implementation Omitted]...\n"
        );
        if (content.length > 200) {
          content =
            content.slice(0, 200) +
            "\n...[Additional AI Explanations Omitted]...";
        }
      }

      return `---[${m.role.toUpperCase()}]---\n${content}`;
    })
    .join("\n\n");

  // ==========================================
  // 🌟 核心改造：动态读取事实提取的 Prompt
  // ==========================================
  const systemPrompt =
    modelConfig?.promptFactExtraction ||
    `任务：提取对话中仅关于【用户】的长期事实、偏好和状态。
严格规则：
1. 角色隔离：只提取【用户】本人的信息！绝对不要记录【AI助手】的能力、身份或回复（比如AI说“我会写代码”，这绝不能存为用户事实）。
2. 拒绝脑补：只提取用户明确说过的或确认过的事实，不要瞎猜。
3. 纯 JSON 输出：只能输出合法的 JSON 对象。不要带任何解释、语气词或 Markdown 代码块包裹。
格式参考（仅供参考格式，严禁抄袭文字）：
{
  "facts": [
    "用户喜欢早上喝咖啡",
    "用户习惯使用深色主题"
  ]
}
没抓到事实时的交白卷格式（非常重要）：
{
  "facts": []
}`;

  // 动态 Token 上限极度压榨
  const estimatedInputTokens = Math.ceil(historyText.length / 1.5);
  const dynamicMaxTokens = Math.ceil(estimatedInputTokens * 0.2) + 50;

  // 🌟 动态获取事实提取的最大允许 Token (默认 150)
  const finalMaxTokens = Math.max(
    modelConfig?.maxExtractionTokens || 150,
    dynamicMaxTokens
  );

  try {
    const content = await requestAndCleanLLM(
      modelConfig,
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Dialogue:\n${historyText}\n\nOutput ONLY JSON:`,
        },
      ],
      {
        maxTokens: finalMaxTokens,
        temperature: 0,
        responseFormat: "json_object",
      }
    );

    console.log("[Memory LLM Raw Output]:\n", content);

    let parsedData;
    try {
      parsedData = JSON.parse(content);
    } catch (parseErr) {
      console.error("[Memory] JSON 解析失败:", parseErr);
      return [];
    }

    const rawFactsArray = Array.isArray(parsedData.facts)
      ? parsedData.facts
      : [];

    // 4. 清洗逻辑
    const facts = rawFactsArray
      .map((text) => (typeof text === "string" ? text.trim() : ""))
      .filter((text) => text.length >= 2)
      .map((cleanText) => ({
        textContent: cleanText,
        importance: 5,
      }));

    console.log("[Memory Parsed Facts]:", facts);
    return facts;
  } catch (error) {
    console.error("[Memory] 提取失败:", error.message);
    return [];
  }
}
