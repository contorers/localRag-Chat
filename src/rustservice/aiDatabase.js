import { invoke,convertFileSrc } from "@tauri-apps/api/core";
import { join } from '@tauri-apps/api/path'; // 用于拼接路径

const formatTime = (ts) => new Date(ts).toLocaleString();

// 统一的路径处理函数
const getLocalFileUrl = (file) => {
  // 输入非数组或为空时，返回空数组
  if (!Array.isArray(file) || file.length === 0) return [];
  // 直接用 map 拼接每个元素
  return file.map(name => `http://user-data.localhost/${name}`);
};

export const aiDatabase = {
  // ==========================================
  // 表: chatList (会话列表) 操作
  // ==========================================
  async addChatList(data) {
    // 自动剥离 id, modelId, timestamp，剩下的所有未知字段全放到 payload 对象里
    const { modelId, timestamp, ...payload } = data;

    return await invoke("add_chat_list", { 
      modelId: modelId || "",
      timestamp: timestamp || Date.now(), 
      payload: JSON.stringify(payload) // 👈 这里绝对干净，不包含上面三个字段
    });
  },

  async queryChatList(id = 0, limit = 20) {
    const results = await invoke("query_chat_list", { id, limit });
 
    return results.map(item => ({
      id: item.id,
      modelId: item.modelId,
      timestamp: item.timestamp,
      ...JSON.parse(item.payload) // 核心：前端自行反序列化并合并
    }));
  },

  async queryChatListByModelId(modelId, limit = 20) {
    const results = await invoke("query_chat_list_by_model_id", { modelId, limit });
    
    return results.map(item => ({
      id: item.id,
      modelId: item.modelId,
      timestamp: item.timestamp,
      ...JSON.parse(item.payload) // 前端接管反序列化
    }));
  },

  async deleteChatListById(id) {
    return await invoke("delete_chat_list_by_id", { id: id });
  },

  async queryChatListById(id) {
    const result = await invoke("query_chat_list_by_id", { id: id });

    return {
      id: result.id,
      modelId: result.modelId,
      timestamp: result.timestamp,
      ...JSON.parse(result.payload) // 前端接管反序列化
    };
  },

  async updateChatList(id, changes) {
    return await invoke("update_chat_list", { id: id, changes });
  },

  async clearAllChatListData() {
    return await invoke("clear_all_chat_list_data");
  },

  // ==========================================
  // 表: chatMessages (具体聊天内容) 操作
  // ==========================================
  async addChatMessages(data) {
    const { chatId, timestamp, embedding,localImages, ...payload } = data;

    return await invoke("add_chat_messages", { 
        chatId: chatId,
        timestamp: timestamp || Date.now(),
        embedding: embedding || null,
        payload: payload,
        localImages:localImages,
    });
  },

  async queryChatMessages(chatId, lastId = 0, limit = 50) {
    const results = await invoke("query_chat_messages", { 
      chatId: chatId, 
      lastId, 
      limit 
    });
    
    // 1. 先解包
    const messages = results.map(item => ({
      id: item.id,
      chatId: item.chatId,
      timestamp: item.timestamp,
      ...JSON.parse(item.payload)
    }));

    // 🌟 2. 新增：并发处理所有的消息内容，替换图片路径
    return await Promise.all(messages.map(async (msg) => {
      if (msg.file) {
        msg.file = getLocalFileUrl(msg.file);
      }
      return msg;
    }));
  },

  async queryMessagesByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return [];
    }

    const results = await invoke("query_messages_by_ids", { ids });
    
    const messages = results.map(item => {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(item.payload);
      } catch (e) {}

      return {
        id: item.id,
        chatId: item.chatId,
        timestamp: item.timestamp,
        ...parsedPayload
      };
    });

    // 🌟 新增：并发处理
    return await Promise.all(messages.map(async (msg) => {
      if (msg.file) {
        msg.file =  getLocalFileUrl(msg.file);
      }
      return msg;
    }));
  },

  async queryChatIdsMessages(chatIds, limit = 100) {
    if (!chatIds || chatIds.length === 0) return [];
    
    const results = await invoke("query_chat_ids_messages", { 
      chatIds: chatIds,
      limit
    });

    const messages = results.map(item => ({
      id: item.id,
      chatId: item.chatId,
      timestamp: item.timestamp,
      ...JSON.parse(item.payload)
    }));

    // 🌟 新增：并发处理
    return await Promise.all(messages.map(async (msg) => {
      if (msg.file) {
        msg.file = getLocalFileUrl(msg.file);
      }
      return msg;
    }));
  },

  async deleteChatMessageByChatId(chatId) {
    return await invoke("delete_chat_message_by_chat_id", { chatId: chatId });
  },

  async deleteChatMessageById(id) {
    return await invoke("delete_chat_message_by_id", { id: id });
  },

  async clearAllChatData() {
    return await invoke("clear_all_chat_data");
  },

  // ==========================================
  // 高级性能优化方法 (用于 RAG 和 记忆压缩)
  // ==========================================
  async countMessagesByChatId(chatId) {
    return await invoke("count_messages_by_chat_id", { chatId: chatId });
  },

  async queryMessagesSlice(chatId, offset, limit) {
    try {
      const results = await invoke("query_messages_slice", { 
        chatId: chatId, // 🌟 强转数字，对齐 Rust 的 i64
        offset, 
        limit 
      });

      const messages = results.map(item => ({
        id: item.id,
        chatId: item.chatId,
        timestamp: item.timestamp,
        ...JSON.parse(item.payload) 
      }));

      // 🌟 新增：拦截并替换相对路径为真实本机的 asset:// 路径
      return await Promise.all(messages.map(async (msg) => {
        if (msg.file) {
          msg.file = getLocalFileUrl(msg.file);
        }
        return msg;
      }));

    } catch (error) {
      console.error(`查询会话 ${chatId} 消息切片失败:`, error);
      return [];
    }
  },


  async saveMessageVector(msgId, vectorArray) {
    // 🌟 核心防坑：确保它是标准数组，避免 Float32Array 序列化变成 Object
    const standardArray = Array.isArray(vectorArray) ? vectorArray : Array.from(vectorArray);
    const vectorJsonStr = JSON.stringify(standardArray);

    return await invoke("save_message_vector", { 
      msgId: msgId, 
      // 变量名改为 vectorJson，与后端对齐
      vectorJson: vectorJsonStr 
    });
  },

  async queryRecentMessagesWithVectors(chatId, limit = 500) {
    const rawMessages = await invoke("query_recent_messages_with_vectors", { chatId: chatId, limit });
    
    return rawMessages.map(msg => {
      let payloadObj = {};
      try {
        // 1. 解析字符串
        payloadObj = JSON.parse(msg.payload);
        
        // 2. 还原 Float32Array
        if (payloadObj.vector && Array.isArray(payloadObj.vector)) {
          payloadObj.vector = new Float32Array(payloadObj.vector);
        }
      } catch (e) {
        console.error("解析 payload 失败", e);
      }
  
      // 🌟 3. 核心大招：把 msg 里的 payload 剥离出来扔掉，剩下的全放进 rest 里
      const { payload, ...rest } = msg;
      
      // 🌟 4. 将外层基础字段 (id, timestamp等) 和 解析出的 payloadObj 字段无缝缝合！
      return {
        ...rest,
        ...payloadObj
      };
    });
  },
  
  async queryAllMessagesWithVectors(chatId) {
    const rawMessages = await invoke("query_all_messages_with_vectors", { chatId: chatId });
    
    return rawMessages.map(msg => {
      let payloadObj = {};
      try {
        payloadObj = JSON.parse(msg.payload);
        if (payloadObj.vector && Array.isArray(payloadObj.vector)) {
          payloadObj.vector = new Float32Array(payloadObj.vector);
        }
      } catch (e) {}
  
      // 同样的操作：剥离 payload 字符串，合并提取出来的字段
      const { payload, ...rest } = msg;
      return { ...rest, ...payloadObj };
    });
  },

  /**
   * 1. 存入/更新单条状态向量
   * 底层利用了批量 upsert 接口，为了兼容原有 API，这里将其包装为单元素数组
   */

  /**
   * 🌟 批量保存向量 (极致性能版)
   * @param {Array} records - 包含多个向量对象的数组
   */
  async saveVectorsBatch(records) {
    if (!records || records.length === 0) return;

    try {
      // 1. 遍历并格式化所有数据，确保类型严格对齐 Rust
      const payloadRecords = records.map(record => {
        const { id, chatId, timestamp, ...payload } = record;
        return {
          id: typeof id === 'string' ? Number(id) : id,
          chatId: typeof chatId === 'string' ? Number(chatId) : chatId,
          timestamp: timestamp || Date.now(),
          payload: JSON.stringify(payload) 
        };
      });

      // 2. 一次 IPC 通讯，把整个数组扔给后端的事务引擎
      await invoke("upsert_vectors_batch", { vectors: payloadRecords });
      console.log(`[VectorDB] 批量落库成功，共处理 ${payloadRecords.length} 条记忆`);
    } catch (error) {
      console.error('[VectorDB] 批量落库失败:', error);
      throw error;
    }
  },
  /**
   * 2. 获取最近的 N 条记忆向量
   */
  async getRecentVectors(limit = 1000) {
    try {
      const results = await invoke("query_recent_vectors", { limit });
      
      return results.map(item => {
        let parsedPayload = {};
        try {
          parsedPayload = JSON.parse(item.payload);
        } catch (e) {
          console.warn(`[VectorDB] Payload 解析失败 ID: ${item.id}`, e);
        }

        // 🌟 核心反序列化：把普通数组强转回底层计算需要的 Float32Array
        if (parsedPayload.vector && Array.isArray(parsedPayload.vector)) {
          parsedPayload.vector = new Float32Array(parsedPayload.vector);
        }

        return {
          id: item.id,
          chatId: item.chatId,
          timestamp: item.timestamp,
          ...parsedPayload 
        };
      });
    } catch (error) {
      console.warn('[VectorDB] 提取近期向量失败:', error);
      return [];
    }
  },

  /**
   * 🌟 4. 重构后的记忆淘汰机制：纯时间淘汰 (FIFO)
   */
  async pruneOldestVectors(keepLimit = 2000) {
    try {
      const deletedCount = await invoke("prune_oldest_vectors", { keepLimit });
      if (deletedCount > 0) {
        console.log(`[VectorDB] 容量保底：已清理最旧的 ${deletedCount} 条记忆。`);
      }
    } catch (error) {
      console.error('[VectorDB] 记忆淘汰失败:', error);
    }
  },

  /**
   * 5. 彻底清空所有向量记忆
   */
  async clearAllVectors() {
    try {
      await invoke("clear_all_vectors");
      console.log(`[VectorDB] 💥 记忆库已彻底清空。`);
    } catch (error) {
      console.error('[VectorDB] 清空记忆库失败:', error);
      throw error;
    }
  },

  /**
   * 6. 根据会话 ID 物理清空所属记忆
   */
  async deleteVectorsByChatId(chatId) {
    try {
      await invoke("delete_vectors_by_chat_id", { chatId: chatId });
      console.log(`[VectorDB] 级联清理完成：已销毁会话 ${chatId} 的相关记忆。`);
    } catch (error) {
      console.error(`[VectorDB] 级联清理失败 ChatID: ${chatId}`, error);
      throw error;
    }
  },

  /**
   * 7. 获取特定会话的向量记忆
   */
 /**
   * 获取特定会话的向量记忆
   */
 async getRecentVectorsByChatId(chatId, limit = 1000) {
  try {
    const results = await invoke("query_recent_vectors_by_chat_id", { 
      chatId: chatId, 
      limit 
    });
    
    return results.map(item => {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(item.payload);
      } catch (e) {
        console.warn(`[VectorDB] Payload 解析失败 ID: ${item.id}`, e);
      }

      // 🌟 核心反序列化：恢复为 Float32Array
      if (parsedPayload.vector && Array.isArray(parsedPayload.vector)) {
        parsedPayload.vector = new Float32Array(parsedPayload.vector);
      }

      return {
        id: item.id,
        chatId: item.chatId,
        timestamp: item.timestamp,
        ...parsedPayload
      };
    });
  } catch (error) {
    console.error(`[VectorDB] 提取会话 ${chatId} 的向量失败:`, error);
    return [];
  }
},

   /**
     * 统一资产变动记录 (签到、兑换、购买)
     */
   async addDeposit(data) {
    try {
      // 从传入的 data 中剥离物理字段，其余的全部放进 payload 
      const { depositType, source, timestamp, ...payload } = data;
      const ts = timestamp || Date.now();

      return await invoke("add_deposit", { 
        // 注意：传给 tauri 的参数名默认需要驼峰命名
        depositType: depositType || "", 
        source: source || "",
        timestamp: ts,
        payload: payload // 绝对干净的附加数据
      });
    } catch (err) {
      console.error("写入资产记录失败:", err);
    }
  },
  
    /**
     * 记录 AI 消耗日志
     */
    async addTokenLog(data) {
      try {
        // 1. 预计算 token 总数
        const tokensTotal = data.tokensTotal || (data.tokensInput || 0) + (data.tokensOutput || 0);
        
        // 2. 解构剥离出独立的物理字段，剩下的统统塞进 payload
        const { tokenType, modelName, timestamp, ...payload } = data;
        const ts = timestamp || Date.now();
  
        // 把预计算的总数放回 payload 里
        payload.tokensTotal = tokensTotal;
  
        return await invoke("add_token_log", { 
          tokenType: tokenType || "",
          modelName: modelName || "",
          timestamp: ts,
          payload: payload // 绝对干净的扩展数据
        });
      } catch (err) {
        console.error("写入消耗日志失败:", err);
      }
    },
  
    // ================= 2. 查询与统计优化 =================
  
    /**
     * 分页查询流水
     * 拆分为两个独立的调用以防止 SQL 注入风险
     */
   /**
   * 游标查询流水 (通用)
   * @param {string} table - 'deposits' | 'tokenlogs'
   * @param {number} lastId - 上次查询的最后一条记录的 ID，传 0 表示查询最新
   * @param {number} limit - 每次查询条数，默认 20
   */
  async getPagedLogs(table, lastId = 0, limit = 20) {
    try {
      let list = [];
      if (table === 'deposits') {
        list = await invoke("get_paged_deposits", { id: lastId, limit });
      } else if (table === 'tokenlogs') {
        list = await invoke("get_paged_tokenlogs", { id: lastId, limit });
      }

      // 展开 payload，并格式化时间
      return list.map(item => ({
        id: item.id,
        timestamp: item.timestamp,
        type: item.depositType || item.tokenType, // 兼容两张表不同的物理字段
        source: item.source,
        modelName: item.modelName,
        ...JSON.parse(item.payload),
        timeStr:formatTime(item.timestamp),
      }));
    } catch (err) {
      console.error(`查询 ${table} 失败:`, err);
      return [];
    }
  },
  
    /**
     * 统计今日总消耗 (用于前端仪表盘)
     * 🌟 优化：底层 SQL 聚合计算，前端只接收一个数字
     */
    async getTodayUsage() {
      try {
        const startOfToday = new Date().setHours(0, 0, 0, 0);
        return await invoke("get_token_usage_above", { timestamp: startOfToday });
      } catch (err) {
        console.error("统计今日消耗失败:", err);
        return 0;
      }
    },
  
    // ================= 3. 维护优化 =================
  
    /**
     * 自动清理机制：只保留最近 15 天的明细
     */
    async autoCleanup() {
      const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
      try {
        const count = await invoke("delete_logs_below", { timestamp: fifteenDaysAgo });
        if (count > 0) {
          console.log(`[DB] 清理了 ${count} 条过往日志`);
        }
      } catch (err) {
        console.error("清理旧日志失败:", err);
      }
    },
    
  // ==========================================
  // 1. 厂商操作 (Providers)
  // ==========================================
  async saveProvider(providerData) {
    try {
      // ✨ 1. 使用 ES6 语法，将 id 提取出来，剩下的全部丢进 payload 对象
      const { id, ...payload } = providerData;

      // ✨ 2. 将分离好的 id 和 payload 发给 Rust
      return await invoke("save_provider", { 
        id: id || null, // 如果前端 id 为空/null，传给 Rust 让它自增
        payload: payload 
      });
    } catch (error) {
      console.error("保存厂商配置失败:", error);
      throw error;
    }
  },

  /**
   * 分页获取厂商列表 (最新到最旧)
   */
  async getProviders(lastId = null, limit = 20) {
    try {
      const rawData = await invoke("get_providers", { lastId, limit });
      
      // ✨ 3. 将后端返回的格式 { id: 1, payload: {...} } 摊平成 { id: 1, name: '...', ... }
      return rawData.map(row => {
        // 兜底防御：如果后端传过来的是 JSON 字符串就 parse，如果是对象就直接用
        const payloadObj = typeof row.payload === 'string' 
          ? JSON.parse(row.payload || '{}') 
          : (row.payload || {});

        return {
          id: row.id,
          ...payloadObj // 扩展运算符，将 payload 里的字段和 id 平级展开
        };
      });
    } catch (error) {
      console.error("获取厂商列表失败:", error);
      return [];
    }
  },

  async deleteProvider(providerId) {
    try {
      await invoke("delete_provider", { providerId: providerId });
    } catch (error) {
      console.error("级联删除厂商失败:", error);
      throw error;
    }
  },

  // ==========================================
  // 2. 独立模型与默认值操作 (Models)
  // ==========================================
  async saveModel(modelData) {
    try {
      // ✨ 1. 抽离表字段，剩下的统统丢进 payload
      const { 
        id, 
        providerId,
        modelType, 
        isDefault,
        ...payload 
      } = modelData;

      // ✨ 2. 梳理最终要传给后端的干净参数
      return await invoke("save_model", { 
        id: id ? id : null,
        providerId: providerId, // Tauri 默认使用驼峰命名接收
        modelType:  modelType || 'text',
        isDefault: Boolean( isDefault),
        payload: payload 
      });
    } catch (error) {
      console.error("保存模型失败:", error);
      throw error;
    }
  },

  async getModels(providerId, lastId = null, limit = 20) {
    try {
      const rawData = await invoke("get_models", { providerId, lastId, limit });
      return rawData.map(row => {
        const payloadObj = typeof row.payload === 'string' 
          ? JSON.parse(row.payload || '{}') 
          : (row.payload || {});

        return {
          id: row.id,
          providerId: row.providerId,
          modelType: row.modelType,
          // 🌟 核心修复：强制转布尔，彻底告别 1/0 的歧义
          isDefault: !!row.isDefault, 
          ...payloadObj
        };
      });
    } catch (error) {
      console.error("获取模型列表失败:", error);
      return [];
    }
  },

  async deleteModel(modelId) {
    try {
      await invoke("delete_model", { modelId:modelId });
    } catch (error) {
      console.error("删除单个模型失败:", error);
      throw error;
    }
  },

  async getDefaultModelWithProvider() {
    try {
      const result = await invoke("get_default_model_with_provider");
      
      if (!result) return null;

      // 前端接管反序列化工作
      const modelJson = JSON.parse(result.modelPayload || "{}");
      const providerJson = JSON.parse(result.providerPayload || "{}");
 
      // 重新拼装结构与 ID
      modelJson.id = result.modelId;
      modelJson.providerId = result.providerId;
      providerJson.id = result.providerId;
  
      return {
        model: modelJson,
        provider: providerJson
      };
    } catch (error) {
      console.error("获取默认模型及厂商失败:", error);
      throw error;
    }
  },

  async setDefaultModel(targetModelId) {
    try {
      // 由于是全局唯一的默认对话模型，不再需要 providerId
      await invoke("set_default_model", { 
        targetModelId: targetModelId 
      });
    } catch (error) {
      console.error("设置默认模型失败:", error);
      throw error;
    }
  },

  

   // 1. 获取配置
  async getSystemSettings(id = 0) {
    try {
      const result = await invoke("get_system_settings", { id });
      
      if (!result) return null; // 数据库还没有这个配置

      // 绝对遵守：前端接管反序列化
      const payloadData = JSON.parse(result.payload || "{}");
      
      // 把外键 ID 拼装回对象给 UI 使用
      payloadData.id = result.id;
      
      return payloadData;
    } catch (error) {
      console.error("[DB Error] 获取系统配置失败:", error);
      throw error;
    }
  },

  // 前端直接发送只包含 3 个字段的 JSON，不用管其他字段
  async updateSystems(id = 0, cacheConfig) {
    try {
      const payloadString = JSON.stringify({
        cacheMessageLimit: cacheConfig.cacheMessageLimit,
        cacheTokenLimit: cacheConfig.cacheTokenLimit,
        enablePrefixCaching: cacheConfig.enablePrefixCaching
      });

      await invoke("update_system_settings_partial", { 
        id: id, 
        payload: payloadString 
      });
    } catch (error) {
      console.error("局部更新失败:", error);
      throw error;
    }
  },

  // 2. 保存与更新合并
  async saveSystemSettings(data) {
    try {
      // 从传入的 data 中把 id 剔除掉，剩下的全作为 payload 存入 JSON
      const { id: id, ...payloadData } = data;
      
      // 把对象序列化成字符串推给 Rust
      const payloadString = JSON.stringify(payloadData);

      // 后端一句 SQL 搞定插入或合并
      return await invoke("save_system_settings", { 
        id: id, 
        payload: payloadString 
      });
    } catch (error) {
      console.error("[DB Error] 保存/更新系统配置失败:", error);
      throw error;
    }
  }
  
};