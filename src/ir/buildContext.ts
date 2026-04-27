// 贯穿 walker 与 builder 的上下文，收集需要注入到 Document 顶层的副作用：
// - numbering：列表 reference 定义（每个顶层 list / 嵌套类型切换时注册一次）
// - imageRequests：异步加载的图片
// - listSeq：递增 numbering reference id

import type { ILevelsOptions } from 'docx'
import type { HtmlToDocxOptions } from '../options.js'
import type { DocxImageType } from '../utils/imageType.js'
import { bulletLevels, decimalLevels } from '../builder/numbering.js'

export type NumberingEntry = {
  reference: string
  levels: ILevelsOptions[]
}

/** 已就绪的图片资源（已知 type 与默认尺寸） */
export type ImageAsset = {
  data: Uint8Array
  type: DocxImageType
  /** px，docx 库内部转 EMU。MVP 默认 200x150 */
  width: number
  height: number
}

export class BuildContext {
  options: HtmlToDocxOptions
  numbering: NumberingEntry[] = []
  /** src → 已就绪的图片资源；buildIr 后由 collectImages 填充 */
  images = new Map<string, ImageAsset>()
  /** MathML 原文 → OMML 字符串；buildIr 后由 collectMath 异步填充。
   * 转换失败 / 依赖缺失时该项缺席，渲染层退回 [math] 占位。 */
  mathOmml = new Map<string, string>()
  private listSeq = 0

  constructor(options: HtmlToDocxOptions) {
    this.options = options
  }

  /** 创建并注册一个新 list reference，返回 reference id */
  registerList(ordered: boolean): string {
    this.listSeq += 1
    const reference = `numbering-${this.listSeq}`
    this.numbering.push({
      reference,
      levels: ordered ? decimalLevels() : bulletLevels(),
    })
    return reference
  }
}
