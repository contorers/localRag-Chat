import MiniSearch from "minisearch";
import { needsRewriting } from "./routerRules.js";
import {
  extractMemoryFactsWithLLM,
  runRollingChatSummary,
  runEpochMemoryChatEpochSummary
} from "./llmService.js";
import { chatDB } from "../Indexdb/db/chatDB.js";
import { vectorDB } from "../Indexdb/db/vectorDB.js";
import {
  analyzeQueryIntent,
  reciprocalRankFusion,
} from "./hybridSearch.js";
import {
  getVectorFromWorker,
  searchVectorsInWorker,
} from "./workerClient.js";

// ============================================================================
// 1. 单会话搜索引擎 (用于大模型上下文召回)
// ============================================================================
export const messageSearcher = new MiniSearch({
  fields: ["content", "reasoning"],
  storeFields: ["id", "chatId", "role", "content", "reasoning", "timestamp"],
  searchOptions: {
    fuzzy: 0.2,
    prefix: true,
    boost: { content: 2, reasoning: 1 },
  },
});

// ============================================================================
// 2. 全局搜索引擎 (用于用户界面的历史记录搜索)
// ============================================================================
export const globalSearcher = new MiniSearch({
  fields: ["content", "reasoning"],
  storeFields: [
    "id",
    "chatId",
    "role",
    "content",
    "reasoning",
    "timestamp",
    "model",
  ],
  searchOptions: {
    fuzzy: 0.2,
    prefix: true,
  },
});

// ============================================================================
// 全局搜索相关逻辑
// ============================================================================

/**
 * 构建全局跨会话搜索索引
 */
export async function buildGlobalSearchIndex(modelId, targetRole) {
  const chatLists = await chatDB.queryChatListByModelId(modelId);

  if (chatLists.length === 0) {
    globalSearcher.removeAll();
    return;
  }

  const chatIds = chatLists
    .map((chat) => chat.id)
    .filter((id) => id !== undefined);

  const modelMap = {};
  chatLists.forEach((chat) => {
    if (chat.id && chat.model) {
      modelMap[chat.id] = chat.model;
    }
  });

  // ✅ 防 OOM 核心：不再全量抓取！只抓取每个会话最近的 100 条消息建立全局搜索索引
  // (对于全局搜索来说，搜索太久远之前的内容通常意义不大，若有需求可调大 limitPerChat)
  const allMessages = await chatDB.queryRecentMessagesByChatIds(chatIds, 100);

  const messagesWithModel = allMessages.map((msg) => ({
    ...msg,
    model: modelMap[msg.chatId] || "unknown",
    role: msg.role === "user" ? "user" : targetRole,
  }));

  globalSearcher.removeAll();
  globalSearcher.addAll(messagesWithModel);
  console.log(
    `[Global Search] 已成功为 ${chatIds.length} 个会话重建索引，共 ${messagesWithModel.length} 条数据。`
  );
}

/**
 * 在全局范围按模型或角色过滤搜索
 */
export function searchByModel(keyword, targetModel, targetRole) {
  return globalSearcher.search(keyword, {
    filter: (result) => {
      let isMatch = result.model === targetModel;
      if (targetRole) {
        isMatch = isMatch && result.role === targetRole;
      }
      return isMatch;
    },
  });
}

// ============================================================================
// 单会话上下文召回相关逻辑 (发给大模型用的)
// ============================================================================

/**
 * 加载特定会话的历史记录到单会话搜索引擎
 */
export async function loadChatHistoryIntoSearch(currentChatId) {
  try {
    const messages = await chatDB.queryChatIdMessages(currentChatId);

    const validMessages = messages.filter(
      (m) => m.content?.trim() !== "" || m.reasoning?.trim() !== ""
    );

    messageSearcher.removeAll();
    messageSearcher.addAll(validMessages);

    console.log(
      `[Search] 会话 ${currentChatId} 的 ${validMessages.length} 条记录已建立索引`
    );
  } catch (error) {
    console.error("[Search] 建立索引失败:", error);
  }
}

/**
 * 实时同步新消息到单会话索引
 */
// 💡 纯 JS 写法：去除了 newMsg 的类型定义
export function addMessageToSearch(newMsg) {
  if (!messageSearcher.has(newMsg.id)) {
    messageSearcher.add(newMsg);
  }
}

/**
 * 纯本地短期记忆截断（替代原有的 LLM 预检）
 * 速度极快，直接截取最近的 N 条，并修复同角色连续出现的问题
 */
export function buildShortTermContext(recentHistory, maxMessages = 10) {
  if (!recentHistory || recentHistory.length === 0) return [];

  // 1. 粗暴截断：只取最近的 maxMessages 条
  const startIdx = Math.max(0, recentHistory.length - maxMessages);
  const slicedHistory = recentHistory.slice(startIdx);

  const mergedHistory = [];

  // 2. 修复合并连续的同角色消息（防止 API 报错）
  slicedHistory.forEach((msg) => {
    const lastMsg = mergedHistory[mergedHistory.length - 1];
    
    if (lastMsg && lastMsg.role === msg.role) {
      // 如果角色相同，用换行符拼接内容
      lastMsg.content += `\n${msg.content}`; 
    } else {
      // 浅拷贝推入新消息
      mergedHistory.push({ ...msg }); 
    }
  });

  return mergedHistory;
}


/**
 * 带有动态路由的超级召回流水线 (极致纯净版)
 * 已彻底移除 LLM Query 重写机制，0 延迟，直接依赖原声用户输入与本地计算
 */
// 🌟 核心修改 1：截取最大长度改为 200，减少 Token 浪费
// 🌟 辅助函数 1：原有纯文本截断保持不变
function extractSnippet(content, query, maxLength = 200) {
  if (!content || content.length <= maxLength) return content;

  const lowerContent = content.toLowerCase();
  const cleanQuery = query.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5+#.-]/g, " ");
  const keywords = cleanQuery.split(/\s+/).filter((k) => k.trim().length > 0);

  let firstMatchIndex = -1;
  for (const keyword of keywords) {
    const idx = lowerContent.indexOf(keyword);
    if (idx !== -1 && (firstMatchIndex === -1 || idx < firstMatchIndex)) {
      firstMatchIndex = idx;
    }
  }

  if (firstMatchIndex === -1) {
    return content.substring(0, maxLength).trim() + "...";
  }

  let start = Math.max(0, firstMatchIndex - 60);
  const lastNewlineBefore = content.lastIndexOf('\n', firstMatchIndex);
  if (lastNewlineBefore !== -1 && lastNewlineBefore > start - 50) {
    start = lastNewlineBefore + 1;
  }

  let end = start + maxLength;
  const nextNewlineAfter = content.indexOf('\n', end - 50);
  if (nextNewlineAfter !== -1 && nextNewlineAfter < end + 50) {
    end = nextNewlineAfter;
  }

  end = Math.min(content.length, end);
  let snippet = content.substring(start, end).trim();

  const prefix = start > 0 ? "...(前文略)\n" : "";
  const suffix = end < content.length ? "\n...(后文略)" : "";

  return `${prefix}${snippet}${suffix}`;
}

// 🌟 辅助函数 2：截断收尾修复保持不变
const fixSnippetEnding = (text) => {
  if (!text) return "";
  let cleaned = text.replace(/[,，、；：;:\-\*\_\#\>\|`\s]+(?:…|\.\.\.)?$/g, '').trim();
  if (/[。！？.!?]$/.test(cleaned)) return cleaned; 
  
  const match = cleaned.match(/[。！？.!?]/g);
  if (match) {
    const lastPunctuation = match[match.length - 1];
    const lastIndex = cleaned.lastIndexOf(lastPunctuation);
    if (cleaned.length - lastIndex < 35) {
      return cleaned.substring(0, lastIndex + 1);
    }
  }
  return cleaned + "...";
};

// 🌟🌟🌟 核心新增：代码与文本双轨智能截断 🌟🌟🌟
// 🌟🌟🌟 新增：裸代码特征探针 🌟🌟🌟
// 用于检测没有被 Markdown 包裹的纯文本代码
/**
 * 探测文本是否为未被 Markdown 标签包裹的“裸代码”
 * 增加了对更多编程语言特征的识别，防止截断时破坏语义
 */
function isNakedCode(text) {
  if (!text || text.length < 20) return false;

  // 1. 深度关键字探测 (涵盖 JS, Python, SQL, CSS)
  const codePatterns = [
    /(?:function\s+|const\s+|let\s+|class\s+|import\s+|export\s+|=>)/, // JS/TS
    /(?:def\s+\w+\(|if\s+__name__\s*==|import\s+\w+|from\s+\w+\s+import)/, // Python
    /(?:SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+.*\s+SET|CREATE\s+TABLE)/i, // SQL
    /(?:display:\s*flex|position:\s*absolute|@media\s+screen)/, // CSS
    /<\/?(?:div|span|script|style|html)>/i // HTML
  ];

  // 只要命中 1 条强特征正则
  const hasStrongKeywords = codePatterns.some(p => p.test(text));

  // 2. 符号密度分析
  // 代码中这些符号的出现频率远高于自然语言
  const symbols = text.match(/[{}[\]();=<>!&|]/g) || [];
  const symbolDensity = symbols.length / text.length;
  
  // 3. 驼峰/下划线命名法探测 (常见于代码变量)
  const hasCodingVars = /\b[a-z]+[A-Z][a-z]+\b|\b[a-z]+_[a-z]+\b/.test(text);

  return hasStrongKeywords || symbolDensity > 0.07 || (symbolDensity > 0.04 && hasCodingVars);
}

// 🌟🌟🌟 升级版：智能双轨截断 🌟🌟🌟
// 🌟🌟🌟 终极版：基于 Tokenizer 的代码安全截断架构 🌟🌟🌟
function smartExtractForCode(content, keywordQuery, textMaxLength = 150, codeMaxLength = 1500) {
  if (!content) return "";

  // ✅ 直接调用外部函数，而不是在这里重写一遍
  const isNaked = isNakedCode(content);

  const actualTextLimit = isNaked ? codeMaxLength : textMaxLength;

  // 2. Tokenizer 物理隔离处理
  const tokens = content.split(/(```[\s\S]*?```)/g);
  let finalParts = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.trim() === "") continue;

    if (i % 2 === 1) {
      // 🔴 代码块处理：行安全截断
      let block = token;
      if (block.length > codeMaxLength) {
        const half = Math.floor(codeMaxLength / 2);
        // 寻找最近的换行符，确保不切断单行代码
        let startPoint = block.indexOf('\n', half - 50);
        let endPoint = block.lastIndexOf('\n', block.length - half + 50);
        
        if (startPoint === -1) startPoint = half;
        if (endPoint === -1) endPoint = block.length - half;

        block = block.substring(0, startPoint) + 
                "\n\n// ... [Code Snippet Truncated] ...\n\n" + 
                block.substring(endPoint);
      }
      finalParts.push(block);
    } else {
      // 🔵 文本处理：增加清洗逻辑
      let cleanedText = token
        .replace(/!\[.*?\]\(.*?\)/g, "[Image]")
        .replace(/\[(.*?)\]\(.*?\)/g, "$1")
        .replace(/[#*>`~]/g, ""); // 移除 Markdown 装饰符

      let textSnippet = extractSnippet(cleanedText, keywordQuery, actualTextLimit);
      finalParts.push(textSnippet);
    }
  }

  return finalParts.join("\n").trim();
}
// ================= 主函数 ================= 
export async function getRelevantContextHybrid(userInput, currentChatId, excludeIds = [], modelConfig) {
  const finalQuery = userInput.trim();
  const keywordQuery = (finalQuery.match(/[\u4e00-\u9fa5]+|[a-zA-Z0-9+#.-]+/g) || []).join(" ");

  // 并行启动所有检索任务
  const msgVectorLimit = modelConfig?.dbMessageVectorLimit || 500;
  const factVectorLimit = modelConfig?.dbFactVectorLimit || 1000;

  // 并行启动所有检索任务
  const [queryVector, dbRecords, factRecords] = await Promise.all([
    getVectorFromWorker(finalQuery).catch(() => null),
    // 替换这里的 500
    chatDB.queryRecentMessagesWithVectors(currentChatId, msgVectorLimit),
    // 替换这里的 1000
    vectorDB.getRecentVectorsByChatId(currentChatId, factVectorLimit)
  ]);

  const validDbRecords = dbRecords.filter(r => !excludeIds.includes(String(r.id)));

  // 🌟 动态读取：模糊匹配率、向量搜索召回数量、事实召回数量
  const [keywordResults, semanticResults, factSemanticResults] = await Promise.all([
    messageSearcher.search(keywordQuery, { fuzzy: modelConfig?.fuzzyMatchRate || 0.2, prefix: true }),
    queryVector ? searchVectorsInWorker(queryVector, validDbRecords, modelConfig?.vectorSearchLimit || 8) : [],
    queryVector ? searchVectorsInWorker(queryVector, factRecords, modelConfig?.factSearchLimit || 5) : []
  ]);

  // 1. 处理 Long-term Facts (🌟 动态读取事实匹配及格线)
  const factThreshold = modelConfig?.factSimilarityThreshold || 0.82;
  const coreFacts = factSemanticResults
    .filter(res => res.similarity > factThreshold) 
    .map(res => res.textContent.trim());

  // 2. RRF 融合与重排 (🌟 动态传入 RRF 的 K 值常数)
  const rankedResults = reciprocalRankFusion(
    keywordResults.filter(r => !excludeIds.includes(String(r.id))).slice(0, 10),
    semanticResults,
    analyzeQueryIntent(finalQuery),
    modelConfig?.rrfConstantK || 30 // 👈 记得在 hybridSearch.js 里让这个函数接收第四个参数
  );

  // 3. 时间衰减因子计算
  const now = Date.now();
  const decayRate = modelConfig?.timeDecayRate ?? 0.04; // 使用 ?? 允许配置为 0 来关闭衰减
  const finalContextLimit = modelConfig?.finalContextLimit || 5;

  const topUniqueResults = rankedResults
    .map(res => {
      const hoursOld = (now - res.timestamp) / 3600000;
      res.finalScore = res.score * Math.exp(-decayRate * hoursOld); // 🌟 动态衰减系数
      return res;
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, finalContextLimit); // 🌟 动态限制最终进入上下文的数量

  const processedQAPairs = new Set();
  const fillerRegex = /好的[，。]|我们可以看到|总结一下|首先|综上所述/g;
  const minValidLength = modelConfig?.minValidAILength || 10;
  const textLimit = modelConfig?.qaSnippetTextLimit || 150;
  const userCodeLimit = modelConfig?.qaSnippetUserCodeLimit || 600;
  const aiCodeLimit = modelConfig?.qaSnippetAICodeLimit || 1500;
  // 4. 对话对构建 (此处逻辑保持不变)
  const formattedMessages = topUniqueResults.map(res => {
    const idx = dbRecords.findIndex(r => String(r.id) === String(res.id));
    if (idx === -1) return null;

    let q = "", a = "", pairId = "";

    if (res.role === 'user') {
      const nextMsg = dbRecords[idx + 1]; 
      // 🌟 替换长度 10 的硬编码
      if (nextMsg && nextMsg.role === 'assistant' && nextMsg.content.length > minValidLength) {
        pairId = String(res.id);
        // 🌟 替换 150, 600, 1500 的硬编码
        q = smartExtractForCode(res.content, keywordQuery, textLimit, userCodeLimit);
        a = smartExtractForCode(nextMsg.content, keywordQuery, textLimit, aiCodeLimit);
      }
    } else if (res.role === 'assistant') {
      const prevMsg = dbRecords[idx - 1]; 
      if (prevMsg && prevMsg.role === 'user') {
        pairId = String(prevMsg.id);
        // 🌟 同样替换这里的硬编码
        q = smartExtractForCode(prevMsg.content, keywordQuery, textLimit, userCodeLimit);
        a = smartExtractForCode(res.content, keywordQuery, textLimit, aiCodeLimit);
      }
    }

    if (!pairId || processedQAPairs.has(pairId)) return null;
    processedQAPairs.add(pairId);

    const cleanQ = fixSnippetEnding(q.replace(fillerRegex, ''));
    const cleanA = fixSnippetEnding(a.replace(fillerRegex, ''));

    return `[History Q&A]:\nQ: ${cleanQ}\nA: ${cleanA}`;
  }).filter(Boolean);

  // 组装最终上下文
  let finalContext = [];
  if (coreFacts.length > 0) {
    finalContext.push(`[Long-term Facts]\n${coreFacts.map(f => `- ${f}`).join("\n")}`);
  }
  return [...finalContext, ...formattedMessages];
}
/**
 * 后台静默记忆压缩任务 (端侧 RAG 架构版)
 */
export async function runBackgroundMemoryHistory(chatId, summarizedCount, modelConfig) {
  const totalCount = await chatDB.countMessagesByChatId(chatId);
  const noLimit = totalCount - summarizedCount;

  if (noLimit < modelConfig.recentLimit) return;

  // 1. 小压缩步长（唯一变量）
  const batchSize = modelConfig.searchLimit; 
  
  // 🌟 2. 纯公式推导大压缩步长，彻底废弃 config 传参
  const HORIZON = 24; // 人类深度对话的平均视界
  const batchBigSize = Math.max(2, Math.ceil(HORIZON / batchSize));

  try {
    const messagesToCompress = await chatDB.queryMessagesSlice(chatId, summarizedCount, batchSize);
    if (!messagesToCompress || messagesToCompress.length === 0) return;

    const currentChatInfo = await chatDB.queryChatListById(chatId);
    const oldSummary = currentChatInfo?.summary || "";

    // 🌟 3. 状态推导：算出当前是第几次执行
    const currentRunIndex = Math.floor(summarizedCount / batchSize) + 1;

    let finalSummary = "";

    // 🌟 4. 完美触发判定：纯靠算出来的 batchBigSize
    if (currentRunIndex % batchBigSize === 0) {
      console.log(`[Memory] 触发全局压缩 (小步长:${batchSize}, 大步长:${batchBigSize}, 第${currentRunIndex}次)`);
      finalSummary = await runRollingChatSummary(
        messagesToCompress, 
        oldSummary, 
        modelConfig
      );
    } else {
      console.log(`[Memory] 触发增量拼接 (小步长:${batchSize}, 第${currentRunIndex}次)`);
      const currentSegmentSummary = await runRollingChatSummary(
        messagesToCompress, 
        "", 
        modelConfig
      );

      if (!oldSummary) {
        finalSummary = currentSegmentSummary;
      } else {
        finalSummary = `${oldSummary}\n---\n${currentSegmentSummary}`;
      }
    }

    await chatDB.updateChatList(chatId, {
      summary: finalSummary,
      summarizedCount: summarizedCount + messagesToCompress.length, 
    });

  } catch (err) {
    console.error("[Memory] 摘要任务异常:", err);
  }
}

export async function runBackgroundMemoryCompress(chatId, vectorizedCount, modelConfig) {
  const totalCount = await chatDB.countMessagesByChatId(chatId);
  const noLimit = totalCount - vectorizedCount;

  if (noLimit < modelConfig.recentLimit) return;
  const batchSize = modelConfig.searchLimit;

  try {
    const messagesToCompress = await chatDB.queryMessagesSlice(chatId, vectorizedCount, batchSize);
    if (!messagesToCompress || messagesToCompress.length === 0) return;

    // ==========================================
    // 🌟 修复 1：将原始消息的向量化改为“串行执行 (for...of)”
    // 避免瞬间向 Worker 塞入大量任务导致队列末尾的任务超时
    // ==========================================
    for (const msg of messagesToCompress) {
      if (!msg.content || msg.content.trim().length < 2) continue; 
      
      try {
        // 这里的 await 会让下一个循环等待，确保 Worker 算完一条再发下一条
        const vectorData = await getVectorFromWorker(msg.content);
        await chatDB.saveMessageVector(msg.id, vectorData); 
      } catch (err) {
        console.warn(`[Memory] 消息 ${msg.id} 向量化失败:`, err);
      }
    }

    // 提取核心事实
    const newFacts = await extractMemoryFactsWithLLM(messagesToCompress, modelConfig);
    
    if (newFacts && newFacts.length > 0) {
      // ==========================================
      // 🌟 修复 2：将核心事实的向量化也改为“串行执行”
      // ==========================================
      for (const fact of newFacts) {
        if (!fact.textContent || fact.textContent.length < 5) continue;
        
        try {
          const vectorData = await getVectorFromWorker(fact.textContent);
          const factId = `fact_${chatId}_${cyrb53Hash(fact.textContent)}`; 
          
          await vectorDB.saveVector({
            id: factId, 
            chatId: chatId,
            timestamp: Date.now(),
            textContent: fact.textContent,
            vector: vectorData,
          });
        } catch (err) {
          console.warn(`[Memory] 事实向量化失败:`, err);
        }
      }
    }

    // 全部成功后，推进游标
    await chatDB.updateChatList(chatId, {
      vectorizedCount: vectorizedCount + messagesToCompress.length, 
    });

  } catch (err) {
    console.error("[Memory] 向量流水线异常:", err);
  }
}

export async function runEpochMemoryCompression(chatId, epochStartIndex, modelConfig) {
  // 1. 获取从 epochStartIndex 开始到现在的【所有】未压缩对话
  const totalCount = await chatDB.countMessagesByChatId(chatId);
  const uncompressedCount = Math.max(0, totalCount - epochStartIndex);

  if (uncompressedCount === 0) return;

  const newMessages = await chatDB.queryChatMessagesByPage(chatId, epochStartIndex, uncompressedCount);
  
  if (!newMessages || newMessages.length === 0) return;

  // 🌟 粗略估算这批新消息的总字数/Token
  const messagesText = newMessages.map(m => m.content).join('');
  const currentTokens = Math.ceil(messagesText.length * 1); 

  // ==========================================
  // 🌟 核心：双重控制熔断判定 (或逻辑)
  // ==========================================
  const isTurnLimitReached = uncompressedCount >= (modelConfig.cacheMessageLimit || 50);
  const isTokenLimitReached = currentTokens >= (modelConfig.cacheTokenLimit || 20000);

  // 只要没碰线，就绝对不压缩，继续白嫖缓存
  if (!isTurnLimitReached && !isTokenLimitReached) {
    return; 
  }

  console.log(`🔥 [Epoch Compress] 触发纪元大压缩！原因: 轮数超限[${isTurnLimitReached}], 字数超限[${isTokenLimitReached}]`);

  // 2. 获取上一个纪元的大摘要
  const currentChatInfo = await chatDB.queryChatListById(chatId);
  const oldEpochSummary = currentChatInfo?.epochSummary || "";

  try {
    // 3. 调用 AI API 生成 newEpochSummary
    const newEpochSummary = await runEpochMemoryChatEpochSummary(newMessages, oldEpochSummary, modelConfig);

    // 如果生成的摘要有效（且不等于老摘要，说明确实更新了）
    if (newEpochSummary && newEpochSummary !== oldEpochSummary) {
      // 4. 更新数据库专属字段，并将游标推到最新！
      const nextStartIndex = epochStartIndex + newMessages.length;
      
      await chatDB.updateChatList(chatId, {
        epochSummary: newEpochSummary,
        epochStartIndex: nextStartIndex // 游标推移，下一轮追加从这里开始
      });
      
      console.log(`✅ [Epoch Compress] 压缩完成！新游标已移动至: ${nextStartIndex}`);
    } else {
       console.log(`⚠️ [Epoch Compress] 压缩返回为空或未改变，游标未推进。`);
    }
  } catch (error) {
    console.error("纪元大压缩执行失败:", error);
  }
}
// 🌟 辅助工具：一个极简的高性能字符串 Hash 算法（用于生成唯一的文本指纹）
// 放在 utils 文件里即可
function cyrb53Hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0).toString(36);
}