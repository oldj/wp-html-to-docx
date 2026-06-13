// 数学公式预转换：遍历 IR 把所有 math 节点（块级 + 行内）的 MathML 转成 OMML，
// 结果写入 ctx.mathOmml（key 为原始 MathML 字符串）。
//
// 设计与 imageCollector 对齐：把异步 IO（动态 import + 转换）集中在 build 阶段，
// 渲染层（runs / blocks）保持同步。
//
// 同一段 MathML 多处出现时只转一次（Map 自带去重）。

import type { Block } from '../types.js'
import type { BuildContext } from './buildContext.js'
import { mathmlToOmml } from '../math/mml2omml.js'
import { makeWarn } from '../utils/log.js'
import { walkBlocksDeep, walkInlinesDeep } from './walkIr.js'

export async function collectMath(ir: Block[], ctx: BuildContext): Promise<void> {
  const sources = new Set<string>()
  collectSources(ir, sources)
  // 脚注内容不在主 IR 中（已提升到 ctx.footnotes），渲染期同样查 ctx.mathOmml，必须一并转换
  for (const fn of ctx.footnotes.values()) collectSources(fn.blocks, sources)
  if (sources.size === 0) return
  const warn = makeWarn(ctx.options.logger)
  for (const mathml of sources) {
    if (ctx.mathOmml.has(mathml)) continue
    const omml = await mathmlToOmml(mathml, warn)
    if (omml !== null) ctx.mathOmml.set(mathml, omml)
  }
}

function collectSources(blocks: Block[], out: Set<string>): void {
  // 块级 <math display="block"> 在 Block 层，行内 <math> 在 Inline 层，两层都要收
  walkBlocksDeep(blocks, (block) => {
    if (block.kind === 'math') out.add(block.mathml)
  })
  walkInlinesDeep(blocks, (item) => {
    if (item.kind === 'math') out.add(item.mathml)
  })
}
