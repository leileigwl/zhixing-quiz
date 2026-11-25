import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmptyState from './index'

describe('EmptyState', () => {
  afterEach(cleanup)

  it('显示标题、说明，点击按钮触发动作', () => {
    const onAction = vi.fn()
    render(<EmptyState title='还没有答题记录' desc='完成第一组测验后显示' actionText='去出题' onAction={onAction} />)
    expect(screen.getByText('还没有答题记录')).toBeTruthy()
    expect(screen.getByText('完成第一组测验后显示')).toBeTruthy()
    fireEvent.click(screen.getByText('去出题'))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('没有动作时不渲染按钮', () => {
    const { container } = render(<EmptyState title='空' />)
    expect(container.querySelector('.zx-empty-action')).toBeNull()
  })
})
