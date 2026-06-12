// 计算图片在 docx 中的最终显示尺寸（像素，docx 库内部再转 EMU）。
//
// 规则：
// - 显式宽度可为像素（"300" / "300px"）或百分比（"100%"，相对页面正文可用宽度）。
// - 只给宽度时按固有宽高比推高度；只给高度时按比例推宽度；都给则直接用；都不给用固有尺寸。
// - 最终宽度 clamp 到页面正文宽度（图片不溢出版心），高度等比缩放。
// - 百分比仅对宽度生效；高度的百分比无明确参照，忽略（退回按比例）。

export type PixelSize = { width: number; height: number }

export function resolveImageDisplaySize(
  intrinsic: PixelSize,
  explicit: { width?: string; height?: string },
  pageContentWidthPx: number,
): PixelSize {
  const iw = intrinsic.width > 0 ? intrinsic.width : 1
  const ih = intrinsic.height > 0 ? intrinsic.height : 1
  const aspect = iw / ih

  const ew = parseLength(explicit.width, pageContentWidthPx)
  const eh = parseLength(explicit.height, null) // 高度不解析百分比

  let width: number
  let height: number
  if (ew !== null && eh !== null) {
    width = ew
    height = eh
  } else if (ew !== null) {
    width = ew
    height = ew / aspect
  } else if (eh !== null) {
    height = eh
    width = eh * aspect
  } else {
    width = iw
    height = ih
  }

  // clamp 到版心宽度，按比例缩高，避免图片宽于可用宽度而溢出页面
  if (pageContentWidthPx > 0 && width > pageContentWidthPx) {
    height = height * (pageContentWidthPx / width)
    width = pageContentWidthPx
  }

  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
}

/**
 * 解析长度字符串为像素。
 * - "100%" / "100% !important" → percentBase * 100 / 100（percentBase 为 null 时返回 null，即忽略）
 * - "300" / "300px" → 300
 * - "10em" / "50vw" / "auto" 等不支持的单位、非正数、非法、undefined → null（退回按固有尺寸处理）
 */
function parseLength(value: string | undefined, percentBase: number | null): number | null {
  if (value === undefined) return null
  // 先剥掉 CSS `!important` 优先级标记（粘贴自网页的样式常带它）。
  // 否则 "100% !important" 不以 % 结尾，会落到下面的数字分支被误判成 100px。
  const s = value
    .trim()
    .replace(/\s*!\s*important$/i, '')
    .trim()
  if (s === '') return null
  if (s.endsWith('%')) {
    if (percentBase === null) return null
    const n = parseFloat(s)
    return Number.isFinite(n) && n > 0 ? (percentBase * n) / 100 : null
  }
  // 仅接受裸数字或 px 后缀；em / vw / pt 等无可靠像素换算的单位返回 null，退回按固有尺寸处理，
  // 避免把 "10em" 当成 10px 让图片严重缩小。先用正则严格校验格式，再交给 parseFloat 忽略尾部 px。
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)\s*(?:px)?$/i.test(s)) return null
  const n = parseFloat(s)
  return n > 0 ? n : null
}
