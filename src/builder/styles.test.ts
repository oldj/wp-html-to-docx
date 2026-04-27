import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

async function getStylesXml(html: string, opts = {}): Promise<string> {
  const u8 = await htmlToDocx(html, opts)
  const files = unzipSync(u8)
  const xml = files['word/styles.xml']
  if (xml === undefined) throw new Error('styles.xml missing')
  return strFromU8(xml)
}

describe('default styles - 字体与字号', () => {
  it('默认 Calibri 11pt（半磅 22）', async () => {
    const xml = await getStylesXml('<p>x</p>')
    expect(xml).toMatch(/<w:rFonts[^>]*w:ascii="Calibri"/)
    expect(xml).toMatch(/<w:sz[^>]*w:val="22"/)
  })

  it('自定义 defaultFont / defaultFontSize 生效', async () => {
    const xml = await getStylesXml('<p>x</p>', {
      defaultFont: 'SimSun',
      defaultFontSize: 28,
    })
    expect(xml).toMatch(/SimSun/)
    expect(xml).toMatch(/<w:sz[^>]*w:val="28"/)
  })
})
