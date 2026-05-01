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
}

/** 内联节点：组合后映射为 TextRun / ImageRun / ExternalHyperlink / 行内 OMML / 行内分页符 */
export type Inline =
  | { kind: 'text'; text: string; style: InlineStyle }
  | { kind: 'break' }
  | { kind: 'image'; src: string; alt?: string; style: InlineStyle }
  /** 行内 <math>：原文 MathML，转换在 collectMath 阶段写入 ctx.mathOmml */
  | { kind: 'math'; mathml: string }
  /** 行内分页符：来自段内 <wp-page-break>，渲染为 docx PageBreak run，与同段文本同时存在 */
  | { kind: 'pageBreak' }

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
  | { kind: 'blockquote'; children: Block[] }
  /** pre 块完整保留空白与换行 */
  | { kind: 'pre'; text: string }
  | { kind: 'hr' }
  | { kind: 'table'; rows: TableRow[] }
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
