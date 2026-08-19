import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter as Router } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './context/AuthContext.tsx';
import { StepUpProvider } from './context/StepUpContext.tsx';
import { queryClient } from './lib/queryClient';
import SentryFallback from './components/SentryFallback';

const dsn = import.meta.env.VITE_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  tunnel: '/sentry-tunnel',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,
  beforeSend(event) {
    const IGNORED_PATTERNS = [
      'ResizeObserver loop',
      'chrome-extension://',
      'moz-extension://',
      'safari-extension://',
      'top.GLOBALS',
      'Non-Error promise rejection captured',
    ];
    const value = event.exception?.values?.[0];
    if (value) {
      const msg = value.value || '';
      for (const pattern of IGNORED_PATTERNS) {
        if (msg.includes(pattern)) return null;
      }
    }
    return event;
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={({ resetError }) => <SentryFallback resetError={resetError} />} showDialog>
      <QueryClientProvider client={queryClient}>
        <Router>
          <AuthProvider>
            <StepUpProvider>
              <App />
            </StepUpProvider>
          </AuthProvider>
        </Router>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
