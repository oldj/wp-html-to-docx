// Block → docx 节点

import {
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  PageBreak,
  Paragraph,
  TextRun,
  type FileChild,
  type ParagraphChild,
} from 'docx'
import type { Block, BlockAlign } from '../types.js'
import type { BuildContext } from '../ir/buildContext.js'
import { inlinesToRuns } from './runs.js'
import { tableBlockToFileChild } from './tables.js'
import { blockOmmlToImported, ommlToImported } from './ommlImport.js'

const ALIGN_MAP: Record<BlockAlign, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  right: AlignmentType.RIGHT,
  center: AlignmentType.CENTER,
  justify: AlignmentType.JUSTIFIED,
}

function toAlignment(
  align: BlockAlign | undefined,
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  return align !== undefined ? ALIGN_MAP[align] : undefined
}

const HEADING_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
} as const

export function blocksToChildren(blocks: Block[], ctx: BuildContext): FileChild[] {
  const out: FileChild[] = []
  for (const block of blocks) appendBlock(block, out, ctx)
  return out
}

function appendBlock(block: Block, out: FileChild[], ctx: BuildContext): void {
  switch (block.kind) {
    case 'paragraph':
      out.push(
        new Paragraph({
          alignment: toAlignment(block.align),
          children: inlinesToRuns(block.inlines, ctx),
        }),
      )
      return
    case 'heading':
      out.push(
        new Paragraph({
          heading: HEADING_MAP[block.level],
          alignment: toAlignment(block.align),
          children: inlinesToRuns(block.inlines, ctx),
        }),
      )
      return
    case 'list-item':
      out.push(
        new Paragraph({
          numbering: { reference: block.ref.reference, level: block.ref.level },
          alignment: toAlignment(block.align),
          children: inlinesToRuns(block.inlines, ctx),
        }),
      )
      return
    case 'blockquote':
      for (const child of block.children) appendBlockquote(child, out, ctx)
      return
    case 'pre':
      out.push(...preToParagraphs(block.text))
      return
    case 'hr':
      out.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' },
          },
        }),
      )
      return
    case 'table':
      out.push(tableBlockToFileChild(block, ctx))
      return
    case 'pageBreak':
      // 块级分页：独立段落含 PageBreak run，渲染为 <w:br w:type="page"/>
      out.push(new Paragraph({ children: [new PageBreak()] }))
      return
    case 'math': {
      const omml = ctx.mathOmml.get(block.mathml)
      // walker 已把无 display=block 的 math 收进了行内路径（inlineCollector），
      // 这里实际只会走到 block.display === 'block' 分支。inline 分支是保险 fallback：
      // 万一外部代码直接构造 Block.math({display:'inline'}) 也不会渲染失败
      const ic =
        omml !== undefined
          ? block.display === 'block'
            ? blockOmmlToImported(omml)
            : ommlToImported(omml)
          : null
      if (ic !== null) {
        // ImportedXmlComponent 不在 ParagraphChild 类型联合内，但运行时兼容
        out.push(new Paragraph({ children: [ic as unknown as ParagraphChild] }))
      } else {
        // 转换失败 / 依赖缺失：退回 [math] 占位段
        out.push(new Paragraph({ children: [new TextRun({ text: '[math]' })] }))
      }
      return
    }
    default:
      return
  }
}

// blockquote 视觉样式：左缩进 + 左边线灰条
const BLOCKQUOTE_INDENT = { left: 720 } as const
const BLOCKQUOTE_BORDER = {
  left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 8 },
} as const

function appendBlockquote(block: Block, out: FileChild[], ctx: BuildContext): void {
  if (block.kind === 'paragraph') {
    out.push(
      new Paragraph({
        indent: BLOCKQUOTE_INDENT,
        border: BLOCKQUOTE_BORDER,
        alignment: toAlignment(block.align),
        children: inlinesToRuns(block.inlines, ctx),
      }),
    )
    return
  }
  if (block.kind === 'heading') {
    // <blockquote><h2>...</h2></blockquote> 也应继承引用视觉，否则会出现「段落有缩进、标题没缩进」的断层
    out.push(
      new Paragraph({
        heading: HEADING_MAP[block.level],
        indent: BLOCKQUOTE_INDENT,
        border: BLOCKQUOTE_BORDER,
        alignment: toAlignment(block.align),
        children: inlinesToRuns(block.inlines, ctx),
      }),
    )
    return
  }
  if (block.kind === 'pre') {
    // <pre> 拆成多行段落，每行也带引用视觉
    const trimmed = block.text.replace(/^\n/, '').replace(/\n$/, '')
    const lines = trimmed.length === 0 ? [''] : trimmed.split('\n')
    for (const line of lines) {
      out.push(
        new Paragraph({
          indent: BLOCKQUOTE_INDENT,
          border: BLOCKQUOTE_BORDER,
          children: [new TextRun({ text: line, font: 'Consolas' })],
        }),
      )
    }
    return
  }
  if (block.kind === 'blockquote') {
    for (const child of block.children) appendBlockquote(child, out, ctx)
    return
  }
  // list-item / table / hr / math / pageBreak：维持原渲染
  // - list-item 已有 numbering 缩进，再叠加 indent 会冲突
  // - table / hr / math / pageBreak 不直接适配段落级 indent+border
  appendBlock(block, out, ctx)
}

function preToParagraphs(text: string): Paragraph[] {
  const trimmed = text.replace(/^\n/, '').replace(/\n$/, '')
  const lines = trimmed.length === 0 ? [''] : trimmed.split('\n')
  return lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, font: 'Consolas' })],
      }),
  )
}
