/// 系统「打开方式」/ 命令行传入的文件路径。
///
/// 两个来源汇入同一条通道：
///   1. 启动参数 —— Windows / Linux 的文件关联或命令行把路径放进 argv
///      （POSIX 平台直接跑二进制时同样适用，属于通用兜底）；
///   2. 运行期事件 —— macOS 上 Finder「打开方式」走 Apple Event（odoc），
///      由 tao 转成 `RunEvent::Opened`，lib.rs 收到后调用 `push` 转发过来。
///
/// 为什么要就绪机制：后端拿到路径时前端往往还没加载完，此时 emit 事件会丢。
/// 所以未就绪先入队，前端注册好监听后主动领取一次，
/// 既不需要轮询，也不会引入额外延迟。
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

// 运行期推送只在 macOS 用到（其余平台打开文件一律是新进程 → 走启动参数）。
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Emitter, Manager};

/// 前端监听的事件名：运行期要求打开文件（见 [`push`]，仅 macOS）。
#[cfg(target_os = "macos")]
pub const OPEN_FILE_EVENT: &str = "open-file";

/// 待领取的启动文件 + 前端就绪标记。
struct Pending {
    /// 前端是否已注册好监听（false 时一概入队，不发事件）。
    ready: bool,
    /// 待领取的文件路径（预览器一次只显示一个文件，保留最后一次请求即可）。
    queued: Option<String>,
}

/// 全局状态（在 `lib.rs` 里 `.manage()`）。
pub struct PendingOpen(Mutex<Pending>);

/// 初始化状态：启动参数里若已带文件，直接入队。
pub fn init_state() -> PendingOpen {
    PendingOpen(Mutex::new(Pending {
        ready: false,
        queued: initial_file_from_args(),
    }))
}

/// 从启动参数里取第一个「磁盘上真实存在的文件」。
///
/// 用「是否存在」而不是「是否以 `-` 开头」来过滤，可以顺带干掉系统塞进来的
/// 非文件参数（macOS 的 `-psn_0_1234`、各种命令行开关）。
/// 每个参数一次 stat，参数通常只有一个，开销可忽略。
fn initial_file_from_args() -> Option<String> {
    std::env::args_os().skip(1).find_map(|arg| {
        let path = PathBuf::from(arg);
        path.is_file().then(|| path.to_string_lossy().into_owned())
    })
}

/// 前端就绪：标记可用并返回启动参数里的文件路径（无则 `None`）。
///
/// 前端必须在注册好 `open-file` 监听之后再调用，
/// 否则两者之间到达的运行期请求会丢。
#[tauri::command]
pub fn frontend_ready(state: tauri::State<'_, PendingOpen>) -> Option<String> {
    let mut pending = lock(&state);
    pending.ready = true;
    pending.queued.take()
}

/// 运行期要求打开文件：前端已就绪就发事件，否则先入队。
///
/// 仅 macOS 需要 —— 那里系统会复用已运行的进程（Finder 的 odoc 事件），
/// 其余平台每次打开文件都是新进程，路径由启动参数带进来。
#[cfg(target_os = "macos")]
pub fn push(app: &AppHandle, path: String) {
    let state = app.state::<PendingOpen>();
    let mut pending = lock(&state);
    if pending.ready {
        drop(pending);
        let _ = app.emit(OPEN_FILE_EVENT, path);
    } else {
        pending.queued = Some(path);
    }
}

/// 取锁：中毒也继续用（宁可丢弃旧值也不 panic，预览器不能崩）。
fn lock(state: &PendingOpen) -> MutexGuard<'_, Pending> {
    state.0.lock().unwrap_or_else(|e| e.into_inner())
}
