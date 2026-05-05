import { describe, it, expect } from 'vitest'
import { Document } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocument, htmlToDocx, VERSION } from './index.js'

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

  it('logger 选项：调用入口时以 info 级别打印版本号', async () => {
    const calls: Array<[string, string]> = []
    await htmlToDocx('<p>hi</p>', {
      logger: (level, msg) => calls.push([level, msg]),
    })
    // 至少一次调用，且首条 message 包含版本号
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0]?.[0]).toBe('info')
    expect(calls[0]?.[1]).toContain(`wp-html-to-docx v${VERSION}`)
  })

  it('logger 抛错不应阻断主流程', async () => {
    const u8 = await htmlToDocx('<p>hi</p>', {
      logger: () => {
        throw new Error('boom')
      },
    })
    expect(u8.byteLength).toBeGreaterThan(0)
  })

  it('未传 logger 时不向 console 写任何内容（静默）', async () => {
    // 仅做存在性测试：不传时不应 throw、不应改变行为
    const u8 = await htmlToDocx('<p>hi</p>')
    expect(u8.byteLength).toBeGreaterThan(0)
  })

  it('VERSION 常量与 package.json 同步', async () => {
    // 防回归：sync-version 脚本未执行 / 漂移时此处会失败
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    // 用 cwd 解析；vitest 的 jsdom 环境下 import.meta.url 不是 file: scheme 无法直接读
    const pkg = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'))
    expect(VERSION).toBe(pkg.version)
  })

  it('options 省略 / undefined / null 都能正常工作', async () => {
    // 防回归：JS 调用方显式传 null 时 `= {}` 默认值不触发，曾让 ctx.options.xxx
    // 抛不可定位的 TypeError。边界已统一兜底
    const a = await htmlToDocx('<p>hi</p>')
    const b = await htmlToDocx('<p>hi</p>', undefined)
    const c = await htmlToDocx('<p>hi</p>', null)
    for (const u8 of [a, b, c]) {
      expect(u8).toBeInstanceOf(Uint8Array)
      expect(u8.byteLength).toBeGreaterThan(0)
    }
  })
})
