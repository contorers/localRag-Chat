import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import iterator from "markdown-it-for-inline";
import somarkdown from "somarkdown";
import texmath from 'markdown-it-texmath';
import katex from 'katex';

const soMdParser = new somarkdown();
// 🌟 纯内置 SVG 复制图标（替代原来的 ICONS.copy）
const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

const md = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
    if (str.length > 1000) return md.utils.escapeHtml(str);
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      } catch (__) {}
    }
    return md.utils.escapeHtml(str);
  },
});

md.use(iterator, "url_new_win", "link_open", function (tokens, idx) {
  const aIndex = tokens[idx].attrIndex("target");
  if (aIndex < 0) {
    tokens[idx].attrPush(["target", "_blank"]);
    tokens[idx].attrPush(["rel", "noopener noreferrer"]);
  } else {
    tokens[idx].attrs[aIndex][1] = "_blank";
  }
});

md.use(texmath, {
  engine: katex,
  delimiters: 'dollars', 
  katexOptions: { 
    strict: false, 
    throwOnError: false, 
    displayMode: true 
  }
});

// 拦截占位图片
const defaultImageRenderer = md.renderer.rules.image;
md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const srcIndex = token.attrIndex("src");
  if (srcIndex >= 0) {
    let originalSrc = token.attrs[srcIndex][1];
    const isBadUrl = originalSrc.includes("via.placeholder.com") || originalSrc.includes("mathworks.com/help/examples") || originalSrc.includes("gstatic.com");
    if (isBadUrl) {
      try {
        const url = new URL(originalSrc);
        const sizePart = url.pathname.replace("/", "") || "150";
        let width = 150, height = 150;
        if (sizePart.includes("x")) {
          const dims = sizePart.split("x");
          width = parseInt(dims[0]) || 150; height = parseInt(dims[1]) || 150;
        } else {
          width = parseInt(sizePart) || 150; height = width;
        }
        let text = url.searchParams.get("text") || `${width} x ${height}`;
        text = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-weight="bold" font-size="${Math.max(12, Math.min(width, height) / 8)}px">${text}</text></svg>`;
        token.attrs[srcIndex][1] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
      } catch (e) { console.warn("占位图解析失败", e); }
    }
  }
  return defaultImageRenderer(tokens, idx, options, env, self);
};

// --- 公式规则拦截 ---
const defaultMathBlock = md.renderer.rules.math_block;
md.renderer.rules.math_block = function (tokens, idx, options, env, self) {
  const rawTex = tokens[idx].content.trim();
  const safeTex = encodeURIComponent(rawTex);
  let renderedHtml = "";
  try {
    renderedHtml = defaultMathBlock(tokens, idx, options, env, self);
  } catch (error) {
    renderedHtml = `<div class="math-error-fallback" style="color: #ef4444; background: #fee2e2; padding: 10px; border-radius: 4px; font-family: monospace; white-space: pre-wrap;">⚠️ 公式解析错误: ${md.utils.escapeHtml(rawTex)}</div>`;
  }
  return `
    <div class="math-block-wrapper" style="position: relative; margin: 1em 0;">
      <div class="math-main-content">${renderedHtml}</div>
      <button class="action-btn copy-math-btn icon-only floating-btn" data-tex="${safeTex}" title="复制公式">${COPY_ICON}</button>
    </div>
  `;
};

const defaultMathInline = md.renderer.rules.math_inline;
md.renderer.rules.math_inline = function (tokens, idx, options, env, self) {
  const rawTex = tokens[idx].content;
  const renderedMath = defaultMathInline(tokens, idx, options, env, self);
  const safeTex = encodeURIComponent(rawTex);
  return `<span class="math-inline-wrapper" data-tex="${safeTex}" title="点击复制" style="position: relative; cursor: pointer; border-radius: 4px; transition: background-color 0.2s;">${renderedMath}</span>`;
};

// 统一的 Mermaid 占位符生成函数
const renderMermaidPlaceholder = (code) => {
  // 对源码进行转码，防止 HTML 注入和解析错误
  const encodedCode = encodeURIComponent(code.trim());
  return `<div class="mermaid-block" data-source="${encodedCode}">
            <div class="mermaid-loading">正在构图...</div>
          </div>`;
};
md.renderer.rules.fence = function (tokens, idx, options, env, slf) {
  const token = tokens[idx];
  const code = token.content;
  const lang = token.info.trim().toLowerCase();

// 🌟 如果是 mermaid，走特殊占位符
if (lang === 'mermaid') {
  return renderMermaidPlaceholder(code);
}

  const highlightedCode = options.highlight(code, lang) || md.utils.escapeHtml(code);
  return `
    <div class="code-block">
      <div class="code-header">
        <span class="lang-tag">${lang || "text"}</span>
        <div class="button-group">
          <button class="action-btn copy-btn icon-only" title="复制代码">${COPY_ICON}</button>
        </div>
      </div>
      <pre><code class="hljs ${lang}">${highlightedCode}</code></pre>
    </div>
  `;
};

function fixLatexErrors(text) {
  return text
      // 1. 修正 \[ \] 和 \( \) 为标准 $$ 和 $ (之前已加)
      .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
      .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$')

      // 2. 修正大模型爱写的 \text{...} 内部嵌套 $ 的情况
      // KaTeX 不允许 \text 内部有公式定界符
      .replace(/\\text\s*\{([^}]*)\$([^}]*)\$\}/g, '\\text{$1$2}')

      // 3. 修正多余的空行：KaTeX 的某些环境（如 matrix）不允许中间有双换行
      .replace(/(\n\s*\n)/g, (match, p1) => {
          // 如果在 $$ 内部，将双换行替换为单换行或 \\
          return match; // 这里可以根据需求更精细地判断
      })

      // 4. 处理中文标点在公式里的问题
      // 有时候 AI 会把公式里的逗号写成中文逗号，导致 KaTeX 报错
      .replace(/\d+，\d+/g, m => m.replace('，', ','))
      
      // 5. 修正 \mathbf 等命令后面没有空格的情况
      .replace(/\\mathbf(?=[a-zA-Z0-9])/g, '\\mathbf ');
}

function fixEnvironments(text) {
  return text
      // 修正裸 matrix
      .replace(/\\matrix\s*\{([\s\S]*?)\}/g, '\\begin{matrix}$1\\end{matrix}')
      // 修正裸 cases
      .replace(/\\cases\s*\{([\s\S]*?)\}/g, '\\begin{cases}$1\\end{cases}');
}


export const renderMarkdown = (text, compId = 'default', isGenerating = false, engine = 'somarkdown') => {
  if (!text) return "";
  
  // 1. 公共预处理：归一化定界符 (\[ \] -> $$)
  let safeText = text
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');

  // 2. 第一步：公共逻辑 - 代码块保护（防止修正逻辑误伤代码内容）
  const blocks = [];
  safeText = safeText.replace(/(```[\s\S]*?```)/g, (match) => {
    blocks.push(match);
    return `__BLOCK_PLACEHOLDER_${blocks.length - 1}__`;
  });

  // ---------------------------------------------------------
  // 🌟 这里注入你需要的【修正方法】：直接平铺在公共区域
  // ---------------------------------------------------------
  
  // [修正 1] 环境补全：\matrix{} -> \begin{matrix}
  safeText = safeText.replace(/\\(matrix|cases|align|array)\s*\{([\s\S]*?)\}/g, '\\begin{$1}$2\\end{$1}');

  // [修正 2] 嵌套错误：修正 \text{...} 内部嵌套 $ 的情况
  safeText = safeText.replace(/\\text\s*\{([^}]*)\$([^}]*)\$\}/g, '\\text{$1$2}');

  // [修正 3] 符号补丁：中文逗号修正与关键字空格
  safeText = safeText.replace(/\d+，\d+/g, m => m.replace('，', ','))
                     .replace(/\\mathbf(?=[a-zA-Z0-9])/g, '\\mathbf ');
  
  // ---------------------------------------------------------

  // 3. 第二步：公共逻辑 - 其他文本清理
  safeText = safeText.replace(/\$\$\$?([a-zA-Z0-9.]+-[a-zA-Z0-9.]+)\$\$\$?/g, "$1");
  safeText = safeText.replace(/“|”/g, '"').replace(/‘|’/g, "'");
  safeText = safeText.replace(/<img[^>]*src=["'].*?gstatic\.com.*?["'][^>]*>/gi, "[拦截]");

  // 4. 还原代码块
  safeText = safeText.replace(/__BLOCK_PLACEHOLDER_(\d+)__/g, (_, index) => blocks[index]);

  // 5. 第三步：公共逻辑 - 生成状态补全
  if (isGenerating) {
    const blockMatches = (safeText.match(/\$\$/g) || []).length;
    if (blockMatches % 2 !== 0) safeText += '\n$$\n';

    const inlineMatches = (safeText.match(/(?<!\\)\$/g) || []).length;
    if (inlineMatches % 2 !== 0) safeText += '$';
  }

  // 6. 第四步：分发渲染
  let rawHtml = "";
  try {
    if (engine === 'markdown-it') {
      const env = { blockIndex: 0, componentId: compId };
      rawHtml = md.render(safeText, env);
    } else {
      // 🌟 对 SoMarkdown 的产物进行后处理：识别它生成的 mermaid 代码块并替换
      rawHtml = soMdParser.render(safeText);
      // 这是一个简单的后处理正则，匹配 <pre><code class="language-mermaid">...</code></pre>
      rawHtml = rawHtml.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_, code) => {
        return renderMermaidPlaceholder(md.utils.unescapeAll(code));
      });
   }
  } catch (error) {
    console.error(`[Markdown 渲染崩溃] 引擎: ${engine}`, error);
    rawHtml = `<div style="color: red; padding: 10px; border: 1px solid red; background: #fee2e2;"><b>引擎 (${engine}) 渲染失败。</b></div><pre>${safeText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
  }

  return rawHtml;
};