// 数学公式预转换：遍历 IR 把所有 math 节点（块级 + 行内）的 MathML 转成 OMML，
// 结果写入 ctx.mathOmml（key 为原始 MathML 字符串）。
//
// 设计与 imageCollector 对齐：把异步 IO（动态 import + 转换）集中在 build 阶段，
// 渲染层（runs / blocks）保持同步。
//
// 同一段 MathML 多处出现时只转一次（Map 自带去重）。

import type { Block, Inline } from '../types.js'
import type { BuildContext } from './buildContext.js'
import { mathmlToOmml } from '../math/mml2omml.js'

export async function collectMath(ir: Block[], ctx: BuildContext): Promise<void> {
  const sources = new Set<string>()
  collectFromBlocks(ir, sources)
  if (sources.size === 0) return
  for (const mathml of sources) {
    if (ctx.mathOmml.has(mathml)) continue
    const omml = await mathmlToOmml(mathml)
    if (omml !== null) ctx.mathOmml.set(mathml, omml)
  }
}

function collectFromBlocks(blocks: Block[], out: Set<string>): void {
  for (const block of blocks) {
    switch (block.kind) {
      case 'math':
        out.add(block.mathml)
        break
      case 'paragraph':
      case 'heading':
      case 'list-item':
        collectFromInlines(block.inlines, out)
        break
      case 'blockquote':
        collectFromBlocks(block.children, out)
        break
      case 'table':
        for (const row of block.rows) {
          for (const cell of row.cells) collectFromBlocks(cell.children, out)
        }
        break
      // pre / hr：无 math
    }
  }
}

function collectFromInlines(inlines: Inline[], out: Set<string>): void {
  for (const item of inlines) {
    if (item.kind === 'math') out.add(item.mathml)
  }
}
