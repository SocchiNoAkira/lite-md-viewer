/**
 * Tauri 后端能力的轻量封装。
 *
 * 浏览器直接访问时（`vite dev` 打开，非 Tauri 环境）这些调用会失败，
 * 因此每个函数都做了 try/catch 降级，保证纯前端调试不崩溃。
 */
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/** 判断是否运行在 Tauri 环境（而非纯浏览器）。 */
function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * 弹出系统文件选择对话框，返回选中的 .md 文件路径（取消返回 null）。
 */
export async function openFileDialog(): Promise<string | null> {
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    return typeof selected === "string" ? selected : null;
  } catch (err) {
    console.error("对话框不可用（可能在浏览器环境）:", err);
    return null;
  }
}

/**
 * 读取 UTF-8 文本文件内容。
 * 走 Tauri command（Rust 侧 read_text_file），浏览器环境返回 null。
 */
export async function readTextFile(path: string): Promise<string> {
  const text = await invoke<string>("read_text_file", { path });
  return text;
}

/**
 * 写入 UTF-8 文本文件（用于导出 HTML）。
 */
export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke("write_text_file", { path, content });
}

/**
 * 弹出保存文件对话框，返回目标路径（取消返回 null）。
 */
export async function saveFileDialog(
  defaultName: string
): Promise<string | null> {
  try {
    const selected = await save({
      defaultPath: defaultName,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    return typeof selected === "string" ? selected : null;
  } catch (err) {
    console.error("保存对话框不可用:", err);
    return null;
  }
}

// ============ 文件监听（Phase 4） ============

/**
 * 开始监听文件变化。变化时回调触发（事件名 file-changed）。
 * 返回取消监听的函数。
 */
export async function watchFile(
  path: string,
  onChange: (path: string) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};

  // 注册事件监听（幂等：listen 同一事件多次会叠加，但由调用方保证只监听一次）。
  const unlisten: UnlistenFn = await listen<string>("file-changed", (e) => {
    if (e.payload === path) onChange(path);
  });

  await invoke("watch_file", { path });

  // 返回取消函数：同时取消事件监听 + 停止 Rust watcher。
  return async () => {
    unlisten();
    try {
      await invoke("unwatch_file");
    } catch {
      /* 忽略 */
    }
  };
}

// ============ 最近文件（Phase 4） ============

/** 读取最近文件列表（最新在前）。 */
export async function getRecentFiles(): Promise<string[]> {
  try {
    return await invoke<string[]>("get_recent_files");
  } catch (err) {
    console.error("读取最近文件失败:", err);
    return [];
  }
}

/** 添加文件到最近文件列表，返回更新后的列表。 */
export async function addRecentFile(path: string): Promise<string[]> {
  try {
    return await invoke<string[]>("add_recent_file", { path });
  } catch (err) {
    console.error("添加最近文件失败:", err);
    return [];
  }
}

// ============ 拖放打开（Phase 4） ============

/**
 * 监听拖放文件事件（用户把 .md 文件拖进窗口）。
 * 返回取消监听的函数。
 */
export async function onFileDrop(onDrop: (path: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};

  const win = getCurrentWebviewWindow();
  const unlisten = await win.onDragDropEvent((event) => {
    // 只有 drop 类型且 payload 是文件路径数组时才处理。
    if (event.payload.type === "drop") {
      const paths = event.payload.paths;
      if (paths.length > 0) {
        onDrop(paths[0]);
      }
    }
  });

  return unlisten;
}

// ============ 系统打开文件（文件关联 / 命令行） ============

/**
 * 监听运行期的「打开文件」请求。
 *
 * 只有系统复用同一进程时才会走到这里（典型是 macOS 的 Finder：
 * 双击第二个 .md 只会给已运行的进程发事件）。
 * 返回取消监听的函数。
 */
export async function onOpenFileRequest(
  onOpen: (path: string) => void
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};

  return listen<string>("open-file", (e) => {
    if (e.payload) onOpen(e.payload);
  });
}

/**
 * 通知后端「前端已就绪」，并领取启动参数里的文件路径（无则 null）。
 *
 * 必须在 `onOpenFileRequest` 注册监听之后再调用：后端在收到本调用之前
 * 只把路径入队、不发事件，因此既不丢请求、也不需要轮询。
 */
export async function claimStartupFile(): Promise<string | null> {
  if (!isTauri()) return null;

  try {
    return await invoke<string | null>("frontend_ready");
  } catch (err) {
    console.error("领取启动文件失败:", err);
    return null;
  }
}

// ============ 字号持久化（Phase 4） ============

const FONT_SIZE_KEY = "md-viewer-font-size";

/** 读取持久化的字号（默认 100%）。 */
export function getFontSize(): number {
  const v = localStorage.getItem(FONT_SIZE_KEY);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 80 && n <= 160 ? n : 100;
}

/** 持久化字号。 */
export function setFontSize(pct: number): void {
  localStorage.setItem(FONT_SIZE_KEY, String(pct));
}
