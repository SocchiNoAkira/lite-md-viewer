/**
 * theme.ts — 主题管理。
 *
 * 设计：CSS 只认 `data-theme="light" | "dark"` 属性，不写 prefers-color-scheme 媒体查询。
 * 本模块负责把「用户偏好 / 系统主题」解析为 data-theme，并跟随系统变化。
 *
 * 首帧防闪烁由 index.html 的 <head> 内联脚本负责（JS 执行前先设置 data-theme）。
 */
type Theme = "light" | "dark";

const STORAGE_KEY = "md-viewer-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

/** 读取系统主题。 */
function systemTheme(): Theme {
  return media.matches ? "dark" : "light";
}

/** 读取当前生效主题：用户显式选择优先，否则跟随系统。 */
export function getTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "light" || saved === "dark" ? saved : systemTheme();
}

/** 将主题写到 DOM（data-theme + color-scheme）。 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** 显式设置主题并持久化。 */
export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/** 切换主题，返回切换后的主题（Phase 3 的主题按钮会用到）。 */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/** 初始化：应用当前主题，并监听系统主题变化（仅当用户未手动指定时跟随）。 */
export function initTheme(): void {
  applyTheme(getTheme());
  media.addEventListener("change", (e) => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyTheme(e.matches ? "dark" : "light");
    }
  });
}
