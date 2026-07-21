// src/service/aiUserService.js
import { embeddingService } from "../embedding/embeddingService.js";
import { chatUserAIApi } from "../api/ai.js";
import { aiDatabase } from "../rustservice/aiDatabase.js";
import {
  shouldTriggerRAG,
  sanitizePrivacyInfo,
} from "../embedding/routerRules.js";

// 用于记录正在进行后台压缩任务的会话 ID，防止重复触发
const compressingChats = new Set();

// 图片 Base64 内存缓存池（存储已压缩好的 Base64 字符串）
const imageBase64Cache = new Map();
const MAX_CACHE_SIZE = 50; // 最大缓存 50 张压缩后的图片，约占用 5-10MB 内存

/**
 * 获取并压缩历史图片 (带 LRU 缓存)
 * 只要 filePath 相同，第二次请求将 0 下载、0 压缩、0 延迟直接返回
 */
async function getCachedCompressedImage(filePath) {
  if (imageBase64Cache.has(filePath)) {
    const cachedStr = imageBase64Cache.get(filePath);
    imageBase64Cache.delete(filePath);
    imageBase64Cache.set(filePath, cachedStr);
    return cachedStr;
  }

  const res = await fetch(filePath);
  if (!res.ok) throw new Error(`读取历史图片失败: ${res.status}`);
  
  // 先转成 ArrayBuffer，方便我们嗅探数据类型
  const buffer = await res.arrayBuffer();
  let originalBlob;

  // 👇 核心修复 1：检测后端是否返回了 JSON 数组（因为你存库时用了 Array.from）
  const uint8View = new Uint8Array(buffer);
  if (uint8View.length > 0 && uint8View[0] === 91) { // 91 是 '[' 的 ASCII 码
    try {
      // 如果是 JSON 数组字符串，把它解析回真正的图片字节流！
      const text = new TextDecoder().decode(uint8View);
      const arr = JSON.parse(text);
      originalBlob = new Blob([new Uint8Array(arr)], { type: "image/jpeg" });
    } catch(e) {
      originalBlob = new Blob([buffer]);
    }
  } else {
    originalBlob = new Blob([buffer]);
  }

  let base64Str = "";
  try {
    // 尝试压缩
    const compressedBytes = await compressImage(originalBlob);
    base64Str = await fileToBase64(new Blob([compressedBytes], { type: "image/jpeg" }));
  } catch (e) {
    // 👇 核心修复 2：压缩降级！如果解析失败，放弃压缩，直接将原图转 Base64 发给大模型！
    console.warn(`历史图片压缩失败，降级使用原图发包:`, e);
    base64Str = await fileToBase64(originalBlob);
  }

  if (imageBase64Cache.size >= MAX_CACHE_SIZE) {
    const firstKey = imageBase64Cache.keys().next().value;
    imageBase64Cache.delete(firstKey);
  }
  imageBase64Cache.set(filePath, base64Str);

  return base64Str;
}
// ==========================================
// 🌟 辅助工具函数
// ==========================================

/**
 * 将图片/Blob 转换为 Base64 (Data URL)
 * @param {File|Blob} file 
 * @returns {Promise<string>}
 */
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
};

/**
 * 提取纯文本文件的内容 (txt, md, csv 等)
 * @param {File} file 
 * @returns {Promise<string>}
 */
const readTextFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsText(file, "UTF-8");
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
};

/**
 * 压缩图片，返回 Uint8Array 格式（支持设定最大尺寸和质量）
 * @param {File} file 
 * @param {number} maxSize 最大边长
 * @param {number} quality 压缩质量 (0-1)
 * @returns {Promise<Uint8Array>}
 */
// 压缩图片，返回 Uint8Array
async function compressImage(file, maxSize = 1024, quality = 0.8) {
  // 👇 1. 记得接收 reject 参数
  return new Promise((resolve, reject) => { 
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext("2d");
      
      // 修复透明 PNG 变黑的问题
      ctx.fillStyle = "#ffffff"; 
      ctx.fillRect(0, 0, width, height);
      
      ctx.drawImage(img, 0, 0, width, height);
      
      URL.revokeObjectURL(url);
      
      canvas.toBlob(
        (blob) => {
          blob.arrayBuffer().then((buffer) => {
            resolve(new Uint8Array(buffer));
          });
        },
        "image/jpeg", 
        quality
      );
    };

    // 👇 2. 核心补漏：处理图片加载失败的情况，防止卡死
    img.onerror = (error) => {
      URL.revokeObjectURL(url); // 及时释放内存
      reject(new Error("图片解析失败，可能文件已损坏"));
    };
    
    img.src = url;
  });
}

/**
 * 独立封装：统一处理消息中的图片 URL，将其转为大模型所需的多模态格式
 */
/**
 * 核心方法：专门处理并压缩上下文中的多模态数据
 */
async function formatMessageWithImages(msg) {
  const imageContents = [];
  let finalContentText = "";

  // ====================================================================
  // 🟢 第一种情况 (大模型回复)：内存中活跃的大模型回复，包含 HTTPS 图片路径
  // ====================================================================
  if (typeof msg.content === "string") {
    // 正则提取大模型生成的 Markdown 图片: ![alt](https://...)
    const mdImageRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
    let match;
    
    while ((match = mdImageRegex.exec(msg.content)) !== null) {
      const imgUrl = match[1];
      try {
        // 下载该 HTTPS 图片并执行 Canvas 压缩
        const base64Str = await getCachedCompressedImage(imgUrl);
        imageContents.push({ type: "image_url", image_url: { url: base64Str } });
      } catch (err) {
        console.error(`大模型 HTTPS 图片压缩失败 [${imgUrl}]:`, err);
      }
    }
    // 将冗长的临时链接从文本中剔除，留下纯文字发给大模型
    finalContentText = msg.content.replace(mdImageRegex, "").trim();
  } else if (Array.isArray(msg.content)) {
    // 防套娃兜底：提取已有文本
    msg.content.forEach(item => {
      if (item.type === "text") {
        finalContentText += (finalContentText ? "\n" : "") + item.text;
      } else if (item.type === "image_url") {
        imageContents.push(item);
      }
    });
  }

  // ====================================================================
  // 🟢 🟢 第一种情况 (用户发送) & 第二种情况 (切换聊天) 
  // 对应: 内存中的原生 File 对象 OR 本地持久化后加载的 URL 路径
  // ====================================================================
  if (msg.file && Array.isArray(msg.file)) {
    for (const fileItem of msg.file) {
      if (!fileItem) continue;

      try {
        let base64Str = "";
        
        // 提取真正的 File 对象 (兼容前端 Proxy 包裹的情况)
        let actualFile = fileItem.file instanceof File || fileItem.file instanceof Blob 
          ? fileItem.file 
          : fileItem;

        // 【第一种情况：用户刚发送】内存中的原生 File / Blob 数据
        if (actualFile instanceof File || actualFile instanceof Blob) {
          // 如果确定不是图片(如 txt/md)，跳过不压
          if (actualFile.type && !actualFile.type.startsWith("image/")) continue;
          
          try {
            const compressedBytes = await compressImage(actualFile);
            base64Str = await fileToBase64(new Blob([compressedBytes], { type: "image/jpeg" }));
          } catch (err) {
            // 👇 核心修复 3：新发送的图片如果格式特殊压不动，也降级发原图！
            console.warn("当前图片压缩失败，降级使用原图发包:", err);
            base64Str = await fileToBase64(actualFile);
          }
        }
        // 【第二种情况：切换聊天】本地读取到的路径 URL
        else if (typeof fileItem === "string") {
          // 本地 URL：执行下载并 Canvas 压缩
          base64Str = await getCachedCompressedImage(fileItem);
        }

        if (base64Str) {
          imageContents.push({ type: "image_url", image_url: { url: base64Str } });
        }
      } catch (err) {
        console.error("file 字段图片压缩失败:", err);
      }
    }
  }

  // ====================================================================
  // 组装标准 Payload (发给大模型)
  // ====================================================================
  if (imageContents.length === 0) {
    msg.content = finalContentText;
  } else {
    const textContents = finalContentText ? [{ type: "text", text: finalContentText }] : [];
    msg.content = [...textContents, ...imageContents];
  }

  // 用完清理，保证 API 字段干净
  delete msg.file;
}

// ==========================================
// 🌟 核心 AI 用户服务层
// ==========================================
export const AIUserService = {
  /**
   * 核心发送消息逻辑
   */
  async sendAIMessage({
    text: rawText,
    files = [], // 接收从前端传来的 file 数组
    chatId,
    model,      // 包含高级参数、baseUrl, path, modelType 等
    signal,
    tempMessages = [],
    onChatCreated,
    onContextAssembled,
    onStreamContent,
    onStreamReasoning,
    onStreamFinish,
    onError,
  }) {
    let fullContent = "";
    let fullReasoning = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let apiMessages = [];
console.log(tempMessages)
    // ==========================================
    // 🌟 阶段 0：处理附件 (图片转 Base64，文档提纯文本)
    // ==========================================
    let finalRawText = rawText || "";
    const localImageBytes = [];  // 存原始字节，传给 Rust 保存
    const localImageBase64 = []; // 存 Base64，用于传给 AI

    if (files && files.length > 0) {
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          // 👇 1. 获取并保存【真正】的原始图片字节流，传给 Rust
          const originalBuffer = await file.arrayBuffer();
          localImageBytes.push(Array.from(new Uint8Array(originalBuffer)));
          
          // 👇 2. 压缩图片，仅用于生成发给 AI 的 Base64
          const compressed = await compressImage(file);
          const base64Str = await fileToBase64(
            new Blob([compressed], { type: "image/jpeg" })
          );
          localImageBase64.push(base64Str);
        } else {
          try {
            const fileContent = await readTextFile(file);
            finalRawText += `\n\n--- 附件 [${file.name}] 内容 ---\n${fileContent}\n--- 附件结束 ---`;
          } catch (e) {
            console.warn(`无法读取文件 ${file.name}:`, e);
          }
        }
      }
    }

    const text = sanitizePrivacyInfo(finalRawText);

    let currentChatId = chatId;
    let userMsgId = null;
    const isNewChat = !chatId;

    const estimateTokens = (textStr) => (textStr ? Math.ceil(textStr.length * 1) : 0);

    try {
      // ==========================================
      // 🌟 阶段 1：初始化系统配置与会话
      // ==========================================
      // 获取全局系统配置 (提供基础兜底)
      const globalSettings = (await aiDatabase.getSystemSettings(0).catch(() => ({ }))) || {};

      // 终极融合：全局配置垫底，用户传入的模型专属配置覆盖
      const mergedModelConfig = {
        ...globalSettings,
        ...model,
      };

      const isStream = mergedModelConfig.modelType === "text" || !mergedModelConfig.modelType;

      // 如果没有 ChatId，则创建新会话
      if (!currentChatId) {
        const titleLen = mergedModelConfig?.chatTitleMaxLength || 15;
        const safeTitle = text.trim() ? text.slice(0, titleLen) : "[多模态图片对话]";

        currentChatId = await aiDatabase.addChatList({
          title: safeTitle,
          modelId: mergedModelConfig.modelId,
          timestamp: Date.now(),
        });
        if (onChatCreated) onChatCreated(currentChatId);
      }

      // ==========================================
      // 🌟 阶段 2：用户消息落库与组装上下文
      // ==========================================
      userMsgId = await aiDatabase.addChatMessages({
        chatId: currentChatId,
        role: "user",
        content: text || "",
        timestamp: Date.now(),
        localImages: localImageBytes.length > 0 ? localImageBytes : null,
      });

      apiMessages = await this._assembleContext({
        text: text || "请分析我发送的图片",
        currentChatId,
        userMsgId,
        tempMessages,
        modelConfig: mergedModelConfig,
      });
      console.log(apiMessages)
      // ==========================================
      // 🌟 阶段 2.5：处理上下文中的多模态图片资源
      // ==========================================
      for (let msg of apiMessages) {
        await formatMessageWithImages(msg);
      }
       
      apiMessages = apiMessages.map(({ file, ...rest }) => rest);
 
      // 将当次上传的图片附加到最新的用户消息中
      if (localImageBase64.length > 0) {
        let lastUserMsgIndex = -1;
        for (let i = apiMessages.length - 1; i >= 0; i--) {
          if (apiMessages[i].role === "user") {
            lastUserMsgIndex = i;
            break;
          }
        }

        if (lastUserMsgIndex !== -1) {
          const originalText = apiMessages[lastUserMsgIndex].content;
          const multiModalContent = [];

          if (originalText) {
            multiModalContent.push({ type: "text", text: originalText });
          }

          for (const base64Str of localImageBase64) {
            multiModalContent.push({
              type: "image_url",
              image_url: { url: base64Str },
            });
          }
          apiMessages[lastUserMsgIndex].content = multiModalContent;
        }
      }

      if (onContextAssembled && isStream) {
        onContextAssembled(
          typeof apiMessages[apiMessages.length - 1].content === "string"
            ? apiMessages.map((m) => m.content).join("\n")
            : "[多模态内容]"
        );
      }

      // ==========================================
      // 🌟 阶段 3：根据多模态类型动态组装 Payload
      // ==========================================
      const payload = {
        model: model.name,
      };

      if (isStream) {
        payload.stream = true;
        payload.messages = apiMessages;

        if (mergedModelConfig.customParams?.length > 0) {
          mergedModelConfig.customParams.forEach((param) => {
            if (param.key) payload[param.key] = param.value;
          });
        }
        if (mergedModelConfig.enableThinking) {
          payload.reasoning_effort = mergedModelConfig.reasoningEffort || "medium";
        }
      } else if (mergedModelConfig.modelType === "image") {
        // 1. 判断发送的是 prompt 还是 input (大部分生图/音频用 prompt，向量通常用 input)
        if (mergedModelConfig.modelType === "embedding") {
          payload.input = text;
        } else {
          payload.prompt = text;
        }

        // 2. 增加判断：如果是 image，专门塞入 b64_json
        if (mergedModelConfig.modelType === "image") {
          payload.response_format = "b64_json";
        }
        
        //增加判断：比如未来如果是音频，可以在这继续加 if
        if (mergedModelConfig.modelType === "video") {
          payload.voice = "alloy";
        }

        if (mergedModelConfig.customParams?.length > 0) {
          mergedModelConfig.customParams.forEach((param) => {
            if (param.key) payload[param.key] = param.value;
          });
        }
      }
   
      // ==========================================
      // 🌟 阶段 4：API 直连与请求发送
      // ==========================================
      const response = await chatUserAIApi(
        model.baseUrl,
        payload,
        signal,
        model.apiKey
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorJson;
        try {
          errorJson = JSON.parse(errorText);
        } catch (e) {}
        throw new Error(errorJson?.error?.message || `API 错误 (${response.status})`);
      }

      // ==========================================
      // 🌟 阶段 5：解析响应 (流式与 JSON 分流)
      // ==========================================
      if (isStream) {
        const streamResult = await this._processStream(response.body, {
          onStreamReasoning,
          onStreamContent,
        });

        fullContent = streamResult.fullContent;
        fullReasoning = streamResult.fullReasoning;
        inputTokens = streamResult.inputTokens || estimateTokens(JSON.stringify(apiMessages));
        outputTokens = streamResult.outputTokens || estimateTokens(fullContent + fullReasoning);
      } else if (mergedModelConfig.modelType === "image") {
        // 图像模型处理
        const jsonResult = await response.json();
        const dataObj = jsonResult.data?.[0];
        if (!dataObj) throw new Error("API 未返回有效的图片内容");

        let finalImageStr = "";
        if (dataObj.b64_json) {
          finalImageStr = `data:image/png;base64,${dataObj.b64_json}`;
        } else if (dataObj.url) {
          finalImageStr = dataObj.url;
        } else {
          throw new Error("API 未返回图片的 URL 或 Base64");
        }

        fullContent = `![Generated Image](${finalImageStr})`;
        if (onStreamContent) onStreamContent(fullContent);

        inputTokens = estimateTokens(text);
        outputTokens = 1;
      }

      const finalTokenStr = `[ 输入: ${inputTokens} | 输出: ${outputTokens} | 总计: ${inputTokens + outputTokens} ]`;

      // ==========================================
      // 🌟 阶段 6：收尾与后台处理
      // ==========================================
      let finalSavedContent = fullContent.trim();

      // AI 响应存入数据库
      await aiDatabase.addChatMessages({
        chatId: currentChatId,
        role: "assistant",
        content: finalSavedContent,
        reasoning: fullReasoning,
        token: finalTokenStr,
        timestamp: Date.now(),
      });

      // 文本模型触发后台记忆压缩调度
      if (isStream) {
        this._triggerBackgroundCompression(currentChatId, mergedModelConfig).catch((e) =>
          console.error(e)
        );
      }

      onStreamFinish?.(finalTokenStr, { inputTokens, outputTokens });

    } catch (error) {
      this._handleError(error, {
        userMsgId,
        isNewChat,
        currentChatId,
        onError,
        onStreamFinish,
        apiMessages,
        fullContent,
        fullReasoning,
        inputTokens,
        outputTokens,
        estimateTokens,
      });
    }
  },

  // ============================================================================
  // 👇 内部辅助方法
  // ============================================================================

  /**
   * 处理 SSE 数据流解析
   */
  async _processStream(body, { onStreamReasoning, onStreamContent }) {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let isProperlyFinished = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let fullContent = "";
    let fullReasoning = "";
    // 过滤零宽字符，防止解析异常
    const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u200E\u200F]/g;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          isProperlyFinished = true;
          break;
        }

        buffer += decoder
          .decode(value, { stream: true })
          .replace(ZERO_WIDTH_REGEX, "");

        let eventEnd;
        while ((eventEnd = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);

          for (let line of rawEvent.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const dataStr = line.slice(6).trim();

            if (dataStr === "[DONE]") {
              isProperlyFinished = true;
              continue;
            }

            try {
              const dataObj = JSON.parse(dataStr);
              if (dataObj.usage) {
                inputTokens = dataObj.usage.prompt_tokens || inputTokens;
                outputTokens = dataObj.usage.completion_tokens || outputTokens;
              }

              const delta = dataObj.choices?.[0]?.delta;
              if (delta) {
                if (delta.reasoning_content) {
                  fullReasoning += delta.reasoning_content;
                  onStreamReasoning?.(delta.reasoning_content);
                }
                if (delta.content) {
                  fullContent += delta.content;
                  onStreamContent?.(delta.content);
                }
              }
            } catch (e) {
              // 忽略当前分块解析错误，继续处理下一个 chunk
            }
          }
        }
      }

      if (!isProperlyFinished && !fullContent && !fullReasoning) {
        throw new Error("Stream closed unexpectedly");
      }
      return { inputTokens, outputTokens, fullContent, fullReasoning };
    } catch (error) {
      throw error;
    } finally {
      reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  },

  /**
   * 统一错误与中断处理
   */
  async _handleError(error, ctx) {
    const isAbort =
      error.name === "AbortError" ||
      error.message === "abort" ||
      error.message.includes("Unexpected");

    if (isAbort) {
      if (ctx.fullContent || ctx.fullReasoning) {
        const partialTokenStr = `[ 中断 | 输入: ${ctx.inputTokens} | 输出: ${ctx.outputTokens} ]`;
        await aiDatabase.addChatMessages({
          chatId: ctx.currentChatId,
          role: "assistant",
          content: ctx.fullContent.trim() || "[内容生成被中断]",
          reasoning: ctx.fullReasoning,
          token: partialTokenStr,
          timestamp: Date.now(),
        });
        ctx.onStreamFinish?.(partialTokenStr, {
          inputTokens: ctx.inputTokens,
          outputTokens: ctx.outputTokens,
        });
      } else {
        ctx.onStreamFinish?.("[ 已取消 ]", { inputTokens: 0, outputTokens: 0 });
      }
    } else {
      const finalTokenStr = `[ 出错: ${error.message} ]`;
      ctx.onStreamFinish?.(finalTokenStr, {
        inputTokens: ctx.inputTokens,
        outputTokens: ctx.outputTokens,
      });
    }

    ctx.onError?.(error);
  },

  /**
   * 触发后台压缩任务 (向量化事实 / 对话摘要)
   */
  async _triggerBackgroundCompression(currentChatId, modelConfig) {
    if (compressingChats.has(currentChatId)) return;
    
    try {
      compressingChats.add(currentChatId);

      // 延迟调度，避免抢占主线程 UI 渲染
      const delayMs = modelConfig?.backgroundTaskDelay || 2000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const currentChatInfo = await aiDatabase.queryChatListById(currentChatId);
      if (!currentChatInfo) return;

      const vectorizedCount = currentChatInfo.vectorizedCount || 0;
      const tasks = [];

      // 长期记忆向量化任务
      tasks.push(
        embeddingService.runBackgroundMemoryFacts(currentChatId, vectorizedCount, modelConfig)
      );

      // 上下文窗口管理：Prefix Caching (纪元大压缩) vs Sliding Saver (滑动窗口摘要)
      if (modelConfig?.enablePrefixCaching) {
        const epochStartIndex = currentChatInfo.epochStartIndex || 0;
        const totalCount = await aiDatabase.countMessagesByChatId(currentChatId);
        const uncompressedCount = Math.max(0, totalCount - 1 - epochStartIndex);
        const cacheLimit = modelConfig.cacheMessageLimit || 50;

        console.log(`[Compression] 缓存模式检查: 已堆叠 ${uncompressedCount} 轮 / 阈值 ${cacheLimit} 轮`);

        if (uncompressedCount >= cacheLimit) {
          console.log("🔥 [Compression] 达到缓存上限，触发纪元大压缩！");
          tasks.push(
            embeddingService.runEpochMemoryCompression(currentChatId, epochStartIndex, modelConfig)
          );
        }
      } else {
        const summarizedCount = currentChatInfo.summarizedCount || 0;
        console.log(`[Compression] 节约模式触发: 摘要游标[${summarizedCount}]`);
        tasks.push(
          embeddingService.runBackgroundMemoryHistory(currentChatId, summarizedCount, modelConfig)
        );
      }

      const results = await Promise.allSettled(tasks);
      results.forEach((res, index) => {
        if (res.status === "rejected") {
          console.error(`[Compression] 后台任务 ${index} 失败:`, res.reason);
        }
      });
    } catch (err) {
      console.error("[Compression] 后台调度器整体异常:", err);
    } finally {
      compressingChats.delete(currentChatId);
    }
  },

  // ============================================================================
  // 👇 核心上下文路由分发器 (双擎架构)
  // ============================================================================
  async _assembleContext(params) {
    if (params.modelConfig?.enablePrefixCaching) {
      console.log("🚀 [Context] 启用【全量缓存模式】(Cache Optimized)");
      return await this._assembleContextCacheOptimized(params);
    } else {
      console.log("🛡️ [Context] 启用【滑动节约模式】(Token Saver)");
      return await this._assembleContextTokenSaver(params);
    }
  },

  /**
   * 组装模式一：节约模式 (Token Saver) - 结合 RAG 检索与历史摘要
   */
  async _assembleContextTokenSaver({ text, currentChatId, userMsgId, tempMessages, modelConfig }) {
    let backgroundContext = [];
    let chatMessages = [];

    const recentLimit = modelConfig?.recentLimit ?? 6;
    const searchLimit = modelConfig?.searchLimit ?? 4;
    const pivot = Math.max(0, tempMessages.length - 2);
    const excludeMsg = tempMessages.slice(-(recentLimit + searchLimit));

    // 1. 触发 RAG 检索
    if (shouldTriggerRAG(text)) {
      try {
        const historyContext = await embeddingService.getRelevantContextAllHybrid(
          text,
          currentChatId,
          excludeMsg.map((m) => m.id),
          modelConfig
        );

        if (historyContext) {
          const contextParts = [];
          if (Array.isArray(historyContext.facts) && historyContext.facts.length > 0) {
            contextParts.push(historyContext.facts.join("\n"));
          }
          if (Array.isArray(historyContext.qaContext) && historyContext.qaContext.length > 0) {
            contextParts.push(historyContext.qaContext.join("\n\n"));
          }
          if (contextParts.length > 0) {
            backgroundContext.push(contextParts.join("\n\n---\n\n"));
          }
        }
      } catch (e) {
        console.error("❌ RAG Context 组装失败:", e);
      }
    }

    // 2. 注入历史摘要
    const currentChatInfo = await aiDatabase.queryChatListById(currentChatId);
    if (currentChatInfo?.summary) {
      let cleanSummary = currentChatInfo.summary
        .replace(/[\uFFFD\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, "")
        .replace(/^-{2,}\s*$/gm, "")
        .replace(/^-\s*$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (cleanSummary.length > 0) {
        const limitThreshold = modelConfig?.summaryInjectThreshold || 10;
        const strictLen = modelConfig?.summaryInjectStrictLen || 500;
        const looseLen = modelConfig?.summaryInjectLooseLen || 1000;
        const maxLen = tempMessages.length > limitThreshold ? strictLen : looseLen;

        if (cleanSummary.length > maxLen) {
          let truncated = cleanSummary.substring(0, maxLen);
          const lastPunctuation = truncated.search(/[。！？.!?][^。！？.!?]*$/);
          if (lastPunctuation !== -1) {
            truncated = truncated.substring(0, lastPunctuation + 1);
          }
          cleanSummary = truncated + "\n...[早期摘要已折叠]";
        }
        backgroundContext.push(`[Previous Recap - 仅供参考]\n${cleanSummary}`);
      }
    }

    // 3. 截取滑动窗口内的新消息
    const totalCount = await aiDatabase.countMessagesByChatId(currentChatId);
    const unsummarizedCount = Math.max(0, totalCount - 1 - (currentChatInfo?.summarizedCount || 0));
    const n = Math.min(unsummarizedCount, recentLimit);
    const startIdx = Math.max(0, pivot - n);
    const recentSlice = tempMessages.slice(startIdx, pivot);

    chatMessages = recentSlice
      .filter((m) => m.id !== userMsgId)
      .map((m) => ({ role: m.role, content: m.content, file: m.file }));

    // 4. 组装 Payload
    let finalSystemContent = "You are a professional assistant. Answer directly and factually. Match the user language.";
    if (backgroundContext.length > 0) {
      finalSystemContent += "\n\n" + backgroundContext.join("\n\n");
    }

    const finalPayload = [{ role: "system", content: finalSystemContent }];
    if (chatMessages.length > 0) finalPayload.push(...chatMessages);
    finalPayload.push({ role: "user", content: text });

    return finalPayload;
  },

  /**
   * 组装模式二：缓存优化模式 (Cache Optimized) - 适合支持 Prompt Cache 的大模型
   */
  async _assembleContextCacheOptimized({ text, currentChatId, tempMessages }) {
    const baseSystemPrompt = {
      role: "system",
      content: "You are a professional assistant. Answer directly and factually. Match the user language.",
    };

    const pivot = Math.max(0, tempMessages.length - 2);
    let backgroundContext = [];
    const currentChatInfo = await aiDatabase.queryChatListById(currentChatId);

    if (currentChatInfo?.epochSummary) {
      backgroundContext.push(`[Previous Core Context]\n${currentChatInfo.epochSummary}`);
    }

    const startIndex = currentChatInfo?.epochStartIndex || 0;
    let chatMessages = tempMessages
      .slice(startIndex, pivot)
      .filter((m) => !m.isGenerating && m.content)
      .map((m) => ({ role: m.role, content: m.content, file: m.file }));

    const finalPayload = [baseSystemPrompt];

    if (backgroundContext.length > 0) {
      finalPayload.push({
        role: "system",
        content: backgroundContext.join("\n\n"),
      });
    }

    finalPayload.push(...chatMessages);
    finalPayload.push({ role: "user", content: text });

    return finalPayload;
  },
};