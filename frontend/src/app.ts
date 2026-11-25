import { PropsWithChildren, useEffect } from 'react'
import { ensureLogin, getToken, redirectToLogin, usesEmailLoginPage } from './services/api'
import { applyInitialLoginRoute } from './services/authGuard'
import './app.scss'

// H5 生产：在 Taro 路由初始化前同步把无 token 的访问切到登录页（修复「地址是登录页、画面是首页」，见 authGuard.ts）。
// 开发态 H5 走 dev-login 自动登录，不拦截；weapp 走 wx.login 静默登录，不涉及。
if (process.env.TARO_ENV === 'h5' && process.env.NODE_ENV !== 'development' && usesEmailLoginPage()) {
  applyInitialLoginRoute(Boolean(getToken()))
}

function App({ children }: PropsWithChildren) {
  useEffect(() => {
    // weapp：wx.login 静默登录；H5：开发态 dev-login，否则无 token 时进入邮箱验证码登录页
    void ensureLogin().then((ok) => {
      if (!ok) redirectToLogin()
    })
  }, [])

  return children
}

export default App
