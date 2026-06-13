// 统一 warning 出口
//
// 库内多处需要向调用方提示非致命问题（未知纸张名、页码槽位冲突、公式转换失败、
// 图片无法嵌入等）。规则：
// - 提供 options.logger 时一律走 logger('warn', ...)，宿主可统一采集；
// - 未提供时按场景二选一：退回 console.warn（保持旧行为），或完全静默
//   （fallbackToConsole = false，用于「静默跳过」是文档化语义的场景，如 skip 图片）。

import type { Logger } from '../options.js'

export type WarnFn = (message: string, ...args: unknown[]) => void

/**
 * 构造 warn 函数。
 * @param logger 用户提供的日志钩子；其自身抛错会被吞掉，不阻断构建主流程
 * @param fallbackToConsole 无 logger 时是否退回 console.warn（默认 true）
 */
export function makeWarn(logger: Logger | undefined, fallbackToConsole = true): WarnFn {
  if (logger === undefined) {
    if (!fallbackToConsole) return () => {}
    return (message, ...args) => console.warn(message, ...args)
  }
  return (message, ...args) => {
    try {
      logger('warn', message, ...args)
    } catch {
      // 用户日志实现自身抛错不应阻断主流程
    }
  }
}
