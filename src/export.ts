/**
 * export.ts — 导出 HTML（自包含，Phase 5）。
 *
 * 生成一个单文件 HTML：内联当前样式 + 高亮配色 + 渲染后的 Markdown。
 * 用户在任意浏览器打开即可看到与预览器一致的效果。
 */

/** 收集应用内联的 CSS（从 <link> 或已打包的构建产物）。 */
async function collectStyles(): Promise<string> {
  // 开发环境：样式通过 <style> 或 vite 注入的 <style> 标签。
  // 生产环境：vite 会把 CSS 打成 <link rel="stylesheet">。
  const chunks: string[] = [];

  // 1. 收集 <style> 标签内容。
  document.querySelectorAll("style").forEach((s) => {
    chunks.push(s.textContent ?? "");
  });

  // 2. 收集 <link rel="stylesheet"> 的内容（fetch 本地资源）。
  const links = document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
  for (const link of links) {
    try {
      const resp = await fetch(link.href);
      if (resp.ok) {
        chunks.push(await resp.text());
      }
    } catch (err) {
      console.warn("无法获取样式表:", link.href, err);
    }
  }

  return chunks.join("\n\n");
}

/** 当前渲染后的正文 HTML。 */
function currentBodyHtml(): string {
  const content = document.getElementById("content");
  return content ? content.innerHTML : "";
}

/** 当前主题（导出时保留）。 */
function currentTheme(): string {
  return document.documentElement.dataset.theme ?? "light";
}

/** 当前字号百分比。 */
function currentFontSize(): string {
  return document.documentElement.style.getPropertyValue("--reader-font-scale") || "1";
}

/**
 * 生成自包含 HTML 字符串。
 */
export async function buildExportHtml(title: string): Promise<string> {
  const css = await collectStyles();
  const body = currentBodyHtml();
  const theme = currentTheme();
  const scale = currentFontSize();

  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
${css}
/* 导出时固定字号 */
.markdown-body { font-size: ${scale === "1" ? "100%" : scale}; }
</style>
</head>
<body>
<div id="app">
  <main id="reader" style="padding: 32px 24px 64px;">
    <article id="content" class="markdown-body" style="max-width: 82ch; margin: 0 auto;">${body}</article>
  </main>
</div>
</body>
</html>`;
}

/** 触发浏览器下载文件。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
