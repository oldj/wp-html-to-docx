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
