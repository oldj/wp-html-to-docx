// Inline → docx 运行节点（TextRun / ExternalHyperlink / ImageRun / PageBreak / ImportedXmlComponent）

import {
  ExternalHyperlink,
  FootnoteReferenceRun,
  ImageRun,
  PageBreak,
  ShadingType,
  TextRun,
  type ParagraphChild,
} from 'docx'
import type { Inline, InlineStyle } from '../types.js'
import type { BuildContext } from '../ir/buildContext.js'
import { pageContentWidthPx } from '../utils/units.js'
import { silentWarn } from '../utils/log.js'
import { mathFallbackText, renderMath } from './ommlImport.js'
import { resolveImageDisplaySize } from './imageLayout.js'

/**
 * 把 Inline[] 转成 docx 的 ParagraphChild[]
 * - text → TextRun（含 link 时再套一层 ExternalHyperlink）
 * - break → TextRun({ break: 1 })（行内 <br>）
 * - pageBreak → PageBreak run（行内 <wp-page-break>，OOXML 输出 <w:br w:type="page"/>）
 * - math → 行内 <m:oMath>（OMML 或 latexToMath 组件，见 renderMath），都不可用时退回 TeX 源码或 [math] 文本
 * - image：从 ctx.images 取已加载资产；缺失时按 onUnresolvedImage 决定 placeholder（用 alt 占位）/ skip
 */
export function inlinesToRuns(inlines: Inline[], ctx: BuildContext): ParagraphChild[] {
  const out: ParagraphChild[] = []
  // 图片百分比宽度的换算基准、以及超宽图片的 clamp 上限：页面正文可用宽度（像素）
  // 纸张名非法的警告由 buildSection 统一发出一次；这里逐段重算，静默以免每段都告警
  const contentWidthPx = pageContentWidthPx(ctx.options, silentWarn)
  for (const item of inlines) {
    if (item.kind === 'break') {
      out.push(new TextRun({ break: 1 }))
      continue
    }
    if (item.kind === 'pageBreak') {
      out.push(new PageBreak())
      continue
    }
    if (item.kind === 'footnoteRef') {
      // 据锚点 id 在 ctx.footnotes 查到数字 id，输出 docx 脚注引用（Word 自动编号上标）
      const fn = ctx.footnotes.get(item.target)
      if (fn !== undefined) out.push(new FootnoteReferenceRun(fn.number))
      // 未找到定义（引用了不存在的脚注）：跳过，不产生引用标记
      continue
    }
    if (item.kind === 'text') {
      out.push(textRunFor(item.text, item.style))
      continue
    }
    if (item.kind === 'math') {
      // 段内公式一律按行内渲染（即便声明了 display=block：与文字混排时不能独占一段）；
      // 两种转换都不可用时退回 TeX 源码（$…$）或 [math] 文本
      const run = renderMath(item.mathml, 'inline', ctx)
      out.push(run ?? textRunFor(mathFallbackText(item.tex, item.display ?? 'inline'), {}))
      continue
    }
    if (item.kind === 'image') {
      const asset = ctx.images.get(item.src)
      if (asset !== undefined) {
        // 依据固有尺寸 + <img> 显式宽高（含百分比）算出最终显示尺寸，并 clamp 到版心宽度。
        // 满宽（data-full-width）等价于 width:100% 且忽略显式高度，优先级高于具体 width。
        const explicit = item.fullWidth
          ? { width: '100%', height: undefined }
          : { width: item.width, height: item.height }
        const size = resolveImageDisplaySize(
          { width: asset.width, height: asset.height },
          explicit,
          contentWidthPx,
        )
        const imageRun = new ImageRun({
          type: asset.type,
          data: asset.data,
          transformation: { width: size.width, height: size.height },
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
    // 链接文字挂 Word 内置的 Hyperlink 字符样式（蓝色 + 下划线，docx 默认样式表自带）；
    // 不挂的话 <w:hyperlink> 能点但外观与正文无异。用户显式的 color 等属于直接格式，仍会覆盖样式
    style: style.link ? 'Hyperlink' : undefined,
    bold: style.bold,
    italics: style.italic,
    underline: style.underline ? {} : undefined,
    strike: style.strike,
    // 上下标在 OOXML 中由互斥的 <w:vertAlign> 表达；两者同真时让上标优先，
    // 下标显式置假，避免 docx 同时写出两个 vertAlign。
    superScript: style.superScript,
    subScript: style.subScript && !style.superScript,
    font,
    color: style.color,
    size: style.fontSize,
    // 用 CLEAR（无图案）+ fill 表达「纯背景色」。SOLID 的语义是
    // 前景色 (color) 完全覆盖 fill，会得到纯前景色而非期望的填充色。
    shading:
      style.bgColor !== undefined ? { type: ShadingType.CLEAR, fill: style.bgColor } : undefined,
  })
  if (style.link) {
    return new ExternalHyperlink({
      link: style.link,
      children: [run],
    })
  }
  return run
}
