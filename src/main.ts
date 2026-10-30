import { renderMarkdown } from "./renderer";
import { initTheme, toggleTheme, getTheme } from "./theme";
import {
  openFileDialog,
  readTextFile,
  writeTextFile,
  saveFileDialog,
  watchFile,
  getRecentFiles,
  addRecentFile,
  onFileDrop,
  claimStartupFile,
  onOpenFileRequest,
  getFontSize,
  setFontSize,
} from "./tauri";
import { setupCopyButtons } from "./utils/copy-code";
import { renderKatex, renderMermaidBlocks } from "./utils/lazy-load";
import { extractToc, renderToc, setupScrollSpy, type TocItem } from "./toc";
import { buildExportHtml, downloadBlob } from "./export";
import "./styles/base.css";
import "./styles/reader.css";
import "./styles/code-block.css";
import "./styles/highlight-theme.css";

const btnOpen = document.getElementById("btn-open") as HTMLButtonElement;
const btnRecent = document.getElementById("btn-recent") as HTMLButtonElement;
const btnSave = document.getElementById("btn-save") as HTMLButtonElement;
const btnExport = document.getElementById("btn-export") as HTMLButtonElement;
const btnTheme = document.getElementById("btn-theme") as HTMLButtonElement;
const btnToggle = document.getElementById("btn-toggle") as HTMLButtonElement;
const btnFullscreen = document.getElementById("btn-fullscreen") as HTMLButtonElement;
const fileInfo = document.getElementById("file-info") as HTMLSpanElement;
const emptyState = document.getElementById("empty-state") as HTMLDivElement;
const content = document.getElementById("content") as HTMLElement;
const rawView = document.getElementById("raw-view") as HTMLTextAreaElement;
const recentMenu = document.getElementById("recent-menu") as HTMLDivElement;
const tocSidebar = document.getElementById("toc-sidebar") as HTMLElement;
const tocNav = document.getElementById("toc-nav") as HTMLElement;
const reader = document.getElementById("reader") as HTMLElement;

/** 缓冲区：当前 Markdown 源码（编辑结果在这里落地）。 */
let currentText = "";
/** 当前文件名（用于标题展示）。 */
let currentFileName: string | null = null;
/** 当前文件绝对路径（另存为后更新；浏览器环境为 null）。 */
let currentPath: string | null = null;
/** 缓冲区是否有未保存到磁盘的修改。 */
let dirty = false;
/** 渲染区是否落后于缓冲区（编辑后尚未重新渲染）。 */
let contentStale = false;
/** 文件被外部程序改动但编辑内容未同步（仅提示，不覆盖编辑）。 */
let externalChangeNotice = false;
/** 加载文件时检测到的行尾风格，保存时还原，避免整文件 diff。 */
let lineEnding = "\n";
/** 原文件是否带 UTF-8 BOM。 */
let hasBom = false;
/** 取消文件监听的函数。 */
let stopWatching: (() => void) | null = null;
/** 取消 scroll-spy 的函数。 */
let stopScrollSpy: (() => void) | null = null;

type ViewMode = "render" | "raw";

// ============ 文本格式保持（行尾 / BOM） ============

/** 编辑器与内部缓冲区统一用 LF，加载时归一化。 */
function normalizeText(raw: string): string {
  const body = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return body.includes("\r\n") ? body.replace(/\r\n/g, "\n") : body;
}

/** 记录原文件的行尾风格与 BOM，返回归一化后的文本。 */
function adoptText(raw: string): string {
  hasBom = raw.charCodeAt(0) === 0xfeff;
  lineEnding = raw.includes("\r\n") ? "\r\n" : "\n";
  return normalizeText(raw);
}

/** 保存前恢复原文件的行尾风格与 BOM。 */
function restoreText(text: string): string {
  const body = lineEnding === "\r\n" ? text.replace(/\r?\n/g, "\r\n") : text;
  return hasBom ? `\uFEFF${body}` : body;
}

// ============ 状态显示 ============

/** 同步标题（未保存标记）与保存按钮可用性。 */
function updateStatusUi(): void {
  document.title = currentFileName
    ? `${dirty ? "● " : ""}${currentFileName} - MD Viewer`
    : "MD Viewer";
  btnSave.disabled = !dirty;
  if (currentPath) {
    fileInfo.textContent = externalChangeNotice
      ? `${currentPath}（外部已修改）`
      : currentPath;
    fileInfo.title = currentPath;
  }
}

/** 编辑区内容有变动：只置脏，不做任何渲染（保证打字性能）。 */
function markEdited(): void {
  contentStale = true;
  if (!dirty) {
    dirty = true;
    updateStatusUi();
  }
}

/** 把编辑区内容同步到缓冲区（仅编辑视图且有未保存修改时）。 */
function syncBufferFromEditor(): void {
  if (!rawView.hidden && dirty) {
    currentText = rawView.value;
  }
}

/** 有未保存修改时确认一次；返回 false 表示用户取消。 */
function confirmDiscard(): boolean {
  if (!dirty) return true;
  return window.confirm("当前文件有未保存的修改，确定放弃并继续吗？");
}

/**
 * 设置视图模式：render（渲染）/ raw（编辑原文）。
 *
 * 进入编辑时按滚动比例定位，避免长文档切换后跳回顶部；
 * 离开编辑时由调用方负责同步缓冲区并重新渲染。
 */
function setViewMode(mode: ViewMode): void {
  const isRaw = mode === "raw";
  const fromRender = isRaw && rawView.hidden;

  // 进入编辑前记录阅读区滚动比例。
  let ratio = 0;
  if (fromRender) {
    const max = reader.scrollHeight - reader.clientHeight;
    ratio = max > 0 ? reader.scrollTop / max : 0;
  }

  if (isRaw) {
    rawView.value = currentText;
    reader.classList.add("raw-mode");
    tocSidebar.hidden = true;
    if (stopScrollSpy) {
      stopScrollSpy();
      stopScrollSpy = null;
    }
  } else {
    reader.classList.remove("raw-mode");
  }

  rawView.hidden = !isRaw;
  content.hidden = isRaw;
  emptyState.hidden = currentFileName !== null;
  btnToggle.textContent = isRaw ? "预览" : "编辑";

  if (isRaw) {
    const max = rawView.scrollHeight - rawView.clientHeight;
    rawView.scrollTop = max > 0 ? ratio * max : 0;
    rawView.focus({ preventScroll: true });
  }
}

/**
 * 渲染 Markdown 文本到阅读区（异步：含 KaTeX/Mermaid 懒加载）。
 */
async function render(text: string): Promise<void> {
  content.innerHTML = renderMarkdown(text);
  setupCopyButtons(content);
  emptyState.hidden = true;
  content.hidden = false;
  contentStale = false;
  // 异步渲染数学公式 + Mermaid（懒加载，无则跳过）。
  await renderKatex(content);
  await renderMermaidBlocks(content);
  // 更新 TOC（在异步渲染完成后提取，避免标题遗漏）。
  updateToc();
}

/**
 * 更新 TOC 大纲（提取标题 + 渲染 + scroll-spy）。
 */
function updateToc(): void {
  const items: TocItem[] = extractToc(content);
  if (items.length === 0) {
    tocSidebar.hidden = true;
    // 清理 scroll-spy。
    if (stopScrollSpy) {
      stopScrollSpy();
      stopScrollSpy = null;
    }
    return;
  }
  tocSidebar.hidden = false;
  renderToc(tocNav, items);
  // 重新绑定 scroll-spy（先清理旧的）。
  if (stopScrollSpy) {
    stopScrollSpy();
  }
  stopScrollSpy = setupScrollSpy(tocNav, items, reader);
}

/**
 * 显示"未打开文件"的空状态。
 */
function showEmpty(): void {
  currentText = "";
  currentFileName = null;
  currentPath = null;
  dirty = false;
  contentStale = false;
  externalChangeNotice = false;
  emptyState.hidden = false;
  content.hidden = true;
  rawView.hidden = true;
  reader.classList.remove("raw-mode");
  fileInfo.textContent = "未打开文件";
  document.title = "MD Viewer";
  btnToggle.disabled = true;
  btnSave.disabled = true;
  btnExport.disabled = true;
  tocSidebar.hidden = true;
  // 停止监听。
  if (stopWatching) {
    stopWatching();
    stopWatching = null;
  }
  // 清理 scroll-spy。
  if (stopScrollSpy) {
    stopScrollSpy();
    stopScrollSpy = null;
  }
}

/**
 * 开始监听当前文件变化（外部编辑器保存后自动刷新）。
 */
async function startWatching(path: string): Promise<void> {
  // 先停掉旧的监听。
  if (stopWatching) {
    stopWatching();
    stopWatching = null;
  }
  try {
    stopWatching = await watchFile(path, async (changedPath) => {
      // 文件变化 → 重新读取；自身保存引起的事件与未保存编辑都需跳过。
      try {
        const raw = await readTextFile(changedPath);
        const incoming = normalizeText(raw);
        // 内容未变（含「保存后 watcher 回环」）→ 什么都不做。
        if (incoming === currentText || incoming === rawView.value) return;
        if (dirty) {
          // 有未保存编辑：不覆盖，仅提示（保存时会覆盖外部版本）。
          if (!externalChangeNotice) {
            externalChangeNotice = true;
            updateStatusUi();
          }
          return;
        }
        currentText = adoptText(raw);
        externalChangeNotice = false;
        if (rawView.hidden) {
          await render(currentText);
        } else {
          rawView.value = currentText;
        }
        updateStatusUi();
      } catch (err) {
        console.error("重新读取失败:", err);
      }
    });
  } catch (err) {
    console.error("启动文件监听失败:", err);
  }
}

/**
 * 打开指定路径的文件并渲染。
 */
async function openPath(path: string): Promise<void> {
  // 切换文件会丢弃编辑内容，先确认一次。
  if (!confirmDiscard()) return;
  try {
    const text = adoptText(await readTextFile(path));
    currentText = text;
    currentPath = path;
    currentFileName = path.split(/[\\/]/).pop() ?? path;
    dirty = false;
    externalChangeNotice = false;
    updateStatusUi();
    btnToggle.disabled = false;
    btnExport.disabled = false;
    await render(text);
    setViewMode("render");
    // 添加到最近文件 + 刷新列表。
    await addRecentFile(path);
    await refreshRecentMenu();
    // 开始监听。
    await startWatching(path);
  } catch (err) {
    console.error("读取文件失败:", err);
    fileInfo.textContent = `读取失败: ${String(err)}`;
    showEmpty();
  }
}

/**
 * 通过系统对话框选择 .md 文件。
 */
async function pickFile(): Promise<void> {
  const path = await openFileDialog();
  if (path) {
    await openPath(path);
  }
}

/**
 * 建立「系统要求打开文件」通道（文件关联 / 命令行 / Finder）。
 *
 * 两步顺序不能颠倒：
 *   1. 先注册运行期监听（macOS 复用进程时会推送新的打开请求）；
 *   2. 再向后端领取启动参数里的文件（Windows/Linux 双击 .md 走这条路）。
 * 后端在收到领取请求前只入队、不发事件，所以两者之间不会漏。
 * 无文件时立即返回，不产生任何可见开销。
 */
async function initOpenFileChannel(): Promise<void> {
  await onOpenFileRequest((path) => {
    void openPath(path);
  });

  const startupPath = await claimStartupFile();
  if (startupPath) {
    await openPath(startupPath);
  }
}

/** 切换渲染/编辑视图。 */
function toggleView(): void {
  if (!currentFileName) return;
  if (rawView.hidden) {
    setViewMode("raw");
    return;
  }

  // 编辑 → 预览：记录滚动比例，同步缓冲区后重新渲染。
  const textMax = rawView.scrollHeight - rawView.clientHeight;
  const ratio = textMax > 0 ? rawView.scrollTop / textMax : 0;
  syncBufferFromEditor();
  setViewMode("render");
  void render(currentText).then(() => {
    const max = reader.scrollHeight - reader.clientHeight;
    reader.scrollTop = max > 0 ? ratio * max : 0;
  });
}

// ============ 保存 ============

/**
 * 保存当前缓冲区到磁盘。
 *
 * 有路径时直接写回原文件（不弹对话框），无路径或要求另存为时弹保存对话框；
 * 浏览器环境下退化为下载副本。
 */
async function saveMarkdown(saveAs = false): Promise<void> {
  if (!currentFileName) return;
  syncBufferFromEditor();

  let path = currentPath;
  if (!path || saveAs) {
    const defaultName = currentFileName || "untitled.md";
    const picked = await saveFileDialog(defaultName, "md");
    if (!picked) {
      // 对话框不可用（浏览器调试）：直接下载一份。
      if (!path) {
        downloadBlob(
          new Blob([currentText], { type: "text/markdown;charset=utf-8" }),
          defaultName
        );
      }
      return;
    }
    path = picked;
  }

  try {
    await writeTextFile(path, restoreText(currentText));
    if (path !== currentPath) {
      // 另存为：后续保存与监听都指向新文件。
      currentPath = path;
      currentFileName = path.split(/[\\/]/).pop() ?? path;
      await startWatching(path);
      await addRecentFile(path);
      await refreshRecentMenu();
    }
    dirty = false;
    externalChangeNotice = false;
    updateStatusUi();
    if (currentPath) fileInfo.textContent = `${currentPath}（已保存）`;
  } catch (err) {
    console.error("保存失败:", err);
    fileInfo.textContent = `保存失败: ${String(err)}`;
  }
}

/** 切换全屏模式。 */
function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen();
  }
}

/** 更新主题按钮文案。 */
function updateThemeBtn(): void {
  btnTheme.textContent = getTheme() === "dark" ? "☀️ 亮色" : "🌙 暗色";
}

// ============ 字号缩放（Phase 4） ============

/** 当前字号百分比（作用于 .markdown-body 与 .raw-view）。 */
let fontSize = getFontSize();

/** 应用字号到 DOM。 */
function applyFontSize(): void {
  document.documentElement.style.setProperty("--reader-font-scale", String(fontSize / 100));
  content.style.fontSize = `${fontSize}%`;
  rawView.style.fontSize = `${fontSize}%`;
}

/** 调整字号（delta 为正放大、负缩小）。 */
function adjustFontSize(delta: number): void {
  fontSize = Math.min(160, Math.max(80, fontSize + delta));
  setFontSize(fontSize);
  applyFontSize();
}

// ============ 最近文件下拉菜单（Phase 4） ============

/** 刷新最近文件下拉菜单内容（只更新列表，不控制显示/隐藏）。 */
async function refreshRecentMenu(): Promise<void> {
  const list = await getRecentFiles();
  if (list.length === 0) {
    closeRecentMenu();
    return;
  }
  recentMenu.innerHTML = "";
  for (const path of list) {
    const name = path.split(/[\\/]/).pop() ?? path;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "recent-item";
    item.textContent = name;
    item.title = path;
    item.addEventListener("click", () => {
      void openPath(path);
      closeRecentMenu();
    });
    recentMenu.appendChild(item);
  }
}

/** 打开/关闭最近文件菜单。 */
async function toggleRecentMenu(): Promise<void> {
  if (recentMenu.style.display === "flex") {
    closeRecentMenu();
  } else {
    await refreshRecentMenu();
    // 仅当有列表项时才显示菜单。
    if (recentMenu.innerHTML !== "") {
      recentMenu.style.display = "flex";
    }
  }
}

function closeRecentMenu(): void {
  recentMenu.style.display = "none";
}

// ============ 事件绑定 ============

btnOpen.addEventListener("click", () => void pickFile());
btnRecent.addEventListener("click", (e) => {
  e.stopPropagation();
  void toggleRecentMenu();
});
btnToggle.addEventListener("click", toggleView);
btnSave.addEventListener("click", () => void saveMarkdown());
btnFullscreen.addEventListener("click", toggleFullscreen);

// 编辑区：只置脏，不触发渲染；Tab 插入缩进而非切换焦点。
rawView.addEventListener("input", markEdited);
rawView.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  e.preventDefault();
  const { selectionStart: start, selectionEnd: end, value } = rawView;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const affected = value.slice(lineStart, end);
  if (affected.includes("\n")) {
    // 多行：整体缩进所选行。
    rawView.setRangeText(affected.replace(/^/gm, "  "), lineStart, end, "select");
  } else {
    rawView.setRangeText("  ", start, end, "end");
  }
  markEdited();
});

// ============ 导出 HTML（Phase 5） ============

/**
 * 导出当前渲染结果为自包含 HTML。
 */
async function exportHtml(): Promise<void> {
  if (!currentText) return;
  syncBufferFromEditor();
  const name = currentFileName ?? "export";
  const baseName = name.replace(/\.[^.]+$/, "");
  const defaultName = `${baseName}.html`;

  // 编辑后渲染区可能落后于缓冲区：先刷新一次，导出内容才与编辑一致。
  if (contentStale) {
    const wasRaw = !rawView.hidden;
    await render(currentText);
    if (wasRaw) {
      content.hidden = true;
      rawView.hidden = false;
      tocSidebar.hidden = true;
      if (stopScrollSpy) {
        stopScrollSpy();
        stopScrollSpy = null;
      }
    }
  }

  const html = await buildExportHtml(name);

  // Tauri 环境：保存对话框 + 写文件；浏览器环境：直接下载。
  const path = await saveFileDialog(defaultName, "html");
  if (path) {
    await writeTextFile(path, html);
  } else {
    // 降级：浏览器直接下载。
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), defaultName);
  }
}

btnExport.addEventListener("click", () => void exportHtml());
btnTheme.addEventListener("click", () => {
  toggleTheme();
  updateThemeBtn();
});

// 最近文件按钮（复用 btn-open，改用下拉）。这里用独立的点击切换。
// 为保持简单：点击「打开文件」只弹出对话框；最近文件通过一个独立入口。
// 因此增加一个「最近文件」按钮，放在工具栏。

document.addEventListener("fullscreenchange", () => {
  btnFullscreen.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
});

// 键盘快捷键：Ctrl+O 打开，Ctrl+S 保存，Ctrl+/- 字号，F11 全屏。
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase();
    if (key === "o") {
      e.preventDefault();
      void pickFile();
    } else if (key === "s") {
      e.preventDefault();
      void saveMarkdown(e.shiftKey);
    } else if (key === "=" || key === "+") {
      e.preventDefault();
      adjustFontSize(10);
    } else if (key === "-") {
      e.preventDefault();
      adjustFontSize(-10);
    } else if (key === "0") {
      e.preventDefault();
      fontSize = 100;
      setFontSize(fontSize);
      applyFontSize();
    }
  }
  if (e.key === "F11") {
    e.preventDefault();
    toggleFullscreen();
  }
});

// 点击空白处关闭最近文件菜单。
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest("#recent-wrapper")) {
    closeRecentMenu();
  }
});

// ============ 初始化 ============

// 应用主题。
initTheme();
updateThemeBtn();

// 应用字号。
applyFontSize();

// 拖放打开（Phase 4）。
void onFileDrop((path) => {
  if (/\.(md|markdown|mdown|mkd)$/i.test(path)) {
    void openPath(path);
  }
});

// 初始状态。
showEmpty();

// 初始化最近文件菜单。
void refreshRecentMenu();

// 文件关联 / 命令行 / Finder 打开的文件（异步，不阻塞首屏）。
void initOpenFileChannel().catch((err) => {
  console.error("建立文件打开通道失败:", err);
});

console.log("MD Viewer 前端已初始化");
