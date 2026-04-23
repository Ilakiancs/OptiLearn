import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const globalStyles = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --color-bg:           #0f1117;
  --color-surface:      #1a1d27;
  --color-surface-2:    #252836;
  --color-border:       #2e3144;
  --color-primary:      #6c63ff;
  --color-primary-dim:  #3d3880;
  --color-success:      #22c55e;
  --color-warning:      #f59e0b;
  --color-danger:       #ef4444;
  --color-text:         #e8e9f0;
  --color-text-muted:   #8b8fa8;
  --color-text-hint:    #555870;
  --radius-sm:          6px;
  --radius-md:          10px;
  --radius-lg:          16px;
}

html, body, #root {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.6;
  background: var(--color-bg);
  color: var(--color-text);
  -webkit-font-smoothing: antialiased;
}

button, input, textarea, select {
  font-family: inherit;
  font-size: inherit;
  outline: none;
}

button:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

a { color: inherit; }

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 3px; }
`

const styleEl = document.createElement('style')
styleEl.textContent = globalStyles
document.head.appendChild(styleEl)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
