// 数学公式预转换：遍历 IR 把所有 math 节点（块级 + 行内）的 MathML 转成 OMML，
// 结果写入 ctx.mathOmml（key 为原始 MathML 字符串）。
// MathML 转换不可用（未装 mathml2omml / 转换失败）且公式带 TeX 源码时，改用 docx/math 的
// latexToMath 兜底，工厂写入 ctx.mathLatex。
//
// 设计与 imageCollector 对齐：把异步 IO（动态 import + 转换）集中在 build 阶段，
// 渲染层（runs / blocks）保持同步。
//
// 同一段 MathML 多处出现时只转一次（Map 自带去重）。

import type { Block } from '../types.js'
import type { BuildContext } from './buildContext.js'
import { mathmlToOmml } from '../math/mml2omml.js'
import { latexToMathFactory } from '../math/latex.js'
import { makeWarn } from '../utils/log.js'
import { walkBlocksDeep, walkInlinesDeep } from './walkIr.js'

export async function collectMath(ir: Block[], ctx: BuildContext): Promise<void> {
  // MathML 原文 → TeX 源码（无则 undefined）。TeX 来自 MathML 内的 annotation，同一原文必然同一 TeX
  const sources = new Map<string, string | undefined>()
  collectSources(ir, sources)
  // 脚注内容不在主 IR 中（已提升到 ctx.footnotes），渲染期同样查 ctx.mathOmml，必须一并转换
  for (const fn of ctx.footnotes.values()) collectSources(fn.blocks, sources)
  if (sources.size === 0) return
  const warn = makeWarn(ctx.options.logger)
  for (const [mathml, tex] of sources) {
    if (ctx.mathOmml.has(mathml) || ctx.mathLatex.has(mathml)) continue
    // 带 TeX 源码的公式缺 MathML 转换器时不必告警：下面的 latexToMath 兜底会接手
    const omml = await mathmlToOmml(mathml, warn, { warnIfMissing: tex === undefined })
    if (omml !== null) {
      ctx.mathOmml.set(mathml, omml)
      continue
    }
    if (tex === undefined) continue
    const make = await latexToMathFactory(tex, warn)
    if (make !== null) ctx.mathLatex.set(mathml, make)
  }
}

function collectSources(blocks: Block[], out: Map<string, string | undefined>): void {
  // 块级 <math display="block"> 在 Block 层，行内 <math> 在 Inline 层，两层都要收
  walkBlocksDeep(blocks, (block) => {
    if (block.kind === 'math') out.set(block.mathml, block.tex)
  })
  walkInlinesDeep(blocks, (item) => {
    if (item.kind === 'math') out.set(item.mathml, item.tex)
  })
}
