import { describe, it, expect } from 'vitest'
import { htmlToDocument, htmlToDocx } from './index.js'

// 阶段 0 冒烟：管道贯通即可（暂不校验内容，阶段 1 起补齐）
describe('htmlToDocument 冒烟', () => {
  it('返回 docx Document 实例', async () => {
    const doc = await htmlToDocument('<p>hi</p>')
    expect(doc).toBeDefined()
  })
})

describe('htmlToDocx 冒烟', () => {
  it('返回 Uint8Array', async () => {
    const u8 = await htmlToDocx('<p>hi</p>')
    expect(u8).toBeInstanceOf(Uint8Array)
    expect(u8.byteLength).toBeGreaterThan(0)
  })
})
