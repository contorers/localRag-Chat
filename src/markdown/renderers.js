// src/components/ai/renderers.js
import plantumlEncoder from "plantuml-encoder";

class LRUCache {
  constructor(limit = 30) {
    this.limit = limit;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return null;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }
  set(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.limit) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, value);
  }
}
const stableBlockCache = new LRUCache(30);

const copyIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;
const downloadIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>`;

const escapeHtml = (unsafe) => {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

const getHashCode = (str) => {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

// 🌟 致命错误修复：强行处理类似 q_d^{-1} 的裸奔节点 
// src/components/ai/renderers.js (只替换 healMermaidCode 函数)
const healMermaidCode = (rawCode) => {
  if (!rawCode) return "";
  let code = rawCode.replace(/[“”]/g, '"').replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 🌟 核心 1：将脆弱的 graph 引擎强行升级为容错极强的 flowchart 引擎
  code = code.replace(/^graph\b/gm, 'flowchart');

  // 🌟 核心 2：无死角给节点套双引号 (允许 ID 为中文)
  code = code.replace(/([a-zA-Z0-9_\-\u4e00-\u9fa5]+)\s*\[([^\]]+)\]/g, (m, id, content) => {
    if (content.trim().startsWith('"')) return m;
    return `${id}["${content.replace(/"/g, "'").trim()}"]`;
  });

  // 保护 Node(Content)：遇到 ) 才停止
  code = code.replace(/([a-zA-Z0-9_\-\u4e00-\u9fa5]+)\s*\(([^\)]+)\)/g, (m, id, content) => {
    if (content.trim().startsWith('"')) return m;
    if (content.startsWith('(')) return m; // 排除双圆号
    return `${id}("${content.replace(/"/g, "'").trim()}")`;
  });

  // 保护 Node{Content}：遇到 } 才停止
  code = code.replace(/([a-zA-Z0-9_\-\u4e00-\u9fa5]+)\s*\{([^\}]+)\}/g, (m, id, content) => {
    if (content.trim().startsWith('"')) return m;
    if (content.startsWith('{')) return m; // 排除双花括号
    return `${id}{"${content.replace(/"/g, "'").trim()}"}`;
  });

  // 保护裸奔公式变量 (如 q_d^{-1} -->)
  code = code.replace(/([a-zA-Z0-9_]+[\^_{][a-zA-Z0-9_{}\-]+)(\s*-->|\s*-.-|\s*\|)/g, '"$1"$2');

  return code;
};

const downloadSvgAsImage = (svgElement, filename = "diagram.png") => {
  try {
    const clonedSvg = svgElement.cloneNode(true);
    const bBox = svgElement.getBBox();
    clonedSvg.setAttribute("width", bBox.width);
    clonedSvg.setAttribute("height", bBox.height);
    clonedSvg.setAttribute("xmlns", "[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)");
    const svgData = new XMLSerializer().serializeToString(clonedSvg);
    const base64Data = window.btoa(unescape(encodeURIComponent(svgData)));
    const dataUrl = `data:image/svg+xml;base64,${base64Data}`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = bBox.width * 2;
      canvas.height = bBox.height * 2;
      const ctx = canvas.getContext("2d");
      ctx.scale(2, 2);
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, bBox.width, bBox.height);
      ctx.drawImage(img, 0, 0);
      try {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = filename;
        a.click();
      } catch (e) {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = filename.replace(".png", ".svg");
        a.click();
      }
    };
    img.src = dataUrl;
  } catch (err) {}
};

const activeEchartsMap = new Map();

export const blockRegistry = {
  // -----------------------------------------
  // 1. Mermaid
  // -----------------------------------------
  mermaid: {
    generateHTML: (code, blockId, safeEncodedCode) => {
      const safeCode = healMermaidCode(code);
      const cached = stableBlockCache.get(blockId); 
      const showSvg = cached && cached.svg ? "flex" : "none";
      const showFallback = cached && cached.svg ? "none" : "block";
      const svgContent = cached && cached.svg ? cached.svg : "";
      
      return `
        <div class="custom-block mermaid-container " 
             data-lang="mermaid" data-source="${safeEncodedCode}" data-block-id="${blockId}"
             style="position: relative; border: 1px solid #e5e7eb; border-radius: 8px; margin: 1em 0; overflow: hidden;">
          <div class="mermaid-svg-wrapper" style="position: relative; display: ${showSvg}; justify-content: center; padding: 20px; background: #ffffff;">
            ${svgContent}
          </div>
          <div class="mermaid-fallback code-block" style="display: ${showFallback}; margin: 0; border: none; border-radius: 0;">
            <div class="code-header" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; background: #f8fafc; border-bottom: 1px solid #e5e7eb;">
              <span class="lang-tag">mermaid</span>
              <button class="action-btn copy-btn icon-only">${copyIconSvg}</button>
            </div>
            <pre style="margin: 0; padding: 16px;"><code class="hljs mermaid">${escapeHtml(code)}</code></pre>
            <div class="error-banner" style="display: none; background: #fef2f2; color: #991b1b; padding: 8px 16px; font-size: 13px; border-top: 1px solid #fee2e2;"></div>
          </div>
        </div>`;
    },
    mount: async (container, rawCode, blockId, isGenerating) => {
      if (isGenerating) return;

      container.classList.add("is-rendered");
      const svgWrapper = container.querySelector(".mermaid-svg-wrapper");
      const fallbackEl = container.querySelector(".mermaid-fallback"); 
      
      const attachDownloadBtn = () => {
        let oldBtn = svgWrapper.querySelector(".download-btn");
        if (oldBtn) oldBtn.remove();
        const btn = document.createElement("button");
        btn.className = "action-btn download-btn floating-btn";
        btn.innerHTML = downloadIconSvg;
        Object.assign(btn.style, {
          position: "absolute", top: "8px", right: "24px", zIndex: "100",
          width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", borderRadius: "6px", cursor: "pointer", opacity: "0"
        });
        btn.onclick = (e) => { e.stopPropagation(); downloadSvgAsImage(svgWrapper.querySelector("svg"), `mermaid-${blockId}.png`); };
        svgWrapper.appendChild(btn);
      };

      const cached = stableBlockCache.get(blockId);
      if (cached && cached.svg) {
        svgWrapper.innerHTML = cached.svg;
        svgWrapper.style.display = "flex";
        if (fallbackEl) fallbackEl.style.display = "none";
        attachDownloadBtn();
        return; 
      }

      if (typeof window.mermaid === 'undefined') {
        const { default: m } = await import('mermaid');
        window.mermaid = m;
        window.mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'loose' });
      }

      const safeSource = healMermaidCode(rawCode);
      try {
        let sandbox = document.getElementById("mermaid-sandbox");
        if (!sandbox) {
          sandbox = document.createElement("div");
          sandbox.id = "mermaid-sandbox";
          Object.assign(sandbox.style, { position: "fixed", top: "-10000px", visibility: "hidden" });
          document.body.appendChild(sandbox);
        }
        
        const { svg } = await window.mermaid.render(`mermaid-${blockId}`, safeSource, sandbox);
        if (!container.isConnected) return;

        stableBlockCache.set(blockId, { code: safeSource, svg: svg });
        svgWrapper.innerHTML = svg;
        svgWrapper.style.display = "flex";
        if (fallbackEl) fallbackEl.style.display = "none";
        attachDownloadBtn();
      } catch (error) {
        if (!container.isConnected) return;
        svgWrapper.style.display = "none";
        if (fallbackEl) fallbackEl.style.display = "block";
        const err = container.querySelector(".error-banner");
        if (err) { err.textContent = `⚠️ Syntax Error`; err.style.display = "block"; }
      }
    }
  },

  // -----------------------------------------
  // 2. ECharts
  // -----------------------------------------
  echarts: {
    generateHTML: (code, blockId, safeEncodedCode) => {
      return `<div class="custom-block echarts-container" data-block-id="${blockId}" style="border: 1px solid #e5e7eb; border-radius: 8px; margin: 1em 0; overflow: hidden;">
                <div class="echarts-wrapper" style="width: 100%; height: 400px; background: #ffffff;"></div>
              </div>`;
    },
    mount: async (container, rawCode, blockId, isGenerating) => {
      if (isGenerating) return;
      const wrapper = container.querySelector(".echarts-wrapper");
      try {
        const option = JSON.parse(rawCode);
        const echarts = await import("echarts"); 
        let chartInstance = echarts.init(wrapper);
        chartInstance.setOption(option, true);
        activeEchartsMap.set(blockId, chartInstance);
        new ResizeObserver(() => chartInstance.resize()).observe(wrapper);
      } catch (e) {
        wrapper.innerHTML = `<div style="padding:20px;color:red;">ECharts Error: ${e.message}</div>`;
      }
    }
  },

  // -----------------------------------------
  // 3. HTML / Vue 沙箱策略
  // -----------------------------------------
  html_sandbox: {
    generateHTML: (code, blockId, safeEncodedCode) => {
      return `
        <div class="custom-block artifact-container" data-lang="html_sandbox" data-source="${safeEncodedCode}" data-block-id="${blockId}" style="margin: 1.5em 0;">
          <div class="artifact-header" style="background: #f8fafc; padding: 8px 16px; font-size: 13px; font-weight: 600; color: #475569; border-radius: 8px 8px 0 0; border: 1px solid #e5e7eb; border-bottom: none; display: flex; align-items: center; gap: 8px;">
            <span>⚡ Web Artifact</span>
          </div>
          <iframe class="artifact-iframe" sandbox="allow-scripts allow-forms allow-popups" style="width: 100%; height: 400px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; background: #ffffff;"></iframe>
        </div>
      `;
    },
    mount: async (container, rawCode, blockId, isGenerating) => {
      if (!isGenerating) {
        const iframe = container.querySelector("iframe");
        
        // 🌟 修复 4: 注入基础的 CSS 重置样式，让单纯的 HTML 标签在 iframe 内不至于太丑
        const resetCss = `<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#333;padding:16px;margin:0;}*,*::before,*::after{box-sizing:border-box;}</style>`;
        
        // 智能插入: 如果有 <head> 就插在 head 里，否则直接拼在前面
        let processedHtml = rawCode;
        if (processedHtml.includes('</head>')) {
          processedHtml = processedHtml.replace('</head>', `${resetCss}</head>`);
        } else {
          processedHtml = `${resetCss}${processedHtml}`;
        }

        if (iframe.getAttribute("srcdoc") !== processedHtml) {
          iframe.setAttribute("srcdoc", processedHtml);
        }
        container.classList.add("is-rendered");
      }
    },
  },

  // -----------------------------------------
  // 4. PlantUML (🌟 这里把你被覆盖的代码抢救回来了！)
  // -----------------------------------------
  plantuml: {
    generateHTML: (code, blockId, safeEncodedCode) => {
      const cached = stableBlockCache.get(blockId);
      const showSvg = cached ? "flex" : "none";
      const showFallback = cached ? "none" : "block";
      return `
        <div class="custom-block plantuml-container" data-lang="plantuml" data-source="${safeEncodedCode}" data-block-id="${blockId}">
          <div class="plantuml-svg-wrapper" style="display: ${showSvg}; justify-content: center; background: white;"><img src="${cached ? cached.url : ''}" /></div>
          <div class="plantuml-fallback code-block" style="display: ${showFallback};"><pre><code>${escapeHtml(code)}</code></pre></div>
        </div>`;
    },
    mount: async (container, rawCode, blockId, isGenerating) => {
      if (isGenerating) return;
      const svgWrapper = container.querySelector(".plantuml-svg-wrapper");
      const fallbackEl = container.querySelector(".plantuml-fallback");
      const imgEl = svgWrapper.querySelector("img");

      const cached = stableBlockCache.get(blockId);
      if (cached && cached.url) {
        svgWrapper.style.display = "flex";
        if (fallbackEl) fallbackEl.style.display = "none";
        return;
      }

      try {
        const encoded = plantumlEncoder.encode(rawCode);
        const url = `https://www.plantuml.com/plantuml/svg/${encoded}`;
        imgEl.onload = () => {
          stableBlockCache.set(blockId, { code: rawCode, url: url });
          svgWrapper.style.display = "flex";
          if (fallbackEl) fallbackEl.style.display = "none";
        };
        imgEl.src = url;
      } catch (e) {}
    }
  }
};

export const clearAllEchartsInstances = () => {
  activeEchartsMap.forEach(i => i && !i.isDisposed() && i.dispose());
  activeEchartsMap.clear();
};
