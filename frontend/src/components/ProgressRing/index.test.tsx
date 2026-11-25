import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ProgressRing from './index'

describe('ProgressRing', () => {
  afterEach(cleanup)

  it('有值时显示百分比', () => {
    const { container } = render(<ProgressRing value={68.4} caption='整体保持率' />)
    expect(container.querySelector('.zx-ring-num')?.textContent).toBe('68%')
    expect(container.querySelector('.zx-ring-cap')?.textContent).toBe('整体保持率')
    expect(container.querySelector('.zx-ring')?.className).not.toContain('is-empty')
  })

  it('无数据时显示「—」而不是 0%', () => {
    const { container } = render(<ProgressRing value={null} tone='mint' />)
    expect(container.querySelector('.zx-ring-num')?.textContent).toBe('—')
    expect(container.querySelector('.zx-ring')?.className).toContain('is-empty')
    expect(container.querySelector('.zx-ring-cap')).toBeNull()
  })
})
