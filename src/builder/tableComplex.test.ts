// 复杂表格端到端测试：表格内嵌多种样式与块级元素，确保都能正确渲染
//
// 这一组测试不是单元级，而是「表格 cell 作为通用容器」的综合断言。
// 防回归点：cell 内任何顶层支持的内容（inline 样式、行内/块级 math、pre、列表、嵌套表格）
// 都不能被 walkTableCell / blocksToChildren 静默吞掉或降级。

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

/** 抽出第 N 个 <w:tc>...</w:tc> 子串，便于做局部断言。
 *  注意：非贪婪匹配，遇嵌套表会被内层 </w:tc> 截断；嵌套表用例须自行定位外层 cell 范围。 */
function getCellXml(xml: string, index = 0): string {
  // <w:tc(?:\s[^>]*)?> 兼容 docx 库未来给 <w:tc> 加属性的情况
  const cells = xml.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) ?? []
  if (cells[index] === undefined) {
    throw new Error(`cell #${index} not found (got ${cells.length} cells)`)
  }
  return cells[index]
}

describe('表格内联样式：加粗 / 斜体 / 删除线 / 下划线', () => {
  it('<td> 内的 strong / em / s / u 都正确产出', async () => {
    const xml = await getDocXml(
      `<table><tr><td>
        <strong>粗</strong><em>斜</em><s>删</s><u>下</u>
      </td></tr></table>`,
    )
    const cell = getCellXml(xml)
    expect(cell).toMatch(/<w:b\s*\/>/)
    expect(cell).toMatch(/<w:i\s*\/>/)
    expect(cell).toMatch(/<w:strike\s*\/>/)
    expect(cell).toMatch(/<w:u\s/)
    // 文字内容仍然在
    expect(cell).toContain('粗')
    expect(cell).toContain('斜')
    expect(cell).toContain('删')
    expect(cell).toContain('下')
  })

  it('<td> 内的 background-color 高亮产出 w:shd fill', async () => {
    const xml = await getDocXml(
      '<table><tr><td><span style="background-color: yellow">高亮</span></td></tr></table>',
    )
    const cell = getCellXml(xml)
    expect(cell).toMatch(/<w:shd[^>]*w:val="clear"/)
    expect(cell).toMatch(/<w:shd[^>]*w:fill="FFFF00"/)
    expect(cell).toContain('高亮')
  })

  it('<td> 内同段多种 inline 样式叠加：粗 + 红色 + 大字号', async () => {
    const xml = await getDocXml(
      `<table><tr><td>
        <strong style="color: red; font-size: 18pt">大红粗</strong>
      </td></tr></table>`,
    )
    const cell = getCellXml(xml)
    expect(cell).toMatch(/<w:b\s*\/>/)
    expect(cell).toMatch(/<w:color[^>]*w:val="FF0000"/)
    expect(cell).toMatch(/<w:sz[^>]*w:val="36"/) // 18pt = 半磅 36
    expect(cell).toContain('大红粗')
  })

  it('<td> 内多种样式分别在不同 run，互不串扰', async () => {
    const xml = await getDocXml(
      `<table><tr><td>
        <strong>A</strong><em>B</em><span style="background-color: yellow">C</span>
      </td></tr></table>`,
    )
    const cell = getCellXml(xml)
    // 抽出三个 run，逐个检查样式没有跨 run 串扰
    // 注意：docx 会镜像产出 <w:bCs/> / <w:iCs/>（complex script 配对），是标准行为
    const runRe = /<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)<w:t[^>]*>([^<]+)<\/w:t><\/w:r>/g
    const runs = [...cell.matchAll(runRe)].map((m) => ({ rPr: m[1]!, text: m[2]! }))
    const byText = Object.fromEntries(runs.map((r) => [r.text, r.rPr]))
    // A 的 run 含 <w:b/>，不含 <w:i/> 或 <w:shd>
    expect(byText['A']).toMatch(/<w:b\s*\/>/)
    expect(byText['A']).not.toMatch(/<w:i\s*\/>/)
    expect(byText['A']).not.toMatch(/<w:shd\b/)
    // B 的 run 含 <w:i/>，不含 <w:b/> 或 <w:shd>
    expect(byText['B']).toMatch(/<w:i\s*\/>/)
    expect(byText['B']).not.toMatch(/<w:b\s*\/>/)
    expect(byText['B']).not.toMatch(/<w:shd\b/)
    // C 的 run 含黄色 shd，不含 b 或 i
    expect(byText['C']).toMatch(/<w:shd[^>]*w:fill="FFFF00"/)
    expect(byText['C']).not.toMatch(/<w:b\s*\/>/)
    expect(byText['C']).not.toMatch(/<w:i\s*\/>/)
  })
})

describe('表格内公式：行内 math 与块级 math', () => {
  it('<td> 内的行内 math 与文本同段，不切块', async () => {
    const xml = await getDocXml(
      `<table><tr><td>
        当 <math><msup><mi>x</mi><mn>2</mn></msup></math> = 4 时
      </td></tr></table>`,
    )
    const cell = getCellXml(xml)
    // cell 内只 1 个段落（去除空白后）
    const paragraphCount = (cell.match(/<w:p\b/g) ?? []).length
    expect(paragraphCount).toBe(1)
    expect(cell).toContain('<m:oMath')
    // 行内 math 不包 m:oMathPara
    expect(cell).not.toContain('<m:oMathPara')
    expect(cell).toContain('当 ')
    expect(cell).toContain(' = 4 时')
    // 不应退回到 [math] 占位
    expect(cell).not.toContain('[math]')
  })

  it('<td> 内的块级 math 产出 m:oMathPara', async () => {
    const xml = await getDocXml(
      `<table><tr><td>
        <p>勾股定理：</p>
        <math display="block"><msup><mi>a</mi><mn>2</mn></msup><mo>+</mo><msup><mi>b</mi><mn>2</mn></msup><mo>=</mo><msup><mi>c</mi><mn>2</mn></msup></math>
      </td></tr></table>`,
    )
    const cell = getCellXml(xml)
    expect(cell).toContain('<m:oMathPara')
    expect(cell).toContain('<m:oMath')
    expect(cell).toContain('勾股定理：')
    expect(cell).not.toContain('[math]')
  })

  it('<td> 同时包含行内 math 与块级 math', async () => {
    const xml = await getDocXml(
      `<table><tr><td>
        <p>已知 <math><mi>a</mi></math> 是常数：</p>
        <math display="block"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>
      </td></tr></table>`,
    )
    const cell = getCellXml(xml)
    // 块级与行内都被识别：oMathPara 出现 1 次，oMath 至少 2 次（行内 + 块内嵌）
    const paraCount = (cell.match(/<m:oMathPara\b/g) ?? []).length
    const mathCount = (cell.match(/<m:oMath\b/g) ?? []).length
    expect(paraCount).toBe(1)
    expect(mathCount).toBeGreaterThanOrEqual(2)
    expect(cell).not.toContain('[math]')
  })
})

describe('表格内代码块：<pre> / <pre><code>', () => {
  it('<td> 内的 <pre> 多行内容被拆成多段，使用等宽字体', async () => {
    const xml = await getDocXml(
      `<table><tr><td><pre>line1\nline2\nline3</pre></td></tr></table>`,
    )
    const cell = getCellXml(xml)
    // 3 行应至少 3 段
    const paragraphCount = (cell.match(/<w:p\b/g) ?? []).length
    expect(paragraphCount).toBeGreaterThanOrEqual(3)
    // pre 走等宽字体（项目默认 Consolas）
    expect(cell).toContain('Consolas')
    expect(cell).toContain('line1')
    expect(cell).toContain('line2')
    expect(cell).toContain('line3')
  })

  it('<td> 内 <pre><code> 代码 + XML 特殊字符正常转义', async () => {
    // 代码里含 < > & 必须被 XML 转义；既不能丢，也不能破坏 document.xml
    const xml = await getDocXml(
      `<table><tr><td><pre><code>if (a &lt; b &amp;&amp; c &gt; 0) { return; }</code></pre></td></tr></table>`,
    )
    const cell = getCellXml(xml)
    expect(cell).toContain('Consolas')
    // 字符必须被 OOXML 实体转义后写入
    expect(cell).toContain('if (a &lt; b &amp;&amp; c &gt; 0)')
  })
})

describe('表格内列表：<ul> 与 <ol>', () => {
  it('<td> 内的 <ul> 产出 numPr，多 li 各自独立段落', async () => {
    const xml = await getDocXml(
      `<table><tr><td><ul><li>项一</li><li>项二</li><li>项三</li></ul></td></tr></table>`,
    )
    const cell = getCellXml(xml)
    // 至少 3 个段落带 numPr（每个 li 一段）
    const numPrMatches = cell.match(/<w:numPr>/g) ?? []
    expect(numPrMatches.length).toBeGreaterThanOrEqual(3)
    expect(cell).toContain('项一')
    expect(cell).toContain('项二')
    expect(cell).toContain('项三')
  })

  it('<td> 内的 <ol> 产出 numPr 且引用 ordered numbering', async () => {
    // 一次构建拿到 document.xml + numbering.xml，避免重复跑 htmlToDocx
    const u8 = await htmlToDocx(
      `<table><tr><td><ol><li>第一</li><li>第二</li></ol></td></tr></table>`,
    )
    const files = unzipSync(u8)
    const xml = strFromU8(files['word/document.xml']!)
    const numberingXml = strFromU8(files['word/numbering.xml']!)
    const cell = getCellXml(xml)
    const numPrMatches = cell.match(/<w:numPr>/g) ?? []
    expect(numPrMatches.length).toBeGreaterThanOrEqual(2)
    expect(cell).toContain('第一')
    expect(cell).toContain('第二')
    // numbering.xml 应配置了 decimal 序号（来自 ol）
    expect(numberingXml).toMatch(/<w:numFmt[^>]*w:val="decimal"/)
  })

  it('<td> 内 <ul> 项里再含 inline 样式（粗体）', async () => {
    const xml = await getDocXml(
      `<table><tr><td><ul><li><strong>重点</strong>项</li></ul></td></tr></table>`,
    )
    const cell = getCellXml(xml)
    expect(cell).toMatch(/<w:numPr>/)
    expect(cell).toMatch(/<w:b\s*\/>/)
    expect(cell).toContain('重点')
    expect(cell).toContain('项')
  })
})

describe('表格嵌套：cell 内再放完整 <table>', () => {
  it('外层 cell 内嵌一张完整子表，两层 tbl/tc 都正确产出', async () => {
    // 注意：本用例不能用 getCellXml（非贪婪正则在嵌套表下会截断到内层 </w:tc>）
    const xml = await getDocXml(
      `<table>
        <tr><td>外层文字
          <table>
            <tr><th>键</th><th>值</th></tr>
            <tr><td>x</td><td>1</td></tr>
          </table>
        </td></tr>
      </table>`,
    )
    // 1) 计数：外层 1 张 + 内层 1 张 = 2 张 <w:tbl>
    const tblCount = (xml.match(/<w:tbl\b/g) ?? []).length
    expect(tblCount).toBe(2)
    // 2) 内层全部 cell 数 = 1（外层）+ 4（内层 2x2）= 5
    const tcCount = (xml.match(/<w:tc(?:\s[^>]*)?>/g) ?? []).length
    expect(tcCount).toBe(5)
    // 3) 内层 <w:tbl> 必须闭合在外层 <w:tc> 内（否则 Word 会渲染异常）
    //    — 直接断言外层 cell 的整段范围里包含完整的内层表
    const outerTcStart = xml.indexOf('<w:tc>')
    // 用 lastIndexOf 找该 <w:tc> 对应的 </w:tc>：当前 doc 里只有一个外层表，
    // 最后一个 </w:tc> 必然是外层 cell 的关闭
    const outerTcEnd = xml.lastIndexOf('</w:tc>') + '</w:tc>'.length
    const outerCell = xml.slice(outerTcStart, outerTcEnd)
    expect(outerCell).toContain('外层文字')
    expect(outerCell).toMatch(/<w:tbl\b[\s\S]*<\/w:tbl>/) // 完整内层表
    expect(outerCell).toContain('键')
    expect(outerCell).toContain('值')
    expect(outerCell).toContain('x')
    expect(outerCell).toContain('1')
    // 4) 内层 thead 的 <th> 仍带表头底色（不被外层吞掉）
    expect(outerCell).toMatch(/w:fill="EFEFEF"/i)
  })
})

describe('综合：单个 cell 同时包含样式 + 公式 + 代码 + 列表', () => {
  it('多块内容并存，互不干扰', async () => {
    const html = `
      <table>
        <thead><tr><th>说明</th></tr></thead>
        <tbody>
          <tr><td>
            <p>
              <strong>注意</strong>：常数 <math><mi>π</mi></math> 用如下公式：
            </p>
            <math display="block"><mfrac><mi>C</mi><mi>d</mi></mfrac></math>
            <pre><code>const PI = 3.14159;</code></pre>
            <ul>
              <li><em>近似值</em></li>
              <li><span style="background-color: yellow">高亮项</span></li>
            </ul>
          </td></tr>
        </tbody>
      </table>
    `
    const xml = await getDocXml(html)
    // 表头有 shading
    expect(xml).toMatch(/w:fill="EFEFEF"/i)
    // 第二个 cell（数据行）抽出来做集中断言
    const dataCell = getCellXml(xml, 1)

    // 1) inline 样式
    expect(dataCell).toMatch(/<w:b\s*\/>/) // strong
    expect(dataCell).toMatch(/<w:i\s*\/>/) // em
    expect(dataCell).toMatch(/<w:shd[^>]*w:fill="FFFF00"/) // 黄底高亮
    expect(dataCell).toContain('注意')
    expect(dataCell).toContain('近似值')
    expect(dataCell).toContain('高亮项')

    // 2) 公式
    expect(dataCell).toContain('<m:oMath')
    expect(dataCell).toContain('<m:oMathPara') // 块级 math
    expect(dataCell).not.toContain('[math]')

    // 3) 代码块
    expect(dataCell).toContain('Consolas')
    expect(dataCell).toContain('const PI = 3.14159;')

    // 4) 列表
    const numPrMatches = dataCell.match(/<w:numPr>/g) ?? []
    expect(numPrMatches.length).toBeGreaterThanOrEqual(2)
  })
})
