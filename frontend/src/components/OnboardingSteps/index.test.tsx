import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OnboardingSteps from './index'

describe('OnboardingSteps（V3.0 新用户三步引导）', () => {
  afterEach(cleanup)

  it('三步依次为上传资料 / 出一组题 / 看记忆曲线，示意图都标注「示意」', () => {
    const { container } = render(<OnboardingSteps />)
    expect(screen.getByText('上传资料')).toBeTruthy()
    expect(screen.getByText('出一组题')).toBeTruthy()
    expect(screen.getByText('看记忆曲线')).toBeTruthy()
    expect(container.querySelectorAll('.zx-onb-tag')).toHaveLength(3)
    container.querySelectorAll('.zx-onb-tag').forEach((el) => expect(el.textContent).toBe('示意'))
    expect(screen.getByText('小图为示意，不是你的数据')).toBeTruthy()
  })

  it('每一步点击触发对应动作', () => {
    const onUpload = vi.fn()
    const onCompose = vi.fn()
    const onCurve = vi.fn()
    const { container } = render(<OnboardingSteps onUpload={onUpload} onCompose={onCompose} onCurve={onCurve} title='自定义标题' />)
    expect(screen.getByText('自定义标题')).toBeTruthy()
    fireEvent.click(container.querySelector('.zx-onb-step.is-1')!)
    fireEvent.click(container.querySelector('.zx-onb-step.is-2')!)
    fireEvent.click(container.querySelector('.zx-onb-step.is-3')!)
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(onCompose).toHaveBeenCalledTimes(1)
    expect(onCurve).toHaveBeenCalledTimes(1)
  })
})
