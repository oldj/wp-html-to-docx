import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

/** 解压生成的 docx，取出正文与脚注两个部件（footnotes.xml 可能缺席） */
async function getParts(html: string): Promise<{ doc: string; footnotes: string | undefined }> {
  const u8 = await htmlToDocx(html)
  const files = unzipSync(u8)
  const docBytes = files['word/document.xml']
  if (docBytes === undefined) throw new Error('word/document.xml not found in output')
  const fnBytes = files['word/footnotes.xml']
  return { doc: strFromU8(docBytes), footnotes: fnBytes ? strFromU8(fnBytes) : undefined }
}

// 用户给出的真实 WonderPen 脚注结构
const WP_HTML = `<div class="markdown-body">
<p>脚注测试<sup class="wp-footnote-ref" id="fnref-1"><a href="#fn-1">[1]</a></sup>正文</p>
<div class="footnotes"><hr><ol><li id="fn-1">内容内容<br>换行后的内容 <a href="#fnref-1" class="footnote-backref">↩</a></li></ol></div>
</div>`

describe('脚注 - docx 原生页面底部脚注', () => {
  it('正文产生 footnoteReference 引用', async () => {
    const { doc } = await getParts(WP_HTML)
    expect(doc).toContain('<w:footnoteReference w:id="1"/>')
  })

  it('脚注内容写入 footnotes.xml，含软换行 <w:br/>', async () => {
    const { footnotes } = await getParts(WP_HTML)
    expect(footnotes).toBeDefined()
    expect(footnotes).toContain('内容内容')
    expect(footnotes).toContain('换行后的内容')
    expect(footnotes).toContain('<w:br/>')
  })

  it('定义容器不在正文渲染（内容不入 body、占位文本 [1] 被丢弃）', async () => {
    const { doc } = await getParts(WP_HTML)
    expect(doc).not.toContain('内容内容')
    expect(doc).not.toContain('[1]')
  })

  it('回跳箭头被剥离（footnotes.xml 不含 ↩ 与 fnref 链接）', async () => {
    const { footnotes } = await getParts(WP_HTML)
    expect(footnotes).not.toContain('↩')
    expect(footnotes).not.toContain('fnref')
  })

  it('多个脚注按定义顺序编号', async () => {
    const html =
      '<p>a<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup>' +
      'b<sup class="wp-footnote-ref"><a href="#fn-2">[2]</a></sup></p>' +
      '<div class="footnotes"><ol><li id="fn-1">first</li><li id="fn-2">second</li></ol></div>'
    const { doc, footnotes } = await getParts(html)
    expect(doc).toContain('<w:footnoteReference w:id="1"/>')
    expect(doc).toContain('<w:footnoteReference w:id="2"/>')
    expect(footnotes).toContain('first')
    expect(footnotes).toContain('second')
  })

  it('兼容 markdown-it 风格（footnote-ref / section.footnotes）', async () => {
    const html =
      '<p>x<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup></p>' +
      '<section class="footnotes"><ol class="footnotes-list">' +
      '<li id="fn1" class="footnote-item"><p>md note ' +
      '<a href="#fnref1" class="footnote-backref">↩︎</a></p></li></ol></section>'
    const { doc, footnotes } = await getParts(html)
    expect(doc).toContain('<w:footnoteReference w:id="1"/>')
    expect(footnotes).toContain('md note')
    expect(footnotes).not.toContain('↩')
  })

  it('引用了不存在的脚注：不产生引用，不崩溃', async () => {
    const { doc } = await getParts(
      '<p>x<sup class="wp-footnote-ref"><a href="#fn-404">[1]</a></sup>y</p>',
    )
    expect(doc).not.toContain('<w:footnoteReference')
    expect(doc).toContain('x')
    expect(doc).toContain('y')
  })

  it('普通 <sup>（无脚注 class）不被当成脚注', async () => {
    const { doc } = await getParts('<p>E=mc<sup>2</sup></p>')
    expect(doc).not.toContain('footnoteReference')
    expect(doc).toContain('2')
  })

  it('脚注定义容器嵌在 <li> 内：注册不受影响，但内容不在正文重复渲染', async () => {
    // 边缘结构：脚注定义容器被包进 <li>。collectFootnoteDefs 全递归注册不受影响，
    // 但正文走查若把 li 内的 div.footnotes 当普通块拍扁，脚注内容会作为列表项重复出现。
    const html =
      '<p>正文<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup></p>' +
      '<ul><li>列表项<div class="footnotes"><ol><li id="fn-1">脚注定义内容</li></ol></div></li></ul>'
    const { doc, footnotes } = await getParts(html)
    // 引用仍正常解析为 docx 脚注
    expect(doc).toContain('<w:footnoteReference')
    // 列表项自身内容保留
    expect(doc).toContain('列表项')
    // 关键：脚注内容只进 footnotes.xml，不作为正文（列表项）渲染
    expect(doc).not.toContain('脚注定义内容')
    expect(footnotes).toContain('脚注定义内容')
  })
})
