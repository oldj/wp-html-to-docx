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

export type HeaderFooterValue = string | { left?: string; center?: string; right?: string }

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

/**
 * 表格单元格默认内边距（对应 OOXML `<w:tblCellMar>`，作用于所有单元格）。
 * 不传字段时各边沿用 DEFAULT_OPTIONS.tableCellMargin 的默认值。
 */
export type TableCellMargin = {
  top?: number
  right?: number
  bottom?: number
  left?: number
  /** 单位，默认 'pt'。最终统一换算为 OOXML 内部 dxa（twip） */
  unit?: LengthUnit
}

/**
 * 简易日志器签名。库在执行入口会以 `info` 级别打印当前版本号，
 * 便于使用方确认实际加载的是哪一版（用于排查"装了旧版"的疑问）。
 * 第一个参数为 message，后续 args 透传给宿主日志实现。
 */
export type Logger = (
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  ...args: unknown[]
) => void

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

  /**
   * 表格单元格默认内边距。不传时使用 DEFAULT_OPTIONS.tableCellMargin（左右各 5pt、上下各 2pt），
   * 用于消除 docx 库默认 0 内边距导致的"单元格紧贴"视觉。
   * - 对应 OOXML `<w:tblCellMar>`，作用于所有单元格
   * - HTML 中 `<table cellpadding="N">`（N 为像素）可覆盖此默认，作用于该表所有四边
   * - 当前不解析 td/th 上的 CSS `padding`
   */
  tableCellMargin?: TableCellMargin

  /**
   * 是否保留普通文本中的连续空格（含行首/行尾）。
   * - false（默认）：按 HTML 标准把任意连续空白折叠为单空格。
   * - true：保留连续的半角/全角空格、NBSP 等可见空白；含换行 `\n`/`\r`
   *   或 `\t` 的空白序列仍折叠为单空格，避免格式化 HTML 源里的缩进/换行
   *   被当成内容。
   * 注意：<pre> 块内空白本就完全保留，不受此选项影响。
   */
  preserveWhitespace?: boolean

  /**
   * 可选日志钩子。提供后，库在执行入口会调用一次：
   *   logger('info', `wp-html-to-docx vX.Y.Z`)
   * 用于在调用方排查实际装载的版本（例如怀疑包管理器命中了缓存中的旧版时）。
   * 不提供则完全静默，不会向 console 写任何内容。
   */
  logger?: Logger
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
  /**
   * 默认表格单元格内边距：左右 5pt（约等于 Word 的 108 dxa）+ 上下 2pt。
   * 这样默认导出的表格不会出现单元格内容紧贴边线的拥挤视觉。
   */
  tableCellMargin: {
    top: 2,
    right: 5,
    bottom: 2,
    left: 5,
    unit: 'pt' as LengthUnit,
  },
} satisfies Partial<HtmlToDocxOptions> & {
  page: Required<PageOptions> & { margin: Required<PageMargin> }
  tableCellMargin: Required<TableCellMargin>
}
