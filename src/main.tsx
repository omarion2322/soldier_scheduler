import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AlgoPage from './components/AlgoPage';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

// Strip Vite's base path so we can match the route below.
const base = import.meta.env.BASE_URL || '/';
const rawPath = window.location.pathname;
const path = rawPath.startsWith(base) ? '/' + rawPath.slice(base.length) : rawPath;
const isAlgo = /^\/algo\/?$/.test(path);

createRoot(rootEl).render(
  <StrictMode>{isAlgo ? <AlgoPage /> : <App />}</StrictMode>,
);
