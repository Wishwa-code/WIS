// src/main.tsx

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx' // ✨ Change: Updated file extension

// ✨ Change: Added '!' to assert that the element is never null
createRoot(document.getElementById('root')!).render(
    <App/>
)

//   <StrictMode>
//     <App />
//   </StrictMode>,