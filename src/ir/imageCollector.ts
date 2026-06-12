// 图片预加载：遍历 IR 收集所有 image inline 的 src，
// 按"data URL 立即解码 / 外链走 imageResolver / 其余按 onUnresolvedImage"策略填充 ctx.images。
//
// 渲染阶段（builder/runs.ts）只读 ctx.images，按 src 命中则产 ImageRun，未命中则跳过。
// 这样把异步 IO 集中在一处，runs 渲染可保持同步。

import type { Block, Inline } from '../types.js'
import type { BuildContext, ImageAsset } from './buildContext.js'
import { isDataUrl, parseDataUrl } from '../utils/dataUrl.js'
import { getIntrinsicSize } from '../utils/imageDimensions.js'
import { inferImageType } from '../utils/imageType.js'

const DEFAULT_WIDTH = 200
const DEFAULT_HEIGHT = 150

export async function collectImages(ir: Block[], ctx: BuildContext): Promise<void> {
  const srcs = new Set<string>()
  collectFromBlocks(ir, srcs)
  // 并行加载所有外链图片：每张失败由 loadImage 内部 try/catch 隔离，
  // onUnresolvedImage='error' 时第一个抛错会冒泡（与原顺序行为一致：终止整次构建）
  const pending = Array.from(srcs)
    .filter((src) => !ctx.images.has(src))
    .map(async (src) => {
      const asset = await loadImage(src, ctx)
      if (asset !== null) ctx.images.set(src, asset)
    })
  await Promise.all(pending)
}

function collectFromBlocks(blocks: Block[], out: Set<string>): void {
  for (const block of blocks) {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
      case 'list-item':
        collectFromInlines(block.inlines, out)
        break
      case 'blockquote':
        collectFromBlocks(block.children, out)
        break
      case 'table':
        for (const row of block.rows) {
          for (const cell of row.cells) collectFromBlocks(cell.children, out)
        }
        break
      // pre / hr / math：无图片
    }
  }
}

function collectFromInlines(inlines: Inline[], out: Set<string>): void {
  for (const item of inlines) {
    if (item.kind === 'image' && item.src) out.add(item.src)
  }
}

async function loadImage(src: string, ctx: BuildContext): Promise<ImageAsset | null> {
  // data URL：同步解码
  if (isDataUrl(src)) {
    try {
      const { mime, data } = parseDataUrl(src)
      // 解码真实固有尺寸；失败（未识别格式）退回默认 200x150
      const size = getIntrinsicSize(data)
      return {
        data,
        type: inferImageType(mime, data),
        width: size?.width ?? DEFAULT_WIDTH,
        height: size?.height ?? DEFAULT_HEIGHT,
      }
    } catch (err) {
      return handleUnresolved(src, ctx, `Failed to parse data URL: ${(err as Error).message}`)
    }
  }

  // 外链：走 resolver
  const resolver = ctx.options.imageResolver
  if (resolver !== undefined) {
    try {
      const res = await resolver(src)
      // 逐字段兜底：resolver 显式值优先，缺哪个轴就用数据解码的固有尺寸补，最后退默认。
      // 不整体「宽高都有才采用」，否则 resolver 只给单边尺寸时，已给的那边会被一起丢弃，
      // 回退到解码结果或默认 200x150（相对旧的逐字段 `?? 默认` 行为是兼容性回归）。
      const decoded = getIntrinsicSize(res.data)
      return {
        data: res.data,
        type: inferImageType(res.mime, res.data),
        width: res.width ?? decoded?.width ?? DEFAULT_WIDTH,
        height: res.height ?? decoded?.height ?? DEFAULT_HEIGHT,
      }
    } catch (err) {
      return handleUnresolved(src, ctx, `imageResolver threw: ${(err as Error).message}`)
    }
  }

  return handleUnresolved(src, ctx, 'No imageResolver configured for non-data URL')
}

function handleUnresolved(src: string, ctx: BuildContext, reason: string): ImageAsset | null {
  const policy = ctx.options.onUnresolvedImage ?? 'skip'
  if (policy === 'error') {
    throw new Error(`Cannot load image "${src}": ${reason}`)
  }
  // skip / placeholder：返回 null，由渲染层用 alt 文本占位
  return null
}
