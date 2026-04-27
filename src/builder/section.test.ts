import { describe, it, expect, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'
import type { HtmlToDocxOptions } from '../options.js'

async function unpack(html: string, opts: HtmlToDocxOptions = {}) {
  const u8 = await htmlToDocx(html, opts)
  const files = unzipSync(u8)
  const dec = (path: string) => {
    const bytes = files[path]
    return bytes ? strFromU8(bytes) : undefined
  }
  return {
    document: dec('word/document.xml') ?? '',
    header1: dec('word/header1.xml'),
    footer1: dec('word/footer1.xml'),
  }
}

describe('section - 纸张尺寸与方向', () => {
  it('默认 A4 portrait：宽 11906 / 高 16838 twip 附近', async () => {
    const { document } = await unpack('<p>x</p>')
    // A4 = 210mm x 297mm = 11906 x 16838 twip
    expect(document).toMatch(/<w:pgSz[^>]*w:w="11906"/)
    expect(document).toMatch(/<w:pgSz[^>]*w:h="16838"/)
    expect(document).toMatch(/<w:pgSz[^>]*w:orient="portrait"/)
  })

  it('Letter landscape：docx 库自动交换为横向尺寸', async () => {
    const { document } = await unpack('<p>x</p>', {
      page: { size: 'Letter', orientation: 'landscape' },
    })
    expect(document).toMatch(/<w:pgSz[^>]*w:orient="landscape"/)
    // landscape：宽 = portrait 高，高 = portrait 宽
    expect(document).toMatch(/<w:pgSz[^>]*w:w="15840"/)
    expect(document).toMatch(/<w:pgSz[^>]*w:h="12240"/)
  })

  it('自定义页面尺寸（pt）', async () => {
    const { document } = await unpack('<p>x</p>', {
      page: { size: { width: 72, height: 144, unit: 'pt' } },
    })
    expect(document).toMatch(/<w:pgSz[^>]*w:w="1440"/)
    expect(document).toMatch(/<w:pgSz[^>]*w:h="2880"/)
  })

  it('未知 PaperSize 字符串：降级 A4 而非 NPE', async () => {
    // 防回归：曾经 page.size: 'A6' 这种 JS 调用方传入未在联合中的字符串会让 PAPER_MM[size]=undefined
    // 触发 NPE。现在应给出 warn + fallback A4
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { document } = await unpack('<p>x</p>', {
        page: { size: 'A6' as never },
      })
      // A4 portrait 尺寸
      expect(document).toMatch(/<w:pgSz[^>]*w:w="11906"/)
      expect(document).toMatch(/<w:pgSz[^>]*w:h="16838"/)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown PaperSize'))
    } finally {
      warn.mockRestore()
    }
  })
})

describe('section - 页边距', () => {
  it('默认 25.4mm 边距 (1440 twip)', async () => {
    const { document } = await unpack('<p>x</p>')
    expect(document).toMatch(/<w:pgMar[^>]*w:top="1440"/)
    expect(document).toMatch(/<w:pgMar[^>]*w:left="1440"/)
  })

  it('自定义边距：mm 单位', async () => {
    const { document } = await unpack('<p>x</p>', {
      page: { margin: { top: 50.8, right: 12.7, bottom: 50.8, left: 12.7, unit: 'mm' } },
    })
    expect(document).toMatch(/<w:pgMar[^>]*w:top="2880"/) // 50.8mm = 2 in = 2880 twip
    expect(document).toMatch(/<w:pgMar[^>]*w:left="720"/) // 12.7mm = 0.5 in
  })

  it('非法 margin（NaN / 负数 / 字符串）：回退默认值，不污染 OOXML', async () => {
    // 防回归：margin 字段曾被原样 toTwip，NaN 让 Word 报「文件已损坏」、负值让 Word 拒开
    const { document } = await unpack('<p>x</p>', {
      page: {
        margin: {
          top: NaN,
          left: -10,
          right: 'oops' as never,
          bottom: 25.4, // 合法：保留
        },
      },
    })
    // top / left / right 应回退到默认 25.4mm = 1440 twip；bottom 也是 1440
    expect(document).toMatch(/<w:pgMar[^>]*w:top="1440"/)
    expect(document).toMatch(/<w:pgMar[^>]*w:left="1440"/)
    expect(document).toMatch(/<w:pgMar[^>]*w:right="1440"/)
    expect(document).toMatch(/<w:pgMar[^>]*w:bottom="1440"/)
    // 负值 / NaN 不应出现在生成的 XML 中
    expect(document).not.toMatch(/w:(top|left|right|bottom)="-/)
    expect(document).not.toContain('NaN')
  })
})

describe('section - 页眉页脚', () => {
  it('字符串 header → header1.xml 含文本', async () => {
    const { header1 } = await unpack('<p>body</p>', { header: 'My Header' })
    expect(header1).toBeDefined()
    expect(header1).toContain('My Header')
  })

  it('三段对象 footer：left/center/right 三段', async () => {
    const { footer1 } = await unpack('<p>x</p>', {
      footer: { left: 'L', center: 'C', right: 'R' },
    })
    expect(footer1).toContain('L')
    expect(footer1).toContain('C')
    expect(footer1).toContain('R')
  })

  it('部分对象 footer：仅 center，left/right 缺省', async () => {
    // 覆盖 normalizeSlots 中未定义槽位的透传分支
    const { footer1 } = await unpack('<p>x</p>', {
      footer: { center: 'ONLY' },
    })
    expect(footer1).toContain('ONLY')
  })
})

describe('section - 页码', () => {
  it('enabled=true：默认放页脚中部', async () => {
    const { footer1 } = await unpack('<p>x</p>', {
      pageNumber: { enabled: true },
    })
    expect(footer1).toBeDefined()
    // PageNumber.CURRENT 在 docx 中编译为 PAGE 字段
    expect(footer1).toMatch(/PAGE/)
  })

  it('start=10：sectPr 含 pgNumType start 10', async () => {
    const { document } = await unpack('<p>x</p>', {
      pageNumber: { enabled: true, start: 10 },
    })
    expect(document).toMatch(/<w:pgNumType[^>]*w:start="10"/)
  })

  it('format=upperRoman：fmt 为 upperRoman', async () => {
    const { document } = await unpack('<p>x</p>', {
      pageNumber: { enabled: true, format: 'upperRoman' },
    })
    expect(document).toMatch(/<w:pgNumType[^>]*w:fmt="upperRoman"/)
  })

  it('template "第 {PAGE} 页 / 共 {TOTAL} 页"：含 PAGE 与 NUMPAGES 字段', async () => {
    const { footer1 } = await unpack('<p>x</p>', {
      pageNumber: {
        enabled: true,
        template: '第 {PAGE} 页 / 共 {TOTAL} 页',
      },
    })
    expect(footer1).toMatch(/PAGE/)
    expect(footer1).toMatch(/NUMPAGES/)
    expect(footer1).toContain('第')
    expect(footer1).toContain('页')
  })

  it('position=header-right：注入到页眉', async () => {
    const { header1, footer1 } = await unpack('<p>x</p>', {
      pageNumber: { enabled: true, position: 'header-right' },
    })
    expect(header1).toMatch(/PAGE/)
    expect(footer1).toBeUndefined()
  })
})
