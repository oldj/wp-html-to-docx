// Inline → docx 运行节点（TextRun / ExternalHyperlink+TextRun / ImageRun）

import { ExternalHyperlink, ImageRun, TextRun, type ParagraphChild } from 'docx'
import type { Inline, InlineStyle } from '../types.js'
import type { BuildContext } from '../ir/buildContext.js'

/**
 * 把 Inline[] 转成 docx 的 ParagraphChild[]
 * - text → TextRun
 * - text + link → ExternalHyperlink({ children: [TextRun] })
 * - break → TextRun({ break: 1 })
 * - image：从 ctx.images 取已加载资产；缺失时 'placeholder' 用 alt 文本，'skip' 跳过
 */
export function inlinesToRuns(inlines: Inline[], ctx: BuildContext): ParagraphChild[] {
  const out: ParagraphChild[] = []
  for (const item of inlines) {
    if (item.kind === 'break') {
      out.push(new TextRun({ break: 1 }))
      continue
    }
    if (item.kind === 'text') {
      out.push(textRunFor(item.text, item.style))
      continue
    }
    if (item.kind === 'image') {
      const asset = ctx.images.get(item.src)
      if (asset !== undefined) {
        out.push(
          new ImageRun({
            type: asset.type,
            data: asset.data,
            transformation: { width: asset.width, height: asset.height },
            altText:
              item.alt !== undefined && item.alt.length > 0
                ? { title: item.alt, description: item.alt, name: item.alt }
                : undefined,
          }),
        )
        continue
      }
      // 未加载（resolver 未配 / 加载失败 / 策略 skip）
      const policy = ctx.options.onUnresolvedImage ?? 'skip'
      if (policy === 'placeholder') {
        const fallback = item.alt ?? '[image]'
        out.push(textRunFor(fallback, item.style))
      }
      // skip：直接跳过，不输出任何内容
    }
  }
  return out
}

function textRunFor(text: string, style: InlineStyle): ParagraphChild {
  const run = new TextRun({
    text,
    bold: style.bold,
    italics: style.italic,
    underline: style.underline ? {} : undefined,
    strike: style.strike,
    style: style.code ? 'CodeChar' : undefined,
    font: style.code ? 'Consolas' : undefined,
  })
  if (style.link) {
    return new ExternalHyperlink({
      link: style.link,
      children: [run],
    })
  }
  return run
}
