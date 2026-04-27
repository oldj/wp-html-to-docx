import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren } from '../parser/parseHtml.js'
import { BuildContext } from './buildContext.js'
import { buildIr } from './buildIr.js'
import { collectImages } from './imageCollector.js'
import type { ImageResolver } from '../options.js'

// 1x1 透明 PNG（base64）
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`

async function buildAndCollect(html: string, opts = {}): Promise<BuildContext> {
  const nodes = parseHtmlBodyChildren(html)
  const ctx = new BuildContext(opts)
  const ir = buildIr(nodes, ctx)
  await collectImages(ir, ctx)
  return ctx
}

describe('imageCollector - data URL', () => {
  it('解码 data URL 并加入 ctx.images', async () => {
    const ctx = await buildAndCollect(`<p><img src="${TINY_PNG_DATA_URL}" alt="t"/></p>`)
    expect(ctx.images.size).toBe(1)
    const asset = ctx.images.get(TINY_PNG_DATA_URL)
    expect(asset?.type).toBe('png')
    expect(asset?.data).toBeInstanceOf(Uint8Array)
    expect(asset!.data.byteLength).toBeGreaterThan(0)
  })

  it('多个 img 引用同一 data URL：去重，仅加载一次', async () => {
    const html = `<p><img src="${TINY_PNG_DATA_URL}"/><img src="${TINY_PNG_DATA_URL}"/></p>`
    const ctx = await buildAndCollect(html)
    expect(ctx.images.size).toBe(1)
  })
})

describe('imageCollector - 外链与 imageResolver', () => {
  it('提供 imageResolver：用于加载外链', async () => {
    const calls: string[] = []
    const resolver: ImageResolver = async (src) => {
      calls.push(src)
      return {
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG magic
        mime: 'image/png',
        width: 50,
        height: 40,
      }
    }
    const ctx = await buildAndCollect('<p><img src="https://x.com/a.png"/></p>', {
      imageResolver: resolver,
    })
    expect(calls).toEqual(['https://x.com/a.png'])
    const asset = ctx.images.get('https://x.com/a.png')
    expect(asset?.type).toBe('png')
    expect(asset?.width).toBe(50)
    expect(asset?.height).toBe(40)
  })

  it('未提供 resolver + skip 策略：不加入 ctx.images（默认行为）', async () => {
    const ctx = await buildAndCollect('<p><img src="https://x.com/a.png"/></p>')
    expect(ctx.images.size).toBe(0)
  })

  it('未提供 resolver + error 策略：抛错', async () => {
    await expect(
      buildAndCollect('<p><img src="https://x.com/a.png"/></p>', {
        onUnresolvedImage: 'error',
      }),
    ).rejects.toThrow(/Cannot load image/)
  })

  it('resolver 抛异常 + skip：吞掉异常不入表', async () => {
    const resolver: ImageResolver = async () => {
      throw new Error('network down')
    }
    const ctx = await buildAndCollect('<p><img src="https://x.com/a.png"/></p>', {
      imageResolver: resolver,
    })
    expect(ctx.images.size).toBe(0)
  })
})
