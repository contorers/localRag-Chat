import MiniSearch from "minisearch";
import {
  extractMemoryFactsWithLLM,
  runRollingChatSummary,
  runEpochMemoryChatEpochSummary
} from "./llmService.js";
import{aiDatabase} from "../../rustservice/aiDatabase.js";
import {
  analyzeQueryIntent,
  reciprocalRankFusion,
} from "../AI-Chat/hybridSearch.js";
import {
  getVectorFromWorker,
  searchVectorsInWorker,
} from "../AI-Chat/workerClient.js";

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
  const chatLists = await aiDatabase.queryChatListByModelId(modelId);

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
  const allMessages = await aiDatabase.queryChatIdsMessages(chatIds, 100);

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
    const messages = await aiDatabase.queryChatMessages(currentChatId,0,10000);

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
export function buildShortTermContext(recentHistory, maxMessages = 32) {
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

// 🌟🌟🌟 终极版：基于 Tokenizer 的代码安全截断架构 🌟🌟🌟
function smartExtractForCode(content) {
  if (!content) return "";

  // 先还原转义换行符
  const normalizedContent = content.replace(/\\n/g, "\n");

  // 过滤非必要块：mermaid、svg、latex 等可视化/标记语言
  const SKIP_LANGS = /^(mermaid|svg|latex|tex|plantuml|dot|drawio)\s*/i;

  const tokens = normalizedContent.split(/(```[\s\S]*?```)/g);
  let finalParts = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.trim() === "") continue;

    if (i % 2 === 1) {
      // 🔴 代码块
      const langLine = token.replace(/^```/, "").split("\n")[0];
      if (SKIP_LANGS.test(langLine)) {
        // 跳过非必要可视化块，替换为占位
        finalParts.push("[图表已省略]");
      } else {
        // 普通代码块完整保留
        finalParts.push(token);
      }
    } else {
      // 🔵 文本：压缩空白和 Markdown 装饰符
      let cleanedText = token
      .replace(/!\[.*?\]\(.*?\)/g, "[Image]")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/[#*>`~]/g, "")
      .replace(/^\|.*\|$/gm, "")              // 删除整行表格行（| cell | cell |）
      .replace(/^\s*[-|]+\s*$/gm, "")         // 删除表格分隔线（|---|---|）
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim();

      if (cleanedText) {
        finalParts.push(cleanedText);
      }
    }
  }

  console.log(finalParts);
  return finalParts.join("\n").trim();
}

// ================= 主函数 ================= 
export async function getRelevantContextAllHybrid(userInput, currentChatId, excludeIds = [], modelConfig) {
  const excludeIdSet = new Set(excludeIds.map(String));
  const finalQuery = userInput.trim();
  const keywordQuery = (finalQuery.match(/[\u4e00-\u9fa5]+|[a-zA-Z0-9+#.-]+/g) || []).join(" ");

  const queryVector = await getVectorFromWorker(finalQuery).catch(() => null);

  const chatList = await aiDatabase.queryChatList(Number.MAX_SAFE_INTEGER, 1000);
  const allChatIds = chatList.map(item => item.id);

  const CHUNK_SIZE = 20;
  const vectorSearchLimit = modelConfig?.vectorSearchLimit || 8;
  
  let globalSemanticResults = [];
  let allFactRecords = [];

  if (queryVector) {
    for (let i = 0; i < allChatIds.length; i += CHUNK_SIZE) {
      const chunkIds = allChatIds.slice(i, i + CHUNK_SIZE);
      
      const chunkRecords = await aiDatabase.queryChatIdsMessages(chunkIds, 1000);
      const validChunkRecords = chunkRecords.filter(r => !excludeIdSet.has(String(r.id)));

      const chunkResults = await searchVectorsInWorker(queryVector, validChunkRecords, vectorSearchLimit);

      globalSemanticResults = [...globalSemanticResults, ...chunkResults]
        .filter(r => r.similarity >= 0.6)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, vectorSearchLimit);

      if (chunkIds.includes(currentChatId)) {
        const facts = await aiDatabase.getRecentVectorsByChatId(currentChatId, modelConfig?.dbFactVectorLimit || 1000);
        const factsOld = await aiDatabase.getRecentVectors(modelConfig?.dbFactVectorLimit || 20000);
        
        const existIds = new Set(facts.map(item => item.id));
        const uniqueFactsOld = factsOld.filter(item => !existIds.has(item.id));
        allFactRecords.push(...facts, ...uniqueFactsOld); 
      }

      chunkRecords.length = 0; 
    }
  }

  const [keywordResults, factSemanticResults] = await Promise.all([
    messageSearcher.search(keywordQuery, { fuzzy: modelConfig?.fuzzyMatchRate || 0.2, prefix: true }),
    queryVector && allFactRecords.length > 0 
      ? searchVectorsInWorker(queryVector, allFactRecords, modelConfig?.factSearchLimit || 5) 
      : Promise.resolve([])
  ]);

  const factThreshold = modelConfig?.factSimilarityThreshold || 0.82;
  const coreFacts = factSemanticResults
    .filter(res => res.similarity > factThreshold) 
    .map(res => res.textContent?.trim() || "");

  const rankedResults = reciprocalRankFusion(
    keywordResults.filter(r => !excludeIdSet.has(String(r.id))).slice(0, 10),
    globalSemanticResults, 
    analyzeQueryIntent(finalQuery),
    modelConfig?.rrfConstantK || 30 
  );

  const candidateIds = rankedResults.map(r => r.id);
  const candidateMessages = await aiDatabase.queryMessagesByIds(candidateIds); 

  const now = Date.now();
  const decayRate = modelConfig?.timeDecayRate ?? 0.04; 
  const finalContextLimit = modelConfig?.finalContextLimit || 5;

  const topUniqueResults = rankedResults
    .map(res => {
      const meta = candidateMessages.find(m => String(m.id) === String(res.id)) || {};
      const msgTimestamp = meta.timestamp || now;
      
      const hoursOld = (now - msgTimestamp) / 3600000;
      res.finalScore = res.score * Math.exp(-decayRate * hoursOld);
      
      res.chatId = meta.chatId;
      res.role = meta.role;
      res.content = meta.content;
      return res;
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, finalContextLimit); 

  const topChatIds = [...new Set(topUniqueResults.map(r => r.chatId).filter(Boolean))];
  
  const targetChatsRecords = await aiDatabase.queryChatIdsMessages(topChatIds, 1000);
  const filteredTargetRecords = targetChatsRecords.filter(r => !excludeIdSet.has(String(r.id)));

  const processedQAPairs = new Set();
  const fillerRegex = /好的[，。]|我们可以看到|总结一下|首先|综上所述/g;
  const minValidLength = modelConfig?.minValidAILength || 10;
  const textLimit = modelConfig?.qaSnippetTextLimit || 150;
  const userCodeLimit = modelConfig?.qaSnippetUserCodeLimit || 600;
  const aiCodeLimit = modelConfig?.qaSnippetAICodeLimit || 1500;

  const formattedMessages = topUniqueResults.map(res => {
    const chatTimeline = filteredTargetRecords
      .filter(m => m.chatId === res.chatId)
      .sort((a, b) => a.id - b.id);

    const localIdx = chatTimeline.findIndex(r => String(r.id) === String(res.id));
    if (localIdx === -1) return null;

    let q = "", a = "", pairId = "";

    if (res.role === 'user') {
      const nextMsg = chatTimeline[localIdx + 1]; 
      if (nextMsg && nextMsg.role === 'assistant' && nextMsg.content?.length > minValidLength) {
        pairId = String(res.id);
        q = smartExtractForCode(res.content);
        a = smartExtractForCode(nextMsg.content);
      }
    } else if (res.role === 'assistant') {
      const prevMsg = chatTimeline[localIdx - 1]; 
      if (prevMsg && prevMsg.role === 'user') {
        pairId = String(prevMsg.id);
        q = smartExtractForCode(prevMsg.content);
        a = smartExtractForCode(res.content);
      }
    }

    if (!pairId || processedQAPairs.has(pairId)) return null;
    processedQAPairs.add(pairId);

    return `[History Q&A]:\nQ: ${q}\nA: ${a}`;
  }).filter(Boolean);

  const finalContext = [];
  if (coreFacts.length > 0) {
    finalContext.push(`[Long-term Facts]\n${coreFacts.map(f => `- ${f}`).join("\n")}`);
  }

  return {
    facts: finalContext,
    qaContext: formattedMessages,
  };
}


// 🌟 新增：专门为 LLM 摘要准备的轻量降噪函数
const cleanForLLMSummary = (text) => {
  if (!text) return "";
  return text
    // 1. 拦截大杀器：清理 Base64 图片或巨长 URL，只保留提示
    .replace(/!\[.*?\]\(.*?\)/g, "[图片/文件]") 
    // 2. 清理纯粹为了 UI 排版的无意义表格分隔线
    .replace(/^\s*[-|]+\s*$/gm, "") 
    // 3. 压缩超过 3 个的连续换行（避免 Token 浪费）
    .replace(/\n{3,}/g, "\n\n") 
    // 4. 压缩连续的空格和制表符
    .replace(/[ \t]+/g, " ") 
    .trim();
};
/**
 * 后台静默记忆压缩任务 (端侧 RAG 架构版)
 */
export async function runBackgroundMemoryHistory(chatId, summarizedCount, modelConfig) {
  const totalCount = await aiDatabase.countMessagesByChatId(chatId);
  const noLimit = totalCount - summarizedCount;

  if (noLimit < modelConfig.recentLimit) return;

  const batchSize = modelConfig.searchLimit; 
  const HORIZON = 24; 
  const batchBigSize = Math.max(2, Math.ceil(HORIZON / batchSize));

  try {
    let messagesToCompress = await aiDatabase.queryMessagesSlice(chatId, summarizedCount, batchSize);
    if (!messagesToCompress || messagesToCompress.length === 0) return;

    // 🌟 在这里进行清洗！遍历清洗每一条消息的内容
    messagesToCompress = messagesToCompress.map(msg => ({
      ...msg,
      content: cleanForLLMSummary(msg.content) 
    }));

    const currentChatInfo = await aiDatabase.queryChatListById(chatId);
    const oldSummary = currentChatInfo?.summary || "";

    const currentRunIndex = Math.floor(summarizedCount / batchSize) + 1;
    let finalSummary = "";

    if (currentRunIndex % batchBigSize === 0) {
      console.log(`[Memory] 触发全局压缩...`);
      finalSummary = await runRollingChatSummary(messagesToCompress, oldSummary, modelConfig);
    } else {
      console.log(`[Memory] 触发增量拼接...`);
      const currentSegmentSummary = await runRollingChatSummary(messagesToCompress, "", modelConfig);
      
      if (!oldSummary) {
        finalSummary = currentSegmentSummary;
      } else {
        finalSummary = `${oldSummary}\n---\n${currentSegmentSummary}`;
      }
    }

    await aiDatabase.updateChatList(chatId, {
      summary: finalSummary,
      summarizedCount: summarizedCount + messagesToCompress.length, 
    });

  } catch (err) {
    console.error("[Memory] 摘要任务异常:", err);
  }
}

export async function runBackgroundMemoryFacts(chatId, vectorizedCount, modelConfig) {
  const totalCount = await aiDatabase.countMessagesByChatId(chatId);
  const noLimit = totalCount - vectorizedCount;

  if (noLimit < modelConfig.recentLimit) return;
  const batchSize = modelConfig.searchLimit;

  try {
    const messagesToCompress = await aiDatabase.queryMessagesSlice(chatId, vectorizedCount, batchSize);
    if (!messagesToCompress || messagesToCompress.length === 0) return;

    const cleanedMessages = messagesToCompress.map(msg => ({
      ...msg,
      content: cleanForLLMSummary(msg.content)
    }));

    // 🌟 修复 1：串行执行原始消息向量化
    for (const msg of cleanedMessages) {
      if (!msg.content || msg.content.trim().length < 2) continue; 
      
      try {
        // 这里的 await 会让下一个循环等待，确保 Worker 算完一条再发下一条
        const vectorData = await getVectorFromWorker(msg.content);
        const vectorArray = Array.from(vectorData);
        await aiDatabase.saveMessageVector(msg.id, vectorArray); 
      } catch (err) {
        console.warn(`[Memory] 消息 ${msg.id} 向量化失败:`, err);
      }
    }

    // 提取核心事实
    const newFacts = await extractMemoryFactsWithLLM(cleanedMessages, modelConfig);
    
    if (newFacts && newFacts.length > 0) {
      const factsToSave = [];

      for (const fact of newFacts) {
        // ==========================================
        // 🌟 极致清理事实输出：剥离所有非文本字符
        // 确保进向量数据库的纯粹是“事实”本身
        // ==========================================
        const pureFactText = fact.textContent
          .replace(/[\*\-\#\`]/g, "") // 强行剥离 Markdown 列表符和强调符
          .replace(/\p{Extended_Pictographic}/gu, "") // 强行剥离 Emoji
          .trim();

        if (!pureFactText || pureFactText.length < 5) continue;
        
        try {
          // 对极致纯净的事实进行向量化
          const vectorData = await getVectorFromWorker(pureFactText);
          const factId = cyrb64HashToInt(pureFactText);
          
          factsToSave.push({
            id: factId, 
            chatId: chatId,
            timestamp: Date.now(),
            textContent: pureFactText, // 保存纯净版
            vector: Array.from(vectorData),
          });
        } catch (err) {
          console.warn(`[Memory] 事实向量计算失败，已跳过:`, err);
        }
      }

     // 🌟 3. 循环结束，拿着整个数组调用刚刚写好的批量事务接口
     if (factsToSave.length > 0) {
       try {
         await aiDatabase.saveVectorsBatch(factsToSave);
       } catch (err) {
         console.error(`[Memory] 事实批量落库失败:`, err);
       }
     }
    }

    // 全部成功后，推进游标
    await aiDatabase.updateChatList(chatId, {
      vectorizedCount: vectorizedCount + cleanedMessages.length, 
    });

  } catch (err) {
    console.error("[Memory] 向量流水线异常:", err);
  }
}

export async function runEpochMemoryCompression(chatId, epochStartIndex, modelConfig) {
  // 1. 获取从 epochStartIndex 开始到现在的【所有】未压缩对话
  const totalCount = await aiDatabase.countMessagesByChatId(chatId);
  const uncompressedCount = Math.max(0, totalCount - epochStartIndex);

  if (uncompressedCount === 0) return;

  const newMessages = await aiDatabase.queryChatMessages(chatId, Number.MAX_SAFE_INTEGER, uncompressedCount);
  
  if (!newMessages || newMessages.length === 0) return;

  // ==========================================
  // 🌟 核心改动 1：在这里构建一份“专用于总结的清洗版消息”
  // ==========================================
  // 绝对不要去修改数据库里的原始 newMessages，我们在内存里 map 出一份新的
  const cleanedMessagesForSummary = newMessages.map(m => ({
    ...m,
    // 这里调用我们之前讨论的加强版过滤函数
    content: cleanForLLMSummary(m.content) 
  }));

  // 🌟 粗略估算这批新消息的总字数/Token
  const messagesText = cleanedMessagesForSummary.map(m => m.content).join('');
  const currentTokens = Math.ceil(messagesText.length * 1); 

  // ==========================================
  // 🌟 核心：双重控制熔断判定 (或逻辑)
  // ==========================================
  const isTurnLimitReached = uncompressedCount >= (modelConfig.cacheMessageLimit);
  const isTokenLimitReached = currentTokens >= (modelConfig.cacheTokenLimit );

  // 只要没碰线，就绝对不压缩，继续白嫖缓存
  if (!isTurnLimitReached && !isTokenLimitReached) {
    return; 
  }

  console.log(`🔥 [Epoch Compress] 触发纪元大压缩！原因: 轮数超限[${isTurnLimitReached}], 字数超限[${isTokenLimitReached}]`);

  // 2. 获取上一个纪元的大摘要
  const currentChatInfo = await aiDatabase.queryChatListById(chatId);
  const oldEpochSummary = currentChatInfo?.epochSummary || "";

  try {
    // 3. 调用 AI API 生成 newEpochSummary
    // ==========================================
    // 🌟 核心改动 2：将清洗后的数组丢给大模型做总结！
    // ==========================================
    const newEpochSummary = await runEpochMemoryChatEpochSummary(cleanedMessagesForSummary, oldEpochSummary, modelConfig);

    // 如果生成的摘要有效（且不等于老摘要，说明确实更新了）
    if (newEpochSummary && newEpochSummary !== oldEpochSummary) {
      // 4. 更新数据库专属字段，并将游标推到最新！
      const nextStartIndex = epochStartIndex + newMessages.length;
      
      await aiDatabase.updateChatList(chatId, {
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
function cyrb64HashToInt(str, seed = 0) {
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

  // ✅ 正确写法：整体作为数字返回
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  //     ↑ 高21位                      ↑ 低32位
  //     合计53位整数
}
