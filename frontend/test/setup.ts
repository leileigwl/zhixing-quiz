import { afterEach, beforeEach, vi } from 'vitest'
import { __resetTaroMock } from './mocks/taro'

beforeEach(() => {
  __resetTaroMock()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})
