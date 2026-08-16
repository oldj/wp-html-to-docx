// 极简 CSS 内联样式解析
// 范围严格按 plan.md「进阶 B」框定：只处理 InlineStyle / Paragraph 直接需要的属性，
// 不实现选择器、cascade、specificity、计算样式等浏览器引擎才需要的复杂度

/**
 * 把 `"color: red; font-size: 14pt"` 拆成 `{ color: 'red', 'font-size': '14pt' }`
 * - key 全部小写、trim
 * - value 保留原样 trim
 * - 重复 key 后写覆盖前写（与浏览器一致的就地覆盖语义）
 * - 解析失败的片段（缺冒号等）静默跳过
 */
export function parseInlineStyle(source: string | undefined): Record<string, string> {
  if (source === undefined) return {}
  const out: Record<string, string> = {}
  for (const decl of source.split(';')) {
    const idx = decl.indexOf(':')
    if (idx <= 0) continue
    const key = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if (key.length === 0 || value.length === 0) continue
    out[key] = value
  }
  return out
}

// 命名颜色：覆盖最常见的几十个，足以满足 WP 文章迁移这种实际场景
// 完整 CSS 命名色列表有 140+ 个，按需扩展即可
const NAMED_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  orange: 'FFA500',
  purple: '800080',
  pink: 'FFC0CB',
  brown: 'A52A2A',
  gray: '808080',
  grey: '808080',
  silver: 'C0C0C0',
  gold: 'FFD700',
  navy: '000080',
  teal: '008080',
  lime: '00FF00',
  cyan: '00FFFF',
  aqua: '00FFFF',
  magenta: 'FF00FF',
  fuchsia: 'FF00FF',
  maroon: '800000',
  olive: '808000',
  darkgray: 'A9A9A9',
  darkgrey: 'A9A9A9',
  lightgray: 'D3D3D3',
  lightgrey: 'D3D3D3',
}

/**
 * 把 CSS 颜色字符串解析为 docx 用的 6 位大写 hex（无 # 前缀）。
 * 支持：命名色、`#RGB`、`#RRGGBB`、`rgb(r,g,b)` / `rgb(r g b)`。
 * 透明 / 不可识别值返回 undefined。
 */
export function parseColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const v = value.trim().toLowerCase()
  if (v.length === 0 || v === 'transparent' || v === 'currentcolor' || v === 'inherit') {
    return undefined
  }
  // 命名色
  const named = NAMED_COLORS[v]
  if (named !== undefined) return named
  // #RGB / #RRGGBB
  if (v.startsWith('#')) {
    const hex = v.slice(1)
    if (/^[0-9a-f]{3}$/.test(hex)) {
      // #RGB → #RRGGBB
      return (hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!).toUpperCase()
    }
    if (/^[0-9a-f]{6}$/.test(hex)) return hex.toUpperCase()
    return undefined
  }
  // rgb(r,g,b) — 不处理 rgba（涉及不透明度合成，超出范围）
  const rgb = /^rgb\(\s*(-?\d+)[\s,]+(-?\d+)[\s,]+(-?\d+)\s*\)$/.exec(v)
  if (rgb) {
    const r = clampByte(parseInt(rgb[1]!, 10))
    const g = clampByte(parseInt(rgb[2]!, 10))
    const b = clampByte(parseInt(rgb[3]!, 10))
    return [r, g, b]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }
  return undefined
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 255) return 255
  return n
}

/**
 * 解析 font-size 为 docx TextRun.size 用的「半磅」整数。
 * 例：`14pt` → 28，`12px` → 18（12 * 0.75 * 2 = 18）。
 *
 * 单位换算约定：
 * - pt: 直接 *2
 * - px: 1px ≈ 0.75pt（96dpi web 标准）
 * - em / rem / %: 以 12pt 为参考基准（≈ Word 默认 11pt 的近似），便于把
 *   `font-size: 1.5em` 这类相对值映射到稳定的绝对值。如需更准确的层级
 *   计算，留给未来的 cascade 实现。
 *
 * 非有限数 / 不支持单位 / 非正值返回 undefined。
 */
export function parseFontSizeHalfPt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const m = /^(-?\d+(?:\.\d+)?)\s*(pt|px|em|rem|%)?$/i.exec(value.trim())
  if (!m) return undefined
  const n = parseFloat(m[1]!)
  if (!Number.isFinite(n) || n <= 0) return undefined
  const unit = (m[2] ?? 'px').toLowerCase()
  let halfPt: number
  switch (unit) {
    case 'pt':
      halfPt = n * 2
      break
    case 'px':
      halfPt = n * 1.5 // n * 0.75pt * 2 半磅
      break
    case 'em':
    case 'rem':
      halfPt = n * 24 // 12pt 基准 * 2
      break
    case '%':
      halfPt = (n / 100) * 24
      break
    default:
      return undefined
  }
  const rounded = Math.round(halfPt)
  return rounded > 0 ? rounded : undefined
}

/**
 * font-family 取首个候选（去引号），用于 `TextRun.font`。
 * 例：`"Helvetica Neue", sans-serif` → `Helvetica Neue`
 */
export function parseFontFamily(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const first = value.split(',')[0]?.trim()
  if (first === undefined || first.length === 0) return undefined
  return first.replace(/^['"]|['"]$/g, '').trim() || undefined
}

/** font-weight: bold / 数值 ≥ 600 视为粗体 */
export function isBoldWeight(value: string | undefined): boolean {
  if (value === undefined) return false
  const v = value.trim().toLowerCase()
  if (v === 'bold' || v === 'bolder') return true
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 600
}

/** 宽度声明的解析结果：`value` 为数值，`isPercent` 标记它是否为百分比 */
export type WidthValue = { value: number; isPercent: boolean }

/**
 * 解析 `<col>` / `<table>` 的宽度声明，用于表格列宽。
 * 接受 `25%`、`120px`、`120`（HTML 遗留属性的裸数字按像素）以及 `pt` / `em` 等其他 CSS 单位。
 *
 * 单位不做换算、原样带出：列宽最终只用来算**比例**，同一张表内单位一致时比例与单位无关；
 * 是否为百分比由 `isPercent` 单独给出，供表宽这种必须区分绝对值与相对值的场景判断。
 *
 * 非正数 / 无法识别（`auto`、`calc(...)` 等）返回 undefined。
 */
export function parseWidthValue(raw: string | undefined): WidthValue | undefined {
  if (raw === undefined) return undefined
  // 粘贴自网页的样式常带 `!important`，先剥掉，否则 "25% !important" 不以 % 结尾会被判成绝对值
  const s = raw
    .trim()
    .replace(/\s*!\s*important$/i, '')
    .trim()
  const m = /^(\d+(?:\.\d+)?|\.\d+)\s*(%|px|pt|pc|in|cm|mm|em|rem)?$/i.exec(s)
  if (!m) return undefined
  const value = parseFloat(m[1]!)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return { value, isPercent: m[2] === '%' }
}

/** text-align: 仅识别 left / right / center / justify */
export type BlockAlign = 'left' | 'right' | 'center' | 'justify'

export function parseTextAlign(value: string | undefined): BlockAlign | undefined {
  if (value === undefined) return undefined
  const v = value.trim().toLowerCase()
  if (v === 'left' || v === 'right' || v === 'center' || v === 'justify') return v
  return undefined
}

/**
 * 解析分页相关 CSS：兼容 legacy `page-break-before/after` 与 CSS3 `break-before/after`。
 * 返回 { before, after }，仅当声明被识别为「强制分页」时为 true；其他取值（auto / avoid 等）均为 false。
 *
 * 强制分页的取值：
 * - legacy: `always` / `left` / `right`
 * - CSS3:   `page` / `left` / `right` / `recto` / `verso` / `always` / `all`
 */
export type PageBreakSides = { before: boolean; after: boolean }

export function parsePageBreaks(decls: Record<string, string>): PageBreakSides {
  return {
    before:
      isForceBreak(decls['page-break-before'], 'legacy') ||
      isForceBreak(decls['break-before'], 'css3'),
    after:
      isForceBreak(decls['page-break-after'], 'legacy') ||
      isForceBreak(decls['break-after'], 'css3'),
  }
}

function isForceBreak(value: string | undefined, kind: 'legacy' | 'css3'): boolean {
  if (value === undefined) return false
  const v = value.trim().toLowerCase()
  if (kind === 'legacy') {
    return v === 'always' || v === 'left' || v === 'right'
  }
  return (
    v === 'page' ||
    v === 'left' ||
    v === 'right' ||
    v === 'recto' ||
    v === 'verso' ||
    v === 'always' ||
    v === 'all'
  )
}
