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

describe('Document metadata 写入 docProps/core.xml', () => {
  // 守住一个端到端：title / creator / description 透传给 docx Document → 生成器写入核心属性
  // 若 docx 库未来改了 metadata 字段名，会立即失败
  it('title / creator / description 都出现在 core.xml', async () => {
    const u8 = await htmlToDocx('<p>x</p>', {
      title: 'My Title',
      creator: 'Alice',
      description: 'A test document.',
    })
    const files = unzipSync(u8)
    const coreXml = files['docProps/core.xml']
    expect(coreXml).toBeDefined()
    const xml = strFromU8(coreXml as Uint8Array)
    expect(xml).toContain('My Title')
    expect(xml).toContain('Alice')
    expect(xml).toContain('A test document.')
  })
  // 「未配置时不抛错」用例已删除：docx 总是写 core.xml，仅 toBeDefined 永远成立，
  // 不能反映任何意图；其他用例隐式覆盖了「不传 metadata 也能正常构建文档」
})
