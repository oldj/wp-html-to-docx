import { describe, it, expect } from 'vitest'
import { htmlToDocx } from './index.js'

describe('htmlToDocx', () => {
  // 占位用例：尚未实现，应当抛出明确错误
  it('当前为未实现状态，应抛出错误', async () => {
    await expect(htmlToDocx('<p>hi</p>')).rejects.toThrow('not implemented')
  })
})
