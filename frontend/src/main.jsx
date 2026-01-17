import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Note: StrictMode disabled due to deck.gl compatibility issues with React 18
// StrictMode double-renders components, which exposes bugs in deck.gl's hook handling
// See: https://github.com/visgl/deck.gl/issues/7494
ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
