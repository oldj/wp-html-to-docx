import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'
import type { ImageResolver } from '../options.js'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`

async function unpack(html: string, opts = {}) {
  const u8 = await htmlToDocx(html, opts)
  const files = unzipSync(u8)
  const xml = files['word/document.xml']
  if (xml === undefined) throw new Error('document.xml missing')
  return { document: strFromU8(xml), files }
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
