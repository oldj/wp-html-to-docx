import { describe, it, expect } from 'vitest'
import { resolveImageDisplaySize } from './imageLayout.js'

// 固有 800x600（宽高比 4:3），版心可用宽度 600px
const INTRINSIC = { width: 800, height: 600 }
const PAGE = 600

describe('resolveImageDisplaySize', () => {
  it('无显式宽高：用固有尺寸，但超出版心宽度时等比 clamp', () => {
    expect(resolveImageDisplaySize(INTRINSIC, {}, PAGE)).toEqual({ width: 600, height: 450 })
  })

  it('小图无显式宽高：保持原始尺寸，不放大', () => {
    expect(resolveImageDisplaySize({ width: 100, height: 100 }, {}, PAGE)).toEqual({
      width: 100,
      height: 100,
    })
  })

  it('宽度 100%：铺满版心宽度，高度按比例', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { width: '100%' }, PAGE)).toEqual({
      width: 600,
      height: 450,
    })
  })

  it('小图 + 100%：强制放大铺满（满宽语义）', () => {
    expect(resolveImageDisplaySize({ width: 100, height: 100 }, { width: '100%' }, PAGE)).toEqual({
      width: 600,
      height: 600,
    })
  })

  it('宽度 50%：版心宽度的一半，高度按比例', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { width: '50%' }, PAGE)).toEqual({
      width: 300,
      height: 225,
    })
  })

  it('像素宽度 "300"：高度按固有比例推算', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { width: '300' }, PAGE)).toEqual({
      width: 300,
      height: 225,
    })
  })

  it('像素宽度带 px 后缀 "300px"', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { width: '300px' }, PAGE)).toEqual({
      width: 300,
      height: 225,
    })
  })

  it('显式像素宽度超出版心：clamp 到版心并等比缩高', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { width: '2000' }, PAGE)).toEqual({
      width: 600,
      height: 450,
    })
  })

  it('同时给宽和高：直接采用，不强制保持比例', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { width: '400', height: '100' }, PAGE)).toEqual({
      width: 400,
      height: 100,
    })
  })

  it('只给高度：按比例推算宽度', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { height: '300' }, PAGE)).toEqual({
      width: 400,
      height: 300,
    })
  })

  it('高度的百分比无参照：忽略，退回固有尺寸（并 clamp）', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { height: '50%' }, PAGE)).toEqual({
      width: 600,
      height: 450,
    })
  })

  it('非法宽度（auto / 空）当作未指定', () => {
    expect(resolveImageDisplaySize({ width: 100, height: 100 }, { width: 'auto' }, PAGE)).toEqual({
      width: 100,
      height: 100,
    })
  })

  it('百分比带 !important：剥离优先级标记后按百分比处理（不被误判成 100px）', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { width: '100% !important' }, PAGE)).toEqual({
      width: 600,
      height: 450,
    })
  })

  it('像素带 !important：剥离后按像素处理', () => {
    expect(resolveImageDisplaySize(INTRINSIC, { width: '300px !important' }, PAGE)).toEqual({
      width: 300,
      height: 225,
    })
  })

  it('不支持的单位（em / vw / pt）当作未指定，退回固有尺寸而非误当像素', () => {
    // 旧实现会把 "10em" 经 parseFloat 截成 10px，导致图片严重缩小
    for (const width of ['10em', '50vw', '12pt']) {
      expect(resolveImageDisplaySize({ width: 100, height: 100 }, { width }, PAGE)).toEqual({
        width: 100,
        height: 100,
      })
    }
  })
})
