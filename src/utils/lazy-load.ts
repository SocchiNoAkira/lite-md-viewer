/**
 * lazy-load.ts — 动态 import 封装（KaTeX / Mermaid 懒加载，Phase 6）。
 *
 * 这两个库体积大（KaTeX ~1MB，Mermaid ~2MB+），首屏不应加载。
 * 只在文档中真正出现公式/图表时才动态 import，之后缓存结果。
 */

import type MarkdownIt from "markdown-it";

// ============ KaTeX ============

let katexPromise: Promise<typeof import("katex")> | null = null;

/** 懒加载 KaTeX，返回模块（缓存）。 */
export function loadKatex(): Promise<typeof import("katex")> {
  if (!katexPromise) {
    // 同时懒加载 KaTeX 的 CSS（Vite 支持动态 import CSS）。
    katexPromise = Promise.all([
      import("katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([mod]) => mod);
  }
  return katexPromise;
}

// ============ Mermaid ============

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

/** 懒加载 Mermaid，返回模块（缓存）。 */
export function loadMermaid(): Promise<typeof import("mermaid")> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid");
  }
  return mermaidPromise;
}

/**
 * Mermaid 渲染需要 DOM 插入后执行，因此这个扩展只负责占位：
 * 把 ```mermaid 代码块替换成带 data-mermaid 的 <pre>，由渲染后处理阶段统一调用 mermaid.run。
 *
 * 这个函数作为 markdown-it 的自定义 fence 规则调用。
 */
export function mermaidFence(
  md: MarkdownIt
): (tokens: any[], idx: number) => string {
  return (_tokens: any[], idx: number): string => {
    const token = _tokens[idx];
    const code = token.content.trim();
    // 占位：先渲染普通代码块结构，mermaid 初始化阶段会替换 innerHTML 为 SVG。
    return `<pre class="mermaid-placeholder" data-mermaid="${encodeURIComponent(code)}"><code class="language-mermaid">${md.utils.escapeHtml(code)}</code></pre>`;
  };
}

/**
 * 处理渲染后 DOM 中所有 mermaid 占位块，调用 mermaid 渲染为 SVG。
 */
export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const placeholders = container.querySelectorAll<HTMLElement>(
    ".mermaid-placeholder"
  );
  if (placeholders.length === 0) return;

  try {
    const mermaid = await loadMermaid();
    mermaid.default.initialize({
      startOnLoad: false,
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
      securityLevel: "strict",
    });

    for (const ph of Array.from(placeholders)) {
      const code = decodeURIComponent(ph.dataset.mermaid ?? "");
      try {
        const { svg } = await mermaid.default.render(
          `mermaid-${Math.random().toString(36).slice(2, 10)}`,
          code
        );
        ph.innerHTML = svg;
        ph.classList.remove("mermaid-placeholder");
        ph.classList.add("mermaid-rendered");
      } catch (err) {
        // 渲染失败：保留原代码块，标红提示。
        ph.classList.add("mermaid-error");
        ph.title = `Mermaid 渲染失败: ${String(err)}`;
      }
    }
  } catch (err) {
    console.error("加载 Mermaid 失败:", err);
  }
}

/**
 * 处理渲染后 DOM 中所有 KaTeX 公式（$...$ 行内 + $$...$$ 块级）。
 * 由 renderer 在 markdown-it 输出后统一调用。
 */
export async function renderKatex(container: HTMLElement): Promise<void> {
  const hasMath =
    container.querySelector(".math-inline, .math-block, .katex") !== null;
  if (!hasMath) return;

  try {
    const katex = await loadKatex();
    const katexModule = katex.default ?? katex;

    // 块级公式
    container.querySelectorAll<HTMLElement>(".math-block").forEach((el) => {
      const tex = el.dataset.tex ?? "";
      try {
        el.innerHTML = katexModule.renderToString(tex, {
          displayMode: true,
          throwOnError: false,
        });
      } catch (err) {
        console.error("KaTeX 块级渲染失败:", err);
      }
    });

    // 行内公式
    container.querySelectorAll<HTMLElement>(".math-inline").forEach((el) => {
      const tex = el.dataset.tex ?? "";
      try {
        el.innerHTML = katexModule.renderToString(tex, {
          displayMode: false,
          throwOnError: false,
        });
      } catch (err) {
        console.error("KaTeX 行内渲染失败:", err);
      }
    });
  } catch (err) {
    console.error("加载 KaTeX 失败:", err);
  }
}
