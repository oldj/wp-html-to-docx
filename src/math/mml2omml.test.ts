// 验证当 optional peer 'mathml2omml' 未安装 / 抛错 / 输入异常时的软退回行为：
// mathmlToOmml 返回 null，由调用方走占位回退，且只 warn 一次。

import { describe, it, expect, beforeEach, vi } from 'vitest'

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('mathml2omml')
})

describe('_ensureMathmlNamespace - 直接断言补全行为', () => {
  // 直接测内部 helper，避免依赖 mathml2omml 是否容错来间接验证

  it('无 xmlns 的 <math> 会被补上规范的 xmlns 属性', async () => {
    const { _ensureMathmlNamespace } = await import('./mml2omml.js')
    const out = _ensureMathmlNamespace('<math><mn>1</mn></math>')
    expect(out).toBe(`<math xmlns="${MATHML_NS}"><mn>1</mn></math>`)
  })

  it('已含 xmlns 的输入原样返回（不重复添加）', async () => {
    const { _ensureMathmlNamespace } = await import('./mml2omml.js')
    const input = `<math xmlns="${MATHML_NS}" display="block"><mn>1</mn></math>`
    expect(_ensureMathmlNamespace(input)).toBe(input)
  })

  it('已含其他 xmlns:* 前缀但缺默认 xmlns 时仍补上默认 xmlns', async () => {
    // \bxmlns\s*= 不会误匹 xmlns:foo=，所以此情形应当补全
    const { _ensureMathmlNamespace } = await import('./mml2omml.js')
    const input = '<math xmlns:m="x"><mn>1</mn></math>'
    const out = _ensureMathmlNamespace(input)
    expect(out).toContain(`xmlns="${MATHML_NS}"`)
    expect(out).toContain('xmlns:m="x"')
  })

  it('保留 <math> 上原有的其它属性（如 display）', async () => {
    const { _ensureMathmlNamespace } = await import('./mml2omml.js')
    const out = _ensureMathmlNamespace('<math display="block"><mn>1</mn></math>')
    expect(out).toBe(`<math xmlns="${MATHML_NS}" display="block"><mn>1</mn></math>`)
  })

  it('找不到 <math> 标记：原样返回（防御）', async () => {
    const { _ensureMathmlNamespace } = await import('./mml2omml.js')
    expect(_ensureMathmlNamespace('not mathml')).toBe('not mathml')
  })
})

describe('_escapeOmmlTextContent - 修复 mml2omml 文本未转义的产物', () => {
  it('m:t 内的 < / > / & 被转回 entity', async () => {
    const { _escapeOmmlTextContent } = await import('./mml2omml.js')
    const input = '<m:oMath><m:r><m:t xml:space="preserve">a<b&c>d</m:t></m:r></m:oMath>'
    const out = _escapeOmmlTextContent(input)
    expect(out).toContain('<m:t xml:space="preserve">a&lt;b&amp;c&gt;d</m:t>')
    expect(out).not.toMatch(/<m:t[^>]*>a<b/)
  })

  it('m:t 内无特殊字符：原样返回', async () => {
    const { _escapeOmmlTextContent } = await import('./mml2omml.js')
    const input = '<m:oMath><m:r><m:t xml:space="preserve">1</m:t></m:r></m:oMath>'
    expect(_escapeOmmlTextContent(input)).toBe(input)
  })

  it('已合法转义的 entity 不重复转义（&amp; 不变成 &amp;amp;）', async () => {
    const { _escapeOmmlTextContent } = await import('./mml2omml.js')
    const input = '<m:oMath><m:r><m:t>&amp; &lt; &gt; &#65; &#x42;</m:t></m:r></m:oMath>'
    expect(_escapeOmmlTextContent(input)).toBe(input)
  })

  it('不误匹同前缀标签 <m:type ...>（regex 边界回归）', async () => {
    const { _escapeOmmlTextContent } = await import('./mml2omml.js')
    // 此前的 regex 没有 \b 会从 <m:type 起步，把 </m:fPr> 等结构当成 m:t 内容吞掉
    const input =
      '<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num><m:r><m:t xml:space="preserve">1</m:t></m:r></m:num></m:f>'
    expect(_escapeOmmlTextContent(input)).toBe(input)
  })
})

describe('mathmlToOmml 软退回', () => {
  it('正常路径：返回非空 OMML 字符串', async () => {
    const { mathmlToOmml } = await import('./mml2omml.js')
    const omml = await mathmlToOmml('<math><mn>1</mn></math>')
    expect(typeof omml).toBe('string')
    expect(omml ?? '').toContain('<m:oMath')
  })

  it('依赖缺失时返回 null，且仅 warn 一次', async () => {
    vi.doMock('mathml2omml', () => {
      throw new Error('module not found')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { mathmlToOmml } = await import('./mml2omml.js')
    const r1 = await mathmlToOmml('<math><mn>1</mn></math>')
    const r2 = await mathmlToOmml('<math><mn>2</mn></math>')
    expect(r1).toBeNull()
    expect(r2).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('转换抛错：返回 null 不影响调用方', async () => {
    vi.doMock('mathml2omml', () => ({
      mml2omml: () => {
        throw new Error('boom')
      },
    }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { mathmlToOmml } = await import('./mml2omml.js')
    const result = await mathmlToOmml('<math><mn>1</mn></math>')
    expect(result).toBeNull()
    // 转换抛错每次都 warn（不像 missing-dep 只 warn 一次）
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    warnSpy.mockRestore()
  })
})
