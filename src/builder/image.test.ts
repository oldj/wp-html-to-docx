import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'
import { pageContentWidthPx } from '../utils/units.js'
import type { ImageResolver } from '../options.js'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`

// docx 把 transformation 的像素尺寸按 1px = 9525 EMU 写入 <wp:extent>
const EMU_PER_PX = 9525

async function unpack(html: string, opts = {}) {
  const u8 = await htmlToDocx(html, opts)
  const files = unzipSync(u8)
  const xml = files['word/document.xml']
  if (xml === undefined) throw new Error('document.xml missing')
  return { document: strFromU8(xml), files }
}

// 取首个 <wp:extent cx cy>（图片显示尺寸，单位 EMU）
function firstExtent(documentXml: string): { cx: number; cy: number } {
  const m = documentXml.match(/<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/)
  if (m === null) throw new Error('no wp:extent found')
  return { cx: Number(m[1]), cy: Number(m[2]) }
}

describe('builder XML - image', () => {
  it('data URL 图片产出 drawing/blip 关系并把图片打入 word/media/', async () => {
    const { document, files } = await unpack(`<p><img src="${TINY_PNG_DATA_URL}"/></p>`)
    expect(document).toContain('<w:drawing>')
    expect(document).toMatch(/blip/i)
    // word/media/ 下应有图片文件
    const mediaPaths = Object.keys(files).filter((k) => k.startsWith('word/media/'))
    expect(mediaPaths.length).toBeGreaterThan(0)
  })

  it('skip 策略 + 无 resolver：不产出 drawing 也不抛错', async () => {
    const { document } = await unpack('<p>before<img src="https://x.com/a.png"/>after</p>')
    expect(document).not.toContain('<w:drawing>')
    expect(document).toContain('before')
    expect(document).toContain('after')
  })

  it('placeholder 策略：用 alt 文本兜底', async () => {
    const { document } = await unpack(
      '<p><img src="https://x.com/a.png" alt="my image"/></p>',
      { onUnresolvedImage: 'placeholder' },
    )
    expect(document).toContain('my image')
  })

  it('resolver 提供数据：正常嵌入', async () => {
    const resolver: ImageResolver = async () => ({
      data: Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0)),
      mime: 'image/png',
    })
    const { document } = await unpack('<p><img src="https://x.com/a.png"/></p>', {
      imageResolver: resolver,
    })
    expect(document).toContain('<w:drawing>')
  })

  it('<a href><img/></a> 把 drawing 包在 hyperlink 里面，使图片真正可点击', async () => {
    // 防回归：image inline 上的 style.link 曾被 builder 忽略，超链接丢失。
    // 必须断言 <w:drawing> 出现在 <w:hyperlink>...</w:hyperlink> 内部，
    // 否则「文本带链接 + 图片无链接」这种半坏状态也会让弱断言通过
    const { document } = await unpack(
      `<p><a href="https://example.com"><img src="${TINY_PNG_DATA_URL}"/></a></p>`,
    )
    expect(document).toMatch(/<w:hyperlink[\s\S]*?<w:drawing>[\s\S]*?<\/w:hyperlink>/)
  })
})

describe('builder XML - image data-full-width（满宽）', () => {
  // 满宽=铺满版心可用宽度。1x1 PNG 固有比例 1:1，铺满后 cx===cy。
  const fullWidthEmu = Math.round(pageContentWidthPx({})) * EMU_PER_PX

  it('data-full-width="1"：图片宽度铺满版心可用宽度', async () => {
    const { document } = await unpack(
      `<p><img src="${TINY_PNG_DATA_URL}" data-full-width="1"/></p>`,
    )
    expect(firstExtent(document).cx).toBe(fullWidthEmu)
  })

  it('满宽优先于显式 width：width="50" 被忽略，仍铺满版心', async () => {
    const { document } = await unpack(
      `<p><img src="${TINY_PNG_DATA_URL}" width="50" data-full-width="1"/></p>`,
    )
    expect(firstExtent(document).cx).toBe(fullWidthEmu)
  })

  it('满宽忽略显式 height：按固有比例铺满（cx===cy），而非采用 height="50"', async () => {
    // 防回归：若 height="50" 被采用，cx（铺满）会远大于 cy（50px），二者不相等
    const { document } = await unpack(
      `<p><img src="${TINY_PNG_DATA_URL}" width="50" height="50" data-full-width="1"/></p>`,
    )
    const { cx, cy } = firstExtent(document)
    expect(cx).toBe(fullWidthEmu)
    expect(cy).toBe(cx)
  })

  it('对照：无 data-full-width 时 width/height 照常生效（50x50px）', async () => {
    const { document } = await unpack(
      `<p><img src="${TINY_PNG_DATA_URL}" width="50" height="50"/></p>`,
    )
    expect(firstExtent(document)).toEqual({ cx: 50 * EMU_PER_PX, cy: 50 * EMU_PER_PX })
  })
})
