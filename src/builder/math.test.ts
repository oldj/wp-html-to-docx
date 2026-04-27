// 进阶 A：MathML → OMML 端到端断言
//
// 默认环境下 mathml2omml 已作为 devDependencies 安装，因此真实转换路径会被走通。
// 缺失依赖时的软退回行为单独在另一组测试中验证（通过 mock 模块）。

import { describe, it, expect, beforeEach } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'
import { _resetForTest } from '../math/mml2omml.js'

async function getDocXml(html: string): Promise<string> {
  const u8 = await htmlToDocx(html)
  const files = unzipSync(u8)
  const xml = files['word/document.xml']
  if (xml === undefined) throw new Error('document.xml missing')
  return strFromU8(xml)
}

beforeEach(() => {
  // 每个用例前重置懒加载缓存，保证 warn 行为与依赖检测的可复现性
  _resetForTest()
})

describe('block <math display="block"> → <m:oMathPara>', () => {
  it('独立块级公式被包进 m:oMathPara', async () => {
    const xml = await getDocXml(
      '<math display="block"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>',
    )
    expect(xml).toContain('<m:oMathPara')
    expect(xml).toContain('<m:oMath')
    expect(xml).toContain('<m:f>') // mfrac → m:f
    // 块级公式不应再出现 [math] 占位
    expect(xml).not.toContain('[math]')
  })
  // xmlns 补全的语义断言由 mml2omml.test.ts._ensureMathmlNamespace 直接覆盖；
  // builder 层只关心「没有 xmlns 的输入也能完成转换」，由上面的用例与下面的行内用例共同体现
})

describe('inline <math> → 段内 <m:oMath>', () => {
  it('段落内的行内 math 与文本并列，不再产 [math] 占位', async () => {
    const xml = await getDocXml(
      '<p>前 <math><msup><mi>a</mi><mn>2</mn></msup></math> 后</p>',
    )
    // 段落里既有文本又有 m:oMath，且不含 m:oMathPara（行内不包段）
    expect(xml).toContain('<m:oMath')
    expect(xml).not.toContain('<m:oMathPara')
    expect(xml).toContain('前')
    expect(xml).toContain('后')
    expect(xml).not.toContain('[math]')
  })
})

describe('B1 回归：math 与同段文本不被切块', () => {
  it('<td>x = <math>1</math></td> 单元格内只产 1 个段落含文本与 m:oMath', async () => {
    const xml = await getDocXml(
      '<table><tr><td>x = <math><mn>1</mn></math></td></tr></table>',
    )
    // 在 <w:tc> 范围里精确数 <w:p>，应只有 1 个
    const tcMatch = xml.match(/<w:tc>[\s\S]*?<\/w:tc>/)
    expect(tcMatch).not.toBeNull()
    const cellXml = tcMatch?.[0] ?? ''
    const paragraphCount = (cellXml.match(/<w:p\b/g) ?? []).length
    expect(paragraphCount).toBe(1)
    // 同一段落内既有文本 run 又有 m:oMath
    expect(cellXml).toMatch(/<w:t[^>]*>x = <\/w:t>/)
    expect(cellXml).toContain('<m:oMath')
  })

  it('<div>see <math>x</math> here</div> 不切段', async () => {
    const xml = await getDocXml('<div>see <math><mi>x</mi></math> here</div>')
    // 应只有一个段落，文本 + 行内 math
    const bodyMatch = xml.match(/<w:body>([\s\S]*?)<w:sectPr/)
    const body = bodyMatch?.[1] ?? ''
    const paragraphCount = (body.match(/<w:p\b/g) ?? []).length
    expect(paragraphCount).toBe(1)
    expect(body).toContain('see ')
    expect(body).toContain('<m:oMath')
    expect(body).toContain(' here')
  })
})

describe('B2 回归：<math> 在 <li> 内不被吞掉，MathML 内文本不泄漏', () => {
  it('list-item 内的行内 math 保留为 m:oMath，且 mn 内的字符不作为段落文本输出', async () => {
    const xml = await getDocXml('<ul><li>see <math><mn>1</mn></math> end</li></ul>')
    expect(xml).toContain('<m:oMath')
    // 周围文本仍在
    expect(xml).toContain('see ')
    expect(xml).toContain(' end')
    // 段落 w:t 不应包含 MathML 内的「1」（避免 see 1 end 这种泄漏）
    const wTexts = xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []
    for (const t of wTexts) {
      expect(t).not.toMatch(/^<w:t[^>]*>1<\/w:t>$/)
    }
  })
})

describe('docx <undefined> 包裹被正确剥离', () => {
  it('document.xml 不应出现 ImportedXmlComponent 的 <undefined> 包装', async () => {
    const xml = await getDocXml('<math display="block"><mn>1</mn></math>')
    expect(xml).not.toContain('<undefined')
  })
})

describe('MathML 文本中含 XML 特殊字符（&lt; / &gt; / &amp;）仍能转出 OMML', () => {
  // 守住 serializeNode 转义回归：parse5 把 &lt; 解码为字面 <，
  // 若 serializeNode 不转义就会产出非法 XML，mml2omml 抛错 → 退回 [math] 占位
  it('不等式 a < b 保留为 m:oMath，不退回 [math]', async () => {
    const xml = await getDocXml('<p><math><mi>a</mi><mo>&lt;</mo><mi>b</mi></math></p>')
    expect(xml).toContain('<m:oMath')
    expect(xml).not.toContain('[math]')
  })
})

// 同一段 MathML 出现多次时的「真正去重」断言（ctx.mathOmml.size === 1）
// 由 ir/mathCollector.test.ts 直接验证；builder 层只能间接看到 OMML 出现次数，
// 不足以反映「转换只跑一次」
