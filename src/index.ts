// html-to-docx 入口
// 后续在此实现：解析 HTML 并映射为 docx 元素

// 转换选项（预留扩展空间）
export type HtmlToDocxOptions = {
  // 文档默认字号（半磅，例如 24 即 12pt），未来可继续扩展 styleMap 等
  defaultFontSize?: number
}

export async function htmlToDocx(_html: string, _options: HtmlToDocxOptions = {}): Promise<Buffer> {
  throw new Error('htmlToDocx is not implemented yet')
}
