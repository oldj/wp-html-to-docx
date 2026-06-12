// 中间表示 (IR) 类型定义
// HTML DOM 经 buildIr 折叠为 Block[]，块下含 Inline[]
// builder 阶段把 IR 映射成 docx 的 Paragraph / Table / ... 节点

/** 块级对齐（来源于块级元素 `style="text-align: ..."`） */
export type BlockAlign = 'left' | 'right' | 'center' | 'justify'

/** 内联文本样式 */
export type InlineStyle = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** 行内代码（等宽字体） */
  code?: boolean
  /** 超链接目标 URL */
  link?: string
  /** 文本颜色：6 位大写 hex（无 #），来自 inline `style="color: ..."` */
  color?: string
  /** 背景填充色：6 位大写 hex，来自 `background` / `background-color` */
  bgColor?: string
  /** 字号：docx 半磅整数（TextRun.size 单位） */
  fontSize?: number
  /** 字体名（首选项），来自 `font-family` */
  fontFamily?: string
  /** 上标（<sup>）；与 subScript 在 OOXML 中互斥，同时为真时以上标优先 */
  superScript?: boolean
  /** 下标（<sub>）；与 superScript 在 OOXML 中互斥 */
  subScript?: boolean
}

/** 内联节点：组合后映射为 TextRun / ImageRun / ExternalHyperlink / 行内 OMML / 行内分页符 */
export type Inline =
  | { kind: 'text'; text: string; style: InlineStyle }
  | { kind: 'break' }
  /** width/height 为 <img> 的原始尺寸字符串（如 "300" 像素或 "100%" 百分比），换算在 builder 阶段做 */
  | {
      kind: 'image'
      src: string
      alt?: string
      width?: string
      height?: string
      style: InlineStyle
    }
  /** 行内 <math>：原文 MathML，转换在 collectMath 阶段写入 ctx.mathOmml */
  | { kind: 'math'; mathml: string }
  /** 行内分页符：来自段内 <wp-page-break>，渲染为 docx PageBreak run，与同段文本同时存在 */
  | { kind: 'pageBreak' }
  /**
   * 脚注引用：来自 <sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup>。
   * `target` 为锚点 id（href 去掉前导 #，如 'fn-1'）；构建期在 ctx.footnotes 查到数字 id
   * 后渲染为 docx 的 FootnoteReferenceRun（Word 自动编号的页面底部脚注引用）。
   */
  | { kind: 'footnoteRef'; target: string }

/** 列表层级引用，由 BuildContext.registerList 注册并填入 numbering 配置 */
export type ListRef = {
  reference: string
  level: number
}

/** 块级节点。`align` 仅在块级 `style="text-align"` 直接出现在元素上时才被填入 */
export type Block =
  | { kind: 'paragraph'; inlines: Inline[]; align?: BlockAlign }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: Inline[]; align?: BlockAlign }
  /** 列表项被平铺：嵌套 list 在 IR 层产出多个 list-item，按出现顺序排列，level 区分缩进 */
  | { kind: 'list-item'; inlines: Inline[]; ref: ListRef; align?: BlockAlign }
  /**
   * 列表项内的「延续段落」。
   * 来源：同一个 <li> 内的第二个及之后的块级段落（如多 <p>、块后裸文本等）。
   * 渲染：作为独立段落，缩进对齐到 list 文本起始位置，但不带编号 / 项目符号。
   */
  | { kind: 'list-continuation'; inlines: Inline[]; level: number; align?: BlockAlign }
  /**
   * `indent` 为额外左缩进（twip），来自被嵌入 list 时由 walkListItem 注入。
   * 顶层 blockquote 不带 indent；blockquote 自带的 720 视觉缩进由 builder 负责，
   * 与此 indent 字段叠加（即 list 内 blockquote 的最终缩进 = 720 + level 缩进）。
   */
  | { kind: 'blockquote'; children: Block[]; indent?: number }
  /** pre 块完整保留空白与换行；indent 同 blockquote 由 list 注入 */
  | { kind: 'pre'; text: string; indent?: number }
  | { kind: 'hr'; indent?: number }
  /**
   * `cellPaddingPx`：来自 HTML `<table cellpadding="N">`（像素，HTML 历史属性）。
   * 在 builder 阶段优先于 options.tableCellMargin。未指定时为 undefined，
   * builder 退回到 options 默认值。
   */
  | { kind: 'table'; rows: TableRow[]; indent?: number; cellPaddingPx?: number }
  | { kind: 'math'; mathml: string; display: 'inline' | 'block' }
  /** 块级分页符：来源 <hr class="page-break"> / <wp-page-break> / 块级元素 CSS page-break-* */
  | { kind: 'pageBreak' }

export type TableRow = {
  isHeader: boolean
  cells: TableCell[]
}

export type TableCell = {
  /** 单元格内容支持嵌套块（li 内可再包 p / 列表 / 表格） */
  children: Block[]
  colSpan?: number
  rowSpan?: number
}
