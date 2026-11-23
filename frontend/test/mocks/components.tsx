/** `@tarojs/components` 的 Vitest 替身：映射为最接近的 DOM 元素，并把 Taro 的 onClick 透传。 */
import React from 'react'

type AnyProps = Record<string, any> & { children?: React.ReactNode }

function make(tag: keyof React.JSX.IntrinsicElements, displayName: string) {
  const Comp = React.forwardRef<any, AnyProps>(
    ({ children, className, hoverClass: _h, hoverStayTime: _hs, canvasId: _c, ...rest }, ref) =>
      React.createElement(tag, { ref, className, ...rest }, children),
  )
  Comp.displayName = displayName
  return Comp
}

export const View = make('div', 'View')
export const Text = make('span', 'Text')
export const Image = make('img', 'Image')
export const Button = make('button', 'Button')
export const Input = make('input', 'Input')
export const Textarea = make('textarea', 'Textarea')
export const ScrollView = make('div', 'ScrollView')
export const Canvas = make('canvas', 'Canvas')
export const Switch = make('input', 'Switch')
