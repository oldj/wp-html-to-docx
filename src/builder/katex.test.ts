// KaTeX 输出端到端：
// - .katex-html 排版层被跳过，不再拍平成「E=mc2」这类乱字符
// - <p> 里只有块级公式时升级为独占一段的 <m:oMathPara>
// - 带 <annotation encoding="application/x-tex"> 的公式优先经 docx/math 的 latexToMath 转换（无论是否装了
//   mathml2omml）；TeX 解析失败 / docx/math 加载失败时退回 mathml2omml，再不行退回 $…$ 文本；无 annotation 才退回 [math]
//
// 夹具为 KaTeX 0.19.1 renderToString 的真实输出（默认 htmlAndMathml），非 ASCII 字符（∫、零宽空格）以转义写出。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import type { HtmlToDocxOptions } from '../options.js'

const KATEX_INLINE =
  '<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="katex-base"><span class="katex-strut" style="height:0.6833em;"></span><span class="mord mathnormal" style="margin-right:0.0576em;">E</span><span class="mspace" style="margin-right:0.2778em;"></span><span class="mrel">=</span><span class="mspace" style="margin-right:0.2778em;"></span></span><span class="katex-base"><span class="katex-strut" style="height:0.8141em;"></span><span class="mord mathnormal">m</span><span class="mord"><span class="mord mathnormal">c</span><span class="msupsub"><span class="vlist-t"><span class="vlist-r"><span class="vlist" style="height:0.8141em;"><span style="top:-3.063em;margin-right:0.05em;"><span class="pstrut" style="height:2.7em;"></span><span class="katex-sizing reset-size6 size3 mtight"><span class="mord mtight">2</span></span></span></span></span></span></span></span></span></span></span>'

const KATEX_BLOCK =
  '<span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><msubsup><mo>\u222b</mo><mn>0</mn><mn>1</mn></msubsup><msup><mi>x</mi><mn>2</mn></msup><mi>d</mi><mi>x</mi><mo>=</mo><mfrac><mn>1</mn><mn>3</mn></mfrac></mrow><annotation encoding="application/x-tex">\\int_0^1 x^2 dx = \\frac{1}{3}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="katex-base"><span class="katex-strut" style="height:2.476em;vertical-align:-0.9119em;"></span><span class="mop"><span class="mop op-symbol large-op" style="margin-right:0.4445em;position:relative;top:-0.0011em;">\u222b</span><span class="msupsub"><span class="vlist-t vlist-t2"><span class="vlist-r"><span class="vlist" style="height:1.564em;"><span style="top:-1.7881em;margin-left:-0.4445em;margin-right:0.05em;"><span class="pstrut" style="height:2.7em;"></span><span class="katex-sizing reset-size6 size3 mtight"><span class="mord mtight">0</span></span></span><span style="top:-3.8129em;margin-right:0.05em;"><span class="pstrut" style="height:2.7em;"></span><span class="katex-sizing reset-size6 size3 mtight"><span class="mord mtight">1</span></span></span></span><span class="vlist-s">\u200b</span></span><span class="vlist-r"><span class="vlist" style="height:0.9119em;"><span></span></span></span></span></span></span><span class="mspace" style="margin-right:0.1667em;"></span><span class="mord"><span class="mord mathnormal">x</span><span class="msupsub"><span class="vlist-t"><span class="vlist-r"><span class="vlist" style="height:0.8641em;"><span style="top:-3.113em;margin-right:0.05em;"><span class="pstrut" style="height:2.7em;"></span><span class="katex-sizing reset-size6 size3 mtight"><span class="mord mtight">2</span></span></span></span></span></span></span></span><span class="mord mathnormal">d</span><span class="mord mathnormal">x</span><span class="mspace" style="margin-right:0.2778em;"></span><span class="mrel">=</span><span class="mspace" style="margin-right:0.2778em;"></span></span><span class="katex-base"><span class="katex-strut" style="height:2.0074em;vertical-align:-0.686em;"></span><span class="mord"><span class="mopen nulldelimiter"></span><span class="mfrac"><span class="vlist-t vlist-t2"><span class="vlist-r"><span class="vlist" style="height:1.3214em;"><span style="top:-2.314em;"><span class="pstrut" style="height:3em;"></span><span class="mord"><span class="mord">3</span></span></span><span style="top:-3.23em;"><span class="pstrut" style="height:3em;"></span><span class="frac-line" style="border-bottom-width:0.04em;"></span></span><span style="top:-3.677em;"><span class="pstrut" style="height:3em;"></span><span class="mord"><span class="mord">1</span></span></span></span><span class="vlist-s">\u200b</span></span><span class="vlist-r"><span class="vlist" style="height:0.686em;"><span></span></span></span></span></span><span class="mclose nulldelimiter"></span></span></span></span></span></span>'

const KATEX_HTML_ONLY =
  '<span class="katex"><span class="katex-html" aria-hidden="true"><span class="katex-base"><span class="katex-strut" style="height:0.4306em;"></span><span class="mord mathnormal">x</span></span></span></span>'

type Para = { text: string; mathText: string; oMath: boolean; oMathPara: boolean }

/** 把 document.xml 拆成段落，分别取正文文本（w:t）与公式文本（m:t） */
function paragraphs(xml: string): Para[] {
  const join = (p: string, re: RegExp): string => [...p.matchAll(re)].map((m) => m[1]).join('')
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => ({
    text: join(p, /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g),
    mathText: join(p, /<m:t(?:\s[^>]*)?>([^<]*)<\/m:t>/g),
    oMath: /<m:oMath[ >]/.test(p),
    oMathPara: /<m:oMathPara[ >]/.test(p),
  }))
}

type HtmlToDocx = (html: string, options?: HtmlToDocxOptions) => Promise<Uint8Array>

type Converted = { paras: Para[]; document: string; footnotes: string; warnings: string[] }

async function convert(htmlToDocx: HtmlToDocx, html: string): Promise<Converted> {
  // 警告收进数组：既不刷到测试输出，也能断言告警策略
  const warnings: string[] = []
  const u8 = await htmlToDocx(html, {
    logger: (level, message) => {
      if (level === 'warn') warnings.push(message)
    },
  })
  const files = unzipSync(u8)
  const footnotes = files['word/footnotes.xml']
  const document = strFromU8(files['word/document.xml']!)
  return {
    paras: paragraphs(document),
    document,
    footnotes: footnotes !== undefined ? strFromU8(footnotes) : '',
    warnings,
  }
}

/** 模拟未安装 mathml2omml（可选再模拟 docx/math 加载失败），返回全新模块图下的 htmlToDocx */
async function loadWithout(...modules: string[]): Promise<HtmlToDocx> {
  for (const m of modules) {
    vi.doMock(m, () => {
      throw new Error('module not found')
    })
  }
  return (await import('../index.js')).htmlToDocx
}

const MOCKABLE = ['mathml2omml', 'docx/math']

beforeEach(() => {
  vi.resetModules()
  for (const m of MOCKABLE) vi.doUnmock(m)
})

afterEach(() => {
  for (const m of MOCKABLE) vi.doUnmock(m)
  vi.restoreAllMocks()
})

/** 带 TeX 源码的最小 MathML；TeX 可故意写成 latexToMath 解析不了的样子，用来走退路 */
const texMath = (tex: string, display = ''): string =>
  `<math${display}><semantics><mi>x</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math>`

describe('KaTeX - 已安装 mathml2omml：仍优先用 TeX 源码', () => {
  const load = async (): Promise<HtmlToDocx> => (await import('../index.js')).htmlToDocx

  it('行内公式：只输出公式，.katex-html 的排版文本不再混进正文', async () => {
    const { paras } = await convert(await load(), `<p>行内公式 ${KATEX_INLINE} 结束。</p>`)
    expect(paras).toHaveLength(1)
    const [p] = paras
    expect(p!.oMath).toBe(true)
    expect(p!.mathText).toContain('E')
    // 正文只剩公式两侧的文字：没有拍平的「E=mc2」，也没有零宽空格
    expect(p!.text).toBe('行内公式  结束。')
  })

  it('块级公式（p.katex-block > span.katex-display）：升级为 oMathPara 独占一段，无排版残留', async () => {
    const { paras } = await convert(await load(), `<p class="katex-block">${KATEX_BLOCK}</p>`)
    expect(paras).toHaveLength(1)
    expect(paras[0]!.oMathPara).toBe(true)
    expect(paras[0]!.text).toBe('')
    expect(paras[0]!.mathText).not.toContain('\\int')
  })

  it('积分 / 求和的主体在运算符内，不留空主体（Word 里的虚线占位框）', async () => {
    // 防回归：mathml2omml 把 KaTeX MathML 里与 ∫ 平级的 x² 放到运算符之外，留下空的 <m:e/>
    const { document } = await convert(await load(), `<p class="katex-block">${KATEX_BLOCK}</p>`)
    const nary = /<m:nary>[\s\S]*?<\/m:nary>/.exec(document)?.[0] ?? ''
    expect(nary).not.toBe('')
    expect(nary).not.toMatch(/<m:e\s*\/>|<m:e><\/m:e>/)
    expect(nary).toMatch(/<m:e>[\s\S]*<m:sSup>/)
  })

  it('矩阵与分段函数的括号是可伸缩的 m:d，而不是普通字符', async () => {
    const pmatrix =
      '<math display="block"><semantics><mi>A</mi><annotation encoding="application/x-tex">' +
      '\\begin{pmatrix} a &amp; b \\\\ c &amp; d \\end{pmatrix}</annotation></semantics></math>'
    const { document } = await convert(await load(), pmatrix)
    expect(document).toMatch(/<m:d>[\s\S]*<m:m>/)
  })

  it('块级公式与文字同段时保持行内，不拆段也不丢文字', async () => {
    const { paras } = await convert(await load(), `<p>见 ${KATEX_BLOCK}</p>`)
    expect(paras).toHaveLength(1)
    expect(paras[0]!.oMath).toBe(true)
    expect(paras[0]!.oMathPara).toBe(false)
    expect(paras[0]!.text.trim()).toBe('见')
  })

  it('TeX 无法解析时退回 mathml2omml，且转换前剥离 annotation，不再 console.warn「Type not supported」', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { paras, warnings } = await convert(await load(), `<p>${texMath('\\notacommand x')}</p>`)
    expect(paras[0]!.oMath).toBe(true)
    expect(paras[0]!.text).toBe('')
    expect(warnings.filter((w) => w.includes('LaTeX conversion failed'))).toHaveLength(1)
    const noisy = warn.mock.calls.filter((c) => String(c[0]).includes('Type not supported'))
    expect(noisy).toHaveLength(0)
  })

  it('KaTeX 纯 HTML 输出（无 .katex-mathml）：排版层是唯一内容，仍按文本保留', async () => {
    const { paras } = await convert(await load(), `<p>变量 ${KATEX_HTML_ONLY}</p>`)
    expect(paras[0]!.text).toBe('变量 x')
  })

  it('非 KaTeX 的 aria-hidden 内容不受影响', async () => {
    const { paras } = await convert(await load(), '<p>a<span aria-hidden="true">★</span>b</p>')
    expect(paras[0]!.text).toBe('a★b')
  })
})

describe('KaTeX - docx/math 加载失败、已安装 mathml2omml：退回 mathml2omml', () => {
  it('KaTeX 公式由 mathml2omml 转换，不退回文本', async () => {
    const htmlToDocx = await loadWithout('docx/math')
    const { paras, warnings } = await convert(
      htmlToDocx,
      `<p>${KATEX_INLINE}</p><p class="katex-block">${KATEX_BLOCK}</p>`,
    )
    expect(paras.map((p) => p.oMath)).toEqual([true, true])
    expect(paras[1]!.oMathPara).toBe(true)
    expect(paras.some((p) => /\$/.test(p.text))).toBe(false)
    expect(warnings.filter((w) => w.includes('docx/math'))).toHaveLength(1)
  })
})

describe('KaTeX - 未安装 mathml2omml：TeX 源码经 latexToMath 生成正式公式', () => {
  const load = (): Promise<HtmlToDocx> => loadWithout('mathml2omml')

  it('行内公式 → 段内 oMath，无排版乱字符、无文本占位', async () => {
    const { paras } = await convert(await load(), `<p>行内公式 ${KATEX_INLINE} 结束。</p>`)
    expect(paras).toHaveLength(1)
    expect(paras[0]!.oMath).toBe(true)
    expect(paras[0]!.oMathPara).toBe(false)
    expect(paras[0]!.mathText).toContain('E')
    expect(paras[0]!.text).toBe('行内公式  结束。')
  })

  it('块级公式 → 独占一段的 oMathPara，积分与分式都是结构化公式', async () => {
    const xml = await (async () => {
      const u8 = await (
        await load()
      )(`<p>前</p><p class="katex-block">${KATEX_BLOCK}</p><p>后</p>`, {
        logger: () => {},
      })
      return strFromU8(unzipSync(u8)['word/document.xml']!)
    })()
    const paras = paragraphs(xml)
    expect(paras.map((p) => p.text)).toEqual(['前', '', '后'])
    expect(paras[1]!.oMathPara).toBe(true)
    // \int → m:nary、\frac → m:f：确认不是把 TeX 当纯文本塞进公式
    expect(xml).toContain('<m:nary>')
    expect(xml).toContain('<m:f>')
    // <m:oMathPara> 未自带命名空间声明，依赖 document.xml 根节点声明 m 前缀
    expect(xml.slice(0, 2000)).toContain(
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
    )
  })

  it('顶层 <math display="block"> 带 annotation 同样走 latexToMath', async () => {
    const { paras } = await convert(
      await load(),
      '<math display="block"><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></math>',
    )
    expect(paras).toHaveLength(1)
    expect(paras[0]!.oMathPara).toBe(true)
  })

  it('同一公式出现多次：每处都输出公式（各建一份组件，不共享实例）', async () => {
    const { paras } = await convert(await load(), `<p>${KATEX_INLINE}</p><p>${KATEX_INLINE}</p>`)
    expect(paras.map((p) => p.oMath)).toEqual([true, true])
  })

  it('脚注里的 KaTeX 公式同样转换', async () => {
    const { footnotes } = await convert(
      await load(),
      '<p>正文<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup></p>' +
        `<div class="footnotes"><ol><li id="fn-1">脚注 ${KATEX_INLINE}</li></ol></div>`,
    )
    expect(footnotes).toMatch(/<m:oMath[ >]/)
    expect(footnotes).not.toContain('$E=mc^2$')
  })

  it('全部公式都带 TeX 源码时，不提示安装 mathml2omml', async () => {
    const { warnings } = await convert(
      await load(),
      `<p>${KATEX_INLINE}</p><p class="katex-block">${KATEX_BLOCK}</p>`,
    )
    expect(warnings).toEqual([])
  })

  it('出现没有 TeX 源码的公式时才提示安装 mathml2omml（只提示一次），且该公式退回 [math]', async () => {
    const { paras, warnings } = await convert(
      await load(),
      `<p>${KATEX_INLINE}</p><p>a <math><mi>x</mi></math> b</p><math display="block"><mi>y</mi></math>`,
    )
    expect(paras.map((p) => p.text)).toEqual(['', 'a [math] b', '[math]'])
    expect(paras[0]!.oMath).toBe(true)
    expect(warnings.filter((w) => w.includes('mathml2omml'))).toHaveLength(1)
  })

  it('非 TeX 的 annotation（如 StarMath）不被当作 TeX 源码', async () => {
    const { paras } = await convert(
      await load(),
      '<p><math><semantics><mi>x</mi><annotation encoding="StarMath 5.0">x</annotation></semantics></math></p>',
    )
    expect(paras[0]!.text).toBe('[math]')
  })

  it('latexToMath 无法解析的 TeX：退回 $TeX$ / $$TeX$$ 文本并告警', async () => {
    const { paras, warnings } = await convert(
      await load(),
      `<p>a ${texMath('\\notacommand x')} b</p>${texMath('\\frac{1}{', ' display="block"')}`,
    )
    expect(paras.map((p) => p.text)).toEqual(['a $\\notacommand x$ b', '$$\\frac{1}{$$'])
    expect(paras.some((p) => p.oMath)).toBe(false)
    expect(warnings.filter((w) => w.includes('LaTeX conversion failed'))).toHaveLength(2)
  })
})

describe('KaTeX - mathml2omml 与 docx/math 都不可用：TeX 源码文本占位', () => {
  const load = (): Promise<HtmlToDocx> => loadWithout('mathml2omml', 'docx/math')

  it('行内 → $TeX$，块级 → 单独成段的 $$TeX$$，并告警一次', async () => {
    const { paras, warnings } = await convert(
      await load(),
      `<p>行内公式 ${KATEX_INLINE} 结束。</p><p class="katex-block">${KATEX_BLOCK}</p>`,
    )
    expect(paras.map((p) => p.text)).toEqual([
      '行内公式 $E=mc^2$ 结束。',
      '$$\\int_0^1 x^2 dx = \\frac{1}{3}$$',
    ])
    expect(paras.some((p) => p.oMath)).toBe(false)
    expect(warnings.filter((w) => w.includes('docx/math'))).toHaveLength(1)
  })

  it('块级公式与文字同段：与公式路径一样按行内处理，降级为 $TeX$ 而非 $$TeX$$', async () => {
    const { paras } = await convert(await load(), `<p>见 ${KATEX_BLOCK}</p>`)
    expect(paras.map((p) => p.text)).toEqual(['见 $\\int_0^1 x^2 dx = \\frac{1}{3}$'])
  })
})
