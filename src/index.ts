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

export type {
  HtmlToDocxOptions,
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
  options: HtmlToDocxOptions = {},
): Promise<Document> {
  const nodes = parseHtmlBodyChildren(html)
  const ctx = new BuildContext(options)
  const ir = buildIr(nodes, ctx)
  // 异步阶段：图片加载 + MathML→OMML 转换；都把异步 IO 集中在这里，
  // 让 builder 阶段保持同步。两者无依赖关系，可并行。
  await Promise.all([collectImages(ir, ctx), collectMath(ir, ctx)])
  return buildDocument(ir, ctx)
}

export async function htmlToDocx(
  html: string,
  options: HtmlToDocxOptions = {},
): Promise<Uint8Array> {
  const doc = await htmlToDocument(html, options)
  return pack(doc)
}
