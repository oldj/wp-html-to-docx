// 把 HtmlToDocxOptions 编译成 ISectionOptions：
//  - properties.page.size / margin / pageNumbers
//  - headers / footers
// 页码占位 {PAGE} {TOTAL} 替换为 PageNumber.CURRENT / TOTAL_PAGES

import {
  AlignmentType,
  Footer,
  Header,
  NumberFormat,
  PageNumber,
  PageOrientation,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type FileChild,
  type IPageMarginAttributes,
  type IPageNumberTypeAttributes,
  type IPageSizeAttributes,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx'
import {
  DEFAULT_OPTIONS,
  type HeaderFooterValue,
  type HtmlToDocxOptions,
  type PageNumberOptions,
  type PageNumberPosition,
} from '../options.js'
import {
  pageContentWidthTwip,
  resolvePageSizeTwip,
  safeNonNegativeInt,
  safeTwip,
} from '../utils/units.js'
import { makeWarn, silentWarn, type WarnFn } from '../utils/log.js'

type Slot = 'left' | 'center' | 'right'
type Region = 'header' | 'footer'

// 槽位内容：用对象 marker 区分用户文本与页码模板，避免靠字符串前缀判别
type SlotContent = { kind: 'text'; text: string } | { kind: 'pageNumber'; template: string }

export function buildSection(
  options: HtmlToDocxOptions,
  children: readonly FileChild[],
): ISectionOptions {
  const warn = makeWarn(options.logger)
  const page = options.page ?? {}
  const orientation = page.orientation ?? DEFAULT_OPTIONS.page.orientation
  const size = resolveSize(page.size ?? DEFAULT_OPTIONS.page.size, orientation, warn)
  const margin = resolveMargin(options)
  const pageNumbers = resolvePageNumbers(options.pageNumber)
  // 页眉页脚三槽的 tab stop 要落在本节版心的中点与右沿。
  // 纸张名非法的警告上面 resolveSize 已发过，这里静默，避免同一问题告警两次
  const contentWidth = pageContentWidthTwip(options, silentWarn)

  const headerParagraphs = buildHeaderFooterParagraphs(
    options.header,
    'header',
    options.pageNumber,
    contentWidth,
    warn,
  )
  const footerParagraphs = buildHeaderFooterParagraphs(
    options.footer,
    'footer',
    options.pageNumber,
    contentWidth,
    warn,
  )

  return {
    properties: {
      page: {
        size,
        margin,
        pageNumbers,
      },
    },
    headers:
      headerParagraphs.length > 0
        ? { default: new Header({ children: headerParagraphs }) }
        : undefined,
    footers:
      footerParagraphs.length > 0
        ? { default: new Footer({ children: footerParagraphs }) }
        : undefined,
    children,
  }
}

function resolveSize(
  size: NonNullable<HtmlToDocxOptions['page']>['size'] & {},
  orientation: 'portrait' | 'landscape',
  warn: WarnFn,
): IPageSizeAttributes {
  // 始终传 portrait 尺寸 + orientation 标志，由 docx 决定最终纵横呈现
  const dim = resolvePageSizeTwip(size, warn)
  return {
    width: dim.width,
    height: dim.height,
    orientation: orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
  }
}

function resolveMargin(options: HtmlToDocxOptions): IPageMarginAttributes {
  const m = { ...DEFAULT_OPTIONS.page.margin, ...(options.page?.margin ?? {}) }
  const unit = m.unit ?? DEFAULT_OPTIONS.page.margin.unit
  const def = DEFAULT_OPTIONS.page.margin
  // 任一字段非有限非负数（NaN / 负数 / 字符串 as any）都回退到默认值，
  // 避免 NaN 进 OOXML 让 Word 报「文件已损坏」、负 margin 让 Word 拒开
  return {
    top: safeTwip(m.top, unit, def.top),
    right: safeTwip(m.right, unit, def.right),
    bottom: safeTwip(m.bottom, unit, def.bottom),
    left: safeTwip(m.left, unit, def.left),
    header: safeTwip(m.header, unit, def.header),
    footer: safeTwip(m.footer, unit, def.footer),
  }
}

function resolvePageNumbers(
  options: PageNumberOptions | undefined,
): IPageNumberTypeAttributes | undefined {
  if (options === undefined || options.enabled !== true) return undefined
  const formatMap = {
    decimal: NumberFormat.DECIMAL,
    upperRoman: NumberFormat.UPPER_ROMAN,
    lowerRoman: NumberFormat.LOWER_ROMAN,
    upperLetter: NumberFormat.UPPER_LETTER,
    lowerLetter: NumberFormat.LOWER_LETTER,
  } as const
  return {
    // start 同样防御 NaN / 负数 / 非数字
    start: safeNonNegativeInt(options.start, 1),
    formatType: options.format ? formatMap[options.format] : NumberFormat.DECIMAL,
  }
}

function buildHeaderFooterParagraphs(
  value: HeaderFooterValue | undefined,
  region: Region,
  pageNumber: PageNumberOptions | undefined,
  contentWidth: number,
  warn: WarnFn,
): Paragraph[] {
  const slots = normalizeSlots(value)
  const pn = resolveSlottedPageNumber(pageNumber, region)
  if (pn !== null) {
    // 把页码内容放进对应槽位（覆盖；与原内容并存时给出 warning）
    const existing = slots[pn.slot]
    if (existing !== undefined && !(existing.kind === 'text' && existing.text === '')) {
      warn(
        `pageNumber.position '${pn.slot}' overlaps with existing ${region} content; pageNumber takes priority`,
      )
    }
    slots[pn.slot] = { kind: 'pageNumber', template: pn.template }
  }
  if (slots.left === undefined && slots.center === undefined && slots.right === undefined) {
    return []
  }
  return [composeThreeSlotParagraph(slots, contentWidth)]
}

function normalizeSlots(
  value: HeaderFooterValue | undefined,
): Record<Slot, SlotContent | undefined> {
  if (value === undefined) return { left: undefined, center: undefined, right: undefined }
  if (typeof value === 'string') {
    return { left: { kind: 'text', text: value }, center: undefined, right: undefined }
  }
  return {
    left: value.left !== undefined ? { kind: 'text', text: value.left } : undefined,
    center: value.center !== undefined ? { kind: 'text', text: value.center } : undefined,
    right: value.right !== undefined ? { kind: 'text', text: value.right } : undefined,
  }
}

function resolveSlottedPageNumber(
  options: PageNumberOptions | undefined,
  region: Region,
): { slot: Slot; template: string } | null {
  if (options === undefined || options.enabled !== true) return null
  const position: PageNumberPosition = options.position ?? 'footer-center'
  const [pos, slot] = position.split('-') as [Region, Slot]
  if (pos !== region) return null
  return { slot, template: options.template ?? '{PAGE}' }
}

/**
 * 单段三槽对齐：left / center / right，用 tab stops 实现。
 * @param contentWidth 版心宽度（twip）。tab stop 位置相对左边距起算，故中部取其一半、右部取其全宽；
 *   不能写死常量，否则横向 / 大纸张 / 自定义边距时右槽会落在页面中部
 */
function composeThreeSlotParagraph(
  slots: Record<Slot, SlotContent | undefined>,
  contentWidth: number,
): Paragraph {
  const children: ParagraphChild[] = []
  if (slots.left !== undefined) children.push(...renderSlot(slots.left))
  if (slots.center !== undefined) {
    children.push(new TextRun({ children: [new Tab()] }))
    children.push(...renderSlot(slots.center))
  }
  if (slots.right !== undefined) {
    children.push(new TextRun({ children: [new Tab()] }))
    children.push(...renderSlot(slots.right))
  }
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    tabStops: [
      { type: TabStopType.CENTER, position: Math.round(contentWidth / 2) },
      { type: TabStopType.RIGHT, position: contentWidth },
    ],
    children,
  })
}

function renderSlot(content: SlotContent): ParagraphChild[] {
  if (content.kind === 'pageNumber') {
    return [renderPageNumberRun(content.template)]
  }
  return [new TextRun({ text: content.text })]
}

function renderPageNumberRun(template: string): TextRun {
  // 拆 {PAGE} 与 {TOTAL}
  type Part = string | typeof PageNumber.CURRENT | typeof PageNumber.TOTAL_PAGES
  const parts: Part[] = []
  let rest = template
  while (true) {
    const match = /\{(PAGE|TOTAL)\}/.exec(rest)
    if (!match) {
      if (rest.length > 0) parts.push(rest)
      break
    }
    if (match.index > 0) parts.push(rest.slice(0, match.index))
    parts.push(match[1] === 'PAGE' ? PageNumber.CURRENT : PageNumber.TOTAL_PAGES)
    rest = rest.slice(match.index + match[0].length)
  }
  return new TextRun({ children: parts })
}
