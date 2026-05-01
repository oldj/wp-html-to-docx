// Inline → docx 运行节点（TextRun / ExternalHyperlink / ImageRun / PageBreak / ImportedXmlComponent）

import {
  ExternalHyperlink,
  ImageRun,
  PageBreak,
  ShadingType,
  TextRun,
  type ParagraphChild,
} from 'docx'
import type { Inline, InlineStyle } from '../types.js'
import type { BuildContext } from '../ir/buildContext.js'
import { ommlToImported } from './ommlImport.js'

/**
 * 把 Inline[] 转成 docx 的 ParagraphChild[]
 * - text → TextRun（含 link 时再套一层 ExternalHyperlink）
 * - break → TextRun({ break: 1 })（行内 <br>）
 * - pageBreak → PageBreak run（行内 <wp-page-break>，OOXML 输出 <w:br w:type="page"/>）
 * - math → 行内 <m:oMath>（来自 ctx.mathOmml 的 OMML），转换失败退回 [math] 文本
 * - image：从 ctx.images 取已加载资产；缺失时按 onUnresolvedImage 决定 placeholder（用 alt 占位）/ skip
 */
export function inlinesToRuns(inlines: Inline[], ctx: BuildContext): ParagraphChild[] {
  const out: ParagraphChild[] = []
  for (const item of inlines) {
    if (item.kind === 'break') {
      out.push(new TextRun({ break: 1 }))
      continue
    }
    if (item.kind === 'pageBreak') {
      out.push(new PageBreak())
      continue
    }
    if (item.kind === 'text') {
      out.push(textRunFor(item.text, item.style))
      continue
    }
    if (item.kind === 'math') {
      const omml = ctx.mathOmml.get(item.mathml)
      // ParagraphChild 的类型签名不含 ImportedXmlComponent，但 docx 在序列化时
      // 只调用每个 child 的 prepForXml，运行时兼容。这里用 unknown 强转规避类型限制。
      const ic = omml !== undefined ? ommlToImported(omml) : null
      if (ic !== null) {
        out.push(ic as unknown as ParagraphChild)
      } else {
        // 转换失败 / 依赖缺失：退回 [math] 文本，与改造前行为一致
        out.push(textRunFor('[math]', {}))
      }
      continue
    }
    if (item.kind === 'image') {
      const asset = ctx.images.get(item.src)
      if (asset !== undefined) {
        const imageRun = new ImageRun({
          type: asset.type,
          data: asset.data,
          transformation: { width: asset.width, height: asset.height },
          altText:
            item.alt !== undefined && item.alt.length > 0
              ? { title: item.alt, description: item.alt, name: item.alt }
              : undefined,
        })
        // <a href><img></a>：当 image inline 携带 link 时，套一层 ExternalHyperlink，
        // 否则图片在 docx 中不可点击（IR 已正确写入 style.link，但 ImageRun 自身不消费）
        if (item.style.link) {
          out.push(
            new ExternalHyperlink({
              link: item.style.link,
              children: [imageRun],
            }),
          )
        } else {
          out.push(imageRun)
        }
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
  // 字体优先级：用户 style="font-family: ..." > <code> 默认 Consolas > 不指定
  const font = style.fontFamily ?? (style.code ? 'Consolas' : undefined)
  // 注：曾经写过 `style: 'CodeChar'` 来给行内代码挂字符样式，但 CodeChar 从未在
  // buildStyles 注册，Word 直接忽略 → 无视觉效果，仅靠下方 font='Consolas' 兜底。
  // 不挂未注册的样式 ID，避免误导读者「这里有样式可挂」。
  const run = new TextRun({
    text,
    bold: style.bold,
    italics: style.italic,
    underline: style.underline ? {} : undefined,
    strike: style.strike,
    font,
    color: style.color,
    size: style.fontSize,
    // 用 CLEAR（无图案）+ fill 表达「纯背景色」。SOLID 的语义是
    // 前景色 (color) 完全覆盖 fill，会得到纯前景色而非期望的填充色。
    shading:
      style.bgColor !== undefined
        ? { type: ShadingType.CLEAR, fill: style.bgColor }
        : undefined,
  })
  if (style.link) {
    return new ExternalHyperlink({
      link: style.link,
      children: [run],
    })
  }
  return run
}
