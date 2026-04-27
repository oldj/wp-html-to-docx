// MathML → OMML 转换的薄包装
//
// 设计要点：
// 1. mathml2omml 是 LGPL-3.0 的可选 peerDependency，运行时通过动态 import 加载。
//    未安装时返回 null，调用方退回 [math] 文本占位，且只警告一次。
// 2. parse5 重新序列化 <math> 时会丢失 xmlns（因为它把命名空间属性当普通 attr 跳过），
//    转换前必须确保根元素含 xmlns="http://www.w3.org/1998/Math/MathML"，否则
//    mathml2omml 不识别。
// 3. 模块级缓存导入结果与「是否警告过」的标志，避免重复 IO 与噪声。

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
 */
export async function mathmlToOmml(mathml: string): Promise<string | null> {
  const conv = await loadConverter()
  if (conv === null) {
    if (!warned) {
      warned = true
      console.warn(
        'wp-html-to-docx: <math> detected but optional peer "mathml2omml" is not installed. ' +
          'Install it to enable real OMML output; falling back to "[math]" placeholder.',
      )
    }
    return null
  }
  try {
    return conv(ensureMathmlNamespace(mathml))
  } catch (err) {
    // 转换异常（极端 MathML 输入）：吞掉并降级，避免整个文档构建失败
    console.warn('wp-html-to-docx: MathML conversion failed, falling back:', err)
    return null
  }
}

/**
 * 给根 <math> 元素补上 xmlns 命名空间（若缺失）。
 * 简单的字符串替换：定位首个 <math 标记，检查 xmlns 是否已在其属性段内。
 */
function ensureMathmlNamespace(mathml: string): string {
  const match = /<math\b([^>]*)>/i.exec(mathml)
  if (!match) return mathml
  const attrs = match[1] ?? ''
  if (/\bxmlns\s*=/.test(attrs)) return mathml
  const replaced = `<math xmlns="${MATHML_NS}"${attrs}>`
  return mathml.slice(0, match.index) + replaced + mathml.slice(match.index + match[0].length)
}
