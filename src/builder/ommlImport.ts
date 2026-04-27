// 把 OMML 字符串包成 docx 能消费的 ImportedXmlComponent。
//
// docx@9 的 ImportedXmlComponent.fromXmlString 在解析时会留下一个 rootKey 为
// undefined 的外层包裹，序列化产物形如 `<undefined><m:oMath/></undefined>`，
// Word 不识别。绕开方法：取 wrap.root 中第一个真正的子组件（即 <m:oMath>）。
//
// 这里也负责把块级公式包成 <m:oMathPara>，让它独占一段。

import { ImportedXmlComponent } from 'docx'

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
  // 兜底：直接返回原对象（极少触发，且至少不会丢内容）
  return wrap
}

/** 块级：用 <m:oMathPara> 包一层，让公式独占一段 */
export function blockOmmlToImported(omml: string): ImportedXmlComponent | null {
  const wrapped = `<m:oMathPara xmlns:m="${OMML_NS}">${omml}</m:oMathPara>`
  return ommlToImported(wrapped)
}
