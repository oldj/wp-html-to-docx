// 中间表示 (IR) 类型定义
// HTML DOM 经 buildIr 折叠为 Block[]，块下含 Inline[]
// builder 阶段把 IR 映射成 docx 的 Paragraph / Table / ... 节点

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
}

/** 内联节点：组合后映射为 TextRun / ImageRun / ExternalHyperlink */
export type Inline =
  | { kind: 'text'; text: string; style: InlineStyle }
  | { kind: 'break' }
  | { kind: 'image'; src: string; alt?: string; style: InlineStyle }

/** 列表层级引用，由 BuildContext.registerList 注册并填入 numbering 配置 */
export type ListRef = {
  reference: string
  level: number
}

/** 块级节点 */
export type Block =
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: Inline[] }
  /** 列表项被平铺：嵌套 list 在 IR 层产出多个 list-item，按出现顺序排列，level 区分缩进 */
  | { kind: 'list-item'; inlines: Inline[]; ref: ListRef }
  | { kind: 'blockquote'; children: Block[] }
  /** pre 块完整保留空白与换行 */
  | { kind: 'pre'; text: string }
  | { kind: 'hr' }
  | { kind: 'table'; rows: TableRow[] }
  | { kind: 'math'; mathml: string; display: 'inline' | 'block' }

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
