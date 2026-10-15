/**
 * highlight.ts — 代码高亮（highlight.js 精简语言包）。
 *
 * 只注册 Top 30 常用语言（按 PROPOSAL 5.1，避免加载全部 386 语言导致包体膨胀）。
 * 未注册的语言降级为无高亮（仍保留语言标签 + 复制按钮）。
 *
 * 使用 ESM 核心 + 按需注册语言，Vite 会 tree-shake 掉未 import 的语言。
 */
import hljs from "highlight.js/lib/core";
import { MAX_CODE_HIGHLIGHT_CHARS } from "./utils/large-file";

// Top 30 常用语言（按使用频率 + 通用性排序）。
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import scala from "highlight.js/lib/languages/scala";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import powershell from "highlight.js/lib/languages/powershell";
import sql from "highlight.js/lib/languages/sql";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import html from "highlight.js/lib/languages/xml"; // html 复用 xml
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import markdown from "highlight.js/lib/languages/markdown";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import makefile from "highlight.js/lib/languages/makefile";
import ini from "highlight.js/lib/languages/ini";
import diff from "highlight.js/lib/languages/diff";
import plaintext from "highlight.js/lib/languages/plaintext";

// 注册语言（别名处理）。
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("java", java);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c++", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cs", csharp);
hljs.registerLanguage("go", go);
hljs.registerLanguage("golang", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rb", ruby);
hljs.registerLanguage("php", php);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("kt", kotlin);
hljs.registerLanguage("scala", scala);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("zsh", shell);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("ps1", powershell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("json", json);
hljs.registerLanguage("jsonc", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", html);
hljs.registerLanguage("htm", html);
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("less", css);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("docker", dockerfile);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("toml", ini);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("text", plaintext);
hljs.registerLanguage("txt", plaintext);

/** 语言别名 -> 显示名（用于代码块语言标签）。 */
const LANG_LABELS: Record<string, string> = {
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
  py: "Python",
  cpp: "C++",
  cs: "C#",
  golang: "Go",
  rs: "Rust",
  rb: "Ruby",
  sh: "Bash",
  zsh: "Shell",
  ps1: "PowerShell",
  jsonc: "JSON",
  yml: "YAML",
  htm: "HTML",
  md: "Markdown",
  docker: "Dockerfile",
  txt: "Text",
  text: "Text",
};

/** 把语言标识转成人类可读标签。 */
export function langLabel(lang: string): string {
  const lower = lang.toLowerCase();
  if (LANG_LABELS[lower]) return LANG_LABELS[lower];
  if (!lang) return "code";
  return lang;
}

/**
 * 高亮单个 code 块的内容。
 * 返回带 hljs span 的 HTML（未识别语言时返回纯文本转义后的原文）。
 * 超长代码块（> MAX_CODE_HIGHLIGHT_CHARS）跳过语法高亮，避免卡顿。
 */
export function highlightCode(code: string, lang: string): string {
  if (code.length > MAX_CODE_HIGHLIGHT_CHARS) {
    // 超大代码块：仅转义，不语法高亮。
    return escapeHtml(code);
  }
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      // 高亮异常时降级为转义文本
    }
  }
  return escapeHtml(code);
}

/** 转义 HTML 特殊字符。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export { hljs };
