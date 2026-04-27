// 进阶 B：内联 style 属性 → docx 端到端断言
// 都通过解开 docx zip → 读 word/document.xml → 字符串匹配的方式断言关键属性

import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

async function getDocXml(html: string): Promise<string> {
  const u8 = await htmlToDocx(html)
  const files = unzipSync(u8)
  const xml = files['word/document.xml']
  if (xml === undefined) throw new Error('document.xml missing')
  return strFromU8(xml)
}

describe('inline style → TextRun.color', () => {
  it('span 的 color 出现在 w:color', async () => {
    const xml = await getDocXml('<p>hello <span style="color: red">world</span></p>')
    expect(xml).toMatch(/<w:color[^>]*w:val="FF0000"/)
  })

  it('短 hex 被规范化为 6 位大写', async () => {
    const xml = await getDocXml('<p><span style="color: #abc">x</span></p>')
    expect(xml).toMatch(/<w:color[^>]*w:val="AABBCC"/)
  })
})

describe('inline style → 背景填充 (shading)', () => {
  it('background-color → w:shd fill，用 clear 模式以保留 fill 颜色', async () => {
    const xml = await getDocXml(
      '<p><span style="background-color: yellow">hi</span></p>',
    )
    expect(xml).toMatch(/<w:shd[^>]*w:val="clear"/)
    expect(xml).toMatch(/<w:shd[^>]*w:fill="FFFF00"/)
  })

  it('background 简写：取首个颜色 token', async () => {
    const xml = await getDocXml('<p><span style="background: #00ff00 none">hi</span></p>')
    expect(xml).toMatch(/<w:shd[^>]*w:fill="00FF00"/)
  })
})

describe('inline style → font-size', () => {
  it('14pt → 半磅 28', async () => {
    const xml = await getDocXml('<p><span style="font-size: 14pt">x</span></p>')
    expect(xml).toMatch(/<w:sz[^>]*w:val="28"/)
  })

  it('12px → 半磅 18', async () => {
    const xml = await getDocXml('<p><span style="font-size: 12px">x</span></p>')
    expect(xml).toMatch(/<w:sz[^>]*w:val="18"/)
  })
})

describe('inline style → font-family / font-weight / font-style / text-decoration', () => {
  it('font-family 首项进入 w:rFonts', async () => {
    const xml = await getDocXml(
      '<p><span style="font-family: \'SimSun\', serif">汉</span></p>',
    )
    expect(xml).toMatch(/<w:rFonts[^>]*w:ascii="SimSun"/)
  })

  it('font-weight: 700 → 加粗', async () => {
    const xml = await getDocXml('<p><span style="font-weight: 700">x</span></p>')
    expect(xml).toMatch(/<w:b\s*\/>/)
  })

  it('font-style: italic → 斜体', async () => {
    const xml = await getDocXml('<p><span style="font-style: italic">x</span></p>')
    expect(xml).toMatch(/<w:i\s*\/>/)
  })

  it('text-decoration: underline line-through → 下划线 + 删除线', async () => {
    const xml = await getDocXml(
      '<p><span style="text-decoration: underline line-through">x</span></p>',
    )
    expect(xml).toMatch(/<w:u\s/)
    expect(xml).toMatch(/<w:strike\s*\/>/)
  })
})

describe('块级 text-align → Paragraph.alignment', () => {
  it('p 居中', async () => {
    const xml = await getDocXml('<p style="text-align: center">x</p>')
    expect(xml).toMatch(/<w:jc[^>]*w:val="center"/)
  })

  it('h2 居右', async () => {
    const xml = await getDocXml('<h2 style="text-align: right">x</h2>')
    expect(xml).toMatch(/<w:jc[^>]*w:val="right"/)
  })

  it('text-align: justify → both', async () => {
    const xml = await getDocXml('<p style="text-align: justify">x</p>')
    expect(xml).toMatch(/<w:jc[^>]*w:val="both"/)
  })

  it('未指定时不输出 w:jc', async () => {
    const xml = await getDocXml('<p>plain</p>')
    expect(xml).not.toMatch(/<w:jc/)
  })
})

describe('样式叠加：tag + inline style + 嵌套', () => {
  it('<strong style="color: red"> 同时加粗 + 染色', async () => {
    const xml = await getDocXml('<p><strong style="color: red">x</strong></p>')
    expect(xml).toMatch(/<w:b\s*\/>/)
    expect(xml).toMatch(/<w:color[^>]*w:val="FF0000"/)
  })

  it('父 span 的颜色与子 strong 的粗体合并', async () => {
    const xml = await getDocXml(
      '<p><span style="color: blue"><strong>x</strong></span></p>',
    )
    expect(xml).toMatch(/<w:b\s*\/>/)
    expect(xml).toMatch(/<w:color[^>]*w:val="0000FF"/)
  })
})

describe('合并相邻 run：颜色不同时不应合并', () => {
  it('两段同文不同色保留两个 run', async () => {
    const xml = await getDocXml(
      '<p><span style="color: red">a</span><span style="color: blue">b</span></p>',
    )
    // 两段独立颜色都出现
    expect(xml).toMatch(/w:val="FF0000"/)
    expect(xml).toMatch(/w:val="0000FF"/)
  })
})

describe('合并相邻 run：sameStyle 字段完整性回归', () => {
  // 守住一个回归边界：在 InlineStyle 加新字段时若忘了同步 sameStyle，
  // 相邻样式不同的 run 会被错误合并；这里对每个非显而易见的字段单独断言

  it('不同 fontSize 不应合并', async () => {
    const xml = await getDocXml(
      '<p><span style="font-size: 14pt">a</span><span style="font-size: 18pt">b</span></p>',
    )
    expect(xml).toMatch(/<w:sz[^>]*w:val="28"/)
    expect(xml).toMatch(/<w:sz[^>]*w:val="36"/)
  })

  it('不同 fontFamily 不应合并', async () => {
    const xml = await getDocXml(
      '<p><span style="font-family: Arial">a</span><span style="font-family: Courier">b</span></p>',
    )
    expect(xml).toMatch(/<w:rFonts[^>]*w:ascii="Arial"/)
    expect(xml).toMatch(/<w:rFonts[^>]*w:ascii="Courier"/)
  })

  it('不同 bgColor 不应合并', async () => {
    const xml = await getDocXml(
      '<p><span style="background-color: yellow">a</span><span style="background-color: red">b</span></p>',
    )
    expect(xml).toMatch(/<w:shd[^>]*w:fill="FFFF00"/)
    expect(xml).toMatch(/<w:shd[^>]*w:fill="FF0000"/)
  })
})

describe('设计断言：text-align 不做 cascade', () => {
  it('div 上的 text-align 不会传给子 p（只直接挂在 p/h/li 上才生效）', async () => {
    const xml = await getDocXml('<div style="text-align: center"><p>x</p></div>')
    // 段落不应输出 w:jc——cascade 走流的话 p 会被居中，我们明确不做
    expect(xml).not.toMatch(/<w:jc/)
  })

  it('p 自带 text-align 仍正常生效（与上一例对照）', async () => {
    const xml = await getDocXml('<p style="text-align: center">x</p>')
    expect(xml).toMatch(/<w:jc[^>]*w:val="center"/)
  })
})
