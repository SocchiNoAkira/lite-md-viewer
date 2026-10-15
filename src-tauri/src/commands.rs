/// Tauri IPC 命令。
///
/// 纯读取/无副作用操作（读取文件、最近文件列表）。
/// 文件监听在 watcher.rs，对话框走 tauri-plugin-dialog（前端直接调用）。

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// 读取 UTF-8 文本文件内容，返回字符串。
///
/// 前端通过 `invoke("read_text_file", { path })` 调用。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("无法读取文件: {e}"))
}

/// 写入 UTF-8 文本文件（用于导出 HTML）。
///
/// 前端通过 `invoke("write_text_file", { path, content })` 调用。
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("无法写入文件: {e}"))
}

/// 最近文件列表的存储位置（应用数据目录下 recent.json）。
fn recent_file_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("recent.json")
}

/// 获取应用数据目录（用于存最近文件）。
fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))
}

/// 读取最近文件列表（最新的在前）。
#[tauri::command]
pub fn get_recent_files(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = app_data_dir(&app)?;
    let p = recent_file_path(&dir);
    if !p.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&p).map_err(|e| format!("读取最近文件失败: {e}"))?;
    let list: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    // 只保留仍然存在的文件。
    Ok(list
        .into_iter()
        .filter(|f| PathBuf::from(f).exists())
        .collect())
}

/// 添加一个文件到最近文件列表（去重、置顶、上限 20）。
#[tauri::command]
pub fn add_recent_file(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let dir = app_data_dir(&app)?;
    let p = recent_file_path(&dir);
    let mut list: Vec<String> = if p.exists() {
        let raw = fs::read_to_string(&p).map_err(|e| format!("读取最近文件失败: {e}"))?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        Vec::new()
    };

    // 去重：删除已存在的相同路径。
    list.retain(|f| f != &path);
    // 置顶。
    list.insert(0, path);
    // 上限 20。
    list.truncate(20);

    // 确保目录存在。
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&list).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&p, json).map_err(|e| format!("写入最近文件失败: {e}"))?;

    Ok(list)
}
