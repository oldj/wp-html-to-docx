// 块级元素文本样式下发与对齐兼容（端到端断言 document.xml）
//
// 覆盖：
// - p / h* / li 自身 style 的 color / font-size 等下发给段内文本
// - div 等未知容器的样式沿「单链继承」传递给内层块
// - HTML4 遗留属性 align="..."（CSS text-align 优先）
// - th 默认加粗居中、td 的对齐下推

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

describe('块级元素 inline style 下发', () => {
  it('p 的 color / font-size 作用于段内文本', async () => {
    const xml = await getDocumentXml('<p style="color: red; font-size: 16px">hello</p>')
    expect(xml).toContain('<w:color w:val="FF0000"/>')
    // 16px = 12pt = 24 半磅
    expect(xml).toMatch(/<w:sz w:val="24"\/>/)
  })

  it('内层标签样式叠加在块级样式之上（span 覆盖 color）', async () => {
    const xml = await getDocumentXml(
      '<p style="color: red">a<span style="color: blue">b</span></p>',
    )
    expect(xml).toContain('<w:color w:val="FF0000"/>')
    expect(xml).toContain('<w:color w:val="0000FF"/>')
  })

  it('heading 的样式下发给标题文本', async () => {
    const xml = await getDocumentXml('<h2 style="color: #336699">title</h2>')
    expect(xml).toContain('<w:color w:val="336699"/>')
  })

  it('li 的样式下发给列表项文本', async () => {
    const xml = await getDocumentXml('<ul><li style="color: green">item</li></ul>')
    expect(xml).toContain('<w:color w:val="008000"/>')
  })

  it('div 容器样式沿继承链传给内层 p（单链继承）', async () => {
    const xml = await getDocumentXml('<div style="color: #abcdef"><p>inherited</p></div>')
    expect(xml).toContain('<w:color w:val="ABCDEF"/>')
  })

  it('blockquote 样式传给内部段落', async () => {
    const xml = await getDocumentXml(
      '<blockquote style="color: #112233"><p>quoted</p></blockquote>',
    )
    expect(xml).toContain('<w:color w:val="112233"/>')
  })

  it('无 style 时不产生多余的 run 属性（行为不变）', async () => {
    const xml = await getDocumentXml('<p>plain</p>')
    expect(xml).not.toContain('<w:color')
  })
})

describe('HTML4 align 属性兼容', () => {
  it('<p align="center"> 产生居中', async () => {
    const xml = await getDocumentXml('<p align="center">x</p>')
    expect(xml).toContain('<w:jc w:val="center"/>')
  })

  it('<h1 align="right"> 产生右对齐', async () => {
    const xml = await getDocumentXml('<h1 align="right">t</h1>')
    expect(xml).toContain('<w:jc w:val="right"/>')
  })

  it('CSS text-align 优先于 align 属性（与浏览器一致）', async () => {
    const xml = await getDocumentXml('<p align="center" style="text-align: right">x</p>')
    expect(xml).toContain('<w:jc w:val="right"/>')
    expect(xml).not.toContain('<w:jc w:val="center"/>')
  })

  it('非法 align 值被忽略', async () => {
    const xml = await getDocumentXml('<p align="middle">x</p>')
    expect(xml).not.toContain('<w:jc')
  })
})

describe('表格单元格：th 默认样式与对齐下推', () => {
  /** 取指定文本所在段落的 XML 片段（从所属 <w:p> 开始到文本出现处） */
  function paraOf(xml: string, marker: string): string {
    const at = xml.indexOf(`>${marker}<`)
    if (at < 0) throw new Error(`marker "${marker}" not found`)
    return xml.slice(xml.lastIndexOf('<w:p>', at), at)
  }

  it('th 文本默认加粗 + 居中（与浏览器渲染一致）', async () => {
    const xml = await getDocumentXml(
      '<table><tr><th>HCell</th></tr><tr><td>BCell</td></tr></table>',
    )
    const th = paraOf(xml, 'HCell')
    expect(th).toContain('<w:b/>')
    expect(th).toContain('<w:jc w:val="center"/>')
    const td = paraOf(xml, 'BCell')
    expect(td).not.toContain('<w:b/>')
    expect(td).not.toContain('<w:jc')
  })

  it('th 显式 text-align 覆盖默认居中', async () => {
    const xml = await getDocumentXml(
      '<table><tr><th style="text-align: left">HCell</th></tr></table>',
    )
    const th = paraOf(xml, 'HCell')
    expect(th).toContain('<w:jc w:val="left"/>')
    expect(th).not.toContain('<w:jc w:val="center"/>')
  })

  it('td 的 text-align 下推到单元格内段落', async () => {
    const xml = await getDocumentXml(
      '<table><tr><td style="text-align: right">42</td></tr></table>',
    )
    expect(paraOf(xml, '42')).toContain('<w:jc w:val="right"/>')
  })

  it('td 的 HTML4 align 属性同样下推', async () => {
    const xml = await getDocumentXml('<table><tr><td align="center">42</td></tr></table>')
    expect(paraOf(xml, '42')).toContain('<w:jc w:val="center"/>')
  })

  it('td 内段落自身的 text-align 优先于单元格对齐', async () => {
    const xml = await getDocumentXml(
      '<table><tr><td style="text-align: right"><p style="text-align: left">x</p></td></tr></table>',
    )
    expect(paraOf(xml, 'x')).toContain('<w:jc w:val="left"/>')
  })

  it('td 的文本样式（color）经 walkBlocks 传给裸文本内容', async () => {
    const xml = await getDocumentXml('<table><tr><td style="color: red">cell</td></tr></table>')
    expect(paraOf(xml, 'cell')).toContain('<w:color w:val="FF0000"/>')
  })
})
