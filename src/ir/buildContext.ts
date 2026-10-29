// 贯穿 walker 与 builder 的上下文，收集需要注入到 Document 顶层的副作用：
// - numbering：列表 reference 定义（每个顶层 list / 嵌套类型切换时注册一次）
// - images：异步加载的图片资源（src → ImageAsset），由 collectImages 填充
// - mathOmml：MathML → OMML 的转换结果（mathml 原文 → OMML 字符串），由 collectMath 填充
// - listSeq：私有自增计数器，用于生成不重复的 numbering reference id

import type { ILevelsOptions } from 'docx'
import type { HtmlToDocxOptions } from '../options.js'
import type { Block } from '../types.js'
import type { DocxImageType } from '../utils/imageType.js'
import type { MathFactory } from '../math/latex.js'
import {
  listLevels,
  resolveListLevelScheme,
  type ListLevelScheme,
  type ListSpec,
} from '../builder/numbering.js'
import { makeWarn } from '../utils/log.js'

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
  /** MathML 原文 → mathml2omml 转出的 OMML 字符串；buildIr 后由 collectMath 异步填充。
   * 没有 TeX 源码、或 TeX 转换失败的公式才走这条路。 */
  mathOmml = new Map<string, string>()
  /** MathML 原文 → TeX 公式组件工厂；公式带 TeX 源码且 latexToMath 能解析时才有，由 collectMath 填充。
   * 同一公式只会落在 mathLatex / mathOmml 之一，两者都没有时渲染层退回文本占位。 */
  mathLatex = new Map<string, MathFactory>()
  /** 锚点 id（如 'fn-1'）→ 脚注编号 + 内容；buildIr 阶段由 collectFootnoteDefs 预扫描填充。
   * 正文引用在渲染层据此解析数字 id，buildDocument 据此注入 Document.footnotes。 */
  footnotes = new Map<string, FootnoteEntry>()
  /** builder 阶段：外层表格单元格可容纳内容的宽度（twip）栈，由 tables.ts 维护。
   * 栈顶即当前所在单元格的内容宽度，单元格里的表格以它而非版心为可用宽度；空栈表示不在表格内。 */
  cellContentWidths: number[] = []
  /** HTML id → Word 书签名；buildIr 阶段由带 id 的元素注册，渲染期据此把 `#id` 链接转成文档内链接 */
  anchors = new Map<string, string>()
  private listSeq = 0
  private footnoteSeq = 0
  private anchorSeq = 0
  /** options.listLevels 解析后的层级方案，所有 reference 共用 */
  private readonly listScheme: ListLevelScheme

  constructor(options: HtmlToDocxOptions) {
    this.options = options
    this.listScheme = resolveListLevelScheme(options.listLevels, makeWarn(options.logger))
  }

  /**
   * 创建并注册一个新 list reference，返回 reference id。
   * spec 给定时，该 reference 在 spec.level 这一层采用元素自己指定的格式 / 起始序号，
   * 其余层仍是默认层级方案（见 builder/numbering.ts）。
   */
  registerList(ordered: boolean, spec?: ListSpec): string {
    this.listSeq += 1
    const reference = `numbering-${this.listSeq}`
    this.numbering.push({
      reference,
      levels: listLevels(ordered, spec, this.listScheme),
    })
    return reference
  }

  /**
   * 为 HTML id 注册一个 Word 书签名并返回；该 id 已注册过时返回 undefined（HTML 中 id 应唯一，重复时以首个为准）。
   * 书签名不直接用 id：Word 书签名只允许字母、数字、下划线且不超过 40 字符，HTML id 常含 `-`、中文等。
   * 以 `_` 开头的书签在 Word 的书签列表中默认隐藏，不打扰用户自己的书签。
   */
  registerAnchor(id: string): string | undefined {
    if (this.anchors.has(id)) return undefined
    this.anchorSeq += 1
    const name = `_wp_anchor_${this.anchorSeq}`
    this.anchors.set(id, name)
    return name
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
