// 公开 API barrel
// 双层 API：
//  - htmlToDocument(html, options) => docx.Document  （便于组合）
//  - htmlToDocx(html, options)     => Uint8Array     （一步到位）

import { Document } from 'docx'
import { parseHtmlBodyChildren } from './parser/parseHtml.js'
import { BuildContext } from './ir/buildContext.js'
import { buildIr } from './ir/buildIr.js'
import { collectImages } from './ir/imageCollector.js'
import { collectMath } from './ir/mathCollector.js'
import { buildDocument } from './builder/buildDocument.js'
import { pack } from './pack/pack.js'
import type { HtmlToDocxOptions } from './options.js'
import { VERSION } from './version.js'

export { VERSION } from './version.js'

export type {
  HtmlToDocxOptions,
  Logger,
  PageOptions,
  PageMargin,
  PaperSize,
  CustomPageSize,
  PageNumberOptions,
  PageNumberPosition,
  HeaderFooterValue,
  ImageResolver,
  ImageResolverResult,
  LengthUnit,
} from './options.js'

export type {
  Block,
  BlockAlign,
  Inline,
  InlineStyle,
  ListRef,
  TableCell,
  TableRow,
} from './types.js'

export async function htmlToDocument(
  html: string,
  options?: HtmlToDocxOptions | null,
): Promise<Document> {
  // `= {}` 默认值仅在参数为 undefined 时触发；JS 调用方显式传 null 会让
  // 后续 `ctx.options.xxx` 抛不可定位的 TypeError。这里在边界统一兜底。
  const opts = options ?? {}
  // logger 钩子：调用方可借此确认实际加载的版本，排查包缓存 / 旧版误用问题
  if (opts.logger !== undefined) {
    try {
      opts.logger('info', `wp-html-to-docx v${VERSION}`)
    } catch {
      // 用户日志实现自身抛错不应阻断主流程
    }
  }
  const nodes = parseHtmlBodyChildren(html)
  const ctx = new BuildContext(opts)
  const ir = buildIr(nodes, ctx)
  // 异步阶段：图片加载 + MathML→OMML 转换；都把异步 IO 集中在这里，
  // 让 builder 阶段保持同步。两者无依赖关系，可并行。
  await Promise.all([collectImages(ir, ctx), collectMath(ir, ctx)])
  return buildDocument(ir, ctx)
}

export async function htmlToDocx(
  html: string,
  options?: HtmlToDocxOptions | null,
): Promise<Uint8Array> {
  const doc = await htmlToDocument(html, options)
  return pack(doc)
}
