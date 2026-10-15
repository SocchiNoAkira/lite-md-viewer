/// 文件监听（Phase 4）。
///
/// 用 notify crate 监听单个文件的修改事件，文件变化时通过 Tauri event 通知前端。
/// 设计：同一时间只监听一个文件（预览器一次只显示一个文件）。

use std::path::PathBuf;
use std::sync::Mutex;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// 当前监听的 watcher 和文件路径（用于切换文件时替换/清理）。
///
/// 注意：`watcher` 和 `path` 字段虽然不被显式读取，但必须持有——
/// 一旦 `RecommendedWatcher` 被 drop，监听就会停止。
struct WatchState {
    #[allow(dead_code)]
    watcher: RecommendedWatcher,
    #[allow(dead_code)]
    path: PathBuf,
}

/// 全局监听状态（单文件）。
pub struct AppState {
    watch: Mutex<Option<WatchState>>,
}

/// 初始化应用状态（在 run() 中注册）。
pub fn init_state() -> AppState {
    AppState {
        watch: Mutex::new(None),
    }
}

/// 开始监听指定文件。切换文件时会自动替换旧的 watcher。
///
/// 事件名：`file-changed`，payload 为文件路径（字符串）。
#[tauri::command]
pub fn watch_file(app: AppHandle, state: tauri::State<'_, AppState>, path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    // 构建 watcher：回调里发事件给前端。
    let handler = {
        let app = app.clone();
        move |res: notify::Result<Event>| {
            match res {
                Ok(event) => {
                    // 只关心「内容修改/写入」类事件（编辑保存）。
                    let is_write = matches!(
                        event.kind,
                        EventKind::Modify(_) | EventKind::Create(_)
                    );
                    if is_write {
                        let _ = app.emit("file-changed", &path);
                    }
                }
                Err(e) => {
                    let _ = app.emit("watch-error", format!("{e}"));
                }
            }
        }
    };

    let mut watcher = notify::recommended_watcher(handler)
        .map_err(|e| format!("创建 watcher 失败: {e}"))?;

    watcher
        .watch(&path_buf, RecursiveMode::NonRecursive)
        .map_err(|e| format!("监听文件失败: {e}"))?;

    // 替换旧状态。
    let mut guard = state.watch.lock().map_err(|e| e.to_string())?;
    *guard = Some(WatchState {
        watcher,
        path: path_buf,
    });

    Ok(())
}

/// 停止监听。
#[tauri::command]
pub fn unwatch_file(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.watch.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}
