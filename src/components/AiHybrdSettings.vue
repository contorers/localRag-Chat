<template>
  <div class="settings-page">
    <header class="settings-header">
      <div class="header-left">
        <button class="icon-btn back-btn" @click="goBack" title="返回">
          <Icon icon="lucide:arrow-left" />
        </button>
        <h2>系统全局与上下文配置</h2>
      </div>
      <div class="header-right">
        <button class="ghost-btn" @click="restoreDefaults" style="margin-right: 12px;">
          <Icon icon="lucide:rotate-ccw" /> 恢复默认
        </button>
        <button class="primary-btn" @click="handleSave" :disabled="isSaving">
          <Icon v-if="isSaving" icon="lucide:loader-2" class="spin-icon" />
          <Icon v-else icon="lucide:save" />
          {{ isSaving ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </header>

    <main class="settings-content">
      <div class="form-container" v-if="!isLoading">
        
        <div class="form-card">
          <div class="card-header-row">
            <div>
              <h3 class="card-title">
                <Icon icon="lucide:terminal-square" class="title-icon" /> 
                系统核心提示词 (System Prompts)
              </h3>
              <p class="card-desc">控制后台静默任务中，大模型进行数据压缩和提取时的行为准则。</p>
            </div>
            <button class="ghost-btn small-btn" @click="toggleAllPrompts">
              {{ isAllPromptsExpanded ? '全部收起' : '全部展开' }}
            </button>
          </div>

          <div class="prompt-grid">
            <div class="prompt-card" :class="{ 'is-expanded': expandedPrompts.global }">
              <div class="prompt-header" @click="expandedPrompts.global = !expandedPrompts.global">
                <div class="prompt-title">
                  <Icon icon="lucide:globe" class="prompt-icon" />
                  <span>全局长效摘要合并 (Global Summary)</span>
                </div>
                <Icon :icon="expandedPrompts.global ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="chevron" />
              </div>
              <div class="prompt-body">
                <textarea 
                  v-model="systemForm.promptGlobalSummary" 
                  class="custom-textarea prompt-editor" 
                  placeholder="输入全局摘要的提示词..."
                ></textarea>
                <div class="prompt-actions">
                  <button class="action-text-btn" @click="resetPrompt('promptGlobalSummary')" title="重置为此项默认值">
                    <Icon icon="lucide:rotate-ccw" />
                  </button>
                </div>
              </div>
            </div>

            <div class="prompt-card" :class="{ 'is-expanded': expandedPrompts.epoch }">
              <div class="prompt-header" @click="expandedPrompts.epoch = !expandedPrompts.epoch">
                <div class="prompt-title">
                  <Icon icon="lucide:archive" class="prompt-icon" />
                  <span>全量缓存纪元合并 (Epoch Summary)</span>
                </div>
                <Icon :icon="expandedPrompts.epoch ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="chevron" />
              </div>
              <div class="prompt-body">
                <textarea 
                  v-model="systemForm.promptEpochSummary" 
                  class="custom-textarea prompt-editor" 
                  placeholder="输入全局缓存摘要的提示词..."
                ></textarea>
                <div class="prompt-actions">
                  <button class="action-text-btn" @click="resetPrompt('promptEpochSummary')" title="重置为此项默认值">
                    <Icon icon="lucide:rotate-ccw" />
                  </button>
                </div>
              </div>
            </div>

            <div class="prompt-card" :class="{ 'is-expanded': expandedPrompts.fact }">
              <div class="prompt-header" @click="expandedPrompts.fact = !expandedPrompts.fact">
                <div class="prompt-title">
                  <Icon icon="lucide:user-check" class="prompt-icon" />
                  <span>用户长期事实提取 (Fact Extraction)</span>
                </div>
                <Icon :icon="expandedPrompts.fact ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="chevron" />
              </div>
              <div class="prompt-body">
                <textarea 
                  v-model="systemForm.promptFactExtraction" 
                  class="custom-textarea prompt-editor" 
                  placeholder="输入事实提取的提示词..."
                ></textarea>
                <div class="prompt-actions">
                  <button class="action-text-btn" @click="resetPrompt('promptFactExtraction')" title="重置为此项默认值">
                    <Icon icon="lucide:rotate-ccw" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="form-card">
          <h3 class="card-title">
            <Icon icon="lucide:scissors" class="title-icon" /> 
            记忆压缩与 Token 防爆
          </h3>
          <p class="card-desc">控制大模型滚动压缩的时机，以及提取任务的最大 Token 长度。</p>
          
          <div class="grid-3-cols">
            <div class="form-group">
              <label title="超过此字符数将触发滚动压缩逻辑">触发压缩阈值 (字符)</label>
              <input type="number" v-model.number="systemForm.compressThreshold" min="1000" step="500" />
            </div>
            <div class="form-group">
              <label title="限制大模型生成的全局摘要最大长度">摘要输出上限 (Tokens)</label>
              <input type="number" v-model.number="systemForm.maxSummaryTokens" min="100" step="50" />
            </div>
            <div class="form-group">
              <label title="限制每次提取用户事实时的最大长度">事实提取上限 (Tokens)</label>
              <input type="number" v-model.number="systemForm.maxExtractionTokens" min="50" step="10" />
            </div>
          </div>
        </div>

        <div class="form-card">
          <h3 class="card-title">
            <Icon icon="lucide:network" class="title-icon" /> 
            上下文 RAG 检索策略
          </h3>
          <p class="card-desc">控制每次对话前，从历史消息和个人事实库中召回数据的逻辑。</p>
          
          <div class="grid-3-cols">
            <div class="form-group">
              <label title="每次从消息向量库检索时，召回的最相似记录条数">向量检索候选数</label>
              <input type="number" v-model.number="systemForm.vectorSearchLimit" min="1" max="30" />
            </div>
            <div class="form-group">
              <label title="最终经过重排后，允许注入 Prompt 的问答对上限">最终上下文注入上限</label>
              <input type="number" v-model.number="systemForm.finalContextLimit" min="1" max="15" />
            </div>
            <div class="form-group">
              <label title="数值越大，越旧的消息在搜索排名中权重下降越快">时间衰减率 (Time Decay)</label>
              <input type="number" v-model.number="systemForm.timeDecayRate" min="0" max="0.5" step="0.01" />
            </div>
          </div>

          <div class="divider"></div>
          <h4 class="sub-title">个人长期事实库 (Long-term Facts)</h4>
          
          <div class="grid-2-cols">
            <div class="form-group">
              <label title="每次从个人事实库检索时，召回的最相似事实条数">事实召回上限 (条)</label>
              <input type="number" v-model.number="systemForm.factSearchLimit" min="1" max="10" />
            </div>
            <div class="form-group">
              <label title="事实召回的及格线（余弦相似度），低于此值不进入上下文">事实匹配及格线 (0~1)</label>
              <input type="number" v-model.number="systemForm.factSimilarityThreshold" min="0" max="1" step="0.01" />
            </div>
          </div>
        </div>

        <div class="form-card">
          <h3 class="card-title">
            <Icon icon="lucide:cpu" class="title-icon" /> 
            本地缓存与高级搜索控制
          </h3>
          <p class="card-desc">近期记忆的窗口控制与混合检索防线参数。</p>
          
          <div class="grid-3-cols">
            <div class="form-group">
              <label title="允许近期的直接对话保留条数">近期对话数量 (条)</label>
              <input type="number" v-model.number="systemForm.recentLimit" min="1" max="20" />
            </div>
            <div class="form-group">
              <label title="压缩与屏蔽条数">检索隔离区 (条)</label>
              <input type="number" v-model.number="systemForm.searchLimit" min="1" max="20" />
            </div>
            <div class="form-group">
              <label title="认定一条 AI 回复为“有参考价值”的最短长度">AI 有效回复下限 (字)</label>
              <input type="number" v-model.number="systemForm.minValidAILength" min="1" max="100" />
            </div>
          </div>

          <div class="grid-2-cols" style="margin-top: 16px;">
            <div class="form-group">
              <label title="缓存模式下触发压缩最大条数">缓存触发条数</label>
              <input type="number" v-model.number="systemForm.cacheMessageLimit" min="10" step="10" />
            </div>
            <div class="form-group">
              <label title="缓存模式下触发压缩最大字数">缓存触发字数</label>
              <input type="number" v-model.number="systemForm.cacheTokenLimit" min="5000" step="1000" />
            </div>
          </div>

          <div class="divider"></div>
          <div class="grid-2-cols">
            <div class="form-group">
              <label title="物理性能防线：从事实库读取的排名最大记录数">事实库物理读取上限 (条)</label>
              <input type="number" v-model.number="systemForm.dbFactVectorLimit" min="1" step="1" />
            </div>
            <div class="form-group">
              <label title="RRF (Reciprocal Rank Fusion) 算法中的平滑常数 K">RRF 融合常数 (K值)</label>
              <input type="number" v-model.number="systemForm.rrfConstantK" min="1" max="100" />
            </div>
          </div>
        </div>

        <div class="form-card">
          <h3 class="card-title">
            <Icon icon="lucide:database" class="title-icon" /> 
            LSH 向量底层参数
          </h3>
          <p class="card-desc">控制本地 sqllite向量检索的性能与精度边界。</p>
          
          <div class="grid-2-cols">
            <div class="form-group">
              <label title="向量维度，必须与嵌入模型一致">向量维度 (Dimensions)</label>
              <input type="number" v-model.number="systemForm.dimensions" min="128" step="128" />
            </div>
            <div class="form-group">
              <label title="超过此数量自动切换为 LSH，低于此数量用暴力精确扫描">LSH 切换阈值</label>
              <input type="number" v-model.number="systemForm.lshThreshold" min="10000" step="50000" />
            </div>
            <div class="form-group">
              <label title="LSH 投影数">投影数 (Projections)</label>
              <input type="number" v-model.number="systemForm.numProjections" min="1" max="64" />
            </div>
            <div class="form-group">
              <label title="LSH 探针位数">探针位数 (Probe Bits)</label>
              <input type="number" v-model.number="systemForm.numProbeBits" min="1" max="10" />
            </div>
          </div>
        </div>

      </div>
      
      <div v-else class="loading-state">
        <Icon icon="lucide:loader-2" class="spin-icon large-spin" />
        <p>正在加载系统配置...</p>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { aiDatabase } from "../rustservice/aiDatabase.js";
import { showConfirm } from "./ui/ui-js/confirm.js";

const router = useRouter();

const isLoading = ref(true);
const isSaving = ref(false);

const DEFAULT_CONFIG = {
  // === 1. LLM 系统提示词 (System Prompts) ===
  promptGlobalSummary: `You are a dialogue compressor for semantic search.\nProcess each message independently.\nKeep only messages that contain useful searchable information (goals, decisions, bugs, fixes, APIs, libraries, technical explanations, constraints, instructions, project names, error messages).\nDiscard greetings, thanks, emojis, acknowledgements and small talk.\nFor each kept message:\n- Rewrite as one concise, self-contained sentence.\n- Preserve the original language and technical keywords.\n- Keep the meaning unchanged.\n- Do not merge messages or infer context.\n- Keep it as short as possible.\n- Never exceed 500 characters.\nReturn ONLY:\n[\n  {\n    "id":123,\n    "compressed_text":"..."\n  }\n]\n\nReturn [] if nothing is kept.`,
  promptEpochSummary: `You are a long-term context consolidation engine.\n\nTask:\nReplace [Past Memory] and [Recent Dialogue] with a compact memory that preserves all information necessary to continue the conversation naturally.\n\nRules:\n- Recent dialogue overrides past memory on conflicts.\n- Preserve user identity, preferences, ongoing tasks, decisions, conclusions, constraints, and important context.\n- Remove repetition, pleasantries, AI self-descriptions, and obsolete or temporary details.\n- Compress by rewriting, not by discarding useful information.\n- Preserve all information that could affect future responses.\n- Output a concise paragraph in Chinese without headings or bullet points.`,
  promptFactExtraction: `Task:\nExtract ONLY observable user facts and user intents.\n---\nValid outputs:\n[F] USER_FACT\nExplicit user statements or stable attributes:\n- "I am a backend developer"\n- "I use Node.js"\n[I] USER_INTENT\nWhat the user is trying to do (inferred from what they asked or did):\n- "User is evaluating their ability to build web projects"\n- "User is trying to optimize RAG accuracy"\n---\nSTRICT RULES:\n1. Do NOT infer skill level\n2. Do NOT evaluate ability\n3. Do NOT assign labels like beginner/intermediate/advanced\n4. Only describe observable behavior or explicit intent\n5. No summaries, no reasoning\n6. If the same thing can be expressed as [F] or [I], prefer [F]\n---\nOutput JSON:\n{\n  "facts": ["[F] ...", "[I] ..."]\n}`,

  // === 2. 记忆与上下文压缩阈值 ===
  compressThreshold: 4000,
  maxSummaryTokens: 600,
  maxExtractionTokens: 150,

  // === 3. RAG 向量搜索参数 ===
  vectorSearchLimit: 8,
  factSearchLimit: 6,
  factSimilarityThreshold: 0.82,
  finalContextLimit: 5,
  timeDecayRate: 0.04,

  // === 4. 高级搜索算法参数 ===
  rrfConstantK: 30,
  dbFactVectorLimit: 8,

  // === 5. 文本裁剪 ===
  minValidAILength: 10,

  // === 6. 摘要注入窗口限制 ===
  recentLimit: 6,
  searchLimit: 4,
  cacheMessageLimit: 100,
  cacheTokenLimit: 2000000,

  // === 7. LSH 向量底层参数 (新增对齐) ===
  dimensions: 384,
  numProjections: 32,
  numProbeBits: 2,
  lshThreshold: 500000
};

// 控制 Prompt 卡片展开状态
const expandedPrompts = reactive({
  global: false,
  epoch: false,
  fact: false
});

// 计算属性：判断是否全部展开
const isAllPromptsExpanded = computed(() => {
  return expandedPrompts.global && expandedPrompts.epoch && expandedPrompts.fact;
});

// 切换所有 Prompt 的展开状态
const toggleAllPrompts = () => {
  const targetState = !isAllPromptsExpanded.value;
  expandedPrompts.global = targetState;
  expandedPrompts.epoch = targetState;
  expandedPrompts.fact = targetState;
};

// 单独重置某个 Prompt
const resetPrompt = (key) => {
  systemForm[key] = DEFAULT_CONFIG[key];
};

// 响应式表单数据
const systemForm = reactive({ ...DEFAULT_CONFIG });

onMounted(async () => {
  await loadSettings();
});

const loadSettings = async () => {
  isLoading.value = true;
  try {
    const savedConfig = await aiDatabase.getSystemSettings(0);
    if (savedConfig) {
      // 提取 savedConfig 中属于 DEFAULT_CONFIG 的有效字段，过滤掉旧库里残留的废弃参数
      const validSavedConfig = Object.keys(DEFAULT_CONFIG).reduce((acc, key) => {
        if (savedConfig[key] !== undefined) {
          acc[key] = savedConfig[key];
        }
        return acc;
      }, {});
      Object.assign(systemForm, { ...DEFAULT_CONFIG, ...validSavedConfig });
    }
  } catch (error) {
    console.error("加载系统配置失败:", error);
  } finally {
    isLoading.value = false;
  }
};

const handleSave = async () => {
  isSaving.value = true;
  try {
    const dataToSave = { id: 0, ...systemForm };
    await aiDatabase.saveSystemSettings(dataToSave);
    showAlert("success", `系统配置已成功保存！`); 
  } catch (error) {
    console.error("保存配置失败:", error);
    showAlert("warning", `保存失败，请检查控制台。`); 
  } finally {
    isSaving.value = false;
  }
};

const restoreDefaults = async () => {
  const isConfirm = await showConfirm({
    title: "恢复",
    message: `确定要恢复所有系统参数和提示词到出厂默认状态吗？\n此操作不可逆！`,
    type: "info",
  });
  if (!isConfirm) return;
  Object.assign(systemForm, DEFAULT_CONFIG);
};

const goBack = () => {
  router.push('/aiUserChat');
};
</script>

<style scoped>
/* ==========================================
   全局与基础布局
   ========================================== */
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  background-color: #f7f9fa;
  color: #333;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  overflow: hidden;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background-color: #ffffff;
  border-bottom: 1px solid #e5e8eb;
  flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: #111827;
}

.header-right {
  display: flex;
  align-items: center;
}

/* ==========================================
   按钮样式
   ========================================== */
.icon-btn {
  background: transparent;
  border: none;
  font-size: 20px;
  color: #6b7280;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: background 0.2s;
  display: flex;
}
.icon-btn:hover { background-color: #f3f4f6; color: #111827; }

.primary-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background-color: #111827;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.primary-btn:hover:not(:disabled) { background-color: #374151; }
.primary-btn:disabled { opacity: 0.7; cursor: not-allowed; }

.ghost-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid #d1d5db;
  color: #4b5563;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.ghost-btn:hover { background: #f3f4f6; color: #111827; }
.small-btn {
  padding: 4px 10px;
  font-size: 12px;
}

/* ==========================================
   主内容区容器
   ========================================== */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  justify-content: center;
}

.form-container {
  width: 100%;
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 40px;
}

.form-card {
  background: #ffffff;
  border: 1px solid #e5e8eb;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.card-title {
  margin: 0 0 6px 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-icon {
  color: #3b82f6;
  font-size: 18px;
}

.card-desc {
  font-size: 13px;
  color: #6b7280;
  margin: 0 0 20px 0;
  line-height: 1.5;
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

/* ==========================================
   Prompt 折叠卡片专属样式
   ========================================== */
.prompt-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-card {
  border: 1px solid #e5e8eb;
  border-radius: 8px;
  background-color: #fcfcfc;
  transition: all 0.2s ease;
  overflow: hidden;
}

.prompt-card:hover {
  border-color: #d1d5db;
}

.prompt-card.is-expanded {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.08);
}

.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  background-color: #ffffff;
  user-select: none;
  border-bottom: 1px solid transparent;
  transition: background-color 0.2s, border-bottom-color 0.2s;
}

.prompt-card.is-expanded .prompt-header {
  border-bottom-color: #e5e8eb;
  background-color: #f0fdf4;
}

.prompt-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.prompt-icon {
  color: #6b7280;
  font-size: 16px;
  transition: color 0.2s;
}
.prompt-card.is-expanded .prompt-icon {
  color: #3b82f6;
}

.chevron {
  color: #9ca3af;
  font-size: 18px;
  transition: transform 0.3s ease;
}

.prompt-body {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.prompt-card.is-expanded .prompt-body {
  grid-template-rows: 1fr;
  opacity: 1;
}

.prompt-body > .custom-textarea {
  min-height: 0;
  overflow: hidden;
  padding-top: 0; 
  padding-bottom: 0;
  border-width: 0;
  transition: all 0.3s ease;
  margin: 0;
}

.prompt-card.is-expanded .prompt-body > .custom-textarea {
  height: 200px;
  padding: 12px;
  border-width: 1px;
  margin: 12px;
  overflow-y: auto;
}

.prompt-editor {
  background-color: #ffffff !important;
  color: #3d3d3d !important;
  border: none !important;
  border-radius: 6px !important;
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace !important;
  font-size: 13px !important;
  line-height: 1.6 !important;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
  resize: vertical;
}

.prompt-editor:focus {
  box-shadow: 0 0 0 2px rgba(189, 189, 189, 0.5) !important;
  background-color: #ffffff !important;
}

.prompt-actions {
  position: absolute;
  top: 24px;
  right: 28px;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

.prompt-card.is-expanded:hover .prompt-actions {
  opacity: 1;
  pointer-events: auto;
}

.action-text-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #d4d4d4;
  border-radius: 4px;
  padding: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.action-text-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
}

/* ==========================================
   常规表单元素
   ========================================== */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

input[type="number"], .custom-textarea {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  transition: all 0.2s;
  background-color: #f9fafb;
  color: #111827;
  width: 100%;
  box-sizing: border-box;
}
input[type="number"]:focus, .custom-textarea:focus {
  outline: none;
  border-color: #3b82f6;
  background-color: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.grid-2-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.grid-3-cols {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.divider {
  height: 1px;
  background-color: #e5e8eb;
  margin: 24px 0 16px 0;
}

.sub-title {
  margin: 0 0 16px 0;
  font-size: 14px;
  font-weight: 600;
  color: #4b5563;
}

/* ==========================================
   加载动画
   ========================================== */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 50vh;
  color: #6b7280;
}
.spin-icon { animation: spin 1s linear infinite; }
.large-spin { font-size: 32px; margin-bottom: 12px; color: #9ca3af; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
/* ==========================================
   滚动条美化 (macOS 极简风格)
   ========================================== */
/* 整体滚动条 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

/* 滚动条轨道 */
::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 4px;
}

/* 滚动条滑块 */
::-webkit-scrollbar-thumb {
  background: #d1d5db; /* 默认浅灰色 */
  border-radius: 4px;
  transition: background-color 0.2s;
}

/* 鼠标悬浮在滚动条上时加深颜色 */
::-webkit-scrollbar-thumb:hover {
  background: #9ca3af; 
}

/* 针对 Prompt 文本输入框的滚动条进行微调，让它更细一点 */
.custom-textarea::-webkit-scrollbar {
  width: 4px;
}
.custom-textarea::-webkit-scrollbar-thumb {
  background: #e5e8eb;
}
.custom-textarea::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}

/* 兼容 Firefox 的标准写法 */
* {
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
</style>