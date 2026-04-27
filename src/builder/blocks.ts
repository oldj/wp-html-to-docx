// Block → docx 节点

import { BorderStyle, HeadingLevel, Paragraph, TextRun, type FileChild } from 'docx'
import type { Block } from '../types.js'
import type { BuildContext } from '../ir/buildContext.js'
import { inlinesToRuns } from './runs.js'
import { tableBlockToFileChild } from './tables.js'

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
      out.push(new Paragraph({ children: inlinesToRuns(block.inlines, ctx) }))
      return
    case 'heading':
      out.push(
        new Paragraph({
          heading: HEADING_MAP[block.level],
          children: inlinesToRuns(block.inlines, ctx),
        }),
      )
      return
    case 'list-item':
      out.push(
        new Paragraph({
          numbering: { reference: block.ref.reference, level: block.ref.level },
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
    case 'math':
      // 占位：渲染为 [math] 文本段。进阶阶段 A 接入 mathml2omml 做真实 OMML 嵌入
      out.push(
        new Paragraph({
          children: [new TextRun({ text: '[math]' })],
        }),
      )
      return
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
