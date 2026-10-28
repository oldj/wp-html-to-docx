// 把 OMML 字符串包成 docx 能消费的 ImportedXmlComponent。
//
// docx@9 的 ImportedXmlComponent.fromXmlString 在解析时会留下一个 rootKey 为
// undefined 的外层包裹，序列化产物形如 `<undefined><m:oMath/></undefined>`，
// Word 不识别。绕开方法：取 wrap.root 中第一个真正的子组件（即 <m:oMath>）。
//
// 这里也负责把块级公式包成 <m:oMathPara>，让它独占一段，并提供公式渲染的统一出口 renderMath。

// docx 的 Math 组件改名导入，避免遮蔽全局 Math 对象
import { ImportedXmlComponent, Math as DocxMath, XmlComponent, type ParagraphChild } from 'docx'
import type { BuildContext } from '../ir/buildContext.js'

const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

export function ommlToImported(omml: string): ImportedXmlComponent | null {
  let wrap: ImportedXmlComponent
  try {
    wrap = ImportedXmlComponent.fromXmlString(omml)
  } catch {
    return null
  }
  // 拆开 fromXmlString 的 undefined 外壳：找首个 ImportedXmlComponent 子节点
  const root = (wrap as unknown as { root?: unknown[] }).root
  if (Array.isArray(root)) {
    for (const item of root) {
      if (item instanceof ImportedXmlComponent) return item
    }
  }
  // 找不到合法子节点：返回 null 让上层走 [math] 占位。
  // 不能直接返回 wrap —— 那会把 <undefined> 包裹写入 document.xml，Word 打不开
  return null
}

/** `<m:oMathPara>`：docx 没有对应组件，latexToMath 产出的块级公式靠它独占一段、按显示样式排版 */
class MathParagraph extends XmlComponent {
  constructor(math: DocxMath) {
    super('m:oMathPara')
    this.root.push(math)
  }
}

/**
 * 公式渲染的统一出口。取 collectMath 的转换结果：TeX 经 latexToMath 的组件（ctx.mathLatex）
 * 或 mathml2omml 的 OMML（ctx.mathOmml），同一公式只会有其一。块级包进 `<m:oMathPara>`。
 * 两者都没有时返回 null，由调用方按所在位置输出 mathFallbackText 占位。
 *
 * 返回值统一按 ParagraphChild 交出：ImportedXmlComponent / MathParagraph 不在其类型联合内，
 * 但 docx 序列化时只调用每个 child 的 prepForXml，运行时兼容。
 */
export function renderMath(
  mathml: string,
  display: 'inline' | 'block',
  ctx: BuildContext,
): ParagraphChild | null {
  const make = ctx.mathLatex.get(mathml)
  if (make !== undefined) {
    const math = new DocxMath({ children: make() })
    return display === 'block' ? (new MathParagraph(math) as unknown as ParagraphChild) : math
  }
  const omml = ctx.mathOmml.get(mathml)
  if (omml === undefined) return null
  const ic = display === 'block' ? blockOmmlToImported(omml) : ommlToImported(omml)
  return ic !== null ? (ic as unknown as ParagraphChild) : null
}

/**
 * 公式转换不可用（依赖缺失 / 转换失败）时的占位文本。
 * 有 TeX 源码时输出 `$…$`（块级 `$$…$$`），读者能看懂，Microsoft 365 的公式编辑器也能
 * 以 LaTeX 格式把它转回正式公式；没有时才退回 `[math]`。
 */
export function mathFallbackText(tex: string | undefined, display: 'inline' | 'block'): string {
  if (tex === undefined) return '[math]'
  return display === 'block' ? `$$${tex}$$` : `$${tex}$`
}

/** 块级：用 <m:oMathPara> 包一层，让公式独占一段 */
export function blockOmmlToImported(omml: string): ImportedXmlComponent | null {
  const wrapped = `<m:oMathPara xmlns:m="${OMML_NS}">${omml}</m:oMathPara>`
  return ommlToImported(wrapped)
}
