// 数学公式预转换：遍历 IR 把所有 math 节点（块级 + 行内）转成 Word 公式，key 为原始 MathML 字符串。
// 转换顺序：
// - 带 TeX 源码（KaTeX 等写入的 annotation）：先用 docx/math 的 latexToMath（工厂写入 ctx.mathLatex），
//   失败再用 mathml2omml（OMML 写入 ctx.mathOmml）。TeX 优先是因为 KaTeX 的 MathML 里，∫ / ∑ 等大型运算符
//   与其作用对象是平级兄弟，mathml2omml 照字面转出空主体（Word 显示虚线占位框），可伸缩括号也会丢；
//   从 TeX 转能还原这些结构。
// - 没有 TeX 源码：只能用 mathml2omml。
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
    if (tex !== undefined) {
      const make = await latexToMathFactory(tex, warn)
      if (make !== null) {
        ctx.mathLatex.set(mathml, make)
        continue
      }
    }
    // 带 TeX 源码的公式走到这里说明 TeX 转换已失败并告警过；此时 mathml2omml 只是额外的退路，
    // 它缺失不必再提示安装，免得只用 KaTeX 的调用方被反复提示安装 LGPL 依赖
    const omml = await mathmlToOmml(mathml, warn, { warnIfMissing: tex === undefined })
    if (omml !== null) ctx.mathOmml.set(mathml, omml)
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
