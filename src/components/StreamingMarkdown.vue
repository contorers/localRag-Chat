<template>
  <div class="streaming-container" ref="containerRef">
    <div 
      v-show="!renderedHtml && content" 
      class="markdown-body raw-text-fallback" 
      style="white-space: pre-wrap; word-break: break-word;"
    >
      {{ content }}
    </div>

    <div
      v-show="renderedHtml"
      ref="markdownRef"
      class="markdown-body"
      :class="{ 'is-generating-state': isGenerating }"
      v-html="renderedHtml"
      @click="handleDelegatedClicks"
    ></div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import { throttle } from "lodash-es";
import DOMPurify from "dompurify";
import "highlight.js/styles/atom-one-light.css";
import "katex/dist/katex.min.css";
import "../../node_modules/somarkdown/dist/somarkdown.css";

import mermaid from "mermaid";
import { renderMarkdownAsync, unregisterMarkdown } from "../markdown/markdownClient"; 

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName && data.tagName.toLowerCase().startsWith('mjx-')) {
    data.allowedTags[data.tagName] = true;
  }
});
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName && data.attrName.toLowerCase().startsWith('mjx-')) {
    data.allowedAttributes[data.attrName] = true;
  }
});

const purifyConfig = {
  ADD_TAGS: [
    'mjx-container', 'mjx-assistive-mml', 'math', 'mi', 'mo', 'mn', 'ms', 'mtext',
    'svg', 'path', 'g', 'defs', 'use', 'img', 'span', 'annotation', 'semantics' 
  ], 
  ADD_ATTR: ['src', 'viewBox', 'd', 'style', 'data-tex', 'transform', 'display','target', 'rel','id', 'href', 'class'], 
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-]|$))/i,
  ADD_URI_SAFE_ATTR: ['src'],
  ALLOW_DATA_ATTR: true 
};

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

const props = defineProps({
  content: { type: String, default: "" },
  maxWidth: { type: String, default: "100%" },
  isGenerating: { type: Boolean, default: false },
  isLocked: { type: Boolean, default: false },
  engine: { type: String, default: "somarkdown" }, 
});

const containerRef = ref(null);
const markdownRef = ref(null);
const renderedHtml = ref("");
const bubbleId = Math.random().toString(36).substring(2, 9);
const emit = defineEmits(['rendered']); 

// ==========================================
// 🌟 完美找回：全局点击监听，控制代码块垂直滚动条的显隐
// ==========================================
const handleGlobalClick = (e) => {
  if (!markdownRef.value) return;
  
  const clickedPre = e.target.closest('pre');
  
  markdownRef.value.querySelectorAll('pre.is-active-scroll').forEach(p => {
    if (p !== clickedPre) {
      p.classList.remove('is-active-scroll');
    }
  });
  
  if (clickedPre && markdownRef.value.contains(clickedPre)) {
    clickedPre.classList.add('is-active-scroll');
  }
};

const iconCopy = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;
const iconCheck = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// ==========================================
// 🌟 完美找回：事件代理交互
// ==========================================
const handleDelegatedClicks = async (e) => {
  const btn = e.target.closest('.action-btn');
  if (!btn) return;

  const type = btn.getAttribute('data-type');
  
  if (type === 'image') {
    const wrapper = btn.closest('.image-download-wrapper');
    const img = wrapper ? wrapper.querySelector('img') : null;
    if (img) downloadFile(img.src, `image-${Date.now()}.png`);
  } 
  else if (type === 'svg') {
    const wrapper = btn.closest('.svg-download-wrapper');
    const svg = wrapper ? wrapper.querySelector('svg:not(.icon)') : null;
    if (svg) downloadSvg(svg, `diagram-${Date.now()}.svg`);
  } 
  else if (type === 'copy-code') {
    const wrapper = btn.closest('.code-block-wrapper');
    const codeEl = wrapper ? (wrapper.querySelector('pre code') || wrapper.querySelector('pre')) : null;
    
    if (codeEl) {
      try {
        await navigator.clipboard.writeText(codeEl.innerText || codeEl.textContent);
        btn.innerHTML = iconCheck;
        setTimeout(() => { if (btn) btn.innerHTML = iconCopy; }, 2000);
      } catch (err) {
        console.error('复制失败:', err);
      }
    }
  }
};

// ==========================================
// 🌟 完美找回：动态注入 Header + 悬浮下载按钮
// ==========================================
const injectCodeBlockHeaders = () => {
  const container = markdownRef.value;
  if (!container) return;

  const pres = container.querySelectorAll('pre:not(.has-wrapper)');
  pres.forEach(pre => {
    if (pre.closest('.math-block-wrapper, .katex-display, .katex, .code-block, .somarkdown-code-block')) return;
    const code = pre.querySelector('code');
    if (code && code.className.includes('language-math')) return; 

    pre.classList.add('has-wrapper');

    let lang = 'Text';
    if (code && code.className) {
      const match = code.className.match(/language-(\w+)/);
      if (match) lang = match[1];
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    
    pre.parentNode.insertBefore(wrapper, pre);
    
    const header = document.createElement('div');
    header.className = 'code-header';
    header.innerHTML = `
      <span class="code-lang">${lang}</span>
      <button class="action-btn copy-btn" data-type="copy-code" title="复制代码">
        ${iconCopy}
      </button>
    `;

    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
};

const injectDownloadButtons = () => {
  const container = markdownRef.value;
  if (!container) return;

  const images = container.querySelectorAll('img:not(.has-download)');
  images.forEach(img => {
    img.classList.add('has-download'); 
    const wrapper = document.createElement('div');
    wrapper.className = 'image-download-wrapper';

    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);

    const btn = document.createElement('button');
    btn.className = 'action-btn download-btn';
    btn.setAttribute('data-type', 'image');
    btn.title = "下载图片";
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    wrapper.appendChild(btn);
  });
};

const downloadFile = async (url, filename) => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (e) {
    const a = document.createElement('a'); a.href = url; a.download = filename; a.target = '_blank'; a.click();
  }
};

const downloadSvg = (svgEl, filename) => {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const svgData = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([svgData], { type: "image/svg+xml;charset=utf-8" }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const renderAllMermaid = async () => {
  const container = markdownRef.value;
  if (!container || props.isGenerating) return;

  const blocks = container.querySelectorAll(".mermaid-block:not(.rendered)");
  if (blocks.length === 0) return;

  for (const block of blocks) {
    const rawSource = decodeURIComponent(block.getAttribute("data-source") || "");
    if (!rawSource) continue;

    try {
      // 1. 预校验：如果语法明显不完整（比如缺少闭合），直接跳过，等下次流式更新
      if (!rawSource.includes("graph") && !rawSource.includes("sequenceDiagram") && !rawSource.includes("pie")) {
        continue;
      }

      block.classList.add("rendered");
      
      // 2. 离屏预渲染（关键：用一个临时 div，不要挂载到 body 下）
      const tempDiv = document.createElement("div");
      tempDiv.style.position = "absolute";
      tempDiv.style.left = "-9999px";
      tempDiv.innerHTML = rawSource;
      
      // 使用 run API，它比 render 更稳定
      await mermaid.run({
        nodes: [tempDiv],
        suppressErrors: true // 🌟 核心：强制开启静默模式，防止它乱报 Syntax Error
      });

      // 3. 渲染成功后，将结果从临时 div 移动到正式 block
      block.innerHTML = `
        <div class="svg-download-wrapper fade-in-smooth" style="width: 100%; overflow-x: auto;">
          ${tempDiv.innerHTML}
        </div>
      `;
      document.body.removeChild(tempDiv);
    } catch (e) {
      // 4. 彻底失败降级：将其直接显示为代码块，彻底停止 Mermaid 渲染尝试
      block.classList.add("rendered", "has-mermaid-error");
      block.classList.remove("mermaid-block");
      block.className = "code-block-wrapper";
      
      block.innerHTML = `
        <div class="code-header" style="background: #fee2e2; border-bottom: 1px solid #fca5a5;">
          <span class="code-lang" style="color: #b91c1c;">解析失败：Mermaid 语法错误</span>
          <button class="action-btn copy-btn" data-type="copy-code">${iconCopy}</button>
        </div>
        <pre><code class="hljs css" style="color: #991b1b; background: #fef2f2;">${rawSource.replace(/</g, "&lt;")}</code></pre>
      `;
    }
  }
};

// ==========================================
// 🌟 核心抗压修改：消除页面流式渲染塌陷
// ==========================================
// ==========================================
// 🌟 核心抗压修改：消除页面流式渲染塌陷
// ==========================================
const throttledRender = throttle(
  (newText) => {
    if (isDestroyed) return;

    // 直接把原始文本喂给引擎，不用在前端假装是 http 了
    renderMarkdownAsync(bubbleId, newText, props.isGenerating, props.engine, (data) => {
      if (isDestroyed || data.status !== 'success') return;
      
      let rawHtml = data.html;

      // 🌟 终极外科手术：直接拦截引擎生成的 HTML 结果
      
      // 情况 1：引擎自作聪明，把它变成了 <a> 蓝色链接
      // 把 <a href="aiImages/xxx.png">...</a> 强行替换回图片标签
      rawHtml = rawHtml.replace(
        /<a[^>]*href=["'](?:http:\/\/user-data\.localhost\/|user-data:\/\/)?((?:aiImages|contactAvatar)\/[^"']+)["'][^>]*>.*?<\/a>/gi,
        '<img src="http://user-data.localhost/$1" alt="local-image" />'
      );

      // 情况 2：引擎正常识别了图片 <img src="aiImages/xxx.png">，但缺了底层协议头
      rawHtml = rawHtml.replace(
        /<img[^>]*src=["'](?:http:\/\/user-data\.localhost\/|user-data:\/\/)?((?:aiImages|contactAvatar)\/[^"']+)["'][^>]*>/gi,
        '<img src="http://user-data.localhost/$1" />'
      );

      // 3. 安全清洗 (DOMPurify 会完美放行 http://user-data.localhost 的 img 标签)
      const safeHtml = DOMPurify.sanitize(rawHtml, purifyConfig);
      renderedHtml.value = safeHtml;
      
      nextTick(() => {
        renderAllMermaid();
        injectDownloadButtons();
        injectCodeBlockHeaders(); 
        emit('rendered'); 
      });
    });
  },
  80 
);

watch(() => props.engine, () => { if (props.content) throttledRender(props.content); });

onMounted(() => {
  document.addEventListener('click', handleGlobalClick);
});

let isDestroyed = false;
onUnmounted(() => {
  isDestroyed = true;
  document.removeEventListener('click', handleGlobalClick); 
  if (throttledRender && throttledRender.cancel) throttledRender.cancel();
  unregisterMarkdown(bubbleId);
});

watch(() => props.isGenerating, (val) => {
  if (!val) {
    throttledRender.flush(); 
    setTimeout(() => {
      renderAllMermaid();
      injectDownloadButtons(); 
      injectCodeBlockHeaders(); 
    }, 50);
    nextTick(() => { emit('rendered'); });
  }
});

watch(() => props.content, (newText) => { if (newText) throttledRender(newText); }, { immediate: true });
</script>

<style scoped>
/* ==========================================
   全局与基础排版
   ========================================== */
.streaming-container {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-family: "Google Sans", "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.2px;
  overflow-anchor: none;
  user-select: text;
  
  /* 🌟 抗塌陷核心武器 1：对整个消息容器启用严格的独立隔离渲染，禁止内容物影响外部滚动锚 */
  contain: layout style;
}

.markdown-body {
  display: flow-root;
  color: #202124; 
  line-height: 1.75;
  font-size: 15px; 
}

/* 标题样式 */
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3) {
  color: #202124; font-weight: 500; margin-top: 1.6em; margin-bottom: 0.8em; line-height: 1.3;
}
.markdown-body :deep(h1) { font-size: 1.6em; }
.markdown-body :deep(h2) { font-size: 1.3em; padding-bottom: 0.3em; border-bottom: 1px solid #f1f3f4; }

.markdown-body :deep(p) { margin-top: 0; margin-bottom: 1.2em; }
.markdown-body :deep(a) { color: #1a73e8; text-decoration: none; }
.markdown-body :deep(a:hover) { text-decoration: underline; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 1.5em; margin-bottom: 1.2em; }

.markdown-body :deep(blockquote) { 
  margin: 1.2em 0; padding: 0.8em 1.2em; color: #6c6c6c; background-color: #f9f9f9; border-left: 1px solid #dadce0; border-radius: 0 4px 4px 0;
}

.markdown-body :deep(img) {
  display: block; min-height: 120px; max-width: 100%; height: auto; border-radius: 8px; background-color: #f8f9fa; border: 1px solid #f1f3f4;
}

/* ==========================================
   💥 独家底层抗电压/抗塌陷样式支撑
   ========================================== */

/* 🌟 抗塌陷核心武器 2：告知浏览器，这些正在高频重绘的块级元素，绝对不允许参与聊天界面的滚动锚定计算 */
.markdown-body :deep(.math-block-wrapper),
.markdown-body :deep(.code-block-wrapper),
.markdown-body :deep(.mermaid-block),
.markdown-body :deep(mjx-container[display="true"]),
.markdown-body :deep(.katex-display) {
  overflow-anchor: none !important;
  contain: layout style;
}

.mermaid-block {
  /* 强制创建一个独立的渲染上下文，防止子元素的宽高影响父元素 */
  contain: layout style;
  
  /* 绝对锁死：这是防爆的关键 */
  width: 100% !important;
  max-width: 100% !important;
  
  /* 允许内部滚动，但决不溢出 */
  overflow-x: auto !important;
  overflow-y: hidden !important;
  
  /* 给渲染留出最小高度，防止从 0 到有时的跳变 */
  min-height: 150px;
  
  /* 关键：阻止 SVG 撑开容器 */
  display: block;
}

/* 强制所有 SVG 的行为 */
.mermaid-block svg {
  max-width: 100% !important;
  height: auto !important;
  /* 确保 SVG 不会因为某些属性强行拉伸 */
  display: block;
}
/* 🌟 抗塌陷核心武器 3：流式渲染状态下，给未解析完的闭合块撑开最小占位高度，防止高度归零引发的塌陷 */
.markdown-body.is-generating-state :deep(.math-block-wrapper),
.markdown-body.is-generating-state :deep(.code-block-wrapper) {
  min-height: 3.5em;
  transform: translateZ(0); /* 开启 GPU 独立复合层，防止整个 DOM 树重排 */
  will-change: transform;
}

/* ==========================================
   图表与公式样式排版
   ========================================== */
.markdown-body :deep(svg) { max-width: 100% !important; height: auto !important; }
.markdown-body :deep(.mermaid-block svg) { max-width: 100% !important; max-height: 70vh; display: block; margin: 0 auto; }
.markdown-body :deep(mjx-container svg) { max-width: 100% !important; height: auto !important; vertical-align: middle; }

/* 表格 */
.markdown-body :deep(table) { border-collapse: collapse; width: max-content; max-width: 100%; margin: 1.5em 0; text-align: left; border: 1px solid #dadce0; border-radius: 8px; overflow: hidden; }
.markdown-body :deep(th), .markdown-body :deep(td) { padding: 10px 14px; border: 1px solid #dadce0; }
.markdown-body :deep(th) { font-weight: 500; background-color: #f8f9fa; }

/* 公式块交互 */
.markdown-body :deep(.math-block-wrapper) { position: relative; margin: 0.8em 0 !important; padding: 12px 0 !important; border-radius: 8px; transition: background 0.2s; line-height: 0 !important; text-align: center; }
.markdown-body :deep(.math-block-wrapper:hover) { background-color: #f8f9fa; }
.markdown-body :deep(.math-block-wrapper .copy-math-btn) { position: absolute; top: 4px; right: 8px; opacity: 0; padding: 4px; cursor: pointer; transition: all 0.2s; border-radius: 4px; }
.markdown-body :deep(.math-block-wrapper:hover .copy-math-btn) { opacity: 1 !important; }
.markdown-body :deep(.math-main-content) { display: flex; justify-content: center; align-items: center; width: 100%; }
.markdown-body :deep(mjx-container[jax="SVG"]) { max-width: 100%; overflow-x: auto; overflow-y: hidden; padding-bottom: 8px !important; }
.markdown-body :deep(mjx-assistive-mml) { display: none !important; }

/* 行内代码与行内公式 */
.markdown-body :deep(.math-inline-wrapper) { cursor: pointer; border-radius: 4px; transition: background-color 0.2s; vertical-align: middle !important; margin: 0 0.15em !important; padding: 0 2px !important; line-height: normal !important; }
.markdown-body :deep(.math-inline-wrapper:hover) { background-color: #f1f3f4; }
.markdown-body :deep(code:not(.hljs)):not([class*="language-"]) {  color: #202124 !important; padding: 0.15em 0.4em !important; border-radius: 4px !important; font-family: "JetBrains Mono", Consolas, monospace !important; }

/* 滚动条轻量化 */
.markdown-body :deep(mjx-container[jax="SVG"])::-webkit-scrollbar, .markdown-body :deep(pre)::-webkit-scrollbar { height: 6px; width: 6px; }
.markdown-body :deep(mjx-container[jax="SVG"])::-webkit-scrollbar-thumb, .markdown-body :deep(pre)::-webkit-scrollbar-thumb { background: #dadce0; border-radius: 4px; }

.markdown-body :deep(.mermaid-block) { margin: 1.5em 0 !important; padding: 12px !important; min-height: 100px; background-color: #ffffff; border-radius: 12px; border: 1px solid #dadce0;}

/* 打字机光标 */
.is-generating-state :deep(> *:last-child::after) { content: "|"; margin-left: 4px; color: #cccccc; animation: cursor-blink 0.8s infinite; }
@keyframes cursor-blink { 50% { opacity: 0; } }

/* ==========================================
   按钮与控件交互样式
   ========================================== */
.markdown-body :deep(.action-btn) { 
  display: inline-flex; align-items: center; justify-content: center; background: #ffffff; border: 0px solid #dadce0 !important; color: #5f6368; padding: 5px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 1px 2px rgba(60,64,67,0.05) !important; 
}
.markdown-body :deep(.action-btn:hover) { background: #f8f9fa; color: #4a4a4a; box-shadow: 0 1px 3px rgba(60,64,67,0.1) !important; }
.markdown-body :deep(.action-btn:active) { background: #d1d1d1; transform: scale(0.97); }
.markdown-body :deep(.action-btn svg) { pointer-events: none; }

/* 图片/SVG悬浮下载按钮排版结构保持原汁原味 */
.markdown-body :deep(.image-download-wrapper), .markdown-body :deep(.svg-download-wrapper) { position: relative; display: inline-block; max-width: 100%; }
.markdown-body :deep(.image-download-wrapper img) { margin: 0; }
.markdown-body :deep(.download-btn) { position: absolute !important; top: 10px !important; right: 10px !important; opacity: 0; border-radius: 8px; padding: 8px !important; z-index: 10; background: rgba(255, 255, 255, 0.8) !important; backdrop-filter: blur(4px); }
.markdown-body :deep(.image-download-wrapper:hover .download-btn), .markdown-body :deep(.svg-download-wrapper:hover .download-btn) { opacity: 1; }

/* ==========================================
   🌟 核心功能找回：代码块完美同步你的交互外观与拦截行为
   ========================================== */
.markdown-body :deep(.code-block-wrapper) {
  background: #ffffff !important; border: 1px solid #dadce0 !important; border-radius: 12px !important; margin: 1.5em 0 !important; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.02) !important;
}
.markdown-body :deep(.code-header) {
  display: flex; justify-content: space-between; align-items: center; background: #ffffff !important; padding: 8px 12px 8px 16px; border-bottom: 1px solid #f1f3f4; 
}
.markdown-body :deep(.code-lang) { color: #5f6368; font-size: 12px; font-family: ui-monospace, Consolas, monospace; font-weight: 500; }
.markdown-body :deep(.code-header .copy-btn) { background: transparent !important; border: none !important; box-shadow: none !important; color: #5f6368; padding: 6px; border-radius: 6px; }
.markdown-body :deep(.code-header .copy-btn:hover) { background: #f4f4f4 !important; color: #202124; }

/* 🌟 完美保留：默认隐藏垂直滚动条交互 */
.markdown-body :deep(pre) {
  background: #fcfcfc !important; margin: 0 !important; padding: 16px !important; border: none !important; border-radius: 0 0 12px 12px !important; 
  overflow-x: auto !important; 
  overflow-y: hidden !important; /* 🌟 默认禁止垂直滚动 */
  max-height: 450px !important; transition: box-shadow 0.2s ease;
}

/* 🌟 完美保留：点击激活后释放垂直滚动条 */
.markdown-body :deep(pre.is-active-scroll) {
  overflow-y: auto !important;
}

.markdown-body :deep(pre code.hljs) { background: transparent !important; font-family: "JetBrains Mono", Consolas, monospace !important; font-size: 13.5px !important; line-height: 1.6 !important; }

/* ==========================================
   图表占位与错误提示 UI
   ========================================== */
/* 1. 流式输出期间，图表正在生成的骨架占位（抗塌陷） */
.markdown-body :deep(.mermaid-block:not(.rendered)) {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  margin: 1.5em 0 !important;
  background-color: #f8f9fa;
  border: 1px dashed #dadce0;
  border-radius: 12px;
  color: #80868b;
  font-size: 13px;
}
.markdown-body :deep(.mermaid-block:not(.rendered) .mermaid-loading) {
  animation: pulse-opacity 1.5s infinite;
}
@keyframes pulse-opacity {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* 2. Mermaid 解析报错时的优雅错误框 */
.markdown-body :deep(.mermaid-error-box) {
  background: #fef2f2;
  border: 1px solid #fca5a5;
  border-radius: 12px;
  overflow: hidden;
  margin: 0;
}
.markdown-body :deep(.mermaid-error-box .error-header) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fee2e2;
  color: #b91c1c;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid #fca5a5;
}
.markdown-body :deep(.mermaid-error-box .error-body) {
  padding: 12px;
  overflow-x: auto;
}
/* 覆盖原本 pre 的样式，让错误代码保持紧凑 */
.markdown-body :deep(.mermaid-error-box pre) {
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  max-height: 250px !important;
}
.markdown-body :deep(.mermaid-error-box code) {
  color: #7f1d1d !important;
  font-family: "JetBrains Mono", Consolas, monospace !important;
  font-size: 12.5px !important;
  background: transparent !important;
}


</style>