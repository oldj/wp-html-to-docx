// 分页：<hr class="page-break"> / <page-break> / CSS page-break-* 三种触发器
// docx 的分页符 OOXML 形式为 <w:br w:type="page"/>，是 PageBreak run 的固有产物

import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

async function getDocXml(html: string): Promise<string> {
  const u8 = await htmlToDocx(html)
  const xml = strFromU8(unzipSync(u8)['word/document.xml']!)
  return xml
}

const PAGE_BREAK_RE = /<w:br[^/>]*w:type="page"\s*\/?\s*>/g

function countPageBreaks(xml: string): number {
  return (xml.match(PAGE_BREAK_RE) ?? []).length
}

describe('<hr class="page-break"> 替代横线为分页', () => {
  it('单独使用 → 1 个分页，无横线段', async () => {
    const xml = await getDocXml('<p>before</p><hr class="page-break"><p>after</p>')
    expect(countPageBreaks(xml)).toBe(1)
    // 普通 hr 段会带下边框；分页应替代它，不应出现 hr 的 999999 边框色
    expect(xml).not.toMatch(/<w:bottom[^>]*w:color="999999"/)
  })

  it('class 列表里包含 page-break 也匹配（多 class 共存）', async () => {
    const xml = await getDocXml('<hr class="foo page-break bar">')
    expect(countPageBreaks(xml)).toBe(1)
  })

  it('普通 <hr> 仍画横线，不变成分页', async () => {
    const xml = await getDocXml('<hr>')
    expect(countPageBreaks(xml)).toBe(0)
    // 既有 hr 的下边框 999999 仍在
    expect(xml).toMatch(/<w:bottom[^>]*w:color="999999"/)
  })

  it('class 是 page-break-x 等近似名 不应匹配', async () => {
    const xml = await getDocXml('<hr class="page-break-x">')
    expect(countPageBreaks(xml)).toBe(0)
  })
})

describe('<page-break> 自定义标签', () => {
  it('开标签形式 <page-break>', async () => {
    const xml = await getDocXml('<p>a</p><page-break><p>b</p>')
    expect(countPageBreaks(xml)).toBe(1)
  })

  it('伪自闭合 <page-break/> 仍工作（parse5 把后续兄弟当子节点，不会丢失内容）', async () => {
    const xml = await getDocXml('<p>a</p><page-break/><p>b</p>')
    expect(countPageBreaks(xml)).toBe(1)
    // "b" 段落不应丢失
    expect(xml).toContain('b')
  })

  it('伪自闭合带空格 <page-break /> 也工作', async () => {
    const xml = await getDocXml('<p>a</p><page-break /><p>b</p>')
    expect(countPageBreaks(xml)).toBe(1)
    expect(xml).toContain('b')
  })

  it('显式闭合 <page-break></page-break>', async () => {
    const xml = await getDocXml('<p>a</p><page-break></page-break><p>b</p>')
    expect(countPageBreaks(xml)).toBe(1)
  })

  it('段内 <p>foo<page-break/>bar</p>：分页符在同段落内', async () => {
    const xml = await getDocXml('<p>foo<page-break/>bar</p>')
    expect(countPageBreaks(xml)).toBe(1)
    // foo 与 bar 都不丢
    expect(xml).toContain('foo')
    expect(xml).toContain('bar')
    // 整篇只有一个段落（因为是行内 page break，不切段）
    const body = xml.match(/<w:body>([\s\S]*?)<w:sectPr/)?.[1] ?? ''
    expect((body.match(/<w:p\b/g) ?? []).length).toBe(1)
  })
})

describe('CSS page-break-before / page-break-after 与 CSS3 break-before / break-after', () => {
  it('p style="page-break-before: always" → p 之前插一个分页', async () => {
    const xml = await getDocXml(
      '<p>before</p><p style="page-break-before: always">target</p>',
    )
    expect(countPageBreaks(xml)).toBe(1)
    expect(xml).toContain('target')
  })

  it('p style="page-break-after: always" → p 之后插一个分页', async () => {
    const xml = await getDocXml(
      '<p style="page-break-after: always">target</p><p>after</p>',
    )
    expect(countPageBreaks(xml)).toBe(1)
  })

  it('CSS3 break-before: page', async () => {
    const xml = await getDocXml('<h2 style="break-before: page">章节</h2>')
    expect(countPageBreaks(xml)).toBe(1)
  })

  it('before + after 同时声明：插 2 个分页', async () => {
    const xml = await getDocXml(
      '<p>x</p><p style="page-break-before: always; page-break-after: always">y</p><p>z</p>',
    )
    expect(countPageBreaks(xml)).toBe(2)
  })

  it('auto / avoid 不触发', async () => {
    const xml = await getDocXml(
      '<p style="page-break-before: auto; page-break-after: avoid">x</p>',
    )
    expect(countPageBreaks(xml)).toBe(0)
  })

  it('CSS 不只对 p 生效：ul / table / blockquote / h1 上同样触发', async () => {
    // walker 主循环统一处理，理论上对所有块级都该生效
    // 这一组用例守住「以后某次重构把 sides 检查移进个别 case 内部」会立即失败的边界
    const ul = await getDocXml(
      '<p>x</p><ul style="page-break-before: always"><li>a</li></ul>',
    )
    expect(countPageBreaks(ul)).toBe(1)

    const table = await getDocXml(
      '<table style="page-break-after: always"><tr><td>x</td></tr></table><p>y</p>',
    )
    expect(countPageBreaks(table)).toBe(1)

    const bq = await getDocXml(
      '<p>x</p><blockquote style="page-break-before: always"><p>y</p></blockquote>',
    )
    expect(countPageBreaks(bq)).toBe(1)

    const h1 = await getDocXml('<p>x</p><h1 style="break-before: page">章节</h1>')
    expect(countPageBreaks(h1)).toBe(1)
  })
})

describe('B1 回归：<page-break> 在 <li> 内不被丢弃', () => {
  it('list-item 内的 page-break 保留为段内 PageBreak run，文本不丢', async () => {
    const xml = await getDocXml('<ul><li>foo<page-break/>bar</li></ul>')
    expect(countPageBreaks(xml)).toBe(1)
    // foo 与 bar 都还在
    expect(xml).toContain('foo')
    expect(xml).toContain('bar')
    // 仅 1 个 list-item 段落
    const body = xml.match(/<w:body>([\s\S]*?)<w:sectPr/)?.[1] ?? ''
    expect((body.match(/<w:p\b/g) ?? []).length).toBe(1)
  })
})

describe('PageBreak 渲染为 <w:br w:type="page"/>', () => {
  it('OOXML 输出 w:type="page"', async () => {
    const xml = await getDocXml('<page-break>')
    expect(xml).toMatch(/<w:br[^/>]*w:type="page"/)
  })
})
