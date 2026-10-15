/**
 * copy-code.ts — 代码块一键复制。
 */

/** 将文本写入剪贴板（优先用现代 Clipboard API，失败降级 execCommand）。 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 降级方案：textarea + execCommand
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 给代码块绑定复制按钮。
 * 点击后复制 code 元素的纯文本，并短暂显示「已复制」反馈。
 */
export function setupCopyButtons(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>("pre").forEach((pre) => {
    // 避免重复绑定
    if (pre.dataset.copyBound === "1") return;
    pre.dataset.copyBound = "1";

    const btn = pre.querySelector<HTMLButtonElement>(".copy-btn");
    const code = pre.querySelector<HTMLElement>("code");
    if (!btn || !code) return;

    btn.addEventListener("click", async () => {
      const ok = await copyToClipboard(code.innerText);
      if (ok) {
        const original = btn.textContent ?? "复制";
        btn.textContent = "已复制 ✓";
        setTimeout(() => {
          btn.textContent = original;
        }, 1500);
      }
    });
  });
}
