import { PropsWithChildren, useEffect } from 'react'
import { ensureLogin } from './services/api'
import './app.scss'

function App({ children }: PropsWithChildren) {
  useEffect(() => {
    void ensureLogin()
  }, [])

  return children
}

export default App
