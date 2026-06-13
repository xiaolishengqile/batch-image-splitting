import { createRoot } from 'react-dom/client'
// @ts-ignore - CSS module
import App from './App'
// @ts-ignore - CSS module
import './index.css'

createRoot(document.getElementById('root')!).render(<App />)
