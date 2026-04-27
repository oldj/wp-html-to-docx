// HTML 文本工具：空白折叠

/**
 * 将 HTML 普通流中的空白序列折叠为单空格（不处理 <pre> 上下文）
 * 注意：parse5 不会自动折叠空白，需要在 walker 阶段对每个文本节点手动处理
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/**
 * 判断字符串是否仅包含空白字符
 */
export function isWhitespaceOnly(text: string): boolean {
  return /^\s*$/.test(text)
}
