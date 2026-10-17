import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.jsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root 容器不存在（index.html 被修改过？）');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
