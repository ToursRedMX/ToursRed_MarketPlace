import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
export function PhoneVerificationGate({ context, children }: { context: 'traveler' | 'agency' | 'account'; children: ReactNode }) {
  const { userRole, phoneVerification, phoneVerificationLoading, phoneVerificationError, refreshPhoneVerification } = useAuth();
  const location = useLocation();
  const effective = context === 'account' ? userRole === 'agency' ? 'agency' : userRole === 'traveler' ? 'traveler' : null : context;
  if (effective && phoneVerificationLoading) return <p role="status" className="p-8">Comprobando verificación telefónica…</p>;
  if (effective && (phoneVerificationError || !phoneVerification)) return <div className="p-8"><p role="alert">No pudimos comprobar tu acceso.</p><button type="button" onClick={() => void refreshPhoneVerification()}>Reintentar</button></div>;
  if (effective && phoneVerification?.[effective].pending) return <Navigate to={`/verificar-telefono?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{location.pathname.endsWith('/profile') && <div className="mx-auto max-w-7xl px-4 py-3"><Link className="text-primary-700 underline" to="/verificar-telefono">{phoneVerification?.verified_at ? 'Teléfono verificado · cambiar o recuperar' : 'Verificar mi teléfono'}</Link></div>}{children}</>;
}
