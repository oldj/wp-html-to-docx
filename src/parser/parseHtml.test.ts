import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren, isElement, isTextNode } from './parseHtml.js'

describe('parseHtmlBodyChildren', () => {
  it('解析片段（无 html/body 包裹）：直接返回顶层 p 元素', () => {
    const nodes = parseHtmlBodyChildren('<p>x</p>')
    expect(nodes).toHaveLength(1)
    const first = nodes[0]
    if (!first || !isElement(first)) throw new Error('expected element')
    expect(first.tagName).toBe('p')
  })

  it('解析完整文档（含 doctype 与 html）：返回 body 子节点而非 html / head', () => {
    // 关键意图：findBody 把 <body> 内的子节点提出来，调用方拿到的应当是 p
    // 而不是 doctype / html / head 这种外层包裹（旧测试只看 length>0 的话，buggy
    // 实现把整个 doc.childNodes 返回也能通过）
    const html = '<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>'
    const nodes = parseHtmlBodyChildren(html)
    expect(nodes).toHaveLength(1)
    const first = nodes[0]
    if (!first || !isElement(first)) throw new Error('expected element')
    expect(first.tagName).toBe('p')
  })

  it('解析含 <html> 但无 doctype：同样从 body 提取', () => {
    const nodes = parseHtmlBodyChildren('<html><body><h1>x</h1></body></html>')
    expect(nodes).toHaveLength(1)
    const first = nodes[0]
    if (!first || !isElement(first)) throw new Error('expected element')
    expect(first.tagName).toBe('h1')
  })

  it('类型守卫', () => {
    const nodes = parseHtmlBodyChildren('text')
    const text = nodes[0]
    expect(text).toBeDefined()
    expect(text && isTextNode(text)).toBe(true)
    expect(text && isElement(text)).toBe(false)
  })
})
