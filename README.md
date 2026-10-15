# MD Viewer

轻量级跨平台 Markdown 预览器，基于 [Tauri 2](https://tauri.app/) + Vanilla TypeScript + Vite。

## 功能

- **打开**：文件关联双击 / 打开对话框 / 拖入窗口 / 命令行参数
- **渲染**：GFM、代码高亮 + 一键复制、KaTeX 公式、Mermaid 图表、DOMPurify XSS 消毒
- **阅读**：TOC 大纲导航、暗/亮主题、原文视图切换、字号缩放、全屏
- **实用**：文件监听（外部修改自动刷新）、最近文件、导出 HTML
- **macOS 原生质感**：液态玻璃（macOS 26+）/ vibrancy 毛玻璃（旧系统自动降级）、Overlay 无边框标题栏（红绿灯与工具栏垂直对齐、拖动工具栏空白处可移动窗口）

**明确不做**：编辑、文件树、云同步、插件系统、多标签页。

## 技术栈

| 层 | 选型 |
|---|---|
| 应用框架 | Tauri 2（Rust 后端 + 系统 WebView） |
| 前端 | Vanilla TypeScript + Vite 5（无 UI 框架） |
| Markdown | markdown-it 14 + 插件（anchor / emoji / task-lists） |
| 安全 | DOMPurify 3 |
| 代码高亮 | highlight.js 11 |
| 图表 / 公式 | Mermaid + KaTeX（懒加载，不进首屏） |
| macOS 玻璃效果 | window-vibrancy 0.8 |

## 环境要求

- **Node.js** ≥ 20（建议 22+）
- **Rust** stable（[rustup.rs](https://rustup.rs/)）
- **macOS**：Xcode Command Line Tools（`xcode-select --install`）
- **Windows**：Visual Studio 2022「使用 C++ 的桌面开发」工作负载 + WebView2（Win11 自带，Win10 需装）

## 构建与部署

```bash
npm install           # 安装前端依赖
npm run tauri dev     # 开发模式（前端热更新，Rust 自动重编译）
npm run tauri build   # 打包发布版
```

产物在 `src-tauri/target/release/bundle/`：

| 平台 | 分发文件 | 说明 |
|---|---|---|
| macOS | `dmg/MD Viewer_0.1.0_*.dmg` | 镜像内含 `macos/MD Viewer.app`；Apple Silicon 出 aarch64，Intel 出 x64 |
| Windows | `nsis/MD Viewer_0.1.0_x64-setup.exe` | NSIS 安装包，免管理员，自动注册 `.md` 文件关联 |

注意事项：

- macOS 产物必须在 macOS 上构建，Windows 构建不出 mac 产物；平台专属代码与依赖已按目标平台条件隔离，互不影响
- macOS 未签名：首次打开需右键 →「打开」绕过 Gatekeeper；正式对外分发需 Apple Developer 证书签名 + 公证
- macOS 液态玻璃使用了 `macOSPrivateApi`，**不能上架 Mac App Store**，只能独立分发

CI：`.github/workflows/build.yml` 在推送 `v*` tag 或手动触发时自动构建 Windows 安装包并创建 draft Release。

## 使用

1. 双击 `.md` 文件（安装包已注册关联），或用「打开文件」对话框、拖入窗口
2. 命令行传入文件路径可直接打开（`md-viewer.exe path/to/file.md`）
3. 快捷键：`Ctrl/Cmd+O` 打开、`Ctrl/Cmd+=` / `Ctrl/Cmd+-` 字号缩放、`Ctrl/Cmd+0` 重置字号、`F11` 全屏
4. macOS 额外交互：拖动顶部工具栏空白处移动窗口，双击最大化

## 项目结构

```
md-viewer/
├── src/                        # 前端（TypeScript）
│   ├── main.ts                 # 入口（工具栏 / 打开 / 监听 / 导出）
│   ├── renderer.ts             # Markdown 渲染管线（markdown-it + 插件）
│   ├── highlight.ts            # 代码高亮
│   ├── theme.ts                # 暗/亮主题
│   ├── toc.ts                  # TOC 大纲 + scroll-spy
│   ├── export.ts               # 导出 HTML
│   ├── tauri.ts                # Tauri 后端能力封装
│   ├── styles/                 # 样式
│   └── utils/                  # 复制代码 / 懒加载 / 大文件
├── src-tauri/                  # Rust 后端
│   ├── src/                    # lib / commands / watcher / open_file / macos
│   ├── tauri.conf.json         # 主配置（跨平台）
│   ├── tauri.macos.conf.json   # macOS 专属（液态玻璃 / Overlay 标题栏 / 红绿灯定位）
│   ├── capabilities/           # 权限配置（核心 + 对话框 + 窗口拖动）
│   └── icons/                  # 图标（macOS icns / Windows ico + logos）
└── .github/workflows/          # CI（Windows 自动构建 + Release）
```

## 已知限制

- 文件内全文搜索尚未实现（其余计划功能均已完成）
- `window-vibrancy` 在 macOS 27 打包版存在已知崩溃风险（官方 issue #229），分发前需真机充分测试；若遇崩溃可禁用液态玻璃、降级为 vibrancy

## 许可证

[MIT](LICENSE)
