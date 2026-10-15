/**
 * large-file.ts — 大文件优化（Phase 6）。
 *
 * 策略：大文件（> 阈值）时，Markdown 渲染仍为同步（markdown-it 本身够快），
 * 但代码高亮是主要瓶颈（highlight.js 对每个代码块同步高亮）。
 * 优化点：
 *   1. 超大文件（> 1MB）直接跳过语法高亮，保留纯文本代码块，保证可用性。
 *   2. 中等文件：限制单个代码块高亮长度，超长代码块跳过。
 *
 * 这些阈值作为常量导出，由 highlight.ts / renderer.ts 使用。
 */

/** 超过此字节数视为「超大文件」，完全跳过语法高亮。 */
export const HUGE_FILE_BYTES = 1_000_000; // 1MB

/** 单个代码块超过此字符数时跳过语法高亮（避免长代码块卡死）。 */
export const MAX_CODE_HIGHLIGHT_CHARS = 200_000;

/** 超过此字节数，关闭「文件监听自动刷新」的防抖间隔加长（减少频繁重渲染）。 */
export const LARGE_FILE_BYTES = 300_000; // 300KB

/**
 * 判断文件是否过大（供调用方决定是否降级）。
 */
export function isHugeFile(sizeBytes: number): boolean {
  return sizeBytes >= HUGE_FILE_BYTES;
}

export function isLargeFile(sizeBytes: number): boolean {
  return sizeBytes >= LARGE_FILE_BYTES;
}
