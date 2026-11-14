import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Lock iOS WKWebView / Safari viewport against pinch-zoom, double-tap zoom, and keyboard scroll shift
const preventZoom = (e: Event) => e.preventDefault();
document.addEventListener('gesturestart', preventZoom, { passive: false });
document.addEventListener('gesturechange', preventZoom, { passive: false });
document.addEventListener('gestureend', preventZoom, { passive: false });
document.addEventListener('touchmove', (e: TouchEvent) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

if (window.visualViewport) {
  const syncViewport = () => {
    const vv = window.visualViewport!;
    document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  };
  window.visualViewport.addEventListener('resize', syncViewport);
  window.visualViewport.addEventListener('scroll', syncViewport);
  syncViewport();
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
