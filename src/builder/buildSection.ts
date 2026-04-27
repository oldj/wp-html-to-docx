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
  TabStopPosition,
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
import { resolvePageSizeTwip, toTwip } from '../utils/units.js'

type Slot = 'left' | 'center' | 'right'
type Region = 'header' | 'footer'

// 槽位内容：用对象 marker 区分用户文本与页码模板，避免靠字符串前缀判别
type SlotContent =
  | { kind: 'text'; text: string }
  | { kind: 'pageNumber'; template: string }

export function buildSection(
  options: HtmlToDocxOptions,
  children: readonly FileChild[],
): ISectionOptions {
  const page = options.page ?? {}
  const orientation = page.orientation ?? DEFAULT_OPTIONS.page.orientation
  const size = resolveSize(page.size ?? DEFAULT_OPTIONS.page.size, orientation)
  const margin = resolveMargin(options)
  const pageNumbers = resolvePageNumbers(options.pageNumber)

  const headerParagraphs = buildHeaderFooterParagraphs(
    options.header,
    'header',
    options.pageNumber,
  )
  const footerParagraphs = buildHeaderFooterParagraphs(
    options.footer,
    'footer',
    options.pageNumber,
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
): IPageSizeAttributes {
  // 始终传 portrait 尺寸 + orientation 标志，由 docx 决定最终纵横呈现
  const dim = resolvePageSizeTwip(size)
  return {
    width: dim.width,
    height: dim.height,
    orientation:
      orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
  }
}

function resolveMargin(options: HtmlToDocxOptions): IPageMarginAttributes {
  const m = { ...DEFAULT_OPTIONS.page.margin, ...(options.page?.margin ?? {}) }
  const unit = m.unit ?? DEFAULT_OPTIONS.page.margin.unit
  return {
    top: toTwip(m.top, unit),
    right: toTwip(m.right, unit),
    bottom: toTwip(m.bottom, unit),
    left: toTwip(m.left, unit),
    header: toTwip(m.header, unit),
    footer: toTwip(m.footer, unit),
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
    start: options.start ?? 1,
    formatType: options.format ? formatMap[options.format] : NumberFormat.DECIMAL,
  }
}

function buildHeaderFooterParagraphs(
  value: HeaderFooterValue | undefined,
  region: Region,
  pageNumber: PageNumberOptions | undefined,
): Paragraph[] {
  const slots = normalizeSlots(value)
  const pn = resolveSlottedPageNumber(pageNumber, region)
  if (pn !== null) {
    // 把页码内容放进对应槽位（覆盖；与原内容并存时给出 console.warn）
    const existing = slots[pn.slot]
    if (existing !== undefined && !(existing.kind === 'text' && existing.text === '')) {
      console.warn(
        `pageNumber.position '${pn.slot}' overlaps with existing ${region} content; pageNumber takes priority`,
      )
    }
    slots[pn.slot] = { kind: 'pageNumber', template: pn.template }
  }
  if (slots.left === undefined && slots.center === undefined && slots.right === undefined) {
    return []
  }
  return [composeThreeSlotParagraph(slots)]
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

function composeThreeSlotParagraph(
  slots: Record<Slot, SlotContent | undefined>,
): Paragraph {
  // 单段三槽对齐：left / center / right，用 tab stops 实现
  // 中部 tab 在页面中间（4500 twip），右部 tab 在页面右侧（约 9000 twip / Letter 内宽 6.5in）
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
      { type: TabStopType.CENTER, position: TabStopPosition.MAX / 2 },
      { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
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
