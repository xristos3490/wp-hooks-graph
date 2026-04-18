import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Restore saved theme before first render (prevents flash)
const savedTheme = localStorage.getItem('hooks-graph-theme');
if (savedTheme === 'light') {
  document.documentElement.classList.add('light');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
