// IR → docx.Document
// 注入 numbering、section properties（page/header/footer/pageNumber）、styles 默认字体

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
    title: ctx.options.title,
    creator: ctx.options.creator,
    description: ctx.options.description,
    styles: buildStyles(ctx),
    numbering:
      numberingConfig.length > 0 ? { config: numberingConfig } : undefined,
    sections: [section],
  })
}

/** 把 defaultFont / defaultFontSize 注入文档级默认样式 */
function buildStyles(ctx: BuildContext): IStylesOptions {
  const font = ctx.options.defaultFont ?? DEFAULT_OPTIONS.defaultFont
  // 字号防御：NaN / 负数 / 非数字回退到默认（22 半磅 = 11pt）
  const size = safeNonNegativeInt(
    ctx.options.defaultFontSize,
    DEFAULT_OPTIONS.defaultFontSize,
  )
  return {
    default: {
      document: {
        run: { font, size },
      },
    },
  }
}
