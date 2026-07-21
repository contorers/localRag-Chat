<template>
  <div class="settings-page">
    <header class="settings-header">
      <div class="header-left">
        <button class="icon-btn back-btn" @click="goBack" title="返回">
          <Icon icon="lucide:arrow-left" />
        </button>
        <h2>厂商与模型配置管理</h2>
      </div>
      <button v-if="currentView === 'list'" class="primary-btn" @click="openProviderForm(null)">
        <Icon icon="lucide:plus" /> 新增厂商
      </button>
    </header>

    <main class="settings-content" @scroll="handleMainScroll">
      <transition name="fade" mode="out-in">
        <div v-if="currentView === 'list'" class="list-view">
          
          <!-- 🌟 新增：全局任务路由分配面板 (完全复用你的 custom-dropdown) -->
          <div v-if="providersList.length > 0" class="global-routing-card">
          
            <div class="routing-grid">
              
              <!-- 主对话大脑 -->
              <div class="routing-item">
                <label>
                  <Icon icon="lucide:message-square" /> 主对话大脑 (Chat)
                </label>
                <p class="help-text">负责核心业务逻辑与日常对话，建议选择高智商模型。</p>
                
                <div class="custom-dropdown global-dropdown" @click.stop>
                  <button class="dropdown-trigger routing-trigger" @click="toggleDropdown('globalChat')">
                    <span class="trigger-text">{{ getGlobalModelName(globalConfig.chatModelId, '-- 请选择主对话模型 --') }}</span>
                    <Icon icon="lucide:chevron-down" class="trigger-icon" :class="{ 'rotate-180': activeDropdown === 'globalChat' }" />
                  </button>
                  <transition name="dropdown-fade">
                    <ul v-if="activeDropdown === 'globalChat'" class="dropdown-menu routing-menu">
                      <template v-for="p in providersList" :key="'chat_p_' + p.id">
                        <template v-if="getTextModels(p.models).length > 0">
                          <!-- 厂商名称作为分组标题 -->
                          <li class="dropdown-group-title">{{ p.name }}</li>
                          <li 
                            v-for="m in getTextModels(p.models)" 
                            :key="m.id"
                            class="dropdown-item"
                            :class="{ 'is-active': globalConfig.chatModelId === m.id }"
                            @click="selectGlobalModel('chat', m.id)"
                          >
                            <span class="item-name">{{ m.name }}</span>
                            <Icon v-if="globalConfig.chatModelId === m.id" icon="lucide:check" class="check-icon" />
                          </li>
                        </template>
                      </template>
                    </ul>
                  </transition>
                </div>
              </div>

              <!-- 上下文压缩引擎 -->
              <div class="routing-item">
                <label>
                  <Icon icon="lucide:minimize-2" /> 历史压缩引擎 (Compress)
                </label>
                <p class="help-text">负责后台提炼历史事实，建议选择极速、低成本的小模型。</p>
                
                <div class="custom-dropdown global-dropdown" @click.stop>
                  <button class="dropdown-trigger routing-trigger" @click="toggleDropdown('globalCompress')">
                    <span class="trigger-text">{{ getGlobalModelName(globalConfig.compressModelId, '-- 跟随主对话模型 (不分离) --') }}</span>
                    <Icon icon="lucide:chevron-down" class="trigger-icon" :class="{ 'rotate-180': activeDropdown === 'globalCompress' }" />
                  </button>
                  <transition name="dropdown-fade">
                    <ul v-if="activeDropdown === 'globalCompress'" class="dropdown-menu routing-menu">
                      <li class="dropdown-item" :class="{ 'is-active': !globalConfig.compressModelId }" @click="selectGlobalModel('compress', '')">
                        <span class="item-name text-gray">-- 跟随主对话模型 (不分离) --</span>
                        <Icon v-if="!globalConfig.compressModelId" icon="lucide:check" class="check-icon" />
                      </li>
                      <template v-for="p in providersList" :key="'comp_p_' + p.id">
                        <template v-if="getTextModels(p.models).length > 0">
                          <li class="dropdown-group-title">{{ p.name }}</li>
                          <li 
                            v-for="m in getTextModels(p.models)" 
                            :key="m.id"
                            class="dropdown-item"
                            :class="{ 'is-active': globalConfig.compressModelId === m.id }"
                            @click="selectGlobalModel('compress', m.id)"
                          >
                            <span class="item-name">{{ m.name }}</span>
                            <Icon v-if="globalConfig.compressModelId === m.id" icon="lucide:check" class="check-icon" />
                          </li>
                        </template>
                      </template>
                    </ul>
                  </transition>
                </div>
              </div>
            </div>
          </div>

          <div v-if="providersList.length === 0 && !isLoadingList" class="empty-state">
            <Icon icon="lucide:server" class="empty-icon" />
            <p>暂无任何厂商及模型配置</p>
            <button class="ghost-btn" @click="openProviderForm(null)">添加第一个厂商</button>
          </div>

          <div v-else class="provider-grid">
            <div 
              v-for="provider in providersList" 
              :key="provider.id" 
              class="provider-card"
              :class="{ 'is-expanded': expandedProviders.includes(provider.id) }"
            >
              <div class="provider-header" @click="toggleProvider(provider)">
                <div class="provider-title-wrapper">
                  <Icon 
                    icon="lucide:chevron-right" 
                    class="chevron-icon" 
                    :class="{ 'rotate-90': expandedProviders.includes(provider.id) }" 
                  />
                  <div class="provider-title">
                    <div class="title-icon-box">
                      <Icon icon="lucide:building-2" class="provider-icon" />
                    </div>
                    <div class="title-text-group">
                      <h3>{{ provider.name }}</h3>
                      <div class="key-mask-wrapper">
                        <a v-if="provider.officialUrl" :href="provider.officialUrl" target="_blank" class="meta-link" @click.stop>
                          <Icon icon="lucide:external-link" /> 官网
                        </a>
                        <span class="key-mask">Key: ••••••••</span>
                        <span class="model-count-badge">{{ provider.models?.length || 0 }} 个模型(已加载)</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div class="provider-actions" @click.stop>
                  <button class="icon-btn edit" @click="openProviderForm(provider)" title="编辑厂商">
                    <Icon icon="lucide:edit" />
                  </button>
                  <button class="icon-btn delete" @click="handleDeleteProvider(provider.id, provider.name)" title="删除厂商">
                    <Icon icon="lucide:trash-2" />
                  </button>
                </div>
              </div>

              <div class="models-collapse-wrapper" :class="{ 'open': expandedProviders.includes(provider.id) }">
                <div class="models-container">
                  <div class="models-header">
                    <h4>已配置的模型节点</h4>
                    <button class="action-btn text-blue" @click.stop="openModelForm(provider.id, null)">
                      <Icon icon="lucide:plus-circle" /> 添加模型
                    </button>
                  </div>
                  
                  <div 
                    v-if="provider.models && provider.models.length > 0" 
                    class="model-list" 
                    @scroll="handleModelScroll(provider, $event)"
                    style="max-height: 400px; overflow-y: auto; padding-right: 8px;"
                  >
                    <div 
                      v-for="model in provider.models" 
                      :key="model.id" 
                      class="model-item" 
                    >
                      <div class="model-info">
                        <div class="model-name-row">
                          <span class="model-name">{{ model.name }}</span>
                          <span class="type-badge" :class="model.modelType || 'text'">
                            {{ formatModelType(model.modelType) }}
                          </span>
                        </div>
                        <div class="model-meta">
                          <span class="meta-item" title="完整接口地址">
                            <Icon icon="lucide:link" /> 
                            {{ model.baseUrl || '未配置 URL' }}
                          </span>
                        </div>
                      </div>
                      <div class="model-actions">
                        <button class="icon-btn edit" @click.stop="openModelForm(provider.id, model)" title="编辑模型">
                          <Icon icon="lucide:edit-3" />
                        </button>
                        <button class="icon-btn delete" @click.stop="handleDeleteModel(provider.id, model.id)" title="删除模型">
                          <Icon icon="lucide:x" />
                        </button>
                      </div>
                    </div>
                    
                    <div class="scroll-status-footer" style="padding: 10px 0;">
                      <div v-if="provider._isLoadingModels" class="loading-text text-gray text-xs text-center flex items-center justify-center">
                        <Icon icon="lucide:loader-2" class="spin-icon mr-1" /> 加载更多模型中...
                      </div>
                      <div v-else-if="provider._noMoreModels && provider.models.length >= 20" class="no-more-text text-gray text-xs text-center">
                        — 到底啦 —
                      </div>
                    </div>
                  </div>
                  <div v-else class="empty-models">该厂商下暂无模型配置</div>
                </div>
              </div>
            </div>
            
            <div class="scroll-status-footer flex justify-center py-6 text-gray-500 text-sm">
              <div v-if="isLoadingList" class="loading-text flex items-center">
                <Icon icon="lucide:loader-2" class="spin-icon mr-2" /> 加载厂商中...
              </div>
              <div v-else-if="noMoreProviders" class="no-more-text">
                —— 没有更多厂商了 ——
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="currentView === 'provider-form'" class="form-view">
          <div class="form-card">
            <h3 class="form-title">{{ isNewRecord ? '新增厂商' : '编辑厂商' }}</h3>
            <p class="form-desc">配置厂商的基础信息，API Key 将在本地进行高强度加密。</p>

            <div class="api-form">
              <div class="form-group">
                <label>厂商名称<span class="required">*</span></label>
                <input v-model.trim="providerForm.name" type="text" placeholder="例如: OpenAI / 阿里云" />
              </div>

              <div class="form-group">
                <label>官网地址 (URL)</label>
                <input v-model.trim="providerForm.officialUrl" type="url" placeholder="例如: https://openai.com" />
              </div>

              <div class="form-group">
                <label>厂商 API Key<span class="required">*</span></label>
                <div class="input-with-icon">
                  <input 
                    v-model.trim="providerForm.apiKey" 
                    :type="showKey ? 'text' : 'password'" 
                    placeholder="sk-xxxxxxxxxxxxxxxx" 
                  />
                  <button type="button" class="toggle-eye" @click="showKey = !showKey">
                    <Icon :icon="showKey ? 'lucide:eye-off' : 'lucide:eye'" />
                  </button>
                </div>
              </div>

              <div class="form-footer">
                <button type="button" class="cancel-btn" @click="closeForm">取消</button>
                <button type="button" class="submit-btn" @click="handleSaveProvider" :disabled="isSaving">
                  <Icon v-if="isSaving" icon="lucide:loader-2" class="spin-icon" />
                  {{ isSaving ? '保存加密中...' : '保存厂商' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="currentView === 'model-form'" class="form-view">
          <div class="form-card model-form-card">
            <h3 class="form-title">{{ isNewRecord ? '新增模型' : '编辑模型' }}</h3>
            <p class="form-desc">配置该模型的接口地址及专属参数重写。</p>

            <div class="api-form">
              <div class="grid-2-cols">
                <div class="form-group">
                  <label>模型类型<span class="required">*</span></label>
                  <div class="custom-dropdown" @click.stop>
                    <button class="dropdown-trigger" @click="toggleDropdown('modelType')">
                      <span class="trigger-text">{{ formatModelType(modelForm.modelType) }}</span>
                      <Icon icon="lucide:chevron-down" class="trigger-icon" :class="{ 'rotate-180': activeDropdown === 'modelType' }" />
                    </button>
                    <transition name="dropdown-fade">
                      <ul v-if="activeDropdown === 'modelType'" class="dropdown-menu">
                        <li class="dropdown-item" :class="{ 'is-active': modelForm.modelType === 'text' }" @click="selectModelType('text')">
                          <span class="item-name">对话/文本 (Text)</span>
                          <Icon v-if="modelForm.modelType === 'text'" icon="lucide:check" class="check-icon" />
                        </li>
                        <li class="dropdown-item" :class="{ 'is-active': modelForm.modelType === 'image' }" @click="selectModelType('image')">
                          <span class="item-name">图像生成 (Image)</span>
                          <Icon v-if="modelForm.modelType === 'image'" icon="lucide:check" class="check-icon" />
                        </li>
                        <li class="dropdown-item" :class="{ 'is-active': modelForm.modelType === 'video' }" @click="selectModelType('video')">
                          <span class="item-name">视频生成 (Video)</span>
                          <Icon v-if="modelForm.modelType === 'video'" icon="lucide:check" class="check-icon" />
                        </li>
                        <li class="dropdown-item" :class="{ 'is-active': modelForm.modelType === 'embedding' }" @click="selectModelType('embedding')">
                          <span class="item-name">向量化 (Embedding)</span>
                          <Icon v-if="modelForm.modelType === 'embedding'" icon="lucide:check" class="check-icon" />
                        </li>
                      </ul>
                    </transition>
                  </div>
                </div>
                <div class="form-group">
                  <label>模型名称<span class="required">*</span></label>
                  <input v-model.trim="modelForm.name" type="text" placeholder="例如: gpt-4o / sora" />
                </div>
              </div>

              <div class="form-group">
                <label>完整接口地址 (URL)<span class="required">*</span></label>
                <input v-model.trim="modelForm.baseUrl" type="url" placeholder="例如: https://api.openai.com/v1/chat/completions" />
              </div>

              <div class="advanced-panel">
                <h5 class="section-title">
                  <Icon icon="lucide:monitor-dot" style="margin-right:4px;" />
                  本地系统控制 (模型专属重写)
                </h5>
                <div class="dynamic-params" v-if="modelForm.modelType === 'text'">
                  
                  <div class="form-group" style="margin-bottom: 12px;">
                    <label class="switch-label-wrapper">
                      <div class="switch-container">
                        <input type="checkbox" v-model="modelForm.enableThinking" class="switch-input" />
                        <span class="switch-slider"></span>
                      </div>
                      <span class="switch-text">启用深度思考模式 <span class="text-gray-400 font-normal ml-1">(开启后解析 Reasoning / 思维链字段)</span></span>
                    </label>
                  </div>

                  <div class="form-group" style="margin-bottom: 20px;">
                    <label class="switch-label-wrapper">
                      <div class="switch-container">
                        <input type="checkbox" v-model="modelForm.includeUsage" class="switch-input" />
                        <span class="switch-slider"></span>
                      </div>
                      <span class="switch-text">记录 Token 消耗量 <span class="text-gray-400 font-normal ml-1">(开启后请求体注入 include_usage 并在本地统计)</span></span>
                    </label>
                  </div>

                  <div class="params-card-group">
                    <div class="group-header">
                      <Icon icon="lucide:brain-circuit" /> 记忆与压缩阈值
                    </div>
                    <div class="grid-2-cols">
                      <div class="form-group">
                        <label>短期记忆保留 (条)</label>
                        <input type="number" v-model.number="modelForm.recentLimit" min="1" max="50" />
                      </div>
                      <div class="form-group">
                        <label>上下文压缩阈值 (字符)</label>
                        <input type="number" v-model.number="modelForm.compressThreshold" min="1000" step="500" />
                      </div>
                      <div class="form-group">
                        <label>记忆摘要最大长度 (Tokens)</label>
                        <input type="number" v-model.number="modelForm.maxSummaryTokens" min="100" />
                      </div>
                      <div class="form-group">
                        <label>长期画像提取上限 (Tokens)</label>
                        <input type="number" v-model.number="modelForm.maxExtractionTokens" min="50" />
                      </div>
                    </div>
                  </div>

                  <div class="params-card-group">
                    <div class="group-header">
                      <Icon icon="lucide:database-zap" /> 历史记忆召回参数
                    </div>
                    <div class="grid-2-cols">
                      <div class="form-group">
                        <label>后台压缩参考条数</label>
                        <input type="number" v-model.number="modelForm.searchLimit" min="1" max="50" />
                      </div>
                      <div class="form-group">
                        <label>历史检索候选池大小</label>
                        <input type="number" v-model.number="modelForm.vectorSearchLimit" min="1" max="20" />
                      </div>
                      <div class="form-group">
                        <label>最终历史注入条数</label>
                        <input type="number" v-model.number="modelForm.finalContextLimit" min="1" max="10" />
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="text-hint">该模型类型无需额外本地控制参数</div>

                <h5 class="section-title" style="margin-top: 24px;">
                  <Icon icon="lucide:blocks" style="margin-right:4px;" />
                  自定义 API 负载参数
                </h5>
                <p class="form-hint" style="margin-bottom: 16px;">在此配置请求体中的专属参数 (如 temperature, max_tokens, steps 等)。</p>
                
                <div class="custom-params-list">
                  <div v-for="(param, index) in modelForm.customParams" :key="index" class="param-row">
                    <input type="text" v-model.trim="param.key" class="param-key" placeholder="参数名 (如 top_p)" />
                    <div class="custom-dropdown param-type-dropdown" @click.stop>
                      <button class="dropdown-trigger" @click="toggleDropdown(`paramType_${index}`)">
                        <span class="trigger-text">{{ formatParamType(param.type) }}</span>
                        <Icon icon="lucide:chevron-down" class="trigger-icon" :class="{ 'rotate-180': activeDropdown === `paramType_${index}` }" />
                      </button>
                      <transition name="dropdown-fade">
                        <ul v-if="activeDropdown === `paramType_${index}`" class="dropdown-menu">
                          <li class="dropdown-item" :class="{ 'is-active': param.type === 'number' }" @click="selectParamType(index, 'number')"><span class="item-name">数字</span><Icon v-if="param.type === 'number'" icon="lucide:check" class="check-icon" /></li>
                          <li class="dropdown-item" :class="{ 'is-active': param.type === 'string' }" @click="selectParamType(index, 'string')"><span class="item-name">字符</span><Icon v-if="param.type === 'string'" icon="lucide:check" class="check-icon" /></li>
                          <li class="dropdown-item" :class="{ 'is-active': param.type === 'boolean' }" @click="selectParamType(index, 'boolean')"><span class="item-name">布尔</span><Icon v-if="param.type === 'boolean'" icon="lucide:check" class="check-icon" /></li>
                        </ul>
                      </transition>
                    </div>
                    
                    <input v-if="param.type === 'string'" v-model="param.value" type="text" class="param-value" placeholder="参数值" />
                    <input v-else-if="param.type === 'number'" v-model.number="param.value" type="number" step="any" class="param-value" placeholder="参数值" />
                    <div v-else-if="param.type === 'boolean'" class="param-value boolean-switch-wrapper">
                      <label class="switch-label-wrapper" style="margin: 0; height: 100%;">
                        <div class="switch-container">
                          <input type="checkbox" v-model="param.value" class="switch-input" />
                          <span class="switch-slider"></span>
                        </div>
                        <span class="switch-text" style="width: 40px; color: #475569; font-family: monospace;">{{ param.value ? 'true' : 'false' }}</span>
                      </label>
                    </div>

                    <button class="icon-btn delete" @click="removeCustomParam(index)" title="删除参数">
                      <Icon icon="lucide:minus-circle" />
                    </button>
                  </div>
                  
                  <button type="button" class="action-btn text-blue" style="margin-top: 8px;" @click="addCustomParam">
                    <Icon icon="lucide:plus-circle" /> 添加参数
                  </button>
                </div>
              </div>

              <div class="form-footer" style="margin-top: 0;">
                <button type="button" class="cancel-btn" @click="closeForm">取消</button>
                <button type="button" class="submit-btn" @click="handleSaveModel" :disabled="isSaving">
                  <Icon v-if="isSaving" icon="lucide:loader-2" class="spin-icon" />保存模型配置
                </button>
              </div>
            </div>
          </div>
        </div>
      </transition>
    </main>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { aiDatabase } from "../rustservice/aiDatabase.js";
import { CryptoEngine } from "../utils/cryptoEngine.js";
import { globalKeyManager } from "../utils/keyManager.js";
import { showConfirm } from "./ui/ui-js/confirm.js";

const router = useRouter();

// ==========================================
// 1. 响应式全局状态管理 (State)
// ==========================================
const currentView = ref('list'); 
const isNewRecord = ref(true);
const isSaving = ref(false);
const showKey = ref(false);
const activeDropdown = ref(null);
const expandedProviders = ref([]);

// 🌟 新增：全局任务路由状态
const globalConfig = reactive({
  chatModelId: "",
  compressModelId: ""
});

// 厂商列表与双层分页状态
const providersList = ref([]);
const isLoadingList = ref(false);
const noMoreProviders = ref(false);
const providersCursor = ref(null);

// 非响应式组件级变量 (仅用于逻辑流转)
let originalEncryptedKey = '';
let targetProviderId = null;

// 表单对象 (已剥离全局 Default 字段)
const providerForm = reactive({ 
  id: null, name: '', officialUrl: '', apiKey: '' 
});

const modelForm = reactive({ 
  id: null, name: '', baseUrl: '', modelType: 'text',
  enableThinking: false, includeUsage: true, recentLimit: 10, compressThreshold: 4000,
  maxSummaryTokens: 600, maxExtractionTokens: 150, searchLimit: 4,
  vectorSearchLimit: 8, finalContextLimit: 5, customParams: []
});

// ==========================================
// 2. 生命周期钩子 (Lifecycle)
// ==========================================
onMounted(async () => {
  window.addEventListener('click', closeDropdown);
  await loadProviders(true); 

  // 初始化拉取全局路由配置
  try {
    const config = await aiDatabase.getSystemSettings(0);
    if (config) {
      globalConfig.chatModelId = config.chatModelId || "";
      globalConfig.compressModelId = config.compressModelId || "";
    }
  } catch (e) {
    console.warn("未获取到全局路由配置", e);
  }
});

onUnmounted(() => {
  window.removeEventListener('click', closeDropdown);
  originalEncryptedKey = '';
  targetProviderId = null;
});

// ==========================================
// 3. 数据加载与分页架构 (Database & Pagination)
// ==========================================

const loadModelsForProvider = async (provider) => {
  if (provider._isLoadingModels || provider._noMoreModels) return;
  
  try {
    provider._isLoadingModels = true;
    const newModels = await aiDatabase.getModels(provider.id, provider._modelsCursor, 50);
 
    if (newModels.length === 0) {
      provider._noMoreModels = true;
      return;
    }

    provider.models.push(...newModels);
    provider._modelsCursor = newModels[newModels.length - 1].id;

    if (newModels.length < 20) {
      provider._noMoreModels = true;
    }
  } catch (error) {
    console.error(`加载厂商[${provider.name}]模型失败:`, error);
  } finally {
    provider._isLoadingModels = false;
  }
};

const loadProviders = async (isReset = false) => {
  if (isLoadingList.value || (!isReset && noMoreProviders.value)) return;

  try {
    isLoadingList.value = true;
    
    if (isReset) {
      providersList.value = [];
      providersCursor.value = null;
      noMoreProviders.value = false;
    }

    const newProviders = await aiDatabase.getProviders(providersCursor.value, 20);

    if (newProviders.length === 0) {
      noMoreProviders.value = true;
      return;
    }

    for (let p of newProviders) {
      p.models = [];
      p._modelsCursor = Number.MAX_SAFE_INTEGER;
      p._isLoadingModels = false;
      p._noMoreModels = false;
    }

    providersList.value.push(...newProviders);
    providersCursor.value = newProviders[newProviders.length - 1].id;

    // 🌟 新增核心代码：使用 Promise.all 并发自动加载这些厂商下的模型
    // 这样顶部全局路由下拉框一进来就能拿到所有模型数据
    await Promise.all(newProviders.map(p => loadModelsForProvider(p)));

    if (newProviders.length < 20) {
      noMoreProviders.value = true;
    }
  } catch (error) {
    console.error("加载厂商数据失败:", error);
  } finally {
    isLoadingList.value = false;
  }
};

// ==========================================
// 4. UI 交互与事件处理 (UI Handlers)
// ==========================================
const handleMainScroll = (e) => {
  if (currentView.value !== 'list') return;
  const { scrollTop, clientHeight, scrollHeight } = e.target;
  if (scrollTop + clientHeight >= scrollHeight - 50) {
    loadProviders(false);
  }
};

const handleModelScroll = (provider, e) => {
  const { scrollTop, clientHeight, scrollHeight } = e.target;
  if (scrollTop + clientHeight >= scrollHeight - 30) {
    loadModelsForProvider(provider);
  }
};

const toggleDropdown = (id) => {
  activeDropdown.value = activeDropdown.value === id ? null : id;
};

const closeDropdown = () => {
  activeDropdown.value = null;
};

const toggleProvider = (provider) => {
  loadModelsForProvider(provider);
  const index = expandedProviders.value.indexOf(provider.id);
  if (index > -1) {
    expandedProviders.value.splice(index, 1);
  } else {
    expandedProviders.value.push(provider.id);
  }
};

const goBack = () => {
  if (currentView.value !== 'list') {
    closeForm();
  } else {
    router.push('/aiUserChat');
  }
};

const closeForm = () => {
  currentView.value = 'list';
  targetProviderId = null;
  originalEncryptedKey = '';
};

// 基础格式化工具
const getTextModels = (models) => models ? models.filter(m => !m.modelType || m.modelType === 'text') : [];
const formatModelType = (type) => ({ 'text': '对话文本', 'image': '图像生成', 'video': '视频生成', 'embedding': '向量化' }[type] || '对话文本');
const formatParamType = (type) => ({ 'number': '数字', 'string': '字符', 'boolean': '布尔' }[type] || '数字');

const selectModelType = (type) => { modelForm.modelType = type; closeDropdown(); };
const selectParamType = (index, type) => {
  modelForm.customParams[index].type = type;
  modelForm.customParams[index].value = type === 'boolean' ? true : type === 'number' ? 0 : '';
  closeDropdown();
};

const addCustomParam = () => modelForm.customParams.push({ key: '', value: '', type: 'number' });
const removeCustomParam = (index) => modelForm.customParams.splice(index, 1);

// ==========================================
// 5. 全局路由与数据保存逻辑 (Business Logic)
// ==========================================

// 🌟 回显格式: "厂商名称 - 模型名称"
const getGlobalModelName = (modelId, fallback) => {
  if (!modelId) return fallback;
  for (const p of providersList.value) {
    if (p.models) {
      const model = p.models.find(m => m.id === modelId);
      if (model) {
        return `${p.name} - ${model.name}`;
      }
    }
  }
  return fallback;
};

// 🌟 全局模型下拉框选中事件
const selectGlobalModel = async (type, modelId) => {
  if (type === 'chat') {
    globalConfig.chatModelId = modelId;
  } else if (type === 'compress') {
    globalConfig.compressModelId = modelId;
  }
  closeDropdown();
  
  // 立即触发保存到数据库
  try {
    await aiDatabase.saveSystemSettings({
      id:0,
      chatModelId: globalConfig.chatModelId,
      compressModelId: globalConfig.compressModelId
    });
  } catch (error) {
    console.error("保存全局路由失败:", error);
  }
};

const openProviderForm = (provider) => {
  showKey.value = false;
  isNewRecord.value = !provider;
  
  providerForm.id = provider?.id || null;
  providerForm.name = provider?.name || '';
  providerForm.officialUrl = provider?.officialUrl || '';
  
  originalEncryptedKey = provider?.apiKey || ''; 
  providerForm.apiKey = provider ? '********' : '';
  
  currentView.value = 'provider-form';
};

const openModelForm = (providerId, model) => {
  targetProviderId = providerId;
  isNewRecord.value = !model;
  
  modelForm.id = model?.id || null;
  modelForm.name = model?.name || '';
  modelForm.baseUrl = model?.baseUrl || ''; 
  modelForm.modelType = model?.modelType || 'text';
  
  modelForm.enableThinking = model?.enableThinking ?? false;
  modelForm.includeUsage = model?.includeUsage ?? true;
  modelForm.recentLimit = model?.recentLimit ?? 10;
  modelForm.compressThreshold = model?.compressThreshold ?? 4000;
  modelForm.maxSummaryTokens = model?.maxSummaryTokens ?? (model?.compressMaxTokens || 600);
  modelForm.maxExtractionTokens = model?.maxExtractionTokens ?? 150;
  modelForm.searchLimit = model?.searchLimit ?? 4;
  modelForm.vectorSearchLimit = model?.vectorSearchLimit ?? 8;
  modelForm.finalContextLimit = model?.finalContextLimit ?? 5;

  if (model) {
    let parsedParams = model.customParams ? JSON.parse(JSON.stringify(model.customParams)) : [];
    if (!model.customParams && model.temperature !== undefined) {
      parsedParams.push({ key: 'temperature', value: model.temperature, type: 'number' });
      parsedParams.push({ key: 'max_tokens', value: model.maxTokens || 4096, type: 'number' });
    }
    modelForm.customParams = parsedParams;
  } else {
    modelForm.customParams = [
      { key: 'temperature', value: 0.7, type: 'number' },
      { key: 'max_tokens', value: 4096, type: 'number' }
    ];
  }
  
  currentView.value = 'model-form';
};

const handleSaveProvider = async () => {
  if (!providerForm.name) return showAlert("warning", `请输入厂商名称`);
  if (!providerForm.apiKey) return showAlert("warning", `请输入 API Key`);

  try {
    isSaving.value = true;
    let finalApiKey = originalEncryptedKey;

    if (providerForm.apiKey !== '********' && providerForm.apiKey.length > 0) {
      const myPublicKey = await globalKeyManager.getEncryptPublicKey();
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(providerForm.apiKey);
      const keyBuffer = CryptoEngine._base64ToArrayBuffer(myPublicKey);
      
      const publicKey = await window.crypto.subtle.importKey(
        "spki", keyBuffer, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]
      );
      
      const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: "RSA-OAEP" }, publicKey, encodedData
      );
      
      const bytes = new Uint8Array(encryptedBuffer);
      let binaryStr = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binaryStr += String.fromCharCode(bytes[i]);
      }
      finalApiKey = btoa(binaryStr);
    }

    const providerToSave = { 
      id: providerForm.id,
      name: providerForm.name,
      officialUrl: providerForm.officialUrl,
      apiKey: finalApiKey
    };
    
    const savedId = await aiDatabase.saveProvider(providerToSave); 
    
    if (isNewRecord.value && savedId) {
      providersList.value.unshift({
        ...providerToSave,
        id: savedId,
        models: [],
        _modelsCursor: null,
        _isLoadingModels: false,
        _noMoreModels: true
      });
    } else {
      const idx = providersList.value.findIndex(p => p.id === providerToSave.id);
      if (idx > -1) Object.assign(providersList.value[idx], providerToSave);
    }

    closeForm();
  } catch (error) {
    console.error("保存厂商失败:", error);
    showAlert("warning", `保存失败，请检查加密环境。`); 
  } finally {
    isSaving.value = false;
  }
};

const handleSaveModel = async () => {
  if (!modelForm.name || !modelForm.baseUrl) return showAlert("warning", `请完整填写模型名称和完整接口地址`); 

  try {
    isSaving.value = true;
    
    const newModel = JSON.parse(JSON.stringify(modelForm));
    newModel.customParams = newModel.customParams.filter(p => p.key.trim() !== '');
    newModel.providerId = targetProviderId; 

    const savedModelId = await aiDatabase.saveModel(newModel);
    newModel.id = isNewRecord.value ? savedModelId : newModel.id;

    const pIdx = providersList.value.findIndex(p => p.id === targetProviderId);
    if (pIdx > -1) {
      if (isNewRecord.value) {
        providersList.value[pIdx].models.unshift(newModel);
      } else {
        const mIdx = providersList.value[pIdx].models.findIndex(m => m.id === newModel.id);
        if (mIdx > -1) Object.assign(providersList.value[pIdx].models[mIdx], newModel);
      }
    }

    closeForm();
  } catch (error) {
    console.error("保存模型失败:", error);
    showAlert("warning", `保存模型失败`); 
  } finally {
    isSaving.value = false;
  }
};

const handleDeleteProvider = async (providerId, providerName) => {
  const isConfirm = await showConfirm({
    title: "删除厂商",
    message: `确定要删除厂商【${providerName}】及其所有模型配置吗？`,
    type: "warning", // 建议用 warning 颜色提醒
  });
  if(!isConfirm) return;  
  
  try {
    // 正确传入 providerId
    await aiDatabase.deleteProvider(providerId); 
    
    // 直接从厂商列表中移除该厂商
    providersList.value = providersList.value.filter(p => p.id !== providerId);
    
    // 补充逻辑：如果删除的厂商包含当前全局选中的模型，最好清理全局配置
    // (可选，视你的业务逻辑而定)
  } catch (error) {
    console.error("删除厂商失败:", error);
    showAlert("warning", `删除厂商失败`); 
  }
};

const handleDeleteModel = async (providerId, modelId) => {
  const isConfirm = await showConfirm({
    title: "删除模型",
    message: `确定要删除该模型吗？`,
    type: "info",
  });
  if(!isConfirm) return;  
  
  try {
    await aiDatabase.deleteModel(modelId); 
    const pIdx = providersList.value.findIndex(p => p.id === providerId);
    if (pIdx > -1) {
      providersList.value[pIdx].models = providersList.value[pIdx].models.filter(m => m.id !== modelId);
    }
  } catch (error) {
    showAlert("warning", `删除模型失败`); 
  }
};
</script>

<style scoped>
/* ==========================================
   1. 基础布局与排版 (Layout & Typography)
========================================== */
.settings-page { 
  display: flex; flex-direction: column; height: 100vh; width: 100%; 
  background-color: #f7f9fa; color: #333; 
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
  overflow: hidden; 
}
.settings-content { flex: 1; overflow-y: auto; padding: 24px; }

/* ==========================================
   2. 头部导航 (Header)
========================================== */
.settings-header { 
  display: flex; justify-content: space-between; align-items: center; 
  padding: 16px 24px; background-color: #ffffff; border-bottom: 1px solid #e5e8eb; 
  flex-shrink: 0; 
}
.header-left { display: flex; align-items: center; gap: 12px; }
.header-left h2 { font-size: 18px; font-weight: 600; margin: 0; color: #111827; }

/* ==========================================
   3. 通用按钮 (Buttons)
========================================== */
.back-btn { background: transparent; border: none; font-size: 20px; color: #6b7280; cursor: pointer; padding: 8px; border-radius: 8px; transition: background 0.2s; display: flex; }
.back-btn:hover { background-color: #f3f4f6; color: #111827; }

.primary-btn { display: flex; align-items: center; gap: 6px; background-color: #111827; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.primary-btn:hover { background-color: #374151; }
.primary-btn:disabled { opacity: 0.7; cursor: not-allowed; }

.ghost-btn { margin-top: 16px; background: transparent; border: 1px solid #d1d5db; padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
.ghost-btn:hover { background: #f3f4f6; color: #111827; }

.icon-btn { background: transparent; border: none; padding: 6px; border-radius: 6px; cursor: pointer; color: #6b7280; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;}
.icon-btn.edit:hover { background-color: #e5e7eb; color: #111827; }
.icon-btn.delete:hover { background-color: #fef2f2; color: #ef4444; }

.action-btn { background: transparent; border: none; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; cursor: pointer; transition: color 0.2s; }
.text-blue { color: #3b82f6; }
.text-blue:hover:not(:disabled) { color: #2563eb; }
.text-gray { color: #9ca3af; cursor: not-allowed; }

/* ==========================================
   🌟 4. 全局任务路由面板 (Global Routing Panel)
========================================== */
.global-routing-card {
  background-color: #ffffff;
  border: 1px solid #e5e8eb;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
  max-width: 900px;
  margin-left: auto;
  margin-right: auto;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
}

.global-routing-card .card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px dashed #e2e8f0;
}

.global-routing-card .header-icon {
  font-size: 24px;
  color: #3b82f6;
  background: #eff6ff;
  padding: 8px;
  border-radius: 8px;
}

.global-routing-card .header-text h3 {
  margin: 0 0 6px 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}

.global-routing-card .header-text p {
  margin: 0;
  font-size: 13px;
  color: #64748b;
}

.routing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
}

.routing-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.routing-item label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.routing-item .help-text {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: #94a3b8;
}

/* 路由面板专属的大号下拉框样式 */
.global-dropdown {
  width: 100%;
  margin-top: 4px;
}
.routing-trigger {
  padding: 10px 14px;
  font-size: 14px;
  background-color: #f8fafc;
  border-color: #e2e8f0;
}
.routing-trigger:hover {
  background-color: #f1f5f9;
  border-color: #cbd5e1;
}
.routing-menu {
  max-height: 280px;
  padding: 6px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  border-color: #cbd5e1;
}
/* 优雅的厂商分组标题 */
.dropdown-group-title {
  padding: 8px 12px 4px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 6px;
  user-select: none;
}
.dropdown-group-title:first-child {
  margin-top: 0;
}
/* 选项缩进，体现层级 */
.routing-menu .dropdown-item {
  padding-left: 16px;
}

/* ==========================================
   5. 列表与卡片视图 (List & Cards)
========================================== */
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; color: #6b7280; }
.empty-icon { font-size: 48px; margin-bottom: 16px; color: #d1d5db; }

.provider-grid { display: flex; flex-direction: column; gap: 16px; max-width: 900px; margin: 0 auto; }
.provider-card { background: #ffffff; border: 1px solid #e5e8eb; border-radius: 12px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02); display: flex; flex-direction: column; overflow: hidden; transition: border-color 0.3s, box-shadow 0.3s; }
.provider-card.is-expanded { border-color: #cbd5e1; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); }

.provider-header { padding: 16px 20px; background-color: #ffffff; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background-color 0.2s; }
.provider-header:hover { background-color: #f9fafb; }
.is-expanded .provider-header { background-color: #f8fafc; border-bottom: 1px solid #e5e8eb; }

.provider-title-wrapper { display: flex; align-items: center; gap: 12px; }
.chevron-icon { font-size: 18px; color: #9ca3af; transition: transform 0.3s ease; }
.chevron-icon.rotate-90 { transform: rotate(90deg); color: #4b5563; }
.provider-title { display: flex; align-items: center; gap: 12px; }
.title-icon-box { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background-color: #f3f4f6; border-radius: 8px; color: #4b5563; }
.provider-icon { font-size: 20px; }
.title-text-group h3 { margin: 0 0 2px 0; font-size: 16px; font-weight: 600; color: #111827; line-height: 1.2; }

.key-mask-wrapper { display: flex; align-items: center; gap: 12px; }
.meta-link { font-size: 11px; color: #3b82f6; text-decoration: none; display: flex; align-items: center; gap: 2px; }
.meta-link:hover { text-decoration: underline; }
.key-mask { font-size: 12px; color: #6b7280; font-family: monospace; }
.model-count-badge { font-size: 11px; background-color: #e5e7eb; color: #4b5563; padding: 2px 6px; border-radius: 12px; font-weight: 500; }
.provider-actions { display: flex; gap: 4px; }

/* ==========================================
   6. 模型列表展开区域 (Models Collapse)
========================================== */
.models-collapse-wrapper { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 0.3s ease, opacity 0.3s ease; }
.models-collapse-wrapper.open { grid-template-rows: 1fr; opacity: 1; }
.models-container { min-height: 0; overflow: hidden; padding: 0 20px; }

.models-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0 12px 0; }
.models-header h4 { margin: 0; font-size: 13px; font-weight: 600; color: #4b5563; }
.model-list { display: flex; flex-direction: column; gap: 8px; padding-bottom: 20px; }
.model-item { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background-color: #ffffff; border: 1px solid #e5e8eb; border-radius: 8px; transition: all 0.2s; }
.model-item:hover { border-color: #cbd5e1; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }

.model-info { display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
.model-name-row { display: flex; align-items: center; gap: 8px; }
.model-name { font-size: 14px; font-weight: 600; color: #1f2937; }
.type-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
.type-badge.text { background-color: #f3f4f6; color: #4b5563; border: 1px solid #e5e7eb; }
.type-badge.image { background-color: #fdf4ff; color: #2563eb; border: 1px solid #bfdbfe; }
.type-badge.video { background-color: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.type-badge.embedding { background-color: #f0fdf4; color: #059669; border: 1px solid #bbf7d0; }
.model-meta { display: flex; align-items: center; gap: 12px; margin-top: 2px; }
.meta-item { font-size: 12px; color: #6b7280; font-family: monospace; display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.model-actions { display: flex; gap: 4px; align-items: center; }
.empty-models { padding: 24px 0; margin-bottom: 20px; text-align: center; font-size: 13px; color: #9ca3af; background: #f9fafb; border-radius: 8px; border: 1px dashed #e5e8eb; }

/* ==========================================
   7. 表单视图通用 (Form Views)
========================================== */
.form-view { display: flex; justify-content: center; padding-bottom: 40px; margin-top: 20px;}
.form-card { background: #ffffff; border: 1px solid #e5e8eb; border-radius: 16px; padding: 32px; width: 100%; max-width: 550px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
.model-form-card { max-width: 680px; }
.form-title { margin: 0 0 8px 0; font-size: 20px; color: #111827; }
.form-desc { font-size: 13px; color: #6b7280; margin-bottom: 24px; line-height: 1.5; }

.api-form { display: flex; flex-direction: column; gap: 24px; }
.form-group { display: flex; flex-direction: column; gap: 8px; }
.form-group label { font-size: 14px; font-weight: 500; color: #374151; }
.required { color: #ef4444; margin-left: 4px; }
.form-hint { font-size: 12px; color: #9ca3af; margin-top: 2px; line-height: 1.4; }
.text-hint { font-size: 13px; color: #6b7280; margin-bottom: 12px; font-style: italic; }

.grid-2-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

input[type="text"], input[type="url"], input[type="password"], input[type="number"] {
  padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; 
  font-size: 14px; font-family: inherit; transition: all 0.2s; 
  background-color: #ffffff; color: #111827; width: 100%; box-sizing: border-box;
}
input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }

.input-with-icon { position: relative; display: flex; align-items: center; }
.input-with-icon input { width: 100%; padding-right: 40px; }
.toggle-eye { position: absolute; right: 8px; background: transparent; border: none; color: #9ca3af; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; }

/* 按钮区 */
.form-footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px; padding-top: 20px; border-top: 1px solid #f3f4f6; }
.cancel-btn { background: #ffffff; border: 1px solid #d1d5db; color: #374151; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.cancel-btn:hover { background: #f9fafb; }
.submit-btn { background: #111827; border: none; color: #ffffff; display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.submit-btn:hover:not(:disabled) { background: #374151; }
.spin-icon { animation: spin 1s linear infinite; }

/* ==========================================
   8. 高级配置面板 (Advanced Panel)
========================================== */
.advanced-panel { 
  display: flex; flex-direction: column; gap: 16px; 
  padding: 24px; background-color: #f8fafc; 
  border: 1px solid #e2e8f0; border-radius: 12px; 
}

.section-title { 
  margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #475569; 
  text-transform: uppercase; letter-spacing: 0.5px; 
  border-bottom: 1px solid #cbd5e1; padding-bottom: 10px; 
  display: flex; align-items: center; 
}

/* 内部小卡片 */
.params-card-group {
  background-color: #ffffff;
  border: 1px solid #e5e8eb;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 8px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.01);
}
.group-header {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.group-header .iconify { color: #64748b; }

/* ==========================================
   9. 自定义参数列表 (Custom Params)
========================================== */
.custom-params-list { display: flex; flex-direction: column; gap: 12px; }
.param-row { display: flex; align-items: center; gap: 8px; animation: fadeIn 0.2s ease; }
.param-key { flex: 2; min-width: 0; }
.param-type { flex: 1; min-width: 0; padding: 8px 12px !important; }
.param-value { flex: 2; min-width: 0; }
.param-type-dropdown { flex: 1; min-width: 80px; }
.param-value-dropdown { flex: 2; min-width: 100px; }

/* ==========================================
   10. 美化下拉菜单 (Custom Dropdown)
========================================== */
.custom-dropdown { position: relative; min-width: 180px; }
.dropdown-trigger {
  width: 100%; display: flex; justify-content: space-between; align-items: center;
  background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;
  padding: 6px 10px 6px 12px; font-size: 13px; color: #1f2937;
  cursor: pointer; transition: all 0.2s; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}
.dropdown-trigger:hover { border-color: #94a3b8; }
.trigger-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
.trigger-icon { font-size: 14px; color: #64748b; transition: transform 0.3s ease; }
.trigger-icon.rotate-180 { transform: rotate(180deg); }

.dropdown-menu {
  position: absolute; top: calc(100% + 4px); left: 0; width: 100%; min-width: max-content;
  background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  padding: 4px; margin: 0; list-style: none; z-index: 50; max-height: 220px; overflow-y: auto;
}
.dropdown-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; font-size: 13px; color: #334155; border-radius: 4px;
  cursor: pointer; transition: background-color 0.15s;
}
.dropdown-item:hover { background-color: #f1f5f9; }
.dropdown-item.is-active { background-color: #eff6ff; color: #2563eb; font-weight: 500; }
.item-name { white-space: nowrap; }
.check-icon { font-size: 14px; color: #3b82f6; margin-left: 12px; }

.dropdown-fade-enter-active, .dropdown-fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.dropdown-fade-enter-from, .dropdown-fade-leave-to { opacity: 0; transform: translateY(-5px); }

/* ==========================================
   11. 拨动开关 (Toggle Switch)
========================================== */
.switch-label-wrapper { display: flex; align-items: center; gap: 12px; cursor: pointer; user-select: none; }
.switch-container { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
.switch-input { opacity: 0; width: 0; height: 0; position: absolute; }
.switch-slider {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background-color: #cbd5e1; border-radius: 22px; transition: background-color 0.3s ease;
}
.switch-slider:before {
  content: ""; position: absolute; height: 18px; width: 18px; left: 2px; bottom: 2px;
  background-color: white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15); transition: transform 0.3s ease;
}
.switch-input:checked + .switch-slider { background-color: #3b82f6; }
.switch-input:checked + .switch-slider:before { transform: translateX(18px); }
.switch-input:focus-visible + .switch-slider { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }
.boolean-switch-wrapper { display: flex; align-items: center; padding-left: 8px; }
.switch-text { font-size: 14px; font-weight: 600; color: #111827; }
.text-gray-400 { color: #9ca3af; }
.font-normal { font-weight: 400; }
.ml-1 { margin-left: 4px; }

/* 动画效果 */
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(10px); }

.scroll-status-footer { text-align: center; padding: 20px 0; color: #64748b; font-size: 13px; }
.loading-text .spin-icon { animation: spin 1s linear infinite; margin-right: 4px; }

/* ==========================================
   滚动条美化 (macOS 极简风格)
========================================== */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; border-radius: 4px; }
::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; transition: background-color 0.2s; }
::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
.custom-textarea::-webkit-scrollbar { width: 4px; }
.custom-textarea::-webkit-scrollbar-thumb { background: #e5e8eb; }
.custom-textarea::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
* { scrollbar-width: thin; scrollbar-color: #d1d5db transparent; }

.global-routing-card,
.provider-grid {
  width: 100% !important;
  max-width: 900px !important;
  margin-left: auto !important;
  margin-right: auto !important;
  box-sizing: border-box !important; /* 核心修复：把 padding 计算在宽度内 */
}
</style>