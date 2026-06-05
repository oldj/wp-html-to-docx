import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

/** 把生成的 docx 解压并取出 word/document.xml */
async function getDocumentXml(html: string): Promise<string> {
  const u8 = await htmlToDocx(html)
  const files = unzipSync(u8)
  const xmlBytes = files['word/document.xml']
  if (xmlBytes === undefined) throw new Error('word/document.xml not found in output')
  return strFromU8(xmlBytes)
}

describe('builder XML 断言 - 上标 / 下标', () => {
  it('<sup> 产生 <w:vertAlign w:val="superscript"/>', async () => {
    const xml = await getDocumentXml('<p>x<sup>2</sup></p>')
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>')
    expect(xml).toContain('2')
  })

  it('<sub> 产生 <w:vertAlign w:val="subscript"/>', async () => {
    const xml = await getDocumentXml('<p>H<sub>2</sub>O</p>')
    expect(xml).toContain('<w:vertAlign w:val="subscript"/>')
    expect(xml).toContain('2')
  })

  it('上下标嵌套（<sup><sub>）：上标优先，不产生 subscript', async () => {
    // 二者在 OOXML 中互斥，textRunFor 让 superScript 胜出、subScript 置假
    const xml = await getDocumentXml('<p><sup><sub>x</sub></sup></p>')
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>')
    expect(xml).not.toContain('<w:vertAlign w:val="subscript"/>')
  })

  it('回归：脚注引用 <sup class="wp-footnote-ref"> 仍走脚注路径，不当作普通上标', async () => {
    const xml = await getDocumentXml(
      '<p>ref<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup></p>' +
        '<div class="footnotes"><ol><li id="fn-1">note</li></ol></div>',
    )
    // 走脚注路径：产生 footnoteReference
    expect(xml).toContain('<w:footnoteReference')
    // 未被当成普通上标：占位文本 [1] 被丢弃，正文里也没有上标 vertAlign
    expect(xml).not.toContain('[1]')
    expect(xml).not.toContain('<w:vertAlign w:val="superscript"/>')
  })
})
