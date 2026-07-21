import { invoke } from "@tauri-apps/api/core";

/**
 * Tauri invoke 参数命名规则：
 * Rust snake_case 参数 → JS 侧 invoke 的 key 必须完全一致（保持 snake_case）
 * Rust 内部的结构体字段序列化才走 camelCase 转换，命令参数名本身不转
 */
export const embeddingService = {

  /**
   * 混合检索：语义 + 关键词 + RRF 融合
   *
   * @param {string}   userInput      - 用户当前输入
   * @param {number}   currentChatId  - 当前会话 ID
   * @param {number[]} excludeIds     - 需排除的消息 ID 列表（已在上下文中的）
   * @param {object|null} modelConfig - ModelConfig 对象，null 则 Rust 侧用默认值
   * @returns {Promise<{ facts: string[], qaContext: string[] }>}
   */
  async getRelevantContextAllHybrid( userInput, currentChatId, excludeIds, modelConfig ) {

    return await invoke("get_relevant_context_all_hybrid", {
      userInput:       userInput,
      currentChatId:  currentChatId,
      excludeIds:      excludeIds ?? [],
      modelConfig:     modelConfig ?? null,
    });
  },

  /**
   * 后台滚动摘要压缩
   *
   * @param {number} chatId          - 会话 ID
   * @param {number} summarizedCount - 已摘要的消息数量（游标）
   * @param {object} modelConfig     - ModelConfig 对象
   * @returns {Promise<void>}
   */
  async runBackgroundMemoryHistory( chatId, summarizedCount, modelConfig ) {
    return await invoke("run_background_memory_history", {
      chatId:          chatId,
      summarizedCount: summarizedCount,
      modelConfig:     modelConfig,
    });
  },

  /**
   * 后台向量化 + 事实提取
   *
   * @param {number} chatId           - 会话 ID
   * @param {number} vectorizedCount  - 已向量化的消息数量（游标）
   * @param {object} modelConfig      - ModelConfig 对象
   * @returns {Promise<void>}
   */
  async runBackgroundMemoryFacts( chatId, vectorizedCount, modelConfig ) {
    return await invoke("run_background_memory_facts", {
      chatId:          chatId,
      vectorizedCount: vectorizedCount,
      modelConfig:     modelConfig,
    });
  },

  /**
   * 纪元大压缩（缓存熔断后触发）
   *
   * @param {number} chatId           - 会话 ID
   * @param {number} epochStartIndex  - 本纪元压缩起始消息索引（游标）
   * @param {object} modelConfig      - ModelConfig 对象
   * @returns {Promise<void>}
   */
  async runEpochMemoryCompression( chatId, epochStartIndex, modelConfig ) {
    return await invoke("run_epoch_memory_compression", {
      chatId:           chatId,
      epochStartIndex: epochStartIndex,
      modelConfig:      modelConfig,
    });
  },


  async loadChatHistoryIntoSearch( chatId, epochStartIndex, modelConfig ) {
    return await invoke("search_chat_messages", {
      chatId:           chatId,
      epochStartIndex: epochStartIndex,
      modelConfig:      modelConfig,
    });
  },
   
};