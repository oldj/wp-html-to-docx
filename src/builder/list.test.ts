import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

async function getDocs(html: string): Promise<{ document: string; numbering?: string }> {
  const u8 = await htmlToDocx(html)
  const files = unzipSync(u8)
  const doc = files['word/document.xml']
  if (doc === undefined) throw new Error('document.xml missing')
  const numbering = files['word/numbering.xml']
  return {
    document: strFromU8(doc),
    numbering: numbering ? strFromU8(numbering) : undefined,
  }
}

describe('builder XML - 列表', () => {
  it('ul 产出 numPr + numbering.xml 含 bullet', async () => {
    const { document, numbering } = await getDocs('<ul><li>a</li><li>b</li></ul>')
    expect(document).toContain('<w:numPr>')
    expect(numbering).toBeDefined()
    // bullet 格式
    expect(numbering).toMatch(/w:val="bullet"/)
  })

  it('ol 产出 decimal numbering', async () => {
    const { numbering } = await getDocs('<ol><li>a</li><li>b</li></ol>')
    expect(numbering).toMatch(/w:val="decimal"/)
  })

  it('嵌套 ul：两个 li 引用同一 numId，ilvl 0 与 1', async () => {
    const { document } = await getDocs('<ul><li>a<ul><li>b</li></ul></li></ul>')
    // 抓出每个 numPr 块里的 numId 与 ilvl，要求两层共享同一个 numId
    // 这才能反映「嵌套同类型 list 复用 reference」的真实意图——只看 ilvl 0/1 都出现
    // 的旧断言在新建第二个 reference 但碰巧两层 ilvl 不同的实现下也会通过
    const numPrBlocks = [...document.matchAll(/<w:numPr>([\s\S]*?)<\/w:numPr>/g)].map(
      (m) => m[1] ?? '',
    )
    expect(numPrBlocks).toHaveLength(2)
    const parsed = numPrBlocks.map((b) => ({
      ilvl: /<w:ilvl[^>]*w:val="(\d+)"/.exec(b)?.[1],
      numId: /<w:numId[^>]*w:val="(\d+)"/.exec(b)?.[1],
    }))
    expect(parsed[0]?.ilvl).toBe('0')
    expect(parsed[1]?.ilvl).toBe('1')
    expect(parsed[0]?.numId).toBeDefined()
    expect(parsed[0]?.numId).toBe(parsed[1]?.numId)
  })

  it('list-continuation 渲染：嵌套列表之后的文本成独立段，带缩进、无编号', async () => {
    const { document } = await getDocs(
      '<ul><li>head<ul><li>nested</li></ul>tail text</li></ul>',
    )
    // tail text 段：缩进对齐到 list 文本起点（720 * (level+1)），但不带 numPr
    const at = document.indexOf('tail text')
    expect(at).toBeGreaterThan(-1)
    const para = document.slice(document.lastIndexOf('<w:p>', at), at)
    expect(para).toMatch(/<w:ind[^>]*w:left="720"/)
    expect(para).not.toContain('<w:numPr>')
  })
})

describe('builder XML - blockquote / hr / pre', () => {
  it('blockquote 段落带左缩进', async () => {
    const { document } = await getDocs('<blockquote><p>x</p></blockquote>')
    expect(document).toMatch(/<w:ind[^>]*w:left="720"/)
  })

  it('hr 段落底部 border', async () => {
    const { document } = await getDocs('<hr/>')
    expect(document).toContain('<w:pBdr>')
    expect(document).toMatch(/<w:bottom[^>]*w:val="single"/)
  })

  it('pre 使用 Consolas 字体', async () => {
    const { document } = await getDocs('<pre>code</pre>')
    expect(document).toMatch(/Consolas/)
  })

  it('pre 多行内容拆为多个独立 paragraph', async () => {
    // preToParagraphs 按 \n 切行，每行各成段；首尾的 \n 被裁掉
    const { document } = await getDocs('<pre>line 1\nline 2\nline 3</pre>')
    const body = document.match(/<w:body>([\s\S]*?)<w:sectPr/)?.[1] ?? ''
    const paragraphCount = (body.match(/<w:p\b/g) ?? []).length
    expect(paragraphCount).toBe(3)
    expect(body).toContain('line 1')
    expect(body).toContain('line 2')
    expect(body).toContain('line 3')
  })
})
