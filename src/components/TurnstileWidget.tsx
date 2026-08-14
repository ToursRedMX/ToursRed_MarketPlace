import React, { useEffect, useRef, useCallback } from 'react';

const TURNSTILE_SITE_KEY = '0x4AAAAAAEPafX7zzdCsVdYB';

interface TurnstileWidgetProps {
  onToken: (token: string) => void;
  className?: string;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({ onToken, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile) return;

    if (widgetIdRef.current) {
      try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
      widgetIdRef.current = null;
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token: string) => onToken(token),
      'expired-callback': () => onToken(''),
      'error-callback': () => onToken(''),
      theme: 'light',
    });
  }, [onToken]);

  useEffect(() => {
    if (window.turnstile) {
      renderWidget();
      return;
    }

    const interval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(interval);
        renderWidget();
      }
    }, 200);

    return () => clearInterval(interval);
  }, [renderWidget]);

  useEffect(() => {
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
      }
    };
  }, []);

  return <div ref={containerRef} className={className} />;
};

export default TurnstileWidget;
