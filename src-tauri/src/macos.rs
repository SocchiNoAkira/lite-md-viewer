// macos.rs — macOS 专属：液态玻璃（Liquid Glass）效果。
//
// 仅当 `target_os = "macos"` 时编译（见 lib.rs 的 cfg 声明），
// Windows / Linux 构建完全不引入此模块，也不引入 window-vibrancy 依赖。
//
// 策略：
//   - macOS 26.0+（Tahoe）→ 原生 NSGlassEffectView（真·液态玻璃）
//   - 更早版本           → 降级到 NSVisualEffectView（传统 vibrancy 毛玻璃）
//
// 依据：window-vibrancy 0.8 的 apply_liquid_glass 在 macOS < 26 时返回
// Error::UnsupportedPlatformVersion，我们据此 catch 并 fallback。

use tauri::{Manager, Runtime, WebviewWindow};
use window_vibrancy::{
    apply_liquid_glass, apply_vibrancy, LiquidGlassOptions, NSGlassEffectViewStyle,
    NSVisualEffectMaterial,
};

/// 主窗口 label（与 tauri.conf.json 一致）。
const MAIN_WINDOW: &str = "main";

/// 应用 macOS 玻璃效果。幂等，可在 setup 阶段安全调用一次。
///
/// 注意：必须在窗口创建之后、且在**主线程**上调用
/// （Tauri 的 setup 钩子正好满足这两个条件）。
pub fn setup_macos_glass<R: Runtime>(app: &tauri::App<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        eprintln!("[macos] 未找到主窗口 '{MAIN_WINDOW}'，跳过玻璃效果");
        return;
    };

    apply_glass_to_window(&window);
}

/// 对单个窗口应用玻璃效果（液态玻璃优先，旧版降级 vibrancy）。
fn apply_glass_to_window<R: Runtime>(window: &WebviewWindow<R>) {
    // 液态玻璃：Clear 样式最贴合「文档纸悬浮」的观感；
    // radius 给窗口整体一个柔和的圆角，tint 用极淡的白色/黑色随主题自适应。
    let options = LiquidGlassOptions::new(NSGlassEffectViewStyle::Clear)
        .radius(16.0)
        .tint_color((255, 255, 255, 12));

    match apply_liquid_glass(window, options) {
        Ok(()) => {
            eprintln!("[macos] 已应用液态玻璃（Liquid Glass，macOS 26+）");
        }
        Err(window_vibrancy::Error::UnsupportedPlatformVersion(_)) => {
            // macOS < 26：降级到传统 vibrancy。
            eprintln!("[macos] 当前系统 < macOS 26，降级为 vibrancy 毛玻璃");
            if let Err(e) = apply_vibrancy(
                window,
                NSVisualEffectMaterial::UnderWindowBackground,
                None,
                Some(16.0),
            ) {
                eprintln!("[macos] 应用 vibrancy 失败：{e}");
            }
        }
        Err(e) => {
            eprintln!("[macos] 应用液态玻璃失败：{e}");
        }
    }
}
