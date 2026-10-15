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
const btnExport = document.getElementById("btn-export") as HTMLButtonElement;
const btnTheme = document.getElementById("btn-theme") as HTMLButtonElement;
const btnToggle = document.getElementById("btn-toggle") as HTMLButtonElement;
const btnFullscreen = document.getElementById("btn-fullscreen") as HTMLButtonElement;
const fileInfo = document.getElementById("file-info") as HTMLSpanElement;
const emptyState = document.getElementById("empty-state") as HTMLDivElement;
const content = document.getElementById("content") as HTMLElement;
const rawView = document.getElementById("raw-view") as HTMLPreElement;
const recentMenu = document.getElementById("recent-menu") as HTMLDivElement;
const tocSidebar = document.getElementById("toc-sidebar") as HTMLElement;
const tocNav = document.getElementById("toc-nav") as HTMLElement;
const reader = document.getElementById("reader") as HTMLElement;

/** 当前文件原始文本（用于原文视图切换）。 */
let currentText = "";
/** 当前文件名（用于标题展示）。 */
let currentFileName: string | null = null;
/** 取消文件监听的函数。 */
let stopWatching: (() => void) | null = null;
/** 取消 scroll-spy 的函数。 */
let stopScrollSpy: (() => void) | null = null;

type ViewMode = "render" | "raw";

/**
 * 设置视图模式：render（渲染）/ raw（原文）。
 */
function setViewMode(mode: ViewMode): void {
  const isRaw = mode === "raw";
  rawView.hidden = !isRaw;
  content.hidden = isRaw;
  emptyState.hidden = currentText !== "";
  btnToggle.textContent = isRaw ? "渲染视图" : "原文视图";
  if (isRaw) {
    rawView.textContent = currentText;
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
  emptyState.hidden = false;
  content.hidden = true;
  rawView.hidden = true;
  fileInfo.textContent = "未打开文件";
  document.title = "MD Viewer";
  btnToggle.disabled = true;
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
      // 文件变化 → 重新读取并渲染。
      try {
        const text = await readTextFile(changedPath);
        currentText = text;
        // 仅在渲染视图下重新渲染（原文视图也会刷新文本）。
        await render(text);
        setViewMode(rawView.hidden ? "render" : "raw");
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
  try {
    const text = await readTextFile(path);
    currentText = text;
    currentFileName = path.split(/[\\/]/).pop() ?? path;
    fileInfo.textContent = path;
    fileInfo.title = path;
    document.title = `${currentFileName} - MD Viewer`;
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

/** 切换渲染/原文视图。 */
function toggleView(): void {
  if (!currentText) return;
  const isRaw = !rawView.hidden;
  setViewMode(isRaw ? "render" : "raw");
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
btnFullscreen.addEventListener("click", toggleFullscreen);

// ============ 导出 HTML（Phase 5） ============

/**
 * 导出当前渲染结果为自包含 HTML。
 */
async function exportHtml(): Promise<void> {
  if (!currentText) return;
  const name = currentFileName ?? "export";
  const baseName = name.replace(/\.[^.]+$/, "");
  const defaultName = `${baseName}.html`;

  const html = await buildExportHtml(name);

  // Tauri 环境：保存对话框 + 写文件；浏览器环境：直接下载。
  const path = await saveFileDialog(defaultName);
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

// 键盘快捷键：Ctrl+O 打开，Ctrl+F 搜索（Phase 5），Ctrl+/- 字号，F11 全屏。
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase();
    if (key === "o") {
      e.preventDefault();
      void pickFile();
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
