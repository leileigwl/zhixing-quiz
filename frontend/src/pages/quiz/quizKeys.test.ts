import { describe, expect, it } from 'vitest'
import { isEditableTarget, optionKeyHint, resolveQuizKey, type QuizKeyContext } from './quizKeys'

const base: QuizKeyContext = {
  optionKeys: ['A', 'B', 'C', 'D'],
  submitted: false,
  hasSelection: false,
  canPrev: true,
}

describe('resolveQuizKey', () => {
  it('1–4 与 A–D（大小写）按位置选项', () => {
    expect(resolveQuizKey({ key: '1' }, base)).toEqual({ type: 'select', optionKey: 'A' })
    expect(resolveQuizKey({ key: '4' }, base)).toEqual({ type: 'select', optionKey: 'D' })
    expect(resolveQuizKey({ key: 'b' }, base)).toEqual({ type: 'select', optionKey: 'B' })
    expect(resolveQuizKey({ key: 'C' }, base)).toEqual({ type: 'select', optionKey: 'C' })
  })

  it('超出选项数量或无关按键不响应', () => {
    const judge = { ...base, optionKeys: ['T', 'F'] }
    expect(resolveQuizKey({ key: '3' }, judge)).toBeNull()
    expect(resolveQuizKey({ key: '5' }, base)).toBeNull()
    expect(resolveQuizKey({ key: 'x' }, base)).toBeNull()
    expect(resolveQuizKey({ key: 'Tab' }, base)).toBeNull()
  })

  it('判断题：1/2、A/B 按位置，T/F 直接按选项字母', () => {
    const judge = { ...base, optionKeys: ['T', 'F'] }
    expect(resolveQuizKey({ key: '1' }, judge)).toEqual({ type: 'select', optionKey: 'T' })
    expect(resolveQuizKey({ key: 'b' }, judge)).toEqual({ type: 'select', optionKey: 'F' })
    expect(resolveQuizKey({ key: 'f' }, judge)).toEqual({ type: 'select', optionKey: 'F' })
  })

  it('Enter：未选不提交；已选提交；已提交则下一题；长按重复不触发', () => {
    expect(resolveQuizKey({ key: 'Enter' }, base)).toBeNull()
    expect(resolveQuizKey({ key: 'Enter' }, { ...base, hasSelection: true })).toEqual({ type: 'submit' })
    expect(resolveQuizKey({ key: 'Enter' }, { ...base, submitted: true })).toEqual({ type: 'next' })
    expect(resolveQuizKey({ key: 'Enter', repeat: true }, { ...base, submitted: true })).toBeNull()
  })

  it('← 上一题（第一题时不响应）', () => {
    expect(resolveQuizKey({ key: 'ArrowLeft' }, base)).toEqual({ type: 'prev' })
    expect(resolveQuizKey({ key: 'ArrowLeft' }, { ...base, canPrev: false })).toBeNull()
  })

  it('已提交或只读回看时不能再改选项', () => {
    expect(resolveQuizKey({ key: '1' }, { ...base, submitted: true })).toBeNull()
    expect(resolveQuizKey({ key: '1' }, { ...base, readonly: true })).toBeNull()
  })

  it('输入框聚焦、修饰键、输入法组字、弹层打开时不拦截', () => {
    expect(resolveQuizKey({ key: '1', targetTag: 'input' }, base)).toBeNull()
    expect(resolveQuizKey({ key: 'Enter', targetTag: 'TEXTAREA' }, { ...base, hasSelection: true })).toBeNull()
    expect(resolveQuizKey({ key: '1', targetEditable: true }, base)).toBeNull()
    expect(resolveQuizKey({ key: '1', ctrlKey: true }, base)).toBeNull()
    expect(resolveQuizKey({ key: '1', metaKey: true }, base)).toBeNull()
    expect(resolveQuizKey({ key: '1', altKey: true }, base)).toBeNull()
    expect(resolveQuizKey({ key: '1', isComposing: true }, base)).toBeNull()
    expect(resolveQuizKey({ key: 'Enter' }, { ...base, submitted: true, blocked: true })).toBeNull()
  })
})

describe('isEditableTarget / optionKeyHint', () => {
  it('识别可编辑目标', () => {
    expect(isEditableTarget('DIV')).toBe(false)
    expect(isEditableTarget(undefined)).toBe(false)
    expect(isEditableTarget('taro-input-core')).toBe(true)
    expect(isEditableTarget('DIV', true)).toBe(true)
  })

  it('键位提示只给前 4 个选项', () => {
    expect(optionKeyHint(0)).toBe('1')
    expect(optionKeyHint(3)).toBe('4')
    expect(optionKeyHint(4)).toBe('')
    expect(optionKeyHint(-1)).toBe('')
  })
})
