<template>
  <div class="app-container">
    <!-- ================= 左侧边栏 ================= -->
    <aside :class="['sidebar', { collapsed: isCollapsed }]">
      <div class="sidebar-header">
        <router-link to="/" class="icon-btn" title="返回主页">
          <Icon icon="lucide:arrow-left" />
        </router-link>
        <button class="icon-btn" @click="toggleCollapse" title="折叠侧边栏">
          <Icon icon="lucide:arrow-left-right" />
        </button>
      </div>

      <div class="sidebar-actions">
        <button class="action-btn primary" @click="freshNewChat">
          <Icon icon="lucide:message-square-plus" /> 新聊天
        </button>
      </div>

      <div class="chat-list-container" @scroll="handleScrollChatList">
        <div class="list-title">近期聊天</div>
        <div class="chat-list">
          <div 
            v-for="chat in userChats" 
            :key="chat.id" 
            class="chat-item"
            :class="{ active: chat.id === chatIdNum }"
            @click="selectCharIds(chat.id, chat.modelId)"
          >
            <input 
              v-if="editingChatId === chat.id" 
              v-model="editTitleValue"
              class="rename-input"
              @blur="submitRename(chat)" 
              @keyup.enter="submitRename(chat)"
              @keyup.esc="cancelRename" 
              @click.stop 
              :ref="(el) => { if (chat?.id) renameInputRefs[chat.id] = el }" 
            />
            
            <template v-else>
              <span class="chat-title" :title="chat.title">{{ chat.title }}</span>
              <div class="menu-wrapper">
                <button class="menu-trigger" @click.stop="togglePanel(chat.id)">
                  <Icon icon="lucide:more-vertical" />
                </button>
                <div v-if="activePanelId === chat.id" class="dropdown-menu">
                  <div class="menu-item" @click.stop="startRename(chat)">
                    <Icon icon="lucide:pencil" class="menu-icon" /> 更改标题
                  </div>
                  <div class="menu-item danger" @click.stop="deleteChatListByChatId(chat.id)">
                    <Icon icon="lucide:trash-2" class="menu-icon" /> 删除对话
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- 底部面板 -->
      <div class="sidebar-footer">
        <div class="user-profile" @click="togglePanelUser">
          <img :src="userStore.localAvatarPath || 'https://api.dicebear.com/7.x/notionists/svg'" class="avatar" />
          <span class="username">{{ userStore.name || "User" }}</span>
          <Icon icon="lucide:chevrons-up-down" class="dots" />
        </div>

        <div v-if="isPanelVisible" class="user-popup-menu">
          <div class="menu-item" @click="router.push('/apiSettings')">
            <Icon icon="lucide:blocks" class="icon" /> 厂商与模型管理
          </div>
          <div class="menu-item" @click="router.push('/aiHybrdSettings')">
            <Icon icon="lucide:cpu" class="icon" /> 系统与 RAG 配置
          </div>
          <div class="menu-divider"></div>
          <div class="menu-item engine-control-row">
            <span>渲染引擎</span>
            <div class="segmented-control">
              <button :class="{ active: currentEngine === 'somarkdown' }" @click="currentEngine = 'somarkdown'">SoMd</button>
              <button :class="{ active: currentEngine === 'markdown-it' }" @click="currentEngine = 'markdown-it'">KaTeX</button>
            </div>
          </div>
          <div class="menu-divider"></div>
          <button class="menu-item danger" @click.stop="deleteAllChat">
            <Icon icon="lucide:trash" class="icon" /> 清空所有记录
          </button>
        </div>
      </div>
      
      <div v-if="activePanelId !== null || isPanelVisible" class="global-overlay" @click="closeAllPanels"></div>
    </aside>

    <!-- ================= 主内容区 ================= -->
    <main class="main-content">
      <header class="main-header">
        <button v-show="isCollapsed" class="icon-btn expand-btn" @click="toggleCollapse" title="展开侧边栏">
          <Icon icon="lucide:panel-left-open" />
        </button>
        <div class="header-center">
          <h3 v-if="chatIdNum" style="font-size: 15px; font-weight: 500; color: #555">
            {{ currentChatList?.title }}
          </h3>
        </div>
        <div style="width: 32px"></div>
      </header>

      <div class="flowing-line" v-show="isFetchingHistory"></div>

      <!-- 聊天消息展示区 -->
      <div class="chat-wrapper" :class="{ 'is-homepage': !chatIdNum }">
        <div v-if="chatIdNum" class="message-list h-full" :class="{ 'chat-invisible': !isChatVisible }">
          <DynamicScroller
            :key="chatIdNum || 'empty-chat'"
            :items="currentChat"
            :min-item-size="54"
            :buffer="200"
            key-field="id"
            class="scroller"
            ref="scrollerRef"
            @scroll.passive="handleScroll"
            @wheel="handleUserInteraction"
          >
            <template v-slot="{ item, index, active }">
              <DynamicScrollerItem 
                :item="item" 
                :active="active" 
                :data-index="index" 
                :size-dependencies="[item.isExpanded, item.isExpandUserMsg, item.isGenerating, item.reasoning, item.content, item.token]"
              >
                <div :class="['message-row', item.role]">
                  <div class="message-body">
                    
                    <!-- ========== 用户消息气泡 ========== -->
                    <template v-if="item.role === 'user'">
                      <!-- 附件区块 -->
                     <!-- 附件区块 -->
                     <div v-if="item.file && item.file.length > 0" class="user-attachments standalone">
                        <template v-for="(fileItem, attIdx) in item.file" :key="attIdx">
                          <img 
                            v-if="fileItem.isImage || typeof fileItem === 'string'" 
                            :src="fileItem.url || fileItem" 
                            class="user-msg-img" 
                            alt="上传的图片" 
                            @load="() => scrollerRef?.scrollToBottom()" 
                          />
                          <!-- 否则当做文档渲染 -->
                          <div v-else class="user-msg-doc">
                            <Icon icon="lucide:file-text" class="doc-icon" />
                            <span class="doc-name">{{ fileItem.file ? fileItem.file.name : fileItem }}</span>
                          </div>
                        </template>
                      </div>

                      <!-- 文本气泡块 -->
                      <div 
                        v-if="item.content && item.content !== '[发送了文件]' && item.content !== '[发送了图片]'" 
                        class="message-content user-msg" 
                        :class="{ 'is-collapsed': item.isExpandUserMsg || item.content.length <= 300 }"
                      >
                        {{ item.content }}
                        <div class="collapsed-mask"></div>
                      </div>

                      <!-- 底部操作按钮 -->
                      <div class="message-actions">
                        <span 
                          class="action-btn copy-btn tooltip-container" 
                          :data-tooltip="item.copied ? '已复制' : '复制内容'" 
                          @click="copyToClipboard(item, index)"
                        >
                          <Icon :icon="item.copied ? 'lucide:check' : 'lucide:copy'" :style="{ color: item.copied ? '#4caf50' : '' }" />
                        </span>
                        <span 
                          v-if="item.content.length > 300" 
                          class="action-btn toggle-btn tooltip-container" 
                          :data-tooltip="item.isExpandUserMsg ? '收起内容' : '展开全文'" 
                          @click="toggleUserMsg(item, index)"
                        >
                          <Icon :icon="item.isExpandUserMsg ? 'lucide:chevron-up' : 'lucide:chevron-down'" />
                        </span>
                      </div>
                    </template>

                    <!-- ========== AI 消息气泡 ========== -->
                    <template v-else-if="item.role === 'assistant'">
                      <!-- 思考过程 -->
                      <div v-if="(item.reasoning !== undefined && !item.content) || (item.reasoning && item.reasoning.length > 0)" class="reasoning-section">
                        <div class="reasoning-title" @click="toggleReasoning(item, index)">
                          <div class="title-left">
                            <Icon 
                              :icon="!item.reasoning && item.isGenerating ? 'lucide:loader-2' : 'lucide:brain'" 
                              :class="['brain-icon', { spinning: !item.reasoning && item.isGenerating }]" 
                            />
                            <span>{{ !item.reasoning && item.isGenerating ? "正在连接 AI..." : "思考过程" }}</span>
                          </div>
                          <Icon :icon="item.isExpanded ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="toggle-icon" />
                        </div>
                        <div class="reasoning-collapse-wrapper" :class="{ 'is-open': item.isExpanded }">
                          <div class="reasoning-content">
                            <StreamingMarkdown
                              v-if="item.reasoning && item.reasoning.length > 0"
                              :key="`reasoning-${item.id || index}`"
                              :content="item.reasoning"
                              :isGenerating="item.isGenerating"
                              :is-locked="isAutoScrollLocked"
                              :engine="currentEngine"
                              @rendered="() => handleMarkdownRendered(item)"
                            />
                            <div v-show="!item.reasoning || item.reasoning.length === 0" class="reasoning-placeholder">
                              <span v-show="item.isGenerating" class="pulse-dot"></span>
                              <span>{{ item.isGenerating ? "正在组织语言..." : "思考已中止" }}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      
                      <!-- 正文内容 (Markdown渲染入口) -->
                      <div class="message-content" @click="handleDelegatedClicks">
                        <StreamingMarkdown
                          v-if="(item.content && item.content.length > 0) || (item.file && item.file.length > 0)"
                          :key="`content-${item.id || index}`"
                          :content="item.content + (item.file ? '\n\n' + item.file.map(url => `![Image](${url})`).join('\n') : '')"
                          :isGenerating="item.isGenerating"
                          :is-locked="isAutoScrollLocked"
                          :engine="currentEngine"
                          @rendered="() => handleMarkdownRendered(item)"
                        />
                      </div>

                      <!-- Token 消耗 -->
                      <div v-if="item.token" class="token-info">
                        <Icon icon="lucide:coins" class="meta-icon" />
                        <span>{{ item.token }}</span>
                      </div>
                    </template>
                  </div>
                </div>
              </DynamicScrollerItem>
            </template>
          </DynamicScroller>
        </div>

        <!-- 首页问候 -->
        <div v-else>
          <h2 class="homepage-greeting">你好！我们先从哪里开始呢？</h2>
        </div>

        <!-- ================= 输入交互区 ================= -->
        <div class="input-area">
          <input type="file" ref="fileInputRef" style="display: none" :accept="fileAccept" multiple @change="handleFileChange" />
          
          <div class="input-box" :class="{ 'is-focused': isInputFocused }">
            <!-- 文件预览区 -->
            <div v-if="selectedFiles.length > 0" class="file-preview-area">
              <div v-for="(fileItem, index) in selectedFiles" :key="index" class="preview-item">
                <img v-if="fileItem.isImage" :src="fileItem.url" class="preview-img" alt="preview" />
                <div v-else class="preview-doc">
                  <Icon icon="lucide:file-text" class="doc-icon" />
                  <span class="doc-name">{{ fileItem.file.name }}</span>
                </div>
                <button class="remove-file-btn" @click.stop="removeFile(index)">
                  <Icon icon="lucide:x" />
                </button>
              </div>
            </div>

            <!-- 文本输入 -->
            <div class="input-row">
              <textarea
                ref="inputRef"
                v-model="inputText"
                placeholder="给 AI 发送消息..."
                rows="1"
                maxlength="100000"
                @input="autoResize"
                @keydown.enter.exact.prevent="sendMessage"
                @focus="isInputFocused = true"
                @blur="isInputFocused = false"
              ></textarea>
            </div>

            <!-- 工具与发送 -->
            <div class="toolbar-row">
              <div class="toolbar-left">
                <!-- 1. 附件工具 -->
                <div class="tool-wrapper">
                  <button class="action-circle-btn ghost" @click.stop="toggleToolsMenu" :class="{ 'is-active': isToolsOpen }">
                    <Icon icon="lucide:plus" class="plus-icon" />
                  </button>
                  <transition name="fade-up">
                    <div v-if="isToolsOpen" class="popover-menu tools-menu">
                      <div class="popover-item" @click.stop="triggerFileInput('image/*')">
                        <Icon icon="lucide:image" class="menu-icon" /> 上传图片
                      </div>
                      <div class="popover-item" @click.stop="triggerFileInput('.pdf,.txt,.doc,.docx,.csv')">
                        <Icon icon="lucide:file-text" class="menu-icon" /> 上传文档
                      </div>
                    </div>
                  </transition>
                </div>

                <!-- 2. 缓存策略控制面板 -->
                <div class="tool-wrapper">
                  <button class="action-circle-btn ghost tooltip-container" data-tooltip="上下文与缓存策略" @click.stop="toggleContextMenu" :class="{ 'is-active': isContextOpen }">
                    <Icon icon="lucide:cpu" class="plus-icon" />
                  </button>
                  <transition name="fade-up">
                    <div v-if="isContextOpen" class="popover-menu context-menu" @click.stop>
                      <div class="context-header">
                        <Icon icon="lucide:database" /> <span>记忆与缓存状态</span>
                      </div>
                      
                      <div class="context-row">
                        <span class="row-label">前缀缓存 (长文优化)</span>
                        <div class="segmented-control">
                          <button :class="{ active: String(currentModel.enablePrefixCaching) === 'true' }" @click="toggleCacheMode(true)">开启</button>
                          <button :class="{ active: String(currentModel.enablePrefixCaching) !== 'true' }" @click="toggleCacheMode(false)">关闭</button>
                        </div>
                      </div>

                      <div class="context-row info-row" v-if="currentModel.enablePrefixCaching">
                        <span class="row-label tooltip-container" data-tooltip="携带几条最新对话">携带窗口大小</span>
                        <div class="number-input-wrapper">
                          <input type="number" v-model.number="currentModel.cacheMessageLimit" @change="updateModelConfig('cacheMessageLimit')" class="limit-input" />
                          <span class="unit">条</span>
                        </div>
                      </div>

                      <div class="context-row info-row" v-if="currentModel.enablePrefixCaching">
                        <span class="row-label tooltip-container" data-tooltip="字数最大限制">字数最大限制</span>
                        <div class="number-input-wrapper">
                          <input type="number" v-model.number="currentModel.cacheTokenLimit" @change="updateModelConfig('cacheTokenLimit')" step="100" class="limit-input"  />
                          <span class="unit">字</span>
                        </div>
                      </div>

                      <div class="context-tip">
                        {{ currentModel.enablePrefixCaching ? "当前为追加模式，长对话首次较慢，后续响应极快且节省 Token。" : "当前为滑动节约模式，自动遗忘早期对话以控制最大算力开销。" }}
                      </div>
                    </div>
                  </transition>
                </div>

                <!-- 3. 模型选择器 -->
                <div class="tool-wrapper">
                  <button class="model-selector-btn ghost" @click.stop="toggleModelDropdown">
                    <Icon icon="lucide:sparkles" class="model-icon" />
                    <span class="model-text">{{ currentModelLabel }}</span>
                    <Icon icon="lucide:chevron-down" class="chevron" :class="{ 'is-open': isModelDropdownOpen }" />
                  </button>
                  <transition name="fade-up">
                    <div v-if="isModelDropdownOpen" class="cascading-menu-container" @click.stop>
                      <!-- 厂商列表 -->
                      <div class="provider-panel" @scroll="handleProviderScroll">
                        <div v-if="providersList.length === 0 && !isLoadingProviders" class="empty-tip" @click="router.push('/apiSettings')">去设置中心添加...</div>
                        <div 
                          v-for="provider in providersList" 
                          :key="provider.id" 
                          class="menu-item provider-item" 
                          :class="{ 'is-active': hoveredProviderId === provider.id }" 
                          @mouseenter="handleHoverProvider(provider)"
                        >
                          <span class="item-text" :title="provider.name">{{ provider.name }}</span>
                          <Icon icon="lucide:chevron-right" class="arrow-icon" />
                        </div>
                        <div v-if="isLoadingProviders" class="loading-tip"><Icon icon="lucide:loader-2" class="animate-spin" /></div>
                      </div>
                      
                      <!-- 模型列表 -->
                      <div class="model-panel" v-if="hoveredProvider" @scroll="handleModelScroll($event, hoveredProvider)">
                        <div v-if="hoveredProvider.models.length === 0 && !hoveredProvider._isLoadingModels" class="empty-tip">暂无模型配置</div>
                        <div 
                          v-for="model in hoveredProvider.models" 
                          :key="model.id" 
                          class="menu-item model-item" 
                          :class="{ 'is-selected': currentModel.modelId === model.id }" 
                          @click="selectModel(hoveredProvider, model)"
                        >
                          <span class="item-text" :title="model.name">{{ model.name }}</span>
                          <Icon v-if="currentModel.modelId === model.id" icon="lucide:check" class="check-icon" />
                        </div>
                        <div v-if="hoveredProvider._isLoadingModels" class="loading-tip"><Icon icon="lucide:loader-2" class="animate-spin" /></div>
                      </div>
                    </div>
                  </transition>
                </div>
              </div>

              <!-- 右侧发送 -->
              <div class="toolbar-right">
                <button
                  class="send-btn"
                  :class="{
                    active: (inputText.trim().length > 0 || isSending || selectedFiles.length > 0) && isEmbeddingReady,
                    loading: !isEmbeddingReady,
                  }"
                  @click="handleButtonClick"
                  :disabled="!isEmbeddingReady && !isSending"
                >
                  <Icon v-if="isSending" icon="lucide:square" class="stop-icon" />
                  <Icon v-else-if="!isEmbeddingReady" icon="lucide:loader-2" class="animate-spin" />
                  <Icon v-else icon="lucide:send" />
                  <span v-if="!isEmbeddingReady && downloadPercent < 100" style="font-size: 10px; margin-left: 2px">{{ Math.round(downloadPercent) }}%</span>
                </button>
              </div>
            </div>
          </div>
          <div class="footer-hint">内容基于您本地提供的 API Key 生成，请妥善保管您的密钥。</div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
/* =================================================================================
   模块 1: 核心依赖与初始化配置
   ================================================================================= */
import { ref, reactive, nextTick, computed, onMounted, onUnmounted, watch, markRaw } from "vue";
import { Icon } from "@iconify/vue";
import { useUserStore } from "../store/useStore.js";
import { useRouter } from "vue-router";
import { DynamicScroller, DynamicScrollerItem } from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import { debounce, throttle } from "lodash-es";
import DOMPurify from "dompurify";
import mermaid from "mermaid";

import { CryptoEngine } from "../utils/cryptoEngine.js";
import StreamingMarkdown from "./StreamingMarkdown.vue";
import { aiDatabase } from "../rustservice/aiDatabase.js";
import { globalKeyManager } from "../utils/keyManager.js";
import { AIUserService } from "../service/aiUserService.js";
import { initEmbeddingEngine } from "../embedding/workerClient.js";
import { clearAllEchartsInstances } from "../markdown/renderers.js";
import { showConfirm } from "./ui/ui-js/confirm.js";

// DOMPurify 允许 KaTeX 等公式节点
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName && data.tagName.toLowerCase().startsWith('mjx-')) data.allowedTags[data.tagName] = true;
});
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName && data.attrName.toLowerCase().startsWith('mjx-')) data.allowedAttributes[data.attrName] = true;
});

const router = useRouter();
const userStore = useUserStore();
const currentEngine = ref("somarkdown");
const iconCopy = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;
const iconCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;


/* =================================================================================
   模块 2: UI 状态控制 (侧边栏、菜单、下拉框)
   ================================================================================= */
const isCollapsed = ref(false);
const activePanelId = ref(null);
const isPanelVisible = ref(false);
const isInputFocused = ref(false);
const isToolsOpen = ref(false);
const isModelDropdownOpen = ref(false);
const isContextOpen = ref(false);

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
};

const toggleToolsMenu = () => { 
  isToolsOpen.value = !isToolsOpen.value; 
  if (isToolsOpen.value) { 
    isModelDropdownOpen.value = false; 
    isContextOpen.value = false; 
  }
};

const toggleModelDropdown = () => { 
  isModelDropdownOpen.value = !isModelDropdownOpen.value; 
  if (isModelDropdownOpen.value) { 
    isToolsOpen.value = false; 
    isContextOpen.value = false; 
  }
};

const toggleContextMenu = () => { 
  isContextOpen.value = !isContextOpen.value; 
  if (isContextOpen.value) { 
    isToolsOpen.value = false; 
    isModelDropdownOpen.value = false; 
  }
};

const closeDropdownOnClickOutside = () => { 
  isModelDropdownOpen.value = false; 
  isToolsOpen.value = false; 
  isContextOpen.value = false; 
};

const togglePanel = (id) => { 
  isPanelVisible.value = false; 
  activePanelId.value = activePanelId.value === id ? null : id; 
};

const togglePanelUser = () => { 
  activePanelId.value = null; 
  isPanelVisible.value = !isPanelVisible.value; 
};

const closeAllPanels = () => { 
  activePanelId.value = null; 
  isPanelVisible.value = false; 
};


/* =================================================================================
   模块 3: 文件上传与预览控制
   ================================================================================= */
const fileInputRef = ref(null);
const fileAccept = ref("*/*");
const selectedFiles = ref([]);

const triggerFileInput = (acceptType) => {
  fileAccept.value = acceptType;
  isToolsOpen.value = false;
  nextTick(() => { 
    if (fileInputRef.value) fileInputRef.value.click(); 
  });
};

const handleFileChange = (event) => {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  files.forEach((file) => {
    const isImage = file.type.startsWith("image/");
    selectedFiles.value.push({ 
      file: file, 
      url: isImage ? URL.createObjectURL(file) : null, 
      isImage: isImage 
    });
  });
  event.target.value = "";
  nextTick(() => inputRef.value?.focus());
};

const removeFile = (index) => {
  const fileItem = selectedFiles.value[index];
  if (fileItem.url) URL.revokeObjectURL(fileItem.url);
  selectedFiles.value.splice(index, 1);
};


/* =================================================================================
   模块 4: 对话列表与历史记录数据库同步
   ================================================================================= */
const userChats = ref([]);
const chatIdNum = ref(null);
const editingChatId = ref(null);
const editTitleValue = ref("");
const loadingChatList = ref(false);
const hasMoreChatList = ref(true);
const limitSize = 20;
const renameInputRefs = {};

async function getChatList(id, limit) {
  try {
    const res = await aiDatabase.queryChatList(id, limit);
    userChats.value = res;
    hasMoreChatList.value = res.length >= limit;
  } catch (error) { 
    console.error("查询列表失败:", error); 
  }
}
getChatList(Number.MAX_SAFE_INTEGER, limitSize);

const loadMoreChats = async () => {
  if (userChats.value.length === 0) return;
  loadingChatList.value = true;
  try {
    const lastId = userChats.value[userChats.value.length - 1].id;
    const newChats = await aiDatabase.queryChatList(lastId, limitSize);
    console.log("加载更多历史列表:", newChats);
    if (newChats.length > 0) userChats.value.push(...newChats);
    if (newChats.length < limitSize) hasMoreChatList.value = false;
  } catch (error) { 
    console.error("加载历史列表失败:", error); 
  } finally { 
    loadingChatList.value = false; 
  }
};

const handleScrollChatList = (event) => {
  const { scrollTop, clientHeight, scrollHeight } = event.target;
  if (scrollTop + clientHeight >= scrollHeight - 10 && !loadingChatList.value && hasMoreChatList.value) {
    loadMoreChats();
  }
};

const freshNewChat = () => {
  if (!chatIdNum.value) return nextTick(() => inputRef.value?.focus());
  chatIdNum.value = null; 
  setTimeout(() => { 
    if (!chatIdNum.value) currentChat.value = []; 
  }, 300);
  nextTick(() => inputRef.value?.focus());
};

const startRename = (chat) => {
  editingChatId.value = chat.id;
  editTitleValue.value = chat.title;
  activePanelId.value = null;
  
  // 等 Vue 渲染出输入框后聚焦
  nextTick(() => {
    const input = renameInputRefs[chat.id];
    if (input) input.focus();
  });
};

const submitRename = async (chat) => {
  const newTitle = editTitleValue.value.trim();
  if (!newTitle || newTitle === chat.title) return cancelRename();
  await aiDatabase.updateChatList(chat.id, { title: newTitle, timestamp: Date.now() });
  const targetChat = userChats.value.find((c) => c.id === chat.id);
  if (targetChat) targetChat.title = newTitle;
  cancelRename();
};

const cancelRename = () => { 
  editingChatId.value = null; 
  editTitleValue.value = ""; 
};

async function deleteChatListByChatId(id) {
  const isConfirm = await showConfirm({ title: "删除", message: `确定要删除此对话吗？`, type: "info" });
  if (!isConfirm) return;
  
  userChats.value = userChats.value.filter((c) => c.id !== id);
  await Promise.all([
    aiDatabase.deleteChatListById(id), 
    aiDatabase.deleteChatMessageByChatId(id), 
    aiDatabase.deleteVectorsByChatId(id)
  ]);
  
  closeAllPanels();
  if (chatIdNum.value === id) freshNewChat();
}

async function deleteAllChat() {
  const isConfirm = await showConfirm({ title: "删除", message: `确定要清空历史对话吗？`, type: "info" });
  if (!isConfirm) return;
  try {
    await Promise.all([
      aiDatabase.clearAllChatListData(), 
      aiDatabase.clearAllChatData(), 
      aiDatabase.clearAllVectors()
    ]);
    userChats.value = []; 
    closeAllPanels(); 
    freshNewChat();
  } catch(e) { 
    console.error(e); 
  }
}


/* =================================================================================
   模块 5: 模型中心配置与状态控制 (联级分页)
   ================================================================================= */
const currentModel = ref({});
const currentModelLabel = computed(() => currentModel.value.label || "请选择模型");
const currentModelId = computed(() => currentModel.value.modelId);
const providersList = ref([]);
const isLoadingProviders = ref(false);
const hasMoreProviders = ref(true);
let providerCursor = null;

const hoveredProviderId = ref(null);
const hoveredProvider = computed(() => providersList.value.find((p) => p.id === hoveredProviderId.value));

const loadMoreProviders = async () => {
  if (isLoadingProviders.value || !hasMoreProviders.value) return;
  isLoadingProviders.value = true;
  try {
    const pBatch = await aiDatabase.getProviders(providerCursor, 20);
    if (pBatch.length > 0) {
      pBatch.forEach((p) => {
        p.models = []; 
        p._modelsCursor = Number.MAX_SAFE_INTEGER; 
        p._isLoadingModels = false; 
        p._hasMoreModels = true;
        providersList.value.push(p);
      });
      providerCursor = pBatch[pBatch.length - 1].id;
    }
    if (pBatch.length < 20) hasMoreProviders.value = false;
  } finally { 
    isLoadingProviders.value = false; 
  }
};

const handleProviderScroll = (e) => {
  if (e.target.scrollTop + e.target.clientHeight >= e.target.scrollHeight - 20) loadMoreProviders();
};

const handleHoverProvider = (provider) => {
  hoveredProviderId.value = provider.id;
  if (provider.models.length === 0 && provider._hasMoreModels && !provider._isLoadingModels) {
    loadModelsForProvider(provider);
  }
};

const loadModelsForProvider = async (provider) => {
  if (provider._isLoadingModels || !provider._hasMoreModels) return;
  provider._isLoadingModels = true;
  try {
    const mBatch = await aiDatabase.getModels(provider.id, provider._modelsCursor, 20);
    if (mBatch.length > 0) {
      provider.models.push(...mBatch);
      provider._modelsCursor = mBatch[mBatch.length - 1].id;
    }
    if (mBatch.length < 20) provider._hasMoreModels = false;
  } finally { 
    provider._isLoadingModels = false; 
  }
};

const handleModelScroll = (e, provider) => {
  if (e.target.scrollTop + e.target.clientHeight >= e.target.scrollHeight - 20) {
    loadModelsForProvider(provider);
  }
};

// 🌟 全局缓存变量
let globalCompressModelId = null;
let globalSystemConfig = null; 

// ====== 初始化模型配置逻辑 ======
const loadModelsFromDB = async () => {
  await loadMoreProviders();
  let targetChatModelId = null;
  
  try {
    // 1. 一次性查出所有的全局配置！
    globalSystemConfig = await aiDatabase.getSystemSettings(0);
    if (globalSystemConfig) {
      targetChatModelId = globalSystemConfig.chatModelId;
      globalCompressModelId = globalSystemConfig.compressModelId || null; 
    }
  } catch (error) {
    console.error("读取全局设置失败:", error);
  }

  let found = false;
  if (targetChatModelId) {
    for (const p of providersList.value) {
      const tempModels = await aiDatabase.getModels(p.id, Number.MAX_SAFE_INTEGER, 50);
      const matchedModel = tempModels.find(m => m.id === targetChatModelId);
      if (matchedModel) {
        await _applyModelToState(p, matchedModel);
        found = true;
        break;
      }
    }
  }

  // 退化策略：没找到就抓取列表里第一个模型兜底
  if (!found && providersList.value.length > 0) {
    for (const p of providersList.value) {
      const tempModels = await aiDatabase.getModels(p.id, Number.MAX_SAFE_INTEGER, 1);
      if (tempModels.length > 0) {
        await _applyModelToState(p, tempModels[0]);
        break;
      }
    }
  }
};

const selectModel = async (provider, model) => {
  if (currentModel.value.modelId === model.id) return (isModelDropdownOpen.value = false);
  await _applyModelToState(provider, model);
  isModelDropdownOpen.value = false;
};

// 🌟 解析应用双轨模型设置
const _applyModelToState = async (chatProvider, chatModel) => {
  let compProvider = chatProvider;
  let compModel = chatModel;

  // 如果全局配置了独立的“历史压缩引擎”，则去寻找它
  if (globalCompressModelId) {
    let foundComp = false;
    for (const p of providersList.value) {
      const tempModels = p.models.length > 0 ? p.models : await aiDatabase.getModels(p.id, Number.MAX_SAFE_INTEGER, 50);
      const matchedModel = tempModels.find(x => x.id === globalCompressModelId);
      if (matchedModel) {
        compProvider = p;
        compModel = matchedModel;
        foundComp = true;
        break;
      }
    }
    // 防爆盾：如果被配置的压缩模型被删除了，自动回退到“跟随主对话模型”
    if (!foundComp) {
      compProvider = chatProvider;
      compModel = chatModel;
    }
  }

  currentModel.value = {
    // --- 1. UI展示与主对话大脑 (Chat) ---
    label: `${chatProvider.name} - ${chatModel.name}`, 
    value: chatModel.id, 
    modelId: chatModel.id, 
    providerId: chatProvider.id, 
    name: chatModel.name,
    modelType: chatModel.modelType || "text", 
    baseUrl: chatModel.baseUrl || chatProvider.officialUrl || "", 
    path: chatModel.path || "/chat/completions",
    encryptedApiKey: chatProvider.apiKey, // 对话专用的加密 Key
    customParams:compModel.customParams,

    // --- 2. 后台历史压缩引擎 (Compress) ---
    compressModelId: compModel.id,
    compressModelName: compModel.name,
    compressBaseUrl: compModel.baseUrl || compProvider.officialUrl || "",
    compressEncryptedApiKey: compProvider.apiKey, // 压缩专用的加密 Key

    // --- 3. 记忆控制与边界配置 (全部走全局缓存 globalSystemConfig) ---
    recentLimit: globalSystemConfig?.recentLimit ?? 6, 
    searchLimit: globalSystemConfig?.searchLimit ?? 4,
    compressThreshold: globalSystemConfig?.compressThreshold ?? 200000,
    maxSummaryTokens: globalSystemConfig?.maxSummaryTokens ?? 600,
    enablePrefixCaching: globalSystemConfig?.enablePrefixCaching ?? false,
    cacheMessageLimit: globalSystemConfig?.cacheMessageLimit ?? 50, 
    cacheTokenLimit: globalSystemConfig?.cacheTokenLimit ?? 200000,
  };
  
};

const toggleCacheMode = async (enable) => {
  if (currentModel.value.enablePrefixCaching === enable) return;
  currentModel.value.enablePrefixCaching = enable;
  try { 
    // 获取最新全局配置并修改
    const config = await aiDatabase.getSystemSettings(0) || { id: 0 };
    config.enablePrefixCaching = enable;
    await aiDatabase.saveSystemSettings(config); 
  } catch (e) { 
    console.error("更新全局缓存开关失败", e); 
  }
};

const updateModelConfig = async (field) => {
  if (!currentModel.value?.modelId) return;
  let val = currentModel.value[field];
  
  // 极值拦截防爆
  if (field === "cacheMessageLimit") val = Math.max(10, Math.min(val || 50, Number.MAX_SAFE_INTEGER));
  else if (field === "recentLimit") val = Math.max(1, Math.min(val || 6, Number.MAX_SAFE_INTEGER));
  else if (field === "cacheTokenLimit") val = Math.max(100, Math.min(val || 200000, Number.MAX_SAFE_INTEGER));
  
  currentModel.value[field] = val;
  try { 
    const config = await aiDatabase.getSystemSettings(0) || { id: 0 };
    config[field] = val;
    await aiDatabase.saveSystemSettings(config); 
  } catch (error) { 
    console.error("更新全局配置失败:", error); 
  }
};


/* =================================================================================
   模块 6: 消息发送与核心对话引擎
   ================================================================================= */
const scrollerRef = ref(null);
const currentChat = ref([]);
const currentChatList = ref(null);
const isLoadingMore = ref(false);
const pageSize = 50;
const isLoadAll = ref(false);
const isFetchingHistory = ref(false);
const isChatVisible = ref(true);
const isAutoScrollLocked = ref(false);

const inputText = ref("");
const inputRef = ref(null);
let abortController = null;
const isSending = ref(false);
const markdownRef = ref(false);

const nextLastId = computed(() => currentChat.value.length === 0 ? Number.MAX_SAFE_INTEGER : currentChat.value[0].id);

const handleMarkdownRendered = debounce((item) => {
  if (!scrollerRef.value) return;
  scrollerRef.value.forceUpdate();
  if (item && item.isGenerating && !isAutoScrollLocked.value) {
    scrollerRef.value.scrollToBottom();
  }
}, 300);

const selectCharIds = async (id, modelIdNum) => {
  if (chatIdNum.value === id) return;
  const targetChatId = id;

  try {
    isFetchingHistory.value = true;
    isChatVisible.value = false;
    currentChat.value = [];        // ✅ 先清空
    currentChatList.value = null;
    
    await nextTick();              // ✅ 等 DOM 清空后再改 key
    chatIdNum.value = id;          // key 变化时 scroller 重建，此时数据是空的

    currentChatList.value = await aiDatabase.queryChatListById(id);
    const pageChats = await aiDatabase.queryChatMessages(id, Number.MAX_SAFE_INTEGER, pageSize);
    
    if (chatIdNum.value !== targetChatId) return;

    isLoadAll.value = pageChats.length < pageSize;
    currentChat.value = pageChats.map((chat) => ({
      ...chat,
      isExpanded: false,
      isExpandUserMsg: false
    }));

    await nextTick();

    setTimeout(() => {
      if (chatIdNum.value !== targetChatId) return;
      if (scrollerRef.value) {
        scrollerRef.value.forceUpdate();
        scrollerRef.value.scrollToBottom();
      }
      requestAnimationFrame(() => {
        if (chatIdNum.value !== targetChatId) return;
        isChatVisible.value = true;
        isFetchingHistory.value = false;
      });
    }, 800);

  } catch (error) {
    console.error("切换失败:", error);
    isFetchingHistory.value = false;
    isChatVisible.value = true;
  }
};

const triggerLoadMoreHistory = async (scrollElement) => {
  if (!chatIdNum.value || isLoadAll.value) return;
  isLoadingMore.value = true;
  const oldScrollHeight = scrollElement.scrollHeight;
  const oldScrollTop = scrollElement.scrollTop;

  try {
    const olderChats = await aiDatabase.queryChatMessages(chatIdNum.value, nextLastId.value, pageSize);
    if (olderChats.length > 0) {
      const uniqueOlderChats = olderChats.filter((oldMsg) => !currentChat.value.some((existMsg) => existMsg.id === oldMsg.id));
      currentChat.value = [...uniqueOlderChats.map((chat) => markRaw(chat)), ...currentChat.value];
      await nextTick();
      setTimeout(() => {
        requestAnimationFrame(() => {
          scrollElement.scrollTop = scrollElement.scrollHeight - oldScrollHeight + oldScrollTop;
        });
      }, 50);
    }
    if (olderChats.length < pageSize) isLoadAll.value = true;
  } finally { 
    setTimeout(() => (isLoadingMore.value = false), 200); 
  }
};

const checkLoadMoreHistory = throttle((el) => { 
  if (el.scrollTop <= 50 && !isLoadingMore.value && !isLoadAll.value) {
    triggerLoadMoreHistory(el); 
  }
}, 150);

const handleScroll = (e) => { 
  const el = e.target; 
  if (!el) return; 
  isAutoScrollLocked.value = Math.ceil(el.scrollHeight - el.scrollTop - el.clientHeight) > 2; 
  checkLoadMoreHistory(el); 
};

const handleUserInteraction = (e) => { 
  if (e.type === "wheel" && e.deltaY < 0) isAutoScrollLocked.value = true; 
};

const scrollToBottomIfNeeded = throttle(() => { 
  if (!isAutoScrollLocked.value && scrollerRef.value) scrollerRef.value.scrollToBottom(); 
}, 150);

const autoResize = () => {
  const textarea = inputRef.value;
  if (!textarea) return;
  textarea.style.height = "auto";
  const newHeight = textarea.scrollHeight;
  textarea.style.height = newHeight + "px";
  textarea.style.overflowY = newHeight >= 200 ? "auto" : "hidden";
};

const handleButtonClick = () => { 
  if (isSending.value) { 
    if(abortController) abortController.abort(); 
  } else if (isEmbeddingReady.value) {
    sendMessage(); 
  }
};

async function sendMessage() {
  if (isSending.value) return;
  const text = inputText.value.trim();
  if (!text && selectedFiles.value.length === 0) return;

  if (!currentModel.value.value) {
    router.push("/apiSettings"); return;
  }
  
  let decryptedApiKey = "";
  let decryptedCompressApiKey = "";
  
  try {
    // 1. 解密主对话大脑的 Key
    if (currentModel.value.encryptedApiKey) {
      const decrypted = await globalKeyManager.decryptMessage(currentModel.value.encryptedApiKey);
      decryptedApiKey = new TextDecoder().decode(CryptoEngine._base64ToArrayBuffer(decrypted));
    } else {
      return;
    }
    
    // 2. 解密压缩引擎的 Key (复用优化)
    if (currentModel.value.compressEncryptedApiKey === currentModel.value.encryptedApiKey) {
      decryptedCompressApiKey = decryptedApiKey;
    } else if (currentModel.value.compressEncryptedApiKey) {
      const compDecrypted = await globalKeyManager.decryptMessage(currentModel.value.compressEncryptedApiKey);
      decryptedCompressApiKey = new TextDecoder().decode(CryptoEngine._base64ToArrayBuffer(compDecrypted));
    }
  } catch (error) { 
    console.log("Key decryption error: ", error);
    return; 
  }
  
  const originalText = text;
  isSending.value = true;
  abortController = new AbortController();
  isAutoScrollLocked.value = false;
  
  const filesToSend = [...selectedFiles.value];
  selectedFiles.value = []; 
  inputText.value = "";
  nextTick(() => autoResize());

  currentChat.value.push({ 
    id: Date.now(), 
    chatId: chatIdNum.value, 
    role: "user", 
    content: text || "[发送了文件]", 
    timestamp: Date.now(), 
    isExpandUserMsg: false, 
    file: filesToSend 
  });

  let baseHistoryTokens = 0, localContentBuffer = "", localReasoningBuffer = "";

  const localThrottledUpdateUI = throttle((targetMessage, baseTokens) => {
    let hasChanged = false;
    if (localContentBuffer) { 
      targetMessage.content += localContentBuffer; 
      localContentBuffer = ""; 
      hasChanged = true; 
    }
    if (localReasoningBuffer) { 
      targetMessage.reasoning += localReasoningBuffer; 
      localReasoningBuffer = ""; 
      hasChanged = true; 
    }
    if (hasChanged) {
      targetMessage.token = `[ ⚡ 正在生成... 预估: ${baseTokens + estimateTokens(targetMessage.content + targetMessage.reasoning)} ]`;
      scrollToBottomIfNeeded();
    }
  }, 150, { leading: true, trailing: true });

  const aiMessage = reactive({ 
    id: Date.now() + 1, 
    chatId: chatIdNum.value, 
    role: "assistant", 
    content: "", 
    reasoning: "", 
    token: "", 
    isExpanded: false, 
    isGenerating: true 
  });
  
  currentChat.value.push(aiMessage);
  scrollToBottomIfNeeded();

  try {
    await AIUserService.sendAIMessage({
      text: text, 
      files: filesToSend.map((f) => f.file), 
      chatId: chatIdNum.value,
      model: { 
        ...currentModel.value, 
        apiKey: decryptedApiKey,
        compressApiKey: decryptedCompressApiKey 
      }, 
      signal: abortController.signal, 
      tempMessages: currentChat.value,
      onChatCreated: (newId) => {
        chatIdNum.value = newId; 
        aiMessage.chatId = newId;
        userChats.value.unshift({ id: newId, title: text.slice(0, 15), modelId: currentModelId.value, timestamp: Date.now() });
      },
      onContextAssembled: (finalPromptText) => { 
        baseHistoryTokens = estimateTokens(finalPromptText); 
      },
      onStreamContent: (chunk) => { 
        localContentBuffer += chunk; 
        localThrottledUpdateUI(aiMessage, baseHistoryTokens); 
      },
      onStreamReasoning: (chunk) => { 
        localReasoningBuffer += chunk; 
        localThrottledUpdateUI(aiMessage, baseHistoryTokens); 
      },
      onStreamFinish: async (finalTokenString, tokenUsage) => { 
        localThrottledUpdateUI.flush(); 
        aiMessage.token = finalTokenString; 
        aiMessage.isGenerating = false; 
        
        const { inputTokens, outputTokens } = tokenUsage;
        const totalCost = inputTokens + outputTokens;
        
        try {
          await aiDatabase.addTokenLog({
            tokenType: "paidToken",
            modelName: currentModel.value?.label,
            tokensTotal: totalCost,
            brief: "聊天对话",
            tokensInput: inputTokens,
            tokensOutput: outputTokens,
          });
        } catch (err) {
          console.error("TokenLog 写入失败:", err);
        }
      },
      onError: (err) => {
        localThrottledUpdateUI.cancel(); 
        aiMessage.isGenerating = false;
        
        if (err.name === "AbortError" || err.message === "abort") {
          currentChat.value.pop(); 
          currentChat.value.pop(); 
          inputText.value = originalText;
          if (currentChat.value.length === 0) { 
            userChats.value = userChats.value.filter((chat) => chat.id !== chatIdNum.value); 
            chatIdNum.value = null; 
          }
        } else { 
          aiMessage.content += " [已停止或遇到错误]"; 
        }
        nextTick(() => { 
          inputRef.value?.focus(); 
          autoResize(); 
        });
      },
    });
  } catch (e) { 
    console.error("消息发送异常:", e); 
  } finally { 
    isSending.value = false; 
  }
}

const estimateTokens = (text) => {
  if (!text) return 0;
  const chineseMatches = text.match(/[\u0100-\uffff]/g);
  const chineseCount = chineseMatches ? chineseMatches.length : 0;
  return Math.ceil(chineseCount * 0.7 + (text.length - chineseCount) * 0.3);
};


/* =================================================================================
   模块 7: 全局代理点击与辅助交互 (下载、复制)
   ================================================================================= */
const handleGlobalClick = (e) => {
  if (!markdownRef.value) return;
  const clickedPre = e.target.closest('pre');
  markdownRef.value.querySelectorAll('pre.is-active-scroll').forEach(p => { 
    if (p !== clickedPre) p.classList.remove('is-active-scroll'); 
  });
  if (clickedPre && markdownRef.value.contains(clickedPre)) {
    clickedPre.classList.add('is-active-scroll');
  }
};

const handleDelegatedClicks = async (e) => {
  // 1. 代理拦截：点击图片直接下载（无须注入多余DOM）
  if (e.target.tagName === 'IMG' && !e.target.classList.contains('user-msg-img')) {
    const res = await fetch(e.target.src);
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); 
    a.href = blobUrl; 
    a.download = `image-${Date.now()}.png`; 
    a.click(); 
    URL.revokeObjectURL(blobUrl); 
    return;
  }
  
  // 2. 代理拦截：动作按钮 (如通过引擎 Worker 生成的复制按钮)
  const btn = e.target.closest('.action-btn');
  if (!btn) return;
  const type = btn.getAttribute('data-type');
  
  if (type === 'copy-code') {
    const wrapper = btn.closest('.code-block-wrapper');
    const codeEl = wrapper ? wrapper.querySelector('code') : null;
    if (codeEl) {
      await navigator.clipboard.writeText(codeEl.innerText);
      btn.innerHTML = iconCheck; 
      setTimeout(() => { 
        if(btn) btn.innerHTML = iconCopy; 
      }, 2000);
    }
  }
};

const copyToClipboard = (item, index) => {
  navigator.clipboard.writeText(item.content).then(() => {
    currentChat.value.splice(index, 1, markRaw({ ...item, copied: true }));
    setTimeout(() => {
      const latestItem = currentChat.value[index];
      if (latestItem) {
        currentChat.value.splice(index, 1, markRaw({ ...latestItem, copied: false }));
      }
    }, 2000);
  });
};

// 直接修改属性即可，Vue 会自动通知虚拟滚动更新高度
const toggleReasoning = (item) => {
  item.isExpanded = !item.isExpanded;
};

const toggleUserMsg = (item) => {
  item.isExpandUserMsg = !item.isExpandUserMsg;
};


/* =================================================================================
   模块 8: 生命周期与监听
   ================================================================================= */
watch(() => [chatIdNum.value, currentModelId.value], async ([newId, newModelId], old, onCleanup) => {
  if (!newId || !newModelId) return;
  let isExpired = false; 
  onCleanup(() => (isExpired = true));
  try { 
    await AIUserService.activateChatSearch(newId, newModelId, "assistant"); 
  } catch (err) {}
}, { immediate: true });

const isEmbeddingReady = ref(true);
const downloadPercent = ref(100);

onMounted(async () => {
  window.addEventListener("click", closeDropdownOnClickOutside);
  document.addEventListener('click', handleGlobalClick);
  await loadModelsFromDB();
  
  try {
    isEmbeddingReady.value = false; 
    downloadPercent.value = 0;
    await initEmbeddingEngine((payload) => { 
      downloadPercent.value = payload.percent; 
    });
    isEmbeddingReady.value = true; 
    downloadPercent.value = 100;
  } catch (error) { 
    isEmbeddingReady.value = false; 
  }
});

onUnmounted(() => {
  window.removeEventListener("click", closeDropdownOnClickOutside);
  document.removeEventListener('click', handleGlobalClick);
  clearAllEchartsInstances();
  if (abortController) abortController.abort();
});
</script>

<style scoped>
/* ==========================================
   1. 全局与基础组件变量
   ========================================== */
.app-container { 
  display: flex; 
  height: 100vh; 
  width: 100vw; 
  background-color: #ffffff; 
  color: #ececec; 
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
  overflow: hidden; 
}

.ghost { 
  border: none; 
  background: transparent; 
  cursor: pointer; 
  transition: all 0.2s ease; 
}
.ghost:hover { 
  background: rgba(0, 0, 0, 0.05); 
}

/* ==========================================
   2. 左侧边栏 (Sidebar)
   ========================================== */
.sidebar { 
  display: flex; 
  flex-direction: column; 
  width: 260px; 
  background-color: #f9f9f9; 
  border-right: 1px solid #e5e5e5; 
  transition: width 0.3s; 
  position: relative; 
  z-index: 10; 
  white-space: nowrap; 
}

.sidebar.collapsed { 
  width: 0; 
  border-right: none; 
  overflow: hidden; 
}

.sidebar-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  padding: 12px 16px; 
  height: 60px; 
}

.sidebar-actions { 
  padding: 0 12px 12px; 
  display: flex; 
  flex-direction: column; 
  gap: 8px; 
}

.action-row { 
  display: flex; 
  gap: 8px; 
}

.action-btn { 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  gap: 8px; 
  border: none; 
  border-radius: 8px; 
  padding: 10px; 
  font-size: 14px; 
  font-weight: 500; 
  cursor: pointer; 
  transition: all 0.2s; 
}

.action-btn.primary { 
  background-color: #ffffff; 
  color: #333; 
  border: 1px solid #e5e5e5; 
  flex: 1; 
}

.action-btn.primary:hover, 
.action-btn.secondary:hover { 
  background-color: #f3f3f3; 
}

.action-btn.secondary { 
  background-color: #ffffff; 
  color: #333; 
  border: 1px solid #e5e5e5; 
}

.action-btn.icon-only { 
  width: 40px; 
  background-color: #ffffff; 
  border: 1px solid #e5e5e5; 
}

.action-btn.icon-only.active { 
  background-color: #e9eaea; 
  border-color: #929292; 
  color: #8e8f8f; 
}

.icon-btn { 
  background: transparent; 
  border: none; 
  color: #666; 
  font-size: 18px; 
  cursor: pointer; 
  padding: 6px; 
  border-radius: 6px; 
  transition: all 0.2s; 
}

.icon-btn:hover { 
  background-color: #e5e5e5; 
  color: #333; 
}

.icon-btn:active { 
  transform: scale(0.92); 
}

/* ==========================================
   3. 历史对话列表区
   ========================================== */
.chat-list-container { 
  flex: 1; 
  overflow-y: auto; 
  padding: 0 12px; 
}
.chat-list-container::-webkit-scrollbar { width: 4px; }
.chat-list-container::-webkit-scrollbar-thumb { background: #dcdcdc; border-radius: 4px; }

.list-title { 
  font-size: 12px; 
  color: #888; 
  font-weight: 600; 
  margin: 16px 0 8px 8px; 
}

.chat-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  height: 40px;                 
  box-sizing: border-box;       
  border-radius: 8px;
  cursor: pointer;
  color: #333;
  margin-bottom: 4px;
  transition: background 0.2s;
  position: relative;           
}

.chat-item:hover { background-color: #ececec; }
.chat-item.active { background-color: #e5e5e5;  }

.chat-title { 
  flex: 1; 
  white-space: nowrap; 
  overflow: hidden; 
  text-overflow: ellipsis; 
  font-size: 14px; 
}

.menu-trigger { 
  background: transparent; 
  border: none; 
  color: #888; 
  cursor: pointer; 
  padding: 4px; 
  border-radius: 4px; 
  opacity: 0; 
  transition: opacity 0.2s; 
}

.chat-item:hover .menu-trigger, 
.chat-item.active .menu-trigger { 
  opacity: 1; 
}
.menu-trigger:hover { background-color: #dcdcdc; color: #333; }

.rename-input {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  padding: 8px 10px;          
  font-size: 14px;
  color: #334155;
  background-color: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;
  z-index: 2;
}

.rename-input:focus {
  box-shadow: 0 0 0 1px rgba(96, 96, 96, 0.15);
}

/* ==========================================
   4. 底部用户与设置面板
   ========================================== */
.sidebar-footer { 
  padding: 12px; 
  border-top: 1px solid #e5e5e5; 
  position: relative; 
}

.user-profile { 
  display: flex; 
  align-items: center; 
  gap: 12px; 
  padding: 8px 12px; 
  border-radius: 8px; 
  cursor: pointer; 
  transition: background 0.2s; 
}
.user-profile:hover { background-color: #ececec; }

.avatar { 
  width: 32px; 
  height: 32px; 
  border-radius: 10%; 
  object-fit: cover; 
}

.username { 
  flex: 1; 
  font-size: 14px; 
  font-weight: 500; 
  color: #333; 
}

.user-popup-menu { 
  position: absolute; 
  background: white; 
  border: 1px solid #e5e5e5; 
  border-radius: 8px; 
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); 
  z-index: 100; 
  bottom: 60px; 
  left: 12px; 
  width: calc(100% - 24px); 
  padding: 6px 8px;  
}

.menu-info { 
  padding: 8px 16px; 
  font-size: 13px; 
  color: #666; 
}

.menu-divider { 
  height: 1px; 
  background: #e5e5e5; 
  margin: 4px 0; 
}

.menu-item { 
  display: flex; 
  align-items: center; 
  width: 100%;  
  border-radius: 8px; 
  box-sizing: border-box; 
  padding: 10px 16px; 
  font-size: 14px; 
  color: #333; 
  cursor: pointer; 
  border: none; 
  background: transparent; 
  text-align: left; 
}
.menu-item:hover { background-color: #f3f3f3; }

.menu-item.danger { justify-content: center; color: #ef4444; }
.menu-item.danger:hover { background-color: #fef2f2; }

.engine-control-row { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  padding: 8px 16px; 
  cursor: default; 
}
.engine-control-row:hover { background-color: transparent !important; }

.segmented-control { 
  display: flex; 
  background-color: #f1f5f9; 
  border-radius: 6px; 
  padding: 2px; 
  gap: 2px; 
}

.segmented-control button { 
  border: none; 
  background: transparent; 
  padding: 4px 10px; 
  font-size: 12px; 
  color: #64748b; 
  border-radius: 4px; 
  cursor: pointer; 
  transition: all 0.2s; 
  font-weight: 500; 
}
.segmented-control button.active { 
  background-color: #ffffff; 
  color: #0f172a; 
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); 
}

/* ==========================================
   5. 弹出菜单与气泡组件
   ========================================== */
.dropdown-menu { 
  position: absolute; 
  padding: 4px; 
  background: white; 
  border: 1px solid #e5e5e5; 
  border-radius: 8px; 
  box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
  z-index: 100; 
  right: 12px; 
  top: 36px; 
  min-width: 100px; 
}

.popover-menu { 
  position: absolute; 
  bottom: calc(100% + 12px); 
  left: 0; 
  background: white; 
  border-radius: 16px; 
  box-shadow: 0 8px 24px rgba(0,0,0,0.12); 
  padding: 6px; 
  z-index: 100; 
  border: 1px solid #f0f0f0; 
  display: flex; 
  flex-direction: column; 
  gap: 2px; 
}

.tools-menu { min-width: 140px; }

.popover-item { 
  display: flex; 
  align-items: center; 
  gap: 10px; 
  padding: 10px 12px; 
  border-radius: 10px; 
  cursor: pointer; 
  font-size: 14px; 
  color: #333; 
  transition: background 0.2s; 
  white-space: nowrap; 
}
.popover-item:hover { background: #f0f4f9; }
.popover-item .menu-icon { font-size: 16px; color: #666; }

.tooltip-container { position: relative; }
.tooltip-container:hover::after { 
  content: attr(data-tooltip); 
  position: absolute; 
  bottom: 110%; 
  left: 50%; 
  transform: translateX(-50%); 
  background-color: rgba(0,0,0,0.8); 
  color: white; 
  padding: 4px 8px; 
  border-radius: 4px; 
  font-size: 12px; 
  white-space: nowrap; 
  pointer-events: none; 
  z-index: 1000; 
}

/* ==========================================
   6. 主区域容器与 Header
   ========================================== */
.main-content { 
  flex: 1; 
  display: flex; 
  flex-direction: column; 
  background-color: #ffffff; 
  position: relative; 
  transition: all 0.3s; 
  overflow: hidden; 
}

.main-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  height: 60px; 
  padding: 0 16px; 
  flex-shrink: 0; 
}

.header-center { 
  flex: 1; 
  display: flex; 
  justify-content: center; 
}

.expand-btn { 
  background: transparent; 
  color: #555; 
  padding: 6px 8px; 
}
.expand-btn:hover { background-color: #f3f3f3; color: #111; }

.global-overlay { 
  position: fixed; 
  top: 0; 
  left: 0; 
  right: 0; 
  bottom: 0; 
  z-index: 90; 
}

/* ==========================================
   7. 聊天消息区 (Scroller)
   ========================================== */
.chat-wrapper { 
  flex: 1; 
  display: flex; 
  flex-direction: column; 
  height: 100%; 
  min-height: 0; 
  overflow: hidden; 
}
.chat-wrapper.is-homepage { 
  justify-content: center; 
  align-items: center; 
  padding-bottom: 5vh; 
}

.homepage-greeting { 
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  text-align: center; 
  margin-bottom: 40px;
  font-size: 28px; 
  font-weight: 600; 
  color: #111; 
}

.message-list { 
  flex: 1; 
  display: flex; 
  flex-direction: column; 
  overflow: hidden; 
  padding: 0; 
  opacity: 1; 
  min-height: 0; 
}
.message-list.chat-invisible { opacity: 0; pointer-events: none; }

.scroller { 
  flex: 1; 
  height: 100%; 
  overflow-y: auto; 
  overflow-anchor: auto; 
  padding: 24px 16px; 
  transition: opacity 0.25s; 
}

.message-list::-webkit-scrollbar { width: 6px; }
.message-list::-webkit-scrollbar-thumb { background: #d3d3d3; border-radius: 6px; }

.scroller::-webkit-scrollbar { width: 16px; }
.scroller::-webkit-scrollbar-thumb { 
  background-clip: padding-box; 
  border: 4px solid transparent; 
  border-radius: 12px; 
  min-height: 50px; 
}
.scroller:hover::-webkit-scrollbar-thumb { background-color: rgba(211,211,211,0.7); }
.scroller::-webkit-scrollbar-thumb:hover { background-color: rgba(199,200,200,1); }

/* 聊天气泡布局 */
.message-row { 
  display: flex; 
  width: 100%; 
  max-width: 850px; 
  margin: 0 auto; 
  padding: 16px 20px; 
  box-sizing: border-box; 
  gap: 16px; 
  align-items: flex-start; 
}
.message-row.user { flex-direction: row-reverse; }

/* 🌟 核心防爆盾 1: 让 Flex 子元素具有收缩能力 */
.message-body { 
  display: flex; 
  flex-direction: column; 
  gap: 8px; 
  max-width: 100%; 
  flex: 1; 
  min-width: 0; 
}
.message-row.assistant .message-body { align-items: flex-start; }
.message-row.user .message-body { align-items: flex-end; }

/* 🌟 核心防爆盾 2: 强制长单词/链接换行 */
.message-content { 
  font-size: 15px; 
  line-height: 1.6; 
  color: #1a1a1a; 
  overflow-wrap: anywhere; 
  word-break: break-word; 
  min-width: 0; 
  max-width: 100%; 
}

.message-row.user .message-content { 
  background-color: #f4f4f4; 
  padding: 10px 16px; 
  border-radius: 18px 18px 2px 18px; 
  width: fit-content; 
  text-align: left; 
  max-width: 80%; 
}

.message-row.assistant .message-content { 
  width: 100%; 
  padding: 4px 0; 
}

/* 用户长文折叠 */
.user-msg { 
  white-space: pre-wrap; 
  position: relative; 
  overflow: hidden; 
  max-height: 250px; 
}
.user-msg.is-collapsed { 
  max-height: 70vh !important; 
  overflow-y: auto !important; 
}
.user-msg.is-collapsed::-webkit-scrollbar { width: 8px; }
.user-msg.is-collapsed::-webkit-scrollbar-thumb { 
  background-color: rgba(0,0,0,0.15); 
  background-clip: padding-box; 
  border: 2px solid transparent; 
  border-radius: 8px; 
  min-height: 40px; 
}

.collapsed-mask { 
  position: absolute; 
  bottom: 0; 
  left: 0; 
  width: 100%; 
  height: 40px; 
  background: linear-gradient(to bottom, transparent, #ececec); 
  transition: opacity 0.3s; 
  pointer-events: none; 
}
.is-collapsed .collapsed-mask { opacity: 0; }

.message-actions { display: flex; gap: 12px; margin-top: 4px; }
.toggle-btn, .copy-btn { color: #111; font-weight: bold; }
.copy-btn:hover { background-color: #f4f4f4; }

/* 思考过程区 */
.reasoning-section { 
  background-color: #ffffff; 
  border-left: 1px solid #e2e8f0; 
  padding: 10px 14px; 
  border-radius: 6px 12px 12px 6px; 
  width: 100%; 
  box-sizing: border-box; 
}

.reasoning-title { 
  display: flex; 
  align-items: center; 
  gap: 6px; 
  font-size: 12px; 
  color: #8c8c8c; 
  font-weight: 600; 
  margin-bottom: 6px; 
  cursor: pointer; 
  user-select: none; 
}
.reasoning-title:hover { color: #555555; }

.toggle-icon { font-size: 14px; opacity: 0.8; transition: transform 0.3s; }
.toggle-icon.is-open { transform: rotate(180deg); }

.reasoning-collapse-wrapper { 
  display: grid; 
  grid-template-rows: 0fr; 
  opacity: 0; 
  transition: opacity 0.3s; 
  overflow: hidden; 
}
.reasoning-collapse-wrapper.is-open { 
  grid-template-rows: 1fr; 
  opacity: 1; 
  margin-top: 8px; 
}

.reasoning-collapse-wrapper > .reasoning-content { min-height: 0; }
.reasoning-content :deep(.markdown-body) { 
  font-size: 13.5px; 
  line-height: 1.6; 
  color: #475569; 
}

.title-left { display: flex; align-items: center; gap: 6px; }

/* Token 及辅助信息 */
.token-info { 
  display: flex; 
  align-items: center; 
  gap: 6px; 
  font-size: 11px; 
  color: #939393; 
  margin-top: 4px; 
  padding-top: 6px; 
  border-top: 1px dashed #e2e8f0; 
  font-family: "JetBrains Mono", monospace !important; 
}

/* ==========================================
   8. 输入区
   ========================================== */
.input-area { 
  width: 100%; 
  padding: 16px 0 24px 0; 
  background: linear-gradient(180deg, transparent 0%, #ffffff 20%); 
  flex-shrink: 0; 
}

.input-box { 
  width: 100%; 
  max-width: 900px; 
  margin: 0 auto; 
  display: flex; 
  flex-direction: column; 
  gap: 8px; 
  background-color: #f9f9f9; 
  border-radius: 24px; 
  padding: 12px 14px 10px 14px; 
  box-sizing: border-box; 
  transition: all 0.3s; 
  border: 1px solid transparent; 
}

.input-box.is-focused { 
  background-color: #ffffff; 
  box-shadow: 0 6px 20px rgba(0,0,0,0.08); 
  border: 1px solid #cecece; 
}

.input-row { width: 100%; }

textarea { 
  width: 100%; 
  border: none; 
  background: transparent; 
  padding: 4px 8px; 
  font-size: 15.5px; 
  line-height: 1.5; 
  font-family: inherit; 
  color: #111; 
  outline: none; 
  resize: none; 
  box-sizing: border-box; 
  min-height: 24px; 
  max-height: 300px; 
  overflow-y: hidden; 
  white-space: pre-wrap; 
  word-break: break-all; 
}
textarea::placeholder { color: #8c8c8c; }

.toolbar-row { 
  display: flex; 
  justify-content: space-between; 
  align-items: flex-end; 
  width: 100%; 
}

.toolbar-left { display: flex; align-items: center; gap: 8px; }
.tool-wrapper { position: relative; }

.action-circle-btn { 
  width: 34px; 
  height: 34px; 
  border-radius: 50%; 
  color: #444746; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
}

.action-circle-btn .plus-icon { 
  font-size: 20px; 
  transition: transform 0.3s; 
}
.action-circle-btn.is-active .plus-icon { transform: rotate(45deg); }

/* ==========================================
   缓存策略控制面板 (极简高级风)
   ========================================== */
   .context-menu { 
  min-width: 280px; 
  padding: 16px; 
  cursor: default; 
}

.context-header { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  font-size: 14px; 
  font-weight: 600; 
  padding-bottom: 12px; 
  border-bottom: 1px solid #e2e8f0; /* 更柔和的分割线 */
  margin-bottom: 8px; 
  color: #1e293b;
}

.context-row { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  padding: 10px 0; 
  border-bottom: 1px dashed #f1f5f9; /* 行与行之间增加隐约的虚线分割 */
}
.context-row:last-of-type {
  border-bottom: none;
}

.row-label { 
  font-size: 13px; 
  color: #475569; 
  font-weight: 500;
}

.context-tip { 
  margin-top: 12px; 
  padding: 10px; 
  font-size: 12px; 
  color: #64748b; 
  background-color: #f8fafc; 
  border-radius: 8px; 
  line-height: 1.5; 
  border: 1px solid #e2e8f0; 
}

/* 🌟 重构的输入框外层容器 */
.number-input-wrapper { 
  display: flex; 
  align-items: center; 
  background: #f8fafc;        /* 浅灰白底色 */
  border: 1px solid #cbd5e1;  /* 清晰的细边框 */
  border-radius: 6px; 
  padding: 4px 8px; 
  transition: all 0.2s ease;
}

.number-input-wrapper:hover {
  border-color: #94a3b8;      /* 悬停加深边框 */
}

.number-input-wrapper:focus-within { 
  border-color: #3b82f6;      /* 聚焦变蓝 */
  background: #ffffff; 
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); /* 柔和的蓝色光晕 */
}

/* 🌟 重构的输入框本身 */
.limit-input { 
  width: 60px; /* 默认宽度（适合两位数） */
  border: none; 
  background: transparent; 
  color: #0f172a;             /* 近乎黑色的深灰，极具质感 */
  font-weight: 600; 
  font-size: 13px; 
  text-align: right; 
  outline: none; 
  margin-right: 6px; 
  font-family: "JetBrains Mono", Consolas, monospace; /* 等宽字体保留极客感 */
  padding: 0;
}

/* 针对字数限制的宽输入框 */
.limit-input.long-input {
  width: 54px; 
}

/* 隐藏上下箭头，让输入框更极简 */
.limit-input::-webkit-outer-spin-button, 
.limit-input::-webkit-inner-spin-button { 
  -webkit-appearance: none; 
  margin: 0; 
}

/* 🌟 后缀单位 */
.unit { 
  font-size: 12px; 
  color: #94a3b8; /* 退为低调的灰色 */
  font-weight: 500; 
  user-select: none;
}

.model-selector-btn { 
  display: flex; 
  align-items: center; 
  gap: 6px; 
  padding: 6px 10px; 
  border-radius: 12px; 
  color: #444746; 
  font-size: 13.5px; 
  font-weight: 500; 
  height: 34px; 
  box-sizing: border-box; 
}
.model-icon { font-size: 14px; color: #8b5cf6; }

.model-selector-btn .chevron { 
  font-size: 14px; 
  color: #888; 
  transition: transform 0.2s; 
}
.model-selector-btn .chevron.is-open { transform: rotate(180deg); }

.send-btn { 
  width: 36px; 
  height: 36px; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  border-radius: 50%; 
  border: none; 
  background: #e0e0e0; 
  color: #fff; 
  cursor: not-allowed; 
  transition: all 0.2s; 
}

.send-btn.active { background: #111; cursor: pointer; }
.send-btn.active:hover { background: #333; transform: scale(1.05); }

.footer-hint { 
  text-align: center; 
  font-size: 12px; 
  color: #999; 
  margin-top: 12px; 
}

/* ==========================================
   9. 附件上传预览样式
   ========================================== */
.file-preview-area { 
  display: flex; 
  flex-wrap: wrap; 
  gap: 10px; 
  padding: 4px 8px 12px 8px; 
  border-bottom: 1px solid transparent; 
}

.preview-item { 
  position: relative; 
  width: 64px; 
  height: 64px; 
  border-radius: 12px; 
  background-color: #f1f5f9; 
  border: 1px solid #e2e8f0; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
}

.preview-img { 
  width: 100%; 
  height: 100%; 
  object-fit: cover; 
  border-radius: 11px; 
}

.preview-doc { 
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  justify-content: center; 
  gap: 4px; 
  width: 100%; 
  padding: 4px; 
}
.preview-doc .doc-icon { font-size: 24px; color: #3b82f6; }
.preview-doc .doc-name { 
  font-size: 10px; 
  color: #64748b; 
  width: 90%; 
  white-space: nowrap; 
  overflow: hidden; 
  text-overflow: ellipsis; 
  text-align: center; 
}

.remove-file-btn { 
  position: absolute; 
  top: -6px; 
  right: -6px; 
  width: 20px; 
  height: 20px; 
  border-radius: 50%; 
  background-color: #64748b; 
  color: white; 
  border: 2px solid #ffffff; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  cursor: pointer; 
  padding: 0; 
}
.remove-file-btn:hover { background-color: #ef4444; }

.user-attachments.standalone { 
  display: flex; 
  flex-direction: row; 
  flex-wrap: wrap; 
  justify-content: flex-end; 
  gap: 10px; 
}

.user-msg-img { 
  width: 120px; 
  height: 120px; 
  border-radius: 14px; 
  object-fit: cover; 
  border: 1px solid rgba(0,0,0,0.08); 
  background-color: #f8f9fa; 
}

.user-msg-doc { 
  display: flex; 
  align-items: center; 
  gap: 10px; 
  background-color: #ffffff; 
  padding: 12px 16px; 
  border-radius: 14px; 
  border: 1px solid rgba(0,0,0,0.1); 
  box-shadow: 0 1px 3px rgba(0,0,0,0.02); 
  min-width: 200px; 
  max-width: 300px; 
}
.user-msg-doc .doc-icon { font-size: 24px; color: #ea4335; flex-shrink: 0; }
.user-msg-doc .doc-name { 
  font-size: 14px; 
  font-weight: 500; 
  color: #3c4043; 
  word-break: break-all; 
  line-height: 1.3; 
}

/* ==========================================
   10. 联级菜单 (模型与厂商)
   ========================================== */
.cascading-menu-container {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;                    
  width: max-content;
  z-index: 100;
  animation: menuIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes menuIn {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.provider-panel,
.model-panel {
  min-height: 0;
  max-height: 320px;
  height: max-content;
  overflow-y: auto;
  padding: 6px;                
  background: #ffffff;
  border: 1px solid #eef0f2;
  border-radius: 14px;         
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.06);
}

.provider-panel {
  min-width: 120px;
  max-width: 240px;
  background: #f9fafb;         
}

.model-panel {
  min-width: 160px;
  max-width: 320px;
}

/* 菜单项通用 */
.provider-item,
.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 10px;
  margin: 2px 0;               
  font-size: 13px;
  color: #334155;
  border-radius: 8px;          
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
  position: relative;
}

/* 去除第一项和最后一项的多余 margin */
.provider-item:first-child,
.model-item:first-child {
  margin-top: 0;
}
.provider-item:last-child,
.model-item:last-child {
  margin-bottom: 0;
}

/* 厂商项悬停/激活 */
.provider-item:hover,
.provider-item.is-active {
  background: #eef2f6;
  color: #0f172a;
  font-weight: 500;
}

/* 模型项悬停 */
.model-item:hover {
  background: #f4f6f8;
}

/* 模型项选中 */
.model-item.is-selected {
  color: #2563eb;
  font-weight: 500;
  background: #eef4ff;
}

/* 文本溢出处理 */
.item-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 8px;          
}

/* 箭头图标 */
.arrow-icon {
  font-size: 14px;
  color: #94a3b8;
  flex-shrink: 0;
}

/* 勾选图标 */
.check-icon {
  font-size: 14px;
  color: #3b82f6;
  flex-shrink: 0;
}

/* 空状态/加载提示 */
.empty-tip,
.loading-tip {
  padding: 20px 16px;
  text-align: center;
  font-size: 12px;
  color: #9ca3af;
}

/* 滚动条美化 */
.provider-panel::-webkit-scrollbar,
.model-panel::-webkit-scrollbar {
  width: 5px;
}
.provider-panel::-webkit-scrollbar-thumb,
.model-panel::-webkit-scrollbar-thumb {
  background: #dce1e8;
  border-radius: 10px;
}
.provider-panel::-webkit-scrollbar-track,
.model-panel::-webkit-scrollbar-track {
  background: transparent;
}

/* ==========================================
   11. Markdown 内部抗压样式 (防爆盾)
   ========================================== */
.markdown-body :deep(pre),
.markdown-body :deep(.code-block-wrapper),
.markdown-body :deep(mjx-container[jax="SVG"] svg) {
  max-width: 100% !important;
  box-sizing: border-box !important;
}

/* ==========================================
   12. 动画类
   ========================================== */
.fade-up-enter-active, 
.fade-up-leave-active { 
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); 
}
.fade-up-enter-from, 
.fade-up-leave-to { 
  opacity: 0; 
  transform: translateY(8px) scale(0.96); 
}

.flowing-line { 
  width: 100% !important; 
  height: 4px !important; 
  flex-shrink: 0 !important; 
  z-index: 9999 !important; 
  background-image: linear-gradient(to right, transparent 0%, #808080 50%, transparent 100%) !important; 
  background-size: 200% 100% !important; 
  animation: light-flow-test 1.5s linear infinite !important; 
}
@keyframes light-flow-test { 
  0% { background-position: 100% 0; } 
  100% { background-position: -100% 0; } 
}

.pulse-dot { 
  width: 6px; 
  height: 6px; 
  background-color: #3b82f6; 
  border-radius: 50%; 
  position: relative; 
}
.pulse-dot::after { 
  content: ""; 
  position: absolute; 
  width: 100%; 
  height: 100%; 
  background: inherit; 
  border-radius: inherit; 
  animation: pulse-wave 1.5s infinite; 
}
@keyframes pulse-wave { 
  0% { transform: scale(1); opacity: 0.5; } 
  100% { transform: scale(3); opacity: 0; } 
}

.typing-placeholder { 
  display: inline-block; 
  font-size: 20px; 
  font-weight: 600; 
  color: #949494; 
  letter-spacing: 4px; 
  line-height: 1; 
  margin-left: 4px; 
  animation: ai-thinking 1.2s infinite; 
}
@keyframes ai-thinking { 
  0%, 100% { opacity: 0.3; transform: translateY(0); } 
  50% { opacity: 1; color: #454545; transform: translateY(-2px); } 
}
</style>