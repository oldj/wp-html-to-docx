// 贯穿 walker 与 builder 的上下文，收集需要注入到 Document 顶层的副作用：
// - numbering：列表 reference 定义（每个顶层 list / 嵌套类型切换时注册一次）
// - images：异步加载的图片资源（src → ImageAsset），由 collectImages 填充
// - mathOmml：MathML → OMML 的转换结果（mathml 原文 → OMML 字符串），由 collectMath 填充
// - listSeq：私有自增计数器，用于生成不重复的 numbering reference id

import type { ILevelsOptions } from 'docx'
import type { HtmlToDocxOptions } from '../options.js'
import type { Block } from '../types.js'
import type { DocxImageType } from '../utils/imageType.js'
import { bulletLevels, decimalLevels } from '../builder/numbering.js'

export type NumberingEntry = {
  reference: string
  levels: ILevelsOptions[]
}

/** 已注册的脚注：number 为 docx 脚注数字 id，blocks 为脚注内容（已剥离回跳箭头） */
export type FootnoteEntry = {
  number: number
  blocks: Block[]
}

/** 已就绪的图片资源（已知 type 与默认尺寸） */
export type ImageAsset = {
  data: Uint8Array
  type: DocxImageType
  /** 固有像素尺寸（从图片数据解码，docx 库内部转 EMU）；解码失败时退回默认 200x150 */
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
  /** 锚点 id（如 'fn-1'）→ 脚注编号 + 内容；buildIr 阶段由 collectFootnoteDefs 预扫描填充。
   * 正文引用在渲染层据此解析数字 id，buildDocument 据此注入 Document.footnotes。 */
  footnotes = new Map<string, FootnoteEntry>()
  private listSeq = 0
  private footnoteSeq = 0

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

  /**
   * 注册一条脚注定义，返回其数字 id。
   * 同一锚点 id 只注册一次（重复定义忽略，沿用首次编号）。
   */
  registerFootnote(anchorId: string, blocks: Block[]): number {
    const exist = this.footnotes.get(anchorId)
    if (exist !== undefined) return exist.number
    this.footnoteSeq += 1
    this.footnotes.set(anchorId, { number: this.footnoteSeq, blocks })
    return this.footnoteSeq
  }
}
