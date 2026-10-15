mod commands;
mod open_file;
mod watcher;

// macOS 专属模块：仅 mac 构建时引入（液态玻璃效果）。
#[cfg(target_os = "macos")]
mod macos;

/// Tauri 应用入口。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(watcher::init_state())
        // 启动参数里的文件路径（文件关联 / 命令行）在这里入队。
        .manage(open_file::init_state())
        .invoke_handler(tauri::generate_handler![
            commands::read_text_file,
            commands::write_text_file,
            commands::get_recent_files,
            commands::add_recent_file,
            watcher::watch_file,
            watcher::unwatch_file,
            open_file::frontend_ready,
        ])
        .setup(|app| {
            // macOS：应用液态玻璃效果（setup 在窗口创建后、主线程上执行）。
            #[cfg(target_os = "macos")]
            macos::setup_macos_glass(app);
            // 非 macOS 平台：app 参数未使用，显式忽略以避免警告。
            #[cfg(not(target_os = "macos"))]
            let _ = app;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("构建 MD Viewer 时出错");

    // 事件循环：除 macOS 的「打开文件」事件外没有额外逻辑（等价于默认 run）。
    app.run(|app_handle, event| {
        // macOS：Finder 的「打开方式」/ 拖到 Dock 图标走 Apple Event，
        // 由 tao 转成 RunEvent::Opened，这里转发给前端的 open-file 通道。
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                match url.to_file_path() {
                    Ok(path) => {
                        open_file::push(app_handle, path.to_string_lossy().into_owned())
                    }
                    Err(_) => eprintln!("[open-file] 无法解析为本地路径：{url}"),
                }
            }
        }
        // 非 macOS：事件循环不做处理，显式忽略以避免警告。
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}
