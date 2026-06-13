// mathCollector：把 IR 中的 MathML 异步转 OMML 写入 ctx.mathOmml
//
// 关键不变量是「同一段 MathML 多次出现只转换一次 / Map 自带去重」，本文件直接
// 在 IR 层断言 ctx.mathOmml.size，避免在 builder 层只能间接看 OMML 出现次数

import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren } from '../parser/parseHtml.js'
import { BuildContext } from './buildContext.js'
import { buildIr } from './buildIr.js'
import { collectMath } from './mathCollector.js'

async function run(html: string): Promise<BuildContext> {
  const ctx = new BuildContext({})
  const ir = buildIr(parseHtmlBodyChildren(html), ctx)
  await collectMath(ir, ctx)
  return ctx
}

describe('collectMath - 转换与去重', () => {
  it('单段 MathML：ctx.mathOmml 落入 1 项，对应 OMML', async () => {
    const ctx = await run('<p><math><mn>1</mn></math></p>')
    expect(ctx.mathOmml.size).toBe(1)
    const [omml] = [...ctx.mathOmml.values()]
    expect(omml).toContain('<m:oMath')
  })

  it('两段相同 MathML：转换只跑一次，ctx.mathOmml.size 仍为 1', async () => {
    // 这是「去重」的真正断言：构造两次出现同一 MathML，期望 ctx 只缓存一项
    const same = '<math><mn>7</mn></math>'
    const ctx = await run(`<p>${same}</p><p>${same}</p>`)
    expect(ctx.mathOmml.size).toBe(1)
  })

  it('两段不同 MathML：ctx.mathOmml.size = 2', async () => {
    const ctx = await run('<p><math><mn>1</mn></math></p><p><math><mn>2</mn></math></p>')
    expect(ctx.mathOmml.size).toBe(2)
  })

  it('块级 + 行内混合：两者都收进 ctx.mathOmml', async () => {
    const ctx = await run(
      '<math display="block"><mn>1</mn></math><p>see <math><mn>2</mn></math></p>',
    )
    expect(ctx.mathOmml.size).toBe(2)
  })

  it('IR 中无 math：ctx.mathOmml 保持空（不需要触发懒加载）', async () => {
    const ctx = await run('<p>hello</p>')
    expect(ctx.mathOmml.size).toBe(0)
  })

  it('list-continuation 中的行内 math 也被转换（嵌套列表之后的内容）', async () => {
    // 此前遍历漏掉 list-continuation 块型，其中的公式渲染期退化为 [math] 占位
    const ctx = await run(
      '<ul><li>head<ul><li>nested</li></ul>tail <math><mn>5</mn></math></li></ul>',
    )
    expect(ctx.mathOmml.size).toBe(1)
  })

  it('脚注内容中的 math 也被转换（ctx.footnotes 的 blocks）', async () => {
    const ctx = await run(
      '<p>x<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup></p>' +
        '<div class="footnotes"><ol><li id="fn-1">note <math><mi>y</mi></math></li></ol></div>',
    )
    expect(ctx.mathOmml.size).toBe(1)
  })
})
