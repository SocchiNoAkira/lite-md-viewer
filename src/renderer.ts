import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import { full as emoji } from "markdown-it-emoji";
import taskLists from "markdown-it-task-lists";
import DOMPurify from "dompurify";
import { highlightCode, langLabel } from "./highlight";

/**
 * Markdown 渲染器。
 *
 * Phase 3：代码高亮（highlight.js）+ 代码块头栏（语言标签 + 复制按钮）。
 * Phase 6：Mermaid fence 占位 + KaTeX 数学公式占位（懒加载）。
 *
 * 渲染流程（renderMarkdown 返回纯 HTML，渲染后处理由调用方触发）：
 *   renderMarkdown(text)  → 纯 HTML 字符串
 *   调用方 set innerHTML
 *   调用方 await finalizeAsyncRender(container)  → 渲染 Mermaid/KaTeX
 */

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
})
  .use(anchor, {
    slugify: (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff -]/g, "")
        .replace(/\s+/g, "-"),
  })
  .use(emoji)
  .use(taskLists, { enabled: true, label: true });

// ============ 数学公式（KaTeX）行内/块级 ============

/** 行内公式默认规则（$...$），无空格要求，非转义。 */
function inlineMath(state: any, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x24 /* $ */) return false;
  // 下一个 $ 前不能是 $（避免 $$ 被误判）。
  if (state.src.charCodeAt(start + 1) === 0x24) return false;

  const end = state.src.indexOf("$", start + 1);
  if (end < 0) return false;
  const tex = state.src.slice(start + 1, end);
  if (tex.trim() === "") return false;

  if (!silent) {
    const token = state.push("inline_math", "", 0);
    token.content = tex;
    token.markup = "$";
  }
  state.pos = end + 1;
  return true;
}

/** 块级公式规则（$$...$$）。 */
function blockMath(state: any, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.slice(start, start + 2) !== "$$") return false;

  const end = state.src.indexOf("$$", start + 2);
  if (end < 0) return false;
  const tex = state.src.slice(start + 2, end).trim();
  if (tex === "") return false;

  if (!silent) {
    const token = state.push("block_math", "", 0);
    token.content = tex;
    token.markup = "$$";
  }
  state.pos = end + 2;
  return true;
}

// 注入行内规则（在 text 规则前）。
md.inline.ruler.before("text", "inline_math", inlineMath);
md.inline.ruler.before("text", "block_math", blockMath);

// 行内公式渲染。
md.renderer.rules.inline_math = (tokens, idx) => {
  const tex = tokens[idx].content;
  return `<span class="math-inline" data-tex="${escapeAttr(tex)}">\\(${escapeHtml(tex)}\\)</span>`;
};

// 块级公式渲染。
md.renderer.rules.block_math = (tokens, idx) => {
  const tex = tokens[idx].content;
  return `<div class="math-block" data-tex="${escapeAttr(tex)}">\\[${escapeHtml(tex)}\\]</div>`;
};

// ============ 代码块 fence ============

/**
 * 自定义 fence 渲染：产出「头栏 + 代码区」结构。
 * mermaid 语言单独处理 → 占位块，由异步渲染阶段替换。
 */
md.renderer.rules.fence = (tokens, idx, _options, _env, _self) => {
  const token = tokens[idx];
  const lang = (token.info ?? "").trim().split(/\s+/)[0] ?? "";

  // Mermaid：占位，异步渲染。
  if (lang.toLowerCase() === "mermaid") {
    const code = token.content.trim();
    return (
      `<pre class="mermaid-placeholder" data-mermaid="${encodeURIComponent(code)}">` +
      `<code class="language-mermaid">${md.utils.escapeHtml(code)}</code>` +
      `</pre>`
    );
  }

  const label = langLabel(lang);
  const codeHtml = highlightCode(token.content, lang);

  return (
    `<pre class="code-block">` +
    `<div class="code-header">` +
    `<span class="lang-label">${label}</span>` +
    `<button class="copy-btn" type="button" aria-label="复制代码">复制</button>` +
    `</div>` +
    `<code class="hljs">${codeHtml}</code>` +
    `</pre>`
  );
};

/**
 * 渲染 Markdown 文本为安全的 HTML 字符串。
 */
export function renderMarkdown(text: string): string {
  const rawHtml = md.render(text);
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "class", "data-copy-bound", "data-tex", "data-mermaid"],
    ADD_TAGS: ["span", "div"],
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/&quot;/g, "&quot;");
}
