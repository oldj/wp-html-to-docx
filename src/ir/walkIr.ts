// IR 树的共享深度遍历器
//
// imageCollector / mathCollector 此前各自维护一份 collectFromBlocks，
// 都漏掉了 list-continuation 块（嵌套列表之后的延续内容），导致其中的
// 图片 / 公式不被预加载而在渲染期丢失。收口到此处保证：
// 新增 Block 变体时只需改这一个 walker，所有资源收集器同步受益。

import type { Block, Inline } from '../types.js'

/**
 * 深度优先遍历所有块（含 blockquote 子块、table 单元格子块）。
 * visit 在进入子块之前调用（先序）。
 */
export function walkBlocksDeep(blocks: Block[], visit: (block: Block) => void): void {
  for (const block of blocks) {
    visit(block)
    switch (block.kind) {
      case 'blockquote':
        walkBlocksDeep(block.children, visit)
        break
      case 'table':
        for (const row of block.rows) {
          for (const cell of row.cells) walkBlocksDeep(cell.children, visit)
        }
        break
      // 其余块无嵌套子块
    }
  }
}

/**
 * 遍历 IR 中所有 Inline（覆盖 paragraph / heading / list-item / list-continuation 四类含
 * inlines 的块，含嵌套结构）。
 */
export function walkInlinesDeep(blocks: Block[], visit: (inline: Inline) => void): void {
  walkBlocksDeep(blocks, (block) => {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
      case 'list-item':
      case 'list-continuation':
        for (const inline of block.inlines) visit(inline)
        break
    }
  })
}
