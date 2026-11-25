/**
 * V2.9 键盘答题：把一次按键映射成答题动作（纯函数，不依赖 Taro / DOM，便于单测）。
 * - 1–4 / A–D：按位置选第 1–4 个选项（判断题 T/F 也可直接按选项字母）
 * - Enter：未提交 → 提交答案；已提交 → 下一题 / 查看报告
 * - ←：上一题
 * 输入框 / 可编辑区域聚焦、带修饰键、弹层打开或输入法组字时一律不拦截。
 */
export type QuizKeyAction =
  | { type: 'select'; optionKey: string }
  | { type: 'submit' }
  | { type: 'next' }
  | { type: 'prev' }

export interface QuizKeyEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  repeat?: boolean
  targetTag?: string
  targetEditable?: boolean
}

export interface QuizKeyContext {
  optionKeys: string[]
  submitted: boolean
  readonly?: boolean
  hasSelection: boolean
  canPrev: boolean
  blocked?: boolean
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'TARO-INPUT-CORE', 'TARO-TEXTAREA-CORE'])
const LETTERS = ['A', 'B', 'C', 'D']

export function isEditableTarget(tag?: string, editable?: boolean): boolean {
  if (editable) return true
  return Boolean(tag && EDITABLE_TAGS.has(tag.toUpperCase()))
}

export function resolveQuizKey(e: QuizKeyEventLike, ctx: QuizKeyContext): QuizKeyAction | null {
  if (ctx.blocked || e.isComposing) return null
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (isEditableTarget(e.targetTag, e.targetEditable)) return null

  const key = e.key

  if (key === 'Enter') {
    if (e.repeat) return null
    if (ctx.submitted) return { type: 'next' }
    return ctx.hasSelection ? { type: 'submit' } : null
  }

  if (key === 'ArrowLeft') {
    return ctx.canPrev ? { type: 'prev' } : null
  }

  if (ctx.submitted || ctx.readonly || key.length !== 1) return null

  let idx = -1
  if (key >= '1' && key <= '4') idx = Number(key) - 1
  const upper = key.toUpperCase()
  // 选项字母优先按字母本身匹配（如判断题 T / F），否则 A–D 按位置
  const direct = ctx.optionKeys.find((k) => k.toUpperCase() === upper)
  if (idx < 0 && direct) return { type: 'select', optionKey: direct }
  if (idx < 0) idx = LETTERS.indexOf(upper)
  if (idx < 0 || idx >= ctx.optionKeys.length) return null
  return { type: 'select', optionKey: ctx.optionKeys[idx] }
}

/** 选项右侧的键位提示文案（第 1–4 个选项显示 1–4） */
export function optionKeyHint(index: number): string {
  return index >= 0 && index < 4 ? String(index + 1) : ''
}
