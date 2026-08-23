import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

/**
 * numbering.xml 里最后一个 abstractNum 的片段。
 * docx 库自己会在最前面注入一套默认的 bullet abstractNum（● ○ ■），不是我们注册的 reference；
 * 只传一个列表时，我们的定义就是最后那个 abstractNum。
 */
function lastAbstractNum(numbering: string | undefined): string {
  const parts = (numbering ?? '').split('<w:abstractNum ')
  return parts[parts.length - 1] ?? ''
}

/** 按出现顺序抓出 document.xml 里每个 numPr 的 (ilvl, numId) */
function numPrList(document: string): { ilvl?: string; numId?: string }[] {
  return [...document.matchAll(/<w:numPr>([\s\S]*?)<\/w:numPr>/g)].map((m) => ({
    ilvl: /<w:ilvl[^>]*w:val="(\d+)"/.exec(m[1] ?? '')?.[1],
    numId: /<w:numId[^>]*w:val="(\d+)"/.exec(m[1] ?? '')?.[1],
  }))
}

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
    const parsed = numPrList(document)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]?.ilvl).toBe('0')
    expect(parsed[1]?.ilvl).toBe('1')
    expect(parsed[0]?.numId).toBeDefined()
    expect(parsed[0]?.numId).toBe(parsed[1]?.numId)
  })

  it('同一个 li 内的相邻子列表：ilvl 相同但 numId 不同，第二个重新从 1 编号', async () => {
    // 同一个 (numId, ilvl) 上的第二个子列表，Word 会接着前一个编号（b. 而不是 a.）——
    // 重启只在上层编号递增时发生，而这两个子列表中间没有父项。断言在 numId 层面，
    // 只看 IR 结构不足以暴露这个问题
    const { document } = await getDocs('<ol><li>a<ol><li>b</li></ol><ol><li>c</li></ol></li></ol>')
    const parsed = numPrList(document)
    expect(parsed).toHaveLength(3)
    expect(parsed.map((p) => p.ilvl)).toEqual(['0', '1', '1'])
    expect(parsed[1]?.numId).toBe(parsed[0]?.numId)
    expect(parsed[2]?.numId).not.toBe(parsed[1]?.numId)
  })

  it('三层嵌套 ol：numbering.xml 依次是 decimal / lowerLetter / lowerRoman', async () => {
    const { numbering } = await getDocs('<ol><li>a<ol><li>b<ol><li>c</li></ol></li></ol></li></ol>')
    expect(numbering).toBeDefined()
    // 抓出我们那个 abstractNum 里前三层的 numFmt，顺序即层级
    const fmts = [...lastAbstractNum(numbering).matchAll(/<w:numFmt w:val="([^"]+)"/g)].map(
      (m) => m[1],
    )
    expect(fmts.slice(0, 3)).toEqual(['decimal', 'lowerLetter', 'lowerRoman'])
  })

  it('嵌套 ul：三层项目符号依次是 • ◦ ▪', async () => {
    const { numbering } = await getDocs('<ul><li>a</li></ul>')
    const texts = [...lastAbstractNum(numbering).matchAll(/<w:lvlText w:val="([^"]*)"/g)].map(
      (m) => m[1],
    )
    expect(texts.slice(0, 3)).toEqual(['•', '◦', '▪'])
  })

  it('data-list-style="upper-roman" + start="3"：numFmt 与 start 写进 numbering.xml', async () => {
    const { numbering } = await getDocs(
      '<ol start="3" data-list-style="upper-roman" style="list-style-type: upper-roman"><li>a</li></ol>',
    )
    expect(lastAbstractNum(numbering)).toMatch(
      /<w:start w:val="3"\/>[\s\S]*?<w:numFmt w:val="upperRoman"\/>/,
    )
  })

  it('ul 里的 ol：ilvl 按嵌套深度递增，而不是从 0 重新起算', async () => {
    const { document } = await getDocs('<ul><li>a<ol><li>b</li></ol></li></ul>')
    const ilvls = [...document.matchAll(/<w:ilvl[^>]*w:val="(\d+)"/g)].map((m) => m[1])
    expect(ilvls).toEqual(['0', '1'])
  })

  it('options.listLevels 写进 numbering.xml：顶层 chineseCounting，第二层 decimal', async () => {
    const u8 = await htmlToDocx('<ol><li>a<ol><li>b</li></ol></li></ol>', {
      listLevels: { ordered: ['simp-chinese-informal', 'decimal'] },
    })
    const numbering = strFromU8(unzipSync(u8)['word/numbering.xml']!)
    const fmts = [...lastAbstractNum(numbering).matchAll(/<w:numFmt w:val="([^"]+)"/g)].map(
      (m) => m[1],
    )
    expect(fmts.slice(0, 2)).toEqual(['chineseCounting', 'decimal'])
    expect(lastAbstractNum(numbering)).toContain('<w:lvlText w:val="%1、"/>')
  })

  it('list-continuation 渲染：嵌套列表之后的文本成独立段，带缩进、无编号', async () => {
    const { document } = await getDocs('<ul><li>head<ul><li>nested</li></ul>tail text</li></ul>')
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
