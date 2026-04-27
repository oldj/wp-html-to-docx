import { describe, it, expect } from 'vitest'
import { Document } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocument, htmlToDocx } from './index.js'

describe('htmlToDocument 顶层 API', () => {
  it('返回真实的 docx Document 实例（而不仅仅是 truthy 值）', async () => {
    const doc = await htmlToDocument('<p>hi</p>')
    expect(doc).toBeInstanceOf(Document)
  })
})

describe('htmlToDocx 顶层 API', () => {
  it('返回 Uint8Array 且产物是合法的 zip 包，document.xml 含 HTML 文本', async () => {
    const u8 = await htmlToDocx('<p>hi</p>')
    expect(u8).toBeInstanceOf(Uint8Array)
    expect(u8.byteLength).toBeGreaterThan(0)
    // 解压并核对核心入口存在与文本落地——避免「函数返回任意 Uint8Array 但内容损坏」也通过
    const files = unzipSync(u8)
    expect(files['word/document.xml']).toBeDefined()
    expect(strFromU8(files['word/document.xml']!)).toContain('hi')
  })
})
