// 超链接端到端：
// - `<a href="#id">` 指向文档内带 id 的元素时，转成 Word 书签 + 文档内链接（InternalHyperlink）
// - 锚点目标不存在、或 href 是相对路径时，只保留文字，不写出点了也打不开的死链接

import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='

async function unpack(html: string): Promise<{ document: string; rels: string }> {
  const files = unzipSync(await htmlToDocx(html))
  return {
    document: strFromU8(files['word/document.xml']!),
    rels: strFromU8(files['word/_rels/document.xml.rels']!),
  }
}

/** 文档中所有书签名（按出现顺序） */
function bookmarks(xml: string): string[] {
  return [...xml.matchAll(/<w:bookmarkStart\b[^>]*\bw:name="([^"]+)"/g)].map((m) => m[1]!)
}

/** 文档中所有文档内链接指向的书签名（按出现顺序） */
function internalLinks(xml: string): string[] {
  return [...xml.matchAll(/<w:hyperlink\b[^>]*\bw:anchor="([^"]+)"/g)].map((m) => m[1]!)
}

/** 名为 name 的书签所包住的文字（属性顺序由 docx 决定，故先取整个标签再分别读 name / id） */
function bookmarkedText(xml: string, name: string): string {
  const start = [...xml.matchAll(/<w:bookmarkStart\b[^>]*\/>/g)].find((m) =>
    m[0].includes(`w:name="${name}"`),
  )
  if (start === undefined) return ''
  const id = /\bw:id="(\d+)"/.exec(start[0])![1]!
  const end = xml.indexOf(`<w:bookmarkEnd w:id="${id}"/>`, start.index)
  return [...xml.slice(start.index, end).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => m[1])
    .join('')
}

describe('文档内锚点链接', () => {
  it('#id 指向标题：标题包进书签，链接转成 w:anchor 并挂 Hyperlink 样式；链接在目标之前也能解析', async () => {
    const { document, rels } = await unpack(
      '<p>见 <a href="#intro">简介</a></p><h2 id="intro">简介</h2><p>正文</p>',
    )
    const [name] = bookmarks(document)
    expect(name).toMatch(/^_wp_anchor_\d+$/)
    expect(bookmarkedText(document, name!)).toBe('简介')
    expect(internalLinks(document)).toEqual([name])
    const link = /<w:hyperlink\b[^>]*\bw:anchor=[\s\S]*?<\/w:hyperlink>/.exec(document)![0]
    expect(link).toContain('<w:rStyle w:val="Hyperlink"/>')
    // 文档内链接不应再写成外部关系
    expect(rels).not.toContain('Target="#intro"')
  })

  it('id 含 Word 书签名不允许的字符（- / 空格 / 中文）也能跳转：书签名由库生成', async () => {
    const { document } = await unpack('<h2 id="第 1-节">一</h2><p><a href="#第 1-节">去</a></p>')
    expect(internalLinks(document)).toEqual(bookmarks(document))
    expect(bookmarks(document)).toHaveLength(1)
  })

  it('百分号编码的锚点（如中文 id）按解码后的 id 匹配', async () => {
    const { document } = await unpack(
      '<h2 id="中文标题">一</h2><p><a href="#%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98">去</a></p>',
    )
    expect(internalLinks(document)).toEqual(bookmarks(document))
  })

  it('目标不存在：只保留文字，不写链接也不挂 Hyperlink 样式', async () => {
    const { document } = await unpack('<p>见 <a href="#nowhere">别处</a></p>')
    expect(document).not.toContain('<w:hyperlink')
    expect(document).not.toContain('w:val="Hyperlink"')
    expect(document).toContain('别处')
  })

  it('id 重复时以首个元素为准，只生成一个书签', async () => {
    const { document } = await unpack(
      '<p id="x">第一</p><p id="x">第二</p><p><a href="#x">去</a></p>',
    )
    const names = bookmarks(document)
    expect(names).toHaveLength(1)
    expect(bookmarkedText(document, names[0]!)).toBe('第一')
  })

  it('外层容器与其内首段各有 id：两个书签挂在同一段，两条链接都能解析', async () => {
    const { document } = await unpack(
      '<div id="outer"><p id="inner">内容</p></div><p><a href="#outer">外</a> <a href="#inner">内</a></p>',
    )
    const names = bookmarks(document)
    expect(names).toHaveLength(2)
    expect(new Set(internalLinks(document))).toEqual(new Set(names))
    for (const name of names) expect(bookmarkedText(document, name)).toBe('内容')
  })

  it('列表项与表格的 id：书签分别落在列表项段落与首个单元格的段落上', async () => {
    const { document } = await unpack(
      '<ol><li id="step">步骤一</li></ol><table id="t"><tr><td>甲</td><td>乙</td></tr></table>' +
        '<p><a href="#step">步骤</a><a href="#t">表格</a></p>',
    )
    const names = bookmarks(document)
    expect(names.map((n) => bookmarkedText(document, n))).toEqual(['步骤一', '甲'])
    expect(internalLinks(document)).toEqual(names)
    // 书签不影响列表编号
    expect(document).toContain('<w:numPr>')
  })

  it('id 所在元素不产出段落（如 <pre>）：不注册书签，指向它的链接退回文字', async () => {
    const { document } = await unpack('<pre id="code">x = 1</pre><p><a href="#code">代码</a></p>')
    expect(bookmarks(document)).toEqual([])
    expect(document).not.toContain('<w:hyperlink')
  })

  it('图片链接到文档内锚点：只输出图片、不加链接（绕开 docx 写出悬空 hlinkClick 关系的 bug）', async () => {
    // 防回归：docx 9.15 给 InternalHyperlink 里的图片写 <a:hlinkClick r:id>，而该关系并不存在，
    // Word 打开时提示「发现无法读取的内容」
    const { document } = await unpack(
      `<h2 id="top">顶部</h2><p><a href="#top"><img src="${TINY_PNG_DATA_URL}"></a></p>`,
    )
    expect(document).toContain('<w:drawing>')
    expect(document).not.toContain('<w:hyperlink')
    expect(document).not.toContain('hlinkClick')
  })

  it('同一段里的文字锚点链接不受影响，仍是文档内链接', async () => {
    const { document } = await unpack(
      `<h2 id="top">顶部</h2><p><a href="#top">回顶部 <img src="${TINY_PNG_DATA_URL}"></a></p>`,
    )
    expect(internalLinks(document)).toEqual(bookmarks(document))
    expect(document).not.toContain('hlinkClick')
  })

  it('图片链接到外部地址：仍包在外部链接里，图片可点击', async () => {
    const { document, rels } = await unpack(
      `<p><a href="https://example.com"><img src="${TINY_PNG_DATA_URL}"></a></p>`,
    )
    const link = /<w:hyperlink\b[^>]*\br:id=[\s\S]*?<\/w:hyperlink>/.exec(document)?.[0] ?? ''
    expect(link).toContain('<w:drawing>')
    expect(rels).toContain('Target="https://example.com"')
  })
})

describe('相对路径链接', () => {
  it('去掉链接只保留文字：不写外部关系，也不挂 Hyperlink 样式', async () => {
    const { document, rels } = await unpack(
      '<p><a href="./other.html">相对</a> <a href="/root">根</a> <a href="https://a.com">绝对</a></p>',
    )
    expect(document).toContain('相对')
    expect(document).toContain('根')
    expect(rels).not.toContain('Target="./other.html"')
    expect(rels).not.toContain('Target="/root"')
    expect(rels).toContain('Target="https://a.com"')
    expect(document.match(/w:val="Hyperlink"/g)).toHaveLength(1)
  })
})
