import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useEscClose } from './useEscClose'

function Demo({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  useEscClose(
    open,
    () => {
      onClose?.()
      setOpen(false)
    },
    '.dlg',
  )
  return (
    <div>
      <button className='trigger' onClick={() => setOpen(true)}>
        打开
      </button>
      {open && (
        <div className='dlg'>
          <span>标题</span>
          <textarea className='first' />
        </div>
      )}
    </div>
  )
}

describe('useEscClose', () => {
  afterEach(cleanup)

  it('打开后焦点进入首个控件，Esc 关闭并把焦点还给触发按钮', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const { container } = render(<Demo onClose={onClose} />)
    const trigger = container.querySelector('.trigger') as HTMLButtonElement
    trigger.focus()
    fireEvent.click(trigger)
    act(() => {
      vi.runAllTimers()
    })
    expect(document.activeElement).toBe(container.querySelector('.first'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.dlg')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('关闭状态下 Esc 无反应，其它按键不关闭', () => {
    const onClose = vi.fn()
    const { container } = render(<Demo onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.trigger')!)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
