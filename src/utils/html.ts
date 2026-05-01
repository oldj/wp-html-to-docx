// HTML 文本工具：空白折叠

/**
 * 将 HTML 普通流中的空白序列折叠为单空格（不处理 <pre> 上下文）
 * 注意：parse5 不会自动折叠空白，需要在 walker 阶段对每个文本节点手动处理
 *
 * @param preserve 当为 true 时启用保守保留模式：仅当一段连续空白包含
 *   `\n` / `\r` / `\t`（多半是 HTML 源的格式化缩进/换行）时才折叠为单空格；
 *   其余空白（半角空格 U+0020、全角空格 U+3000、NBSP 等）原样保留。
 */
export function collapseWhitespace(text: string, preserve = false): string {
  if (!preserve) return text.replace(/\s+/g, ' ')
  return text.replace(/\s+/g, (run) => (/[\n\r\t]/.test(run) ? ' ' : run))
}

/**
 * 判断字符串是否仅包含空白字符
 */
export function isWhitespaceOnly(text: string): boolean {
  return /^\s*$/.test(text)
}
