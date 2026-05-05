import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'
import type { HtmlToDocxOptions } from '../options.js'

/** 把生成的 docx 二进制解压并取出 word/document.xml */
async function getDocumentXml(html: string, options?: HtmlToDocxOptions): Promise<string> {
  const u8 = await htmlToDocx(html, options)
  const files = unzipSync(u8)
  const xmlBytes = files['word/document.xml']
  if (xmlBytes === undefined) throw new Error('word/document.xml not found in output')
  return strFromU8(xmlBytes)
}

/** 从单元格内边距块 <w:tblCellMar><w:top.../>...</w:tblCellMar> 中取各边的 dxa 值 */
function extractCellMar(xml: string): {
  top?: number
  right?: number
  bottom?: number
  left?: number
} {
  const block = xml.match(/<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/)?.[0] ?? ''
  const get = (side: string): number | undefined => {
    const m = block.match(new RegExp(`<w:${side}\\s[^>]*w:w="(\\d+)"`))
    return m?.[1] !== undefined ? parseInt(m[1], 10) : undefined
  }
  return { top: get('top'), right: get('right'), bottom: get('bottom'), left: get('left') }
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

  it('li 内 <table> 跟随列表缩进：产出 <w:tblInd w:w="720">，且 tblW 切到 auto 避免右溢出', async () => {
    const xml = await getDocumentXml('<ul><li><table><tr><td>x</td></tr></table></li></ul>')
    // 属性顺序由 docx 库决定，分别断言两个属性各自存在
    const tblIndMatch = xml.match(/<w:tblInd\s[^/>]*\/>/)?.[0] ?? ''
    expect(tblIndMatch).toContain('w:w="720"')
    expect(tblIndMatch).toContain('w:type="dxa"')
    // 切到 auto 宽：不应再出现 100% pct
    expect(xml).not.toMatch(/<w:tblW[^>]*w:w="100%"/)
    expect(xml).toMatch(/<w:tblW[^>]*w:type="auto"/)
  })

  it('顶层 <table>（不在 list 内）维持 100% pct 宽且无 tblInd', async () => {
    const xml = await getDocumentXml('<table><tr><td>x</td></tr></table>')
    expect(xml).toMatch(/<w:tblW[^>]*w:type="pct"[^>]*w:w="100%"/)
    expect(xml).not.toMatch(/<w:tblInd/)
  })

  it('li 内 <pre> 与 <hr>：段落带 w:left=720 缩进', async () => {
    const xml = await getDocumentXml('<ul><li><pre>code</pre><hr></li></ul>')
    // 至少两段带 left=720（pre 一行 + hr 段）
    const indentMatches = xml.match(/<w:ind[^>]*w:left="720"/g) ?? []
    expect(indentMatches.length).toBeGreaterThanOrEqual(2)
  })

  it('li 内 <blockquote>：缩进叠加（720 自带 + 720 list = 1440）', async () => {
    const xml = await getDocumentXml('<ul><li><blockquote><p>q</p></blockquote></li></ul>')
    // 段落带 left=1440 + 灰边线
    expect(xml).toMatch(/<w:ind[^>]*w:left="1440"/)
    expect(xml).toMatch(/<w:left[^>]*w:color="CCCCCC"/)
  })
})

describe('builder XML 断言 - 单元格内边距', () => {
  it('默认表格：含 <w:tblCellMar>，且 top/bottom 与 left/right 各有非零默认值', async () => {
    // 防回归：曾经默认 0 内边距导致单元格紧贴
    const xml = await getDocumentXml('<table><tr><td>x</td></tr></table>')
    const mar = extractCellMar(xml)
    // pt → dxa：2pt = 40, 5pt = 100（toTwip 四舍五入；2pt=40, 5pt=100）
    expect(mar.top).toBe(40)
    expect(mar.bottom).toBe(40)
    expect(mar.left).toBe(100)
    expect(mar.right).toBe(100)
  })

  it('options.tableCellMargin 覆盖默认值', async () => {
    const xml = await getDocumentXml('<table><tr><td>x</td></tr></table>', {
      tableCellMargin: { top: 10, right: 20, bottom: 10, left: 20, unit: 'pt' },
    })
    const mar = extractCellMar(xml)
    expect(mar.top).toBe(200)
    expect(mar.bottom).toBe(200)
    expect(mar.left).toBe(400)
    expect(mar.right).toBe(400)
  })

  it('HTML <table cellpadding="N"> 覆盖 options（N 为像素）', async () => {
    const xml = await getDocumentXml(
      '<table cellpadding="8"><tr><td>x</td></tr></table>',
      // 即便用户通过 options 设了别的值，HTML 属性优先
      { tableCellMargin: { top: 1, right: 1, bottom: 1, left: 1, unit: 'pt' } },
    )
    const mar = extractCellMar(xml)
    // 8 px * 15 = 120 dxa，四边一致
    expect(mar.top).toBe(120)
    expect(mar.right).toBe(120)
    expect(mar.bottom).toBe(120)
    expect(mar.left).toBe(120)
  })

  it('cellpadding="0"：显式取消内边距（边界情况）', async () => {
    const xml = await getDocumentXml('<table cellpadding="0"><tr><td>x</td></tr></table>')
    const mar = extractCellMar(xml)
    expect(mar.top).toBe(0)
    expect(mar.right).toBe(0)
    expect(mar.bottom).toBe(0)
    expect(mar.left).toBe(0)
  })

  it('部分覆盖：只指定 left，其他三边走默认', async () => {
    const xml = await getDocumentXml('<table><tr><td>x</td></tr></table>', {
      tableCellMargin: { left: 10, unit: 'pt' },
    })
    const mar = extractCellMar(xml)
    // left 自定义 = 10pt = 200dxa；其他三边走默认 (top/bottom 2pt = 40, right 5pt = 100)
    expect(mar.left).toBe(200)
    expect(mar.right).toBe(100)
    expect(mar.top).toBe(40)
    expect(mar.bottom).toBe(40)
  })

  it('用户只提供 unit 不提供值：fallback 到默认值时仍按默认单位（pt），不被用户的 unit 顶替', async () => {
    // 防回归：曾经用户提供 { unit: 'mm' } 但缺四边值时，默认 (2,5,2,5) 被错误地按 mm 解释。
    // 期望各边 fallback 到 def 时，单位也 fallback 到 def.unit
    const xml = await getDocumentXml('<table><tr><td>x</td></tr></table>', {
      tableCellMargin: { unit: 'mm' },
    })
    const mar = extractCellMar(xml)
    // 默认值按 pt 解释：top=2pt=40, right=5pt=100；若按 mm 错算则会是 113 / 283
    expect(mar.top).toBe(40)
    expect(mar.right).toBe(100)
    expect(mar.bottom).toBe(40)
    expect(mar.left).toBe(100)
  })

  it('混合单位：user 值用 user 单位、默认值用默认单位（mm 5 与 pt 2 各自换算）', async () => {
    const xml = await getDocumentXml('<table><tr><td>x</td></tr></table>', {
      tableCellMargin: { left: 5, right: 5, unit: 'mm' },
    })
    const mar = extractCellMar(xml)
    // left/right 用 mm：5mm ≈ 283 dxa；top/bottom fallback 到 def 2pt=40
    expect(mar.left).toBe(283)
    expect(mar.right).toBe(283)
    expect(mar.top).toBe(40)
    expect(mar.bottom).toBe(40)
  })

  it('li 内 <table> 同时获得列表缩进与默认 cell 内边距', async () => {
    const xml = await getDocumentXml('<ul><li><table><tr><td>x</td></tr></table></li></ul>')
    expect(xml).toMatch(/<w:tblInd[^>]*w:w="720"/)
    const mar = extractCellMar(xml)
    expect(mar.top).toBe(40)
    expect(mar.left).toBe(100)
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
