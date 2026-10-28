// TeX → docx 公式组件的薄包装：MathML 转换不可用时的兜底
//
// 设计要点：
// 1. 用 docx 自带的 `docx/math` 入口（MIT，与 docx 同包，无额外依赖与许可风险）。它约 77KB，
//    只在确有公式需要兜底时才动态 import，用不到公式的调用方的浏览器包里不会带上它。
// 2. 与 mml2omml.ts 相同，模块级缓存导入结果与「是否警告过」的标志。
// 3. 返回工厂函数而非组件本身：同一公式在文档中可能出现多次，每处渲染各建一份组件，不共享实例。

import type { MathComponent } from 'docx'
import { makeWarn, type WarnFn } from '../utils/log.js'

type LatexToMath = (latex: string) => readonly MathComponent[]

/** 生成一份 TeX 对应的公式组件；每次调用返回新实例 */
export type MathFactory = () => readonly MathComponent[]

let cached: LatexToMath | null | undefined
let warned = false

async function loadConverter(): Promise<LatexToMath | null> {
  if (cached !== undefined) return cached
  try {
    const mod = (await import('docx/math')) as { latexToMath: LatexToMath }
    cached = mod.latexToMath
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
 * 把 TeX 源码编译成公式组件工厂。
 * 先在这里试转一次：latexToMath 遇到不认识的命令 / 环境会抛错，提前发现才能在收集阶段告警，
 * 渲染阶段据此直接走文本占位。失败（入口加载失败 / TeX 无法解析）时返回 null。
 *
 * @param warn 警告出口；调用方传入经 makeWarn(logger) 构造的函数，缺省退 console.warn
 */
export async function latexToMathFactory(
  tex: string,
  warn: WarnFn = makeWarn(undefined),
): Promise<MathFactory | null> {
  const conv = await loadConverter()
  if (conv === null) {
    if (!warned) {
      warned = true
      warn('wp-html-to-docx: failed to load "docx/math"; TeX formulas fall back to "$…$" text.')
    }
    return null
  }
  try {
    conv(tex)
  } catch (err) {
    warn(`wp-html-to-docx: LaTeX conversion failed for "${tex}", falling back to text:`, err)
    return null
  }
  return () => conv(tex)
}
