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
    if (slots[pn.slot] !== undefined && slots[pn.slot] !== '') {
      // eslint-disable-next-line no-console
      console.warn(
        `pageNumber.position '${pn.slot}' overlaps with existing ${region} content; pageNumber takes priority`,
      )
    }
    slots[pn.slot] = '__PAGE_NUMBER_TOKEN__' + pn.template
  }
  if (slots.left === undefined && slots.center === undefined && slots.right === undefined) {
    return []
  }
  return [composeThreeSlotParagraph(slots)]
}

function normalizeSlots(value: HeaderFooterValue | undefined): Record<Slot, string | undefined> {
  if (value === undefined) return { left: undefined, center: undefined, right: undefined }
  if (typeof value === 'string') return { left: value, center: undefined, right: undefined }
  return { left: value.left, center: value.center, right: value.right }
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

function composeThreeSlotParagraph(slots: Record<Slot, string | undefined>): Paragraph {
  // 单段三槽对齐：left / center / right，用 tab stops 实现
  // 中部 tab 在页面中间（4500 twip），右部 tab 在页面右侧（约 9000 twip / Letter 内宽 6.5in）
  const children: ParagraphChild[] = []
  if (slots.left !== undefined) children.push(...renderSlot(slots.left))
  const hasCenter = slots.center !== undefined
  const hasRight = slots.right !== undefined
  if (hasCenter) {
    children.push(new TextRun({ children: [new Tab()] }))
    children.push(...renderSlot(slots.center as string))
  }
  if (hasRight) {
    children.push(new TextRun({ children: [new Tab()] }))
    children.push(...renderSlot(slots.right as string))
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

function renderSlot(text: string): ParagraphChild[] {
  // 含页码模板：拆解为字面文本 + PageNumber 字段
  const TOKEN = '__PAGE_NUMBER_TOKEN__'
  if (text.startsWith(TOKEN)) {
    const tmpl = text.slice(TOKEN.length)
    return [renderPageNumberRun(tmpl)]
  }
  return [new TextRun({ text })]
}

function renderPageNumberRun(template: string): TextRun {
  // 拆 {PAGE} 与 {TOTAL}
  type Part = string | typeof PageNumber.CURRENT | typeof PageNumber.TOTAL_PAGES
  const parts: Part[] = []
  let rest = template
  // eslint-disable-next-line no-constant-condition
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
