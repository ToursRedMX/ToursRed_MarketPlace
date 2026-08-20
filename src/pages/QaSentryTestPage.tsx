import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import NotFoundPage from './NotFoundPage';

const EXPECTED_TOKEN = 'sentry-sourcemaps-2026';

function verifySentrySourceMaps(): void {
  throw new Error('QA source map verification - ' + new Date().toISOString());
}

const QaSentryTestPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const verifyParam = searchParams.get('verify');

  if (verifyParam !== EXPECTED_TOKEN) {
    return <NotFoundPage />;
  }

  return <SentryTestContent onMount={verifySentrySourceMaps} />;
};

const SentryTestContent: React.FC<{ onMount: () => void }> = ({ onMount }) => {
  useEffect(() => {
    onMount();
  }, [onMount]);

  return (
    <div className="min-h-[calc(100vh-16rem)] flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          Verificando source maps de Sentry...
        </h1>
        <p className="text-gray-600">
          Se lanzó un error de prueba. Si los source maps funcionan correctamente,
          el stack trace en Sentry mostrará las líneas originales del código fuente.
        </p>
      </div>
    </div>
  );
};

export default QaSentryTestPage;
