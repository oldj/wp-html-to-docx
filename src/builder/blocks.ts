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
      // display=block 包 m:oMathPara；display=inline（极罕见出现在块级 IR 上）
      // 也直接用 m:oMath 插入段落
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

function appendBlockquote(block: Block, out: FileChild[], ctx: BuildContext): void {
  if (block.kind === 'paragraph') {
    out.push(
      new Paragraph({
        indent: { left: 720 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 8 },
        },
        alignment: toAlignment(block.align),
        children: inlinesToRuns(block.inlines, ctx),
      }),
    )
    return
  }
  if (block.kind === 'blockquote') {
    for (const child of block.children) appendBlockquote(child, out, ctx)
    return
  }
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
