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

  it('嵌套 ul：两个 li 引用同一 numId 但 ilvl 不同', async () => {
    const { document } = await getDocs('<ul><li>a<ul><li>b</li></ul></li></ul>')
    // 期望存在 ilvl 0 与 ilvl 1
    expect(document).toMatch(/<w:ilvl[^>]*w:val="0"/)
    expect(document).toMatch(/<w:ilvl[^>]*w:val="1"/)
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
