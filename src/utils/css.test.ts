import { describe, it, expect } from 'vitest'
import {
  parseInlineStyle,
  parseColor,
  parseFontSizeHalfPt,
  parseFontFamily,
  isBoldWeight,
  parseTextAlign,
} from './css.js'

describe('parseInlineStyle', () => {
  it('拆分多条声明，key 小写、value trim', () => {
    expect(parseInlineStyle('Color: Red ; Font-Size: 14pt')).toEqual({
      color: 'Red',
      'font-size': '14pt',
    })
  })

  it('空 / undefined 返回空对象', () => {
    expect(parseInlineStyle(undefined)).toEqual({})
    expect(parseInlineStyle('')).toEqual({})
    expect(parseInlineStyle('   ')).toEqual({})
  })

  it('缺失冒号或空值的片段被跳过', () => {
    expect(parseInlineStyle('color; font-weight: bold; : red ;color:')).toEqual({
      'font-weight': 'bold',
    })
  })

  it('重复 key 后写覆盖前写', () => {
    expect(parseInlineStyle('color: red; color: blue')).toEqual({ color: 'blue' })
  })
})

describe('parseColor', () => {
  it('命名色', () => {
    expect(parseColor('red')).toBe('FF0000')
    expect(parseColor('Black')).toBe('000000')
    expect(parseColor('grey')).toBe('808080')
  })

  it('短 hex 扩展', () => {
    expect(parseColor('#f00')).toBe('FF0000')
    expect(parseColor('#abc')).toBe('AABBCC')
  })

  it('完整 hex', () => {
    expect(parseColor('#1a2B3c')).toBe('1A2B3C')
  })

  it('rgb()', () => {
    expect(parseColor('rgb(255, 0, 128)')).toBe('FF0080')
    expect(parseColor('rgb(255 0 128)')).toBe('FF0080')
    expect(parseColor('rgb(300, -5, 50)')).toBe('FF0032')
  })

  it('透明 / inherit / 不识别 → undefined', () => {
    expect(parseColor('transparent')).toBeUndefined()
    expect(parseColor('currentColor')).toBeUndefined()
    expect(parseColor('inherit')).toBeUndefined()
    expect(parseColor('not-a-color')).toBeUndefined()
    expect(parseColor('#ff')).toBeUndefined()
    expect(parseColor(undefined)).toBeUndefined()
  })
})

describe('parseFontSizeHalfPt', () => {
  it('pt 直接 *2', () => {
    expect(parseFontSizeHalfPt('14pt')).toBe(28)
    expect(parseFontSizeHalfPt('11.5pt')).toBe(23)
  })

  it('px → 半磅（n * 1.5）', () => {
    expect(parseFontSizeHalfPt('12px')).toBe(18)
    expect(parseFontSizeHalfPt('16px')).toBe(24)
  })

  it('em / rem 以 12pt 为基准', () => {
    expect(parseFontSizeHalfPt('1em')).toBe(24)
    expect(parseFontSizeHalfPt('1.5rem')).toBe(36)
  })

  it('% 同 em', () => {
    expect(parseFontSizeHalfPt('150%')).toBe(36)
  })

  it('无单位按 px 处理', () => {
    expect(parseFontSizeHalfPt('12')).toBe(18)
  })

  it('非法值 → undefined', () => {
    expect(parseFontSizeHalfPt(undefined)).toBeUndefined()
    expect(parseFontSizeHalfPt('')).toBeUndefined()
    expect(parseFontSizeHalfPt('abc')).toBeUndefined()
    expect(parseFontSizeHalfPt('-5pt')).toBeUndefined()
    expect(parseFontSizeHalfPt('0pt')).toBeUndefined()
    expect(parseFontSizeHalfPt('5vw')).toBeUndefined()
  })
})

describe('parseFontFamily', () => {
  it('取首项并去引号', () => {
    expect(parseFontFamily('"Helvetica Neue", sans-serif')).toBe('Helvetica Neue')
    expect(parseFontFamily("'SimSun', serif")).toBe('SimSun')
    expect(parseFontFamily('Arial')).toBe('Arial')
  })

  it('空 / undefined → undefined', () => {
    expect(parseFontFamily(undefined)).toBeUndefined()
    expect(parseFontFamily('')).toBeUndefined()
    expect(parseFontFamily(' , serif')).toBeUndefined()
  })
})

describe('isBoldWeight', () => {
  it('bold / bolder / 数值 ≥ 600', () => {
    expect(isBoldWeight('bold')).toBe(true)
    expect(isBoldWeight('Bolder')).toBe(true)
    expect(isBoldWeight('700')).toBe(true)
    expect(isBoldWeight('600')).toBe(true)
  })

  it('normal / 数值 < 600 / undefined → false', () => {
    expect(isBoldWeight('normal')).toBe(false)
    expect(isBoldWeight('500')).toBe(false)
    expect(isBoldWeight(undefined)).toBe(false)
  })
})

describe('parseTextAlign', () => {
  it('合法值', () => {
    expect(parseTextAlign('left')).toBe('left')
    expect(parseTextAlign('Center')).toBe('center')
    expect(parseTextAlign('JUSTIFY')).toBe('justify')
  })

  it('非法值 / undefined → undefined', () => {
    expect(parseTextAlign(undefined)).toBeUndefined()
    expect(parseTextAlign('start')).toBeUndefined()
    expect(parseTextAlign('inherit')).toBeUndefined()
  })
})
