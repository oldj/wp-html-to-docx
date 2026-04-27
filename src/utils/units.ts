// 统一单位换算
// docx 内部使用 twip（1/1440 inch）作为页面/边距单位

import type { CustomPageSize, LengthUnit, PaperSize } from '../options.js'

/** 1 inch = 1440 twip */
const TWIP_PER_INCH = 1440
/** 1 inch = 25.4 mm */
const MM_PER_INCH = 25.4
/** 1 inch = 72 pt */
const PT_PER_INCH = 72

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
 */
export function resolvePageSizeTwip(
  size: PaperSize | CustomPageSize,
): { width: number; height: number } {
  if (typeof size === 'string') {
    const paper = PAPER_MM[size]
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
