// MathML → OMML 转换的薄包装
//
// 设计要点：
// 1. mathml2omml 是 LGPL-3.0 的可选 peerDependency，运行时通过动态 import 加载。
//    未安装时返回 null，调用方退回 [math] 文本占位，且只警告一次。
// 2. parse5 重新序列化 <math> 时会丢失 xmlns（因为它把命名空间属性当普通 attr 跳过），
//    转换前必须确保根元素含 xmlns="http://www.w3.org/1998/Math/MathML"，否则
//    mathml2omml 不识别。
// 3. 模块级缓存导入结果与「是否警告过」的标志，避免重复 IO 与噪声。

import { makeWarn, type WarnFn } from '../utils/log.js'

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

type Mml2Omml = (mathml: string, options?: { disableDecode?: boolean }) => string

let cached: Mml2Omml | null | undefined
let warned = false

/**
 * 加载 mathml2omml；首次调用时尝试动态 import，失败缓存为 null。
 * 之后所有调用走缓存，不会重复触发 import 错误。
 */
async function loadConverter(): Promise<Mml2Omml | null> {
  if (cached !== undefined) return cached
  try {
    const mod = (await import('mathml2omml')) as { mml2omml: Mml2Omml }
    cached = mod.mml2omml
  } catch {
    cached = null
  }
  return cached
}

/** 仅在测试中使用：重置模块状态 */
export function _resetForTest(): void {
  cached = undefined
  warned = false
}

/**
 * 把 MathML 字符串转成 OMML 字符串。
 * 失败（依赖缺失 / 转换抛错）时返回 null，调用方负责退回占位。
 *
 * @param warn 警告出口；调用方传入经 makeWarn(logger) 构造的函数，缺省退 console.warn
 */
export async function mathmlToOmml(
  mathml: string,
  warn: WarnFn = makeWarn(undefined),
): Promise<string | null> {
  const conv = await loadConverter()
  if (conv === null) {
    if (!warned) {
      warned = true
      warn(
        'wp-html-to-docx: <math> detected but optional peer "mathml2omml" is not installed. ' +
          'Install it to enable real OMML output; falling back to "[math]" placeholder.',
      )
    }
    return null
  }
  try {
    const raw = conv(_ensureMathmlNamespace(mathml))
    return _escapeOmmlTextContent(raw)
  } catch (err) {
    // 转换异常（极端 MathML 输入）：吞掉并降级，避免整个文档构建失败
    warn('wp-html-to-docx: MathML conversion failed, falling back:', err)
    return null
  }
}

/**
 * mathml2omml 在生成 `<m:t>` 时不会转义内部文本中的 `<`、`>`、`&`，
 * 例如 `<mo>&lt;</mo>` 会产出 `<m:t>...<...</m:t>`，整段就是非法 XML，
 * 后续 `ImportedXmlComponent.fromXmlString` 解析直接抛错。
 *
 * 这里对所有 `<m:t ...>...</m:t>` 文本内容补做最小转义。upstream 修好之前，这是必须的兜底。
 *
 * 以 `_` 前缀导出供测试直接断言；外部代码不应使用。
 */
export function _escapeOmmlTextContent(omml: string): string {
  // \b 边界防止误匹 <m:type ...> 这类同前缀的标签（regex 否则会从 <m:type 起步）
  return omml.replace(
    /<m:t\b([^>]*)>([\s\S]*?)<\/m:t>/g,
    (_match, attrs: string, content: string) => {
      // 现版 mml2omml 在 <m:t> 内全部输出原始字符；但负向预查跳过已合法转义的 entity，
      // 避免未来 mml2omml 改变行为时把 `&amp;` 二次转成 `&amp;amp;`
      const safe = content
        .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      return `<m:t${attrs}>${safe}</m:t>`
    },
  )
}

/**
 * 给根 <math> 元素补上 xmlns 命名空间（若缺失）。
 * 简单的字符串替换：定位首个 <math 标记，检查 xmlns 是否已在其属性段内。
 *
 * 以 `_` 前缀导出供测试直接断言（与 `_resetForTest` 同一约定）；外部代码不应使用。
 */
export function _ensureMathmlNamespace(mathml: string): string {
  const match = /<math\b([^>]*)>/i.exec(mathml)
  if (!match) return mathml
  const attrs = match[1] ?? ''
  if (/\bxmlns\s*=/.test(attrs)) return mathml
  const replaced = `<math xmlns="${MATHML_NS}"${attrs}>`
  return mathml.slice(0, match.index) + replaced + mathml.slice(match.index + match[0].length)
}
