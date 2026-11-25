import { PropsWithChildren, useEffect } from 'react'
import { ensureLogin, redirectToLogin } from './services/api'
import './app.scss'

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
