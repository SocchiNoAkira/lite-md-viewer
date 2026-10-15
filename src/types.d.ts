// Third-party modules without bundled type declarations.

/** markdown-it-task-lists：无官方类型，忽略。 */
declare module "markdown-it-task-lists";

/** markdown-it-emoji v3：ESM 具名导出 bare/light/full，类型声明缺失。 */
declare module "markdown-it-emoji" {
  import type MarkdownIt from "markdown-it";
  import type Token from "markdown-it/lib/token.mjs";

  export interface EmojiPlugin {
    (md: MarkdownIt): void;
  }

  export const bare: EmojiPlugin;
  export const light: EmojiPlugin;
  export const full: EmojiPlugin;

  export default function emoji(
    md: MarkdownIt,
    options?: Record<string, unknown>,
  ): void;
}

/** CSS 动态 import（Vite 支持），TS 无类型。 */
declare module "*.css";
