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
/**
 * 表单控件：Taro 的 onInput 回调读取 `e.detail.value`，DOM 事件没有 detail，这里补齐；
 * placeholderClass / maxlength / focus 等 Taro 专有属性不透传到 DOM。
 */
function makeField(tag: 'input' | 'textarea', displayName: string) {
  const Comp = React.forwardRef<any, AnyProps>(
    (
      { className, hoverClass: _h, placeholderClass: _pc, maxlength, focus: _f, onInput, onConfirm, value, type, ...rest },
      ref,
    ) =>
      React.createElement(tag, {
        ref,
        className,
        maxLength: maxlength,
        type: tag === 'input' && type !== 'number' ? type : undefined,
        value: value ?? '',
        onChange: (e: any) => onInput?.({ ...e, detail: { value: e.target.value } }),
        onKeyDown: (e: any) => {
          if (e.key === 'Enter') onConfirm?.({ ...e, detail: { value: e.target.value } })
        },
        ...rest,
      }),
  )
  Comp.displayName = displayName
  return Comp
}

export const Input = makeField('input', 'Input')
export const Textarea = makeField('textarea', 'Textarea')
export const ScrollView = make('div', 'ScrollView')
export const Canvas = make('canvas', 'Canvas')
export const Switch = make('input', 'Switch')
