// 统一单位换算
// docx 内部使用 twip（1/1440 inch）作为页面/边距单位

import {
  DEFAULT_OPTIONS,
  type CustomPageSize,
  type HtmlToDocxOptions,
  type LengthUnit,
  type PaperSize,
} from '../options.js'
import { makeWarn, type WarnFn } from './log.js'

/** 1 inch = 1440 twip */
const TWIP_PER_INCH = 1440
/** 1 inch = 25.4 mm */
const MM_PER_INCH = 25.4
/** 1 inch = 72 pt */
const PT_PER_INCH = 72
/** 1 inch = 96 px（CSS 像素，docx ImageRun.transformation 约定的单位） */
const PX_PER_INCH = 96

export function toTwip(value: number, unit: LengthUnit): number {
  if (unit === 'in') return Math.round(value * TWIP_PER_INCH)
  if (unit === 'mm') return Math.round((value / MM_PER_INCH) * TWIP_PER_INCH)
  // pt
  return Math.round((value / PT_PER_INCH) * TWIP_PER_INCH)
}

/** 标准纸张尺寸（mm） */
const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  Tabloid: { width: 279.4, height: 431.8 },
}

/**
 * 把纸张尺寸解析为 portrait 方向下的 twip 宽高。
 * 注意：docx 库的 IPageSizeAttributes 会根据 orientation 标志自行处理纵横，
 * 因此这里始终返回 portrait 尺寸，不在此交换宽高。
 *
 * JS 调用方可能传入未在 PaperSize 联合中的字符串（拼写错误 / 类型断言绕过），
 * 此时给出 warning 并降级到 A4，避免 NPE 让整次构建崩溃。
 *
 * @param warn 警告出口；调用方传入经 makeWarn(logger) 构造的函数，缺省退 console.warn
 */
export function resolvePageSizeTwip(
  size: PaperSize | CustomPageSize,
  warn: WarnFn = makeWarn(undefined),
): {
  width: number
  height: number
} {
  if (typeof size === 'string') {
    const paper = PAPER_MM[size] ?? PAPER_MM.A4
    if (PAPER_MM[size] === undefined) {
      warn(`wp-html-to-docx: unknown PaperSize "${size}", falling back to A4`)
    }
    return {
      width: toTwip(paper.width, 'mm'),
      height: toTwip(paper.height, 'mm'),
    }
  }
  const unit = size.unit ?? 'pt'
  return {
    width: toTwip(size.width, unit),
    height: toTwip(size.height, unit),
  }
}

/**
 * 把可选的长度值换算为 twip。当值非有限正数（NaN / 负数 / 字符串 / undefined 等）
 * 时返回 fallback；fallback 本身也校验，确保 OOXML 永远不会写出非法数。
 *
 * 用于 page.margin、defaultFontSize、pageNumber.start 等用户可见数值入口。
 */
export function safeTwip(value: unknown, unit: LengthUnit, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return toTwip(value, unit)
  }
  return toTwip(fallback, unit)
}

/** 校验非负有限整数；非法时返回 fallback。用于 fontSize / pageNumber.start 等无单位整数 */
export function safeNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value)
  }
  return fallback
}

/**
 * 页面正文可用宽度（CSS 像素）= 页宽 − 左右页边距。
 * 用于把图片的百分比宽度（如 "100%"）换算成像素，并对超宽图片做 clamp。
 * 与 buildSection 的尺寸/边距解析保持一致：始终用 portrait 尺寸 + orientation 决定实际页宽。
 */
export function pageContentWidthPx(options: HtmlToDocxOptions): number {
  return (pageContentWidthTwip(options) / TWIP_PER_INCH) * PX_PER_INCH
}

/**
 * 页面正文可用宽度（twip）= 页宽 − 左右页边距。
 * 表格网格（`tblGrid` 的 `gridCol`）以 twip 计，故与 pageContentWidthPx 共用同一套解析。
 */
export function pageContentWidthTwip(options: HtmlToDocxOptions): number {
  const page = options.page ?? {}
  const orientation = page.orientation ?? DEFAULT_OPTIONS.page.orientation
  const dim = resolvePageSizeTwip(page.size ?? DEFAULT_OPTIONS.page.size, makeWarn(options.logger))
  // resolvePageSizeTwip 始终返回 portrait 宽高；横向时实际页宽取其 height
  const pageWidthTwip = orientation === 'landscape' ? dim.height : dim.width
  const m = { ...DEFAULT_OPTIONS.page.margin, ...(page.margin ?? {}) }
  const unit = m.unit ?? DEFAULT_OPTIONS.page.margin.unit
  const def = DEFAULT_OPTIONS.page.margin
  const left = safeTwip(m.left, unit, def.left)
  const right = safeTwip(m.right, unit, def.right)
  return Math.max(1, pageWidthTwip - left - right)
}
