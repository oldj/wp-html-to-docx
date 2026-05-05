// 列表 numbering 默认模板
// docx 要求 reference 在 Document 顶层声明 8 层 levels，Paragraph 引用 (reference, level)

import { AlignmentType, LevelFormat, type ILevelsOptions } from 'docx'

const MAX_LEVELS = 8
/** 每层缩进的 twip（约 0.5 英寸 / 720 twip） */
export const INDENT_PER_LEVEL = 720
export const HANGING_INDENT = 360

/** 无序列表层级模板：所有层均为 bullet */
export function bulletLevels(): ILevelsOptions[] {
  const out: ILevelsOptions[] = []
  for (let i = 0; i < MAX_LEVELS; i++) {
    out.push({
      level: i,
      format: LevelFormat.BULLET,
      text: '•',
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: {
          indent: { left: INDENT_PER_LEVEL * (i + 1), hanging: HANGING_INDENT },
        },
      },
    })
  }
  return out
}

/** 有序列表层级模板：所有层均为 decimal */
export function decimalLevels(): ILevelsOptions[] {
  const out: ILevelsOptions[] = []
  for (let i = 0; i < MAX_LEVELS; i++) {
    out.push({
      level: i,
      format: LevelFormat.DECIMAL,
      text: `%${i + 1}.`,
      alignment: AlignmentType.LEFT,
      start: 1,
      style: {
        paragraph: {
          indent: { left: INDENT_PER_LEVEL * (i + 1), hanging: HANGING_INDENT },
        },
      },
    })
  }
  return out
}
