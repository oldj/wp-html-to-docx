import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

async function getDocumentXml(html: string): Promise<string> {
  const u8 = await htmlToDocx(html)
  const files = unzipSync(u8)
  const xml = files['word/document.xml']
  if (xml === undefined) throw new Error('document.xml missing')
  return strFromU8(xml)
}

describe('builder XML - table', () => {
  it('table 产出 <w:tbl>', async () => {
    const xml = await getDocumentXml('<table><tr><td>x</td></tr></table>')
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('<w:tr')
    expect(xml).toContain('<w:tc>')
  })

  it('thead 行带 shading 与 tblHeader', async () => {
    const xml = await getDocumentXml(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>',
    )
    // 表头行渲染为 tblHeader
    expect(xml).toContain('<w:tblHeader')
    // 表头 cell 含填充色（EFEFEF）
    expect(xml).toMatch(/w:fill="EFEFEF"/i)
  })

  it('colspan 产出 gridSpan', async () => {
    const xml = await getDocumentXml('<table><tr><td colspan="2">x</td></tr></table>')
    expect(xml).toMatch(/<w:gridSpan[^>]*w:val="2"/)
  })

  it('单元格内嵌套列表 → numPr', async () => {
    const xml = await getDocumentXml(
      '<table><tr><td><ul><li>a</li></ul></td></tr></table>',
    )
    expect(xml).toContain('<w:numPr>')
  })
})
