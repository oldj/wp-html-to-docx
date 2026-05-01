// 公共配置选项与默认值

export type PaperSize = 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid'

export type LengthUnit = 'pt' | 'mm' | 'in'

export type CustomPageSize = {
  width: number
  height: number
  unit?: LengthUnit
}

export type PageMargin = {
  top?: number
  right?: number
  bottom?: number
  left?: number
  /** 页眉距纸顶 */
  header?: number
  /** 页脚距纸底 */
  footer?: number
  unit?: LengthUnit
}

export type PageOptions = {
  size?: PaperSize | CustomPageSize
  orientation?: 'portrait' | 'landscape'
  margin?: PageMargin
}

export type HeaderFooterValue =
  | string
  | { left?: string; center?: string; right?: string }

export type PageNumberPosition =
  | 'header-left'
  | 'header-center'
  | 'header-right'
  | 'footer-left'
  | 'footer-center'
  | 'footer-right'

export type PageNumberOptions = {
  enabled?: boolean
  /** 起始编号，默认 1 */
  start?: number
  format?: 'decimal' | 'upperRoman' | 'lowerRoman' | 'upperLetter' | 'lowerLetter'
  position?: PageNumberPosition
  /** 模板，含 {PAGE} {TOTAL} 占位符。例：'第 {PAGE} 页 / 共 {TOTAL} 页' */
  template?: string
}

export type ImageResolverResult = {
  data: Uint8Array
  width?: number
  height?: number
  mime?: string
}

export type ImageResolver = (src: string) => Promise<ImageResolverResult>

export type HtmlToDocxOptions = {
  page?: PageOptions
  header?: HeaderFooterValue
  footer?: HeaderFooterValue
  pageNumber?: PageNumberOptions

  // 文档级元数据（对应 OOXML core properties / docProps/core.xml，
  // 在 Word 的「文件 → 信息」面板里可见与编辑）
  /** 标题（dc:title） */
  title?: string
  /** 作者（dc:creator）。Word UI 中显示为「作者」 */
  creator?: string
  /** 描述 / 备注（dc:description） */
  description?: string
  /** 主题（dc:subject） */
  subject?: string
  /** 关键词，逗号分隔（cp:keywords） */
  keywords?: string
  /** 最后修改者（cp:lastModifiedBy）。未设置时 docx 库默认写入 "Un-named" */
  lastModifiedBy?: string

  /** 默认字体，默认 'Calibri' */
  defaultFont?: string
  /** 默认字号（半磅，docx 单位）。22 = 11pt */
  defaultFontSize?: number

  /**
   * 文档级默认语言，写入 styles.xml 的 <w:rPrDefault><w:lang/>。
   * 影响 Word 的拼写检查 / 校对语言、East Asian 字体回退归属等。
   * - value:         → <w:lang w:val="...">       西文 / 默认校对语言（如 'en-US'）
   * - eastAsia:      → <w:lang w:eastAsia="...">  东亚字符语言（如 'zh-CN'、'ja-JP'）
   * - bidirectional: → <w:lang w:bidi="...">      复杂文种 / RTL 语言（如 'ar-SA'）
   * 不传则不写入 <w:lang>，由 Word 使用其打开端默认。
   */
  language?: {
    value?: string
    eastAsia?: string
    bidirectional?: string
  }

  imageResolver?: ImageResolver
  /** 未提供 resolver 且非 data URL 时的兜底策略 */
  onUnresolvedImage?: 'skip' | 'placeholder' | 'error'
}

/** 单点声明的默认值，便于覆盖与测试 */
export const DEFAULT_OPTIONS = {
  page: {
    size: 'A4' as PaperSize,
    orientation: 'portrait' as const,
    margin: {
      top: 25.4,
      right: 25.4,
      bottom: 25.4,
      left: 25.4,
      header: 12.7,
      footer: 12.7,
      unit: 'mm' as LengthUnit,
    },
  },
  defaultFont: 'Calibri',
  defaultFontSize: 22,
  onUnresolvedImage: 'skip' as const,
} satisfies Partial<HtmlToDocxOptions> & {
  page: Required<PageOptions> & { margin: Required<PageMargin> }
}
