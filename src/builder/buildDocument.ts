// IR → docx.Document
// 注入 numbering、section properties（page/header/footer/pageNumber）、
// 文档级默认样式（字体 / 字号 / 语言）

import { Document, type IStylesOptions } from 'docx'
import type { Block } from '../types.js'
import type { BuildContext } from '../ir/buildContext.js'
import { DEFAULT_OPTIONS } from '../options.js'
import { safeNonNegativeInt } from '../utils/units.js'
import { blocksToChildren } from './blocks.js'
import { buildSection } from './buildSection.js'

export function buildDocument(ir: Block[], ctx: BuildContext): Document {
  const children = blocksToChildren(ir, ctx)
  const numberingConfig = ctx.numbering.map((entry) => ({
    reference: entry.reference,
    levels: entry.levels,
  }))
  const section = buildSection(ctx.options, children)
  return new Document({
    // OOXML core properties：透传给 docx 库写入 docProps/core.xml
    title: ctx.options.title,
    creator: ctx.options.creator,
    description: ctx.options.description,
    subject: ctx.options.subject,
    keywords: ctx.options.keywords,
    lastModifiedBy: ctx.options.lastModifiedBy,
    styles: buildStyles(ctx),
    numbering:
      numberingConfig.length > 0 ? { config: numberingConfig } : undefined,
    sections: [section],
  })
}

/** 把 defaultFont / defaultFontSize / language 注入文档级默认样式 */
function buildStyles(ctx: BuildContext): IStylesOptions {
  const font = ctx.options.defaultFont ?? DEFAULT_OPTIONS.defaultFont
  // 字号防御：NaN / 负数 / 非数字回退到默认（22 半磅 = 11pt）
  const size = safeNonNegativeInt(
    ctx.options.defaultFontSize,
    DEFAULT_OPTIONS.defaultFontSize,
  )
  // 仅当 language 至少有一个子字段非空时才挂；空对象会让 docx 写出无意义的 <w:lang/>
  const lang = ctx.options.language
  const hasLang =
    lang !== undefined &&
    (lang.value !== undefined ||
      lang.eastAsia !== undefined ||
      lang.bidirectional !== undefined)
  return {
    default: {
      document: {
        run: {
          font,
          size,
          ...(hasLang ? { language: lang } : {}),
        },
      },
    },
  }
}
