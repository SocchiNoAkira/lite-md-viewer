// 防止 Windows 上 release 构建弹出额外的命令行窗口（DO NOT REMOVE）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    md_viewer_lib::run()
}
