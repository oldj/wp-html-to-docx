// 列表 numbering 模板
// docx 要求 reference 在 Document 顶层声明 8 层 levels，Paragraph 引用 (reference, level)

import { AlignmentType, LevelFormat, type ILevelsOptions } from 'docx'
import type { ListLevelsOptions } from '../options.js'
import type { WarnFn } from '../utils/log.js'

const MAX_LEVELS = 8
/** 每层缩进的 twip（约 0.5 英寸 / 720 twip） */
export const INDENT_PER_LEVEL = 720
export const HANGING_INDENT = 360

/**
 * 单个列表的编号规格，来自元素自身的属性（data-list-style / style 的 list-style-type /
 * type / start）。只要给了任一项，该列表就拥有自己的 reference，不再与父列表共用。
 */
export type ListSpec = {
  /** 该列表所在的嵌套深度（0 起），决定它覆盖 reference 的哪一层 */
  level: number
  /** CSS list-style-type 关键字；未给或不认识时用层级默认方案 */
  style?: string
  /** 起始序号（仅 ol），默认 1 */
  start?: number
}

type LevelFormatValue = NonNullable<ILevelsOptions['format']>

/** 一层的编号形态：格式 + 编号文本模板（%N 由 docx 替换为该层计数） */
type LevelShape = {
  format: LevelFormatValue
  /** 编号文本；`%N` 会被替换为对应层级的占位符 `%{level+1}` */
  text: string
}

/** 已解析的层级方案：两类列表各一组按深度循环的形态 */
export type ListLevelScheme = {
  bullet: readonly LevelShape[]
  ordered: readonly LevelShape[]
}

/**
 * 层级默认方案：按嵌套深度三级一循环，与 WonderPen 编辑器 / HTML 导出的 CSS 同一套
 * （● ○ ■ 与 1. a. i.，也是 Word / Google Docs 的默认）。
 */
export const DEFAULT_BULLET_LEVELS: readonly string[] = ['disc', 'circle', 'square']
export const DEFAULT_ORDERED_LEVELS: readonly string[] = ['decimal', 'lower-alpha', 'lower-roman']

/**
 * CSS list-style-type → docx 编号形态。
 * 中文数字三种沿用中文排版习惯，后缀用顿号（与 CSS 预定义 counter-style 的后缀一致）。
 * docx 的枚举名 IDEOGRAPH__DIGITAL 带双下划线（上游拼写），这里直接写 OOXML 字面值以免绑死在拼写上。
 */
const STYLE_SHAPES: Record<string, LevelShape> = {
  decimal: { format: LevelFormat.DECIMAL, text: '%N.' },
  'decimal-leading-zero': { format: LevelFormat.DECIMAL_ZERO, text: '%N.' },
  'lower-alpha': { format: LevelFormat.LOWER_LETTER, text: '%N.' },
  'lower-latin': { format: LevelFormat.LOWER_LETTER, text: '%N.' },
  'upper-alpha': { format: LevelFormat.UPPER_LETTER, text: '%N.' },
  'upper-latin': { format: LevelFormat.UPPER_LETTER, text: '%N.' },
  'lower-roman': { format: LevelFormat.LOWER_ROMAN, text: '%N.' },
  'upper-roman': { format: LevelFormat.UPPER_ROMAN, text: '%N.' },
  'cjk-decimal': { format: 'ideographDigital', text: '%N、' },
  'simp-chinese-informal': { format: LevelFormat.CHINESE_COUNTING, text: '%N、' },
  'trad-chinese-informal': { format: LevelFormat.TAIWANESE_COUNTING, text: '%N、' },
  disc: { format: LevelFormat.BULLET, text: '•' },
  circle: { format: LevelFormat.BULLET, text: '◦' },
  square: { format: LevelFormat.BULLET, text: '▪' },
  none: { format: LevelFormat.NONE, text: '' },
}

/** HTML 的 type 属性 → CSS 关键字。ol 的取值区分大小写（a / A、i / I 是不同格式） */
const OL_TYPE_ATTR: Record<string, string> = {
  '1': 'decimal',
  a: 'lower-alpha',
  A: 'upper-alpha',
  i: 'lower-roman',
  I: 'upper-roman',
}
const UL_TYPE_ATTR: ReadonlySet<string> = new Set(['disc', 'circle', 'square', 'none'])

/**
 * 把元素上的 list-style-type 候选值归一为本模块认识的 CSS 关键字；都不认识返回 undefined。
 * 候选按优先级传入：data-list-style > style 的 list-style-type > type 属性。
 * ul 不接受编号格式、ol 不接受项目符号（与 CSS 语义不同，但与 HTML 的 type 属性语义一致，
 * 也避免 `<ul style="list-style-type: decimal">` 这种少见写法把项目符号列表变成编号列表）。
 */
export function resolveListStyle(
  ordered: boolean,
  candidates: readonly (string | undefined)[],
  typeAttr?: string,
): string | undefined {
  const isAllowed = (key: string): boolean => {
    if (key === 'none') return true
    const shape = STYLE_SHAPES[key]
    if (shape === undefined) return false
    return ordered ? shape.format !== LevelFormat.BULLET : shape.format === LevelFormat.BULLET
  }
  for (const raw of candidates) {
    if (raw === undefined) continue
    const key = raw.trim().toLowerCase()
    if (isAllowed(key)) return key
  }
  if (typeAttr === undefined) return undefined
  const typeValue = typeAttr.trim()
  if (ordered) return OL_TYPE_ATTR[typeValue]
  const lower = typeValue.toLowerCase()
  return UL_TYPE_ATTR.has(lower) ? lower : undefined
}

/**
 * 把 options.listLevels 解析成层级方案。每一项都过 resolveListStyle 的白名单：不认识的关键字、
 * 与列表类型不匹配的关键字跳过并 warn；整组为空（未传或全部非法）时回退默认方案。
 */
export function resolveListLevelScheme(
  options: ListLevelsOptions | undefined,
  warn: WarnFn,
): ListLevelScheme {
  const toShapes = (ordered: boolean, keys: readonly string[] | undefined): LevelShape[] => {
    const kind = ordered ? 'ordered' : 'bullet'
    const out: LevelShape[] = []
    for (const raw of keys ?? []) {
      const key = resolveListStyle(ordered, [raw])
      if (key === undefined) {
        warn(`[wp-html-to-docx] listLevels.${kind}: unsupported list-style-type "${raw}", skipped`)
        continue
      }
      out.push(STYLE_SHAPES[key] as LevelShape)
    }
    if (out.length > 0) return out
    const fallback = ordered ? DEFAULT_ORDERED_LEVELS : DEFAULT_BULLET_LEVELS
    return fallback.map((key) => STYLE_SHAPES[key] as LevelShape)
  }
  return {
    bullet: toShapes(false, options?.bullet),
    ordered: toShapes(true, options?.ordered),
  }
}

const DEFAULT_SCHEME: ListLevelScheme = resolveListLevelScheme(undefined, () => {})

function shapeForLevel(
  ordered: boolean,
  level: number,
  scheme: ListLevelScheme,
  spec?: ListSpec,
): LevelShape {
  if (spec !== undefined && spec.level === level && spec.style !== undefined) {
    const shape = STYLE_SHAPES[spec.style]
    if (shape !== undefined) return shape
  }
  const cycle = ordered ? scheme.ordered : scheme.bullet
  return cycle[level % cycle.length] as LevelShape
}

/**
 * 生成一个 reference 的 8 层定义。
 * - 默认：每层按 scheme（options.listLevels 解析结果，缺省为 DEFAULT_*_LEVELS）循环取形态
 * - 传了 spec：仅 spec.level 那一层改用 spec.style 的形态与 spec.start 起始序号，
 *   其余层仍按方案循环——嵌套在它里面、自身没有指定格式的同类列表会复用这个 reference，
 *   它们该拿到的是各自层级的默认形态，而不是外层指定的格式（与 CSS 语义一致）
 */
export function listLevels(
  ordered: boolean,
  spec?: ListSpec,
  scheme: ListLevelScheme = DEFAULT_SCHEME,
): ILevelsOptions[] {
  const out: ILevelsOptions[] = []
  for (let i = 0; i < MAX_LEVELS; i++) {
    const shape = shapeForLevel(ordered, i, scheme, spec)
    // 起始序号只对 ol 有意义，且只作用于 spec 指定的那一层；其余层从 1 起
    const start =
      spec !== undefined && spec.level === i && spec.start !== undefined ? spec.start : 1
    out.push({
      level: i,
      format: shape.format,
      text: shape.text.replace('%N', `%${i + 1}`),
      alignment: AlignmentType.LEFT,
      ...(ordered ? { start } : {}),
      style: {
        paragraph: {
          indent: { left: INDENT_PER_LEVEL * (i + 1), hanging: HANGING_INDENT },
        },
      },
    })
  }
  return out
}

/** 无序列表层级模板（默认循环 • ◦ ▪） */
export function bulletLevels(): ILevelsOptions[] {
  return listLevels(false)
}

/** 有序列表层级模板（默认循环 1. a. i.） */
export function decimalLevels(): ILevelsOptions[] {
  return listLevels(true)
}
