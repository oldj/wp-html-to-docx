import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

/** 把生成的 docx 二进制解压并取出 word/document.xml */
async function getDocumentXml(html: string): Promise<string> {
  const u8 = await htmlToDocx(html)
  const files = unzipSync(u8)
  const xmlBytes = files['word/document.xml']
  if (xmlBytes === undefined) throw new Error('word/document.xml not found in output')
  return strFromU8(xmlBytes)
}

describe('builder XML 断言 - 文本块', () => {
  it('paragraph 产生 <w:p> 与文本', async () => {
    const xml = await getDocumentXml('<p>hello</p>')
    expect(xml).toContain('<w:p')
    expect(xml).toContain('hello')
  })

  it('heading 1 标记为 Heading1 style', async () => {
    const xml = await getDocumentXml('<h1>title</h1>')
    expect(xml).toContain('Heading1')
    expect(xml).toContain('title')
  })

  it('strong 产生 <w:b/>', async () => {
    const xml = await getDocumentXml('<p><strong>x</strong></p>')
    expect(xml).toMatch(/<w:b\s*\/>|<w:b\s/)
  })

  it('em 产生 <w:i/>', async () => {
    const xml = await getDocumentXml('<p><em>x</em></p>')
    expect(xml).toMatch(/<w:i\s*\/>|<w:i\s/)
  })

  it('u 产生 <w:u', async () => {
    const xml = await getDocumentXml('<p><u>x</u></p>')
    expect(xml).toContain('<w:u')
  })

  it('s 产生 <w:strike', async () => {
    const xml = await getDocumentXml('<p><s>x</s></p>')
    expect(xml).toMatch(/<w:strike\s*\/>|<w:strike\s/)
  })

  it('a 产生 hyperlink 关系', async () => {
    const xml = await getDocumentXml('<p><a href="https://example.com">link</a></p>')
    expect(xml).toContain('w:hyperlink')
    expect(xml).toContain('link')
  })

  it('br 产生 <w:br/>', async () => {
    const xml = await getDocumentXml('<p>a<br/>b</p>')
    expect(xml).toMatch(/<w:br\s*\/>|<w:br\s/)
  })
})

describe('builder XML 断言 - 列表内软换行', () => {
  it('li 内多 <p>：合并为单段，段间产生 <w:br/>，编号仅出现一次', async () => {
    const xml = await getDocumentXml(
      '<ol><li><p>first</p><p>second</p></li><li><p>third</p></li></ol>',
    )
    // numPr 段（带编号的列表项）共 2 个：每个 <li> 一个
    const numPrMatches = xml.match(/<w:numPr>/g) ?? []
    expect(numPrMatches.length).toBe(2)
    // 第一个 li 内部出现至少一个软换行 <w:br/>（区分于 <w:br w:type="page"/>）
    expect(xml).toMatch(/<w:br\s*\/>|<w:br(?![^>]*w:type)/)
    expect(xml).toContain('first')
    expect(xml).toContain('second')
    expect(xml).toContain('third')
  })

  it('li 内裸文本 + <p>：仍是单段 list-item，含软换行', async () => {
    const xml = await getDocumentXml('<ul><li>foo<p>bar</p></li></ul>')
    const numPrMatches = xml.match(/<w:numPr>/g) ?? []
    expect(numPrMatches.length).toBe(1)
    expect(xml).toMatch(/<w:br\s*\/>|<w:br(?![^>]*w:type)/)
    expect(xml).toContain('foo')
    expect(xml).toContain('bar')
  })

  it('li 内 <table>：端到端真正产生 <w:tbl>，且外层 list 编号正常', async () => {
    // 防回归：曾经 li 内 <table> 被错误当作 phrasing 容器拍扁，整个表格结构丢失
    const xml = await getDocumentXml(
      '<ol><li><table><tr><td>cell</td></tr></table></li><li>next</li></ol>',
    )
    expect(xml).toContain('<w:tbl')
    expect(xml).toContain('cell')
    expect(xml).toContain('next')
    // 两个 li 都应当带 numbering（外层空占位 + 第二项）
    const numPrMatches = xml.match(/<w:numPr>/g) ?? []
    expect(numPrMatches.length).toBe(2)
  })
})

describe('builder XML 断言 - blockquote 视觉一致性', () => {
  it('blockquote 内 heading：仍带左缩进 + 左边线灰条', async () => {
    // 防回归：曾经 <blockquote><h2/></blockquote> 标题被走 appendBlock，丢失引用块视觉
    const xml = await getDocumentXml('<blockquote><h2>title</h2><p>body</p></blockquote>')
    // 标题段落带 Heading2 + 左缩进 720
    expect(xml).toContain('Heading2')
    // 至少存在两段都带 left=720 缩进与 CCCCCC 左边线
    const indentMatches = xml.match(/<w:ind[^>]*w:left="720"/g) ?? []
    expect(indentMatches.length).toBeGreaterThanOrEqual(2)
    expect(xml).toMatch(/<w:left[^>]*w:color="CCCCCC"/)
  })

  it('blockquote 内 pre：每行段落都带引用视觉', async () => {
    const xml = await getDocumentXml('<blockquote><pre>a\nb</pre></blockquote>')
    // pre 拆出 2 行 → 至少 2 段带 left=720
    const indentMatches = xml.match(/<w:ind[^>]*w:left="720"/g) ?? []
    expect(indentMatches.length).toBeGreaterThanOrEqual(2)
    expect(xml).toContain('Consolas')
  })
})
