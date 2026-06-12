// IR → docx.Document
// 注入 numbering、section properties（page/header/footer/pageNumber）、
// 文档级默认样式（字体 / 字号 / 语言）

import { Document, Paragraph, type IStylesOptions } from 'docx'
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
  const footnotes = buildFootnotes(ctx)
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
    footnotes: Object.keys(footnotes).length > 0 ? footnotes : undefined,
    sections: [section],
  })
}

/**
 * 把 ctx.footnotes 组装成 docx 的 footnotes 配置（id → { children: Paragraph[] }）。
 * docx 的脚注内容仅接受 Paragraph，故从 blocksToChildren 结果中过滤掉非段落块
 * （如表格——脚注内极少见）；过滤后为空时兜底一个空段，避免产生无内容脚注。
 */
function buildFootnotes(ctx: BuildContext): Record<string, { children: Paragraph[] }> {
  const out: Record<string, { children: Paragraph[] }> = {}
  for (const fn of ctx.footnotes.values()) {
    const paras = blocksToChildren(fn.blocks, ctx).filter(
      (c): c is Paragraph => c instanceof Paragraph,
    )
    out[String(fn.number)] = {
      children: paras.length > 0 ? paras : [new Paragraph({})],
    }
  }
  return out
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
