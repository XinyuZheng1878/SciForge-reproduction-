import React from 'react'
import ReactDOM from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '@xyflow/react/dist/style.css'
import './index.css'
import './styles/base-shell.css'
import './styles/surfaces-write.css'
import './styles/markdown-code.css'
import './styles/write-editor.css'
import './styles/write-rich-editor.css'
import './styles/workflow-canvas.css'
import App from './App'
import './i18n'
import { installDevDsGuiBridge } from './dev/dev-ds-gui-bridge'

installDevDsGuiBridge()
document.documentElement.dataset.platform = window.dsGui?.platform ?? 'unknown'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
