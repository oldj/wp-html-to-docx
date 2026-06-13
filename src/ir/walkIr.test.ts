// walkIr：IR 树共享遍历器
//
// 重点守住「所有含 inlines 的块类型都被遍历到」—— 此前 imageCollector / mathCollector
// 各自维护遍历逻辑时都漏掉了 list-continuation，导致其中的图片 / 公式在渲染期丢失。

import { describe, it, expect } from 'vitest'
import type { Block, Inline } from '../types.js'
import { walkBlocksDeep, walkInlinesDeep } from './walkIr.js'

const text = (t: string): Inline => ({ kind: 'text', text: t, style: {} })

describe('walkBlocksDeep', () => {
  it('遍历嵌套 blockquote 与 table 单元格内的块', () => {
    const ir: Block[] = [
      {
        kind: 'blockquote',
        children: [
          { kind: 'paragraph', inlines: [text('in-quote')] },
          { kind: 'blockquote', children: [{ kind: 'math', mathml: '<math/>', display: 'block' }] },
        ],
      },
      {
        kind: 'table',
        rows: [
          {
            isHeader: false,
            cells: [{ children: [{ kind: 'paragraph', inlines: [text('in-cell')] }] }],
          },
        ],
      },
    ]
    const kinds: string[] = []
    walkBlocksDeep(ir, (b) => kinds.push(b.kind))
    expect(kinds).toEqual(['blockquote', 'paragraph', 'blockquote', 'math', 'table', 'paragraph'])
  })
})

describe('walkInlinesDeep', () => {
  it('覆盖全部四类含 inlines 的块（含 list-continuation）', () => {
    const ir: Block[] = [
      { kind: 'paragraph', inlines: [text('p')] },
      { kind: 'heading', level: 1, inlines: [text('h')] },
      { kind: 'list-item', inlines: [text('li')], ref: { reference: 'r', level: 0 } },
      // 此前两个 collector 都漏掉的块类型
      { kind: 'list-continuation', inlines: [text('cont')], level: 0 },
    ]
    const seen: string[] = []
    walkInlinesDeep(ir, (i) => {
      if (i.kind === 'text') seen.push(i.text)
    })
    expect(seen).toEqual(['p', 'h', 'li', 'cont'])
  })

  it('深入 blockquote / table 嵌套结构中的 inlines', () => {
    const ir: Block[] = [
      {
        kind: 'blockquote',
        children: [
          {
            kind: 'table',
            rows: [
              {
                isHeader: false,
                cells: [
                  {
                    children: [{ kind: 'list-continuation', inlines: [text('deep')], level: 1 }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]
    const seen: string[] = []
    walkInlinesDeep(ir, (i) => {
      if (i.kind === 'text') seen.push(i.text)
    })
    expect(seen).toEqual(['deep'])
  })
})
