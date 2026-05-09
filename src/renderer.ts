import './index.css';
import '@fortawesome/fontawesome-free/css/all.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(React.createElement(App));
}
