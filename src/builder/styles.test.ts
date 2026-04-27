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
  it('title / creator / description 都出现在 core.xml 且匹配 dc: 命名空间', async () => {
    const u8 = await htmlToDocx('<p>x</p>', {
      title: 'My Title',
      creator: 'Alice',
      description: 'A test document.',
    })
    const files = unzipSync(u8)
    const coreXml = files['docProps/core.xml']
    expect(coreXml).toBeDefined()
    const xml = strFromU8(coreXml as Uint8Array)
    // 强断言到 OOXML 元素而非纯字符串包含，防御「字段写到错误位置但字符串恰好出现」
    expect(xml).toMatch(/<dc:title>My Title<\/dc:title>/)
    expect(xml).toMatch(/<dc:creator>Alice<\/dc:creator>/)
    expect(xml).toMatch(/<dc:description>A test document\.<\/dc:description>/)
  })

  it('subject / keywords / lastModifiedBy 也透传到 core.xml', async () => {
    // 防回归：除已有 3 个字段外，docx 还支持的 subject / keywords / lastModifiedBy 三项也应被透传
    const u8 = await htmlToDocx('<p>x</p>', {
      subject: 'Quarterly Report',
      keywords: 'finance, q4, 2026',
      lastModifiedBy: 'Bob',
    })
    const files = unzipSync(u8)
    const xml = strFromU8(files['docProps/core.xml'] as Uint8Array)
    expect(xml).toMatch(/<dc:subject>Quarterly Report<\/dc:subject>/)
    expect(xml).toMatch(/<cp:keywords>finance, q4, 2026<\/cp:keywords>/)
    expect(xml).toMatch(/<cp:lastModifiedBy>Bob<\/cp:lastModifiedBy>/)
  })
  // 「未配置时不抛错」用例已删除：docx 总是写 core.xml，仅 toBeDefined 永远成立，
  // 不能反映任何意图；其他用例隐式覆盖了「不传 metadata 也能正常构建文档」
})
