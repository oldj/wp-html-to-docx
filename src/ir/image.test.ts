import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren } from '../parser/parseHtml.js'
import { BuildContext } from './buildContext.js'
import { buildIr } from './buildIr.js'
import { collectImages } from './imageCollector.js'
import type { ImageResolver, Logger } from '../options.js'

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

  it('resolver 只给单边尺寸：保留已给值，另一边用解码固有尺寸补（不整体丢弃）', async () => {
    const pngData = Uint8Array.from(Buffer.from(TINY_PNG_BASE64, 'base64')) // 真实 1x1 PNG
    const resolver: ImageResolver = async () => ({
      data: pngData,
      mime: 'image/png',
      width: 50, // 只给宽、不给高
    })
    const ctx = await buildAndCollect('<p><img src="https://x.com/a.png"/></p>', {
      imageResolver: resolver,
    })
    const asset = ctx.images.get('https://x.com/a.png')
    expect(asset?.width).toBe(50) // 已给的宽度保留（旧实现会连同它一起丢成默认/解码值）
    expect(asset?.height).toBe(1) // 缺失的高度回退到解码固有尺寸（1x1），而非默认 150
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

  it('list-continuation 中的图片也被收集（嵌套列表之后的内容）', async () => {
    // <li> 内嵌套列表之后的图片落在 list-continuation 块中，
    // 此前遍历漏掉该块型，图片不被预加载、渲染期静默丢失
    const html = `<ul><li>head<ul><li>nested</li></ul><img src="${TINY_PNG_DATA_URL}"/> tail</li></ul>`
    const ctx = await buildAndCollect(html)
    expect(ctx.images.size).toBe(1)
  })

  it('脚注内容中的图片也被收集（ctx.footnotes 的 blocks）', async () => {
    // 脚注内容在 buildIr 预扫描时被提升出主 IR，但渲染期同样查 ctx.images
    const html =
      '<p>x<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup></p>' +
      `<div class="footnotes"><ol><li id="fn-1">note <img src="${TINY_PNG_DATA_URL}"/></li></ol></div>`
    const ctx = await buildAndCollect(html)
    expect(ctx.images.size).toBe(1)
  })

  it('多张图并行加载：观察到的最大并发数 > 1', async () => {
    // 守住「并行而非串行」：resolver 在 release 前一直挂起，
    // 若实现是顺序 await，永远只会有 1 个 in-flight，allInFlight 永远等不到 3
    let inFlight = 0
    let maxInFlight = 0
    let resolveAll: (() => void) | undefined
    const allInFlight = new Promise<void>((res) => {
      resolveAll = () => res()
    })
    const resolver: ImageResolver = async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (inFlight >= 3) resolveAll?.()
      // 等所有图都进入 in-flight 后再统一返回
      await allInFlight
      inFlight -= 1
      return { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png' }
    }
    const html =
      '<p><img src="https://x.com/a.png"/><img src="https://x.com/b.png"/><img src="https://x.com/c.png"/></p>'
    const ctx = await buildAndCollect(html, { imageResolver: resolver })
    expect(maxInFlight).toBe(3)
    expect(ctx.images.size).toBe(3)
  })
})

describe('imageCollector - 不支持的图片格式', () => {
  // "RIFF\0\0\0\0WEBP" 12 字节，足以命中 WebP magic 检测
  const WEBP_BYTES = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
  const WEBP_DATA_URL = `data:image/webp;base64,${Buffer.from(WEBP_BYTES).toString('base64')}`

  it('webp data URL：默认 skip，不伪装成 png 嵌入', async () => {
    const ctx = await buildAndCollect(`<p><img src="${WEBP_DATA_URL}"/></p>`)
    expect(ctx.images.size).toBe(0)
  })

  it('svg data URL：默认 skip', async () => {
    const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`
    const ctx = await buildAndCollect(`<p><img src="${svg}"/></p>`)
    expect(ctx.images.size).toBe(0)
  })

  it('resolver 返回 webp 数据（mime 缺失，靠 magic bytes 识别）：同样跳过', async () => {
    const resolver: ImageResolver = async () => ({ data: Uint8Array.from(WEBP_BYTES) })
    const ctx = await buildAndCollect('<p><img src="https://x.com/a.webp"/></p>', {
      imageResolver: resolver,
    })
    expect(ctx.images.size).toBe(0)
  })

  it('error 策略下不支持格式抛出明确错误', async () => {
    await expect(
      buildAndCollect(`<p><img src="${WEBP_DATA_URL}"/></p>`, { onUnresolvedImage: 'error' }),
    ).rejects.toThrow(/unsupported image format "webp"/)
  })

  it('未能加载的图片经 logger 输出 warn（提供 logger 时）', async () => {
    const logs: string[] = []
    const logger: Logger = (level, message) => {
      if (level === 'warn') logs.push(message)
    }
    const ctx = await buildAndCollect(`<p><img src="${WEBP_DATA_URL}"/></p>`, { logger })
    expect(ctx.images.size).toBe(0)
    expect(logs.some((m) => m.includes('not embedded') && m.includes('webp'))).toBe(true)
  })

  it('logger 自身抛错不阻断构建', async () => {
    const ctx = await buildAndCollect(`<p><img src="${WEBP_DATA_URL}"/></p>`, {
      logger: () => {
        throw new Error('logger boom')
      },
    })
    expect(ctx.images.size).toBe(0)
  })
})
