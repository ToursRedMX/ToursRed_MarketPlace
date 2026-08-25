import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Shield, ShieldAlert, Loader2, X } from 'lucide-react';

type ModalState =
  | { open: false }
  | { open: true; kind: 'mfa_required' }
  | { open: true; kind: 'step_up_required' };

interface StepUpContextValue {
  fetchWithStepUp: (input: string, init?: RequestInit) => Promise<Response>;
}

const StepUpContext = createContext<StepUpContextValue | undefined>(undefined);

export const StepUpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [modalState, setModalState] = useState<ModalState>({ open: false });
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [modalError, setModalError] = useState('');
  const resolverRef = useRef<((result: boolean) => void) | null>(null);

  const resolveAndClose = useCallback((result: boolean) => {
    setModalState({ open: false });
    setCode('');
    setModalError('');
    setVerifying(false);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  const handleVerify = useCallback(async () => {
    if (code.length !== 6) {
      setModalError('El codigo debe tener 6 digitos');
      return;
    }
    setVerifying(true);
    setModalError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-sensitive-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.verified) {
        setModalError(data.error || 'El codigo ingresado no es valido.');
        setVerifying(false);
        return;
      }
      resolveAndClose(true);
    } catch {
      setModalError('No se pudo verificar. Intenta de nuevo.');
      setVerifying(false);
    }
  }, [code, resolveAndClose]);

  const fetchWithStepUp = useCallback(async (input: string, init?: RequestInit): Promise<Response> => {
    const firstResponse = await fetch(input, init);
    if (firstResponse.status !== 403) {
      return firstResponse;
    }

    let body: any = null;
    try {
      body = await firstResponse.clone().json();
    } catch {
      return firstResponse;
    }

    if (body?.code !== 'MFA_NOT_CONFIGURED' && body?.code !== 'STEP_UP_REQUIRED') {
      return firstResponse;
    }

    if (body.code === 'MFA_NOT_CONFIGURED') {
      const goToSecurity = await new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setModalState({ open: true, kind: 'mfa_required' });
      });
      if (goToSecurity) {
        navigate('/traveler/profile#seguridad');
      }
      return firstResponse;
    }

    const verified = await new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setModalState({ open: true, kind: 'step_up_required' });
    });

    if (!verified) {
      return firstResponse;
    }

    return fetch(input, init);
  }, [navigate]);

  return (
    <StepUpContext.Provider value={{ fetchWithStepUp }}>
      {children}
      {modalState.open && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 relative">
            <button
              onClick={() => resolveAndClose(false)}
              className="absolute top-3 right-3 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            {modalState.kind === 'mfa_required' ? (
              <>
                <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mb-4">
                  <ShieldAlert className="w-6 h-6 text-amber-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Protege tus fondos</h3>
                <p className="text-sm text-slate-600 mb-5">
                  Para utilizar tu saldo ToursRed Cash o canjear puntos necesitas activar la
                  autenticacion en dos pasos desde Seguridad.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => resolveAndClose(false)}
                    className="flex-1 py-2.5 px-4 border border-slate-300 text-slate-600 font-medium rounded-lg hover:bg-slate-50"
                  >
                    Ahora no
                  </button>
                  <button
                    onClick={() => resolveAndClose(true)}
                    className="flex-1 bg-blue-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-blue-700"
                  >
                    Activar ahora
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-4">
                  <Shield className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Verifica tu identidad</h3>
                <p className="text-sm text-slate-600 mb-4">
                  Ingresa el codigo de 6 digitos de tu aplicacion de autenticacion para continuar.
                </p>
                {modalError && (
                  <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg p-2.5">{modalError}</div>
                )}
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Codigo de 6 digitos"
                  autoFocus
                  className="w-full text-center text-xl tracking-widest font-mono border border-slate-300 rounded-lg py-2.5 mb-4 focus:ring-2 focus:ring-blue-500"
                  maxLength={6}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.length === 6 && !verifying) handleVerify();
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => resolveAndClose(false)}
                    className="flex-1 py-2.5 px-4 border border-slate-300 text-slate-600 font-medium rounded-lg hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleVerify}
                    disabled={code.length !== 6 || verifying}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Verificar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </StepUpContext.Provider>
  );
};

export const useStepUp = (): StepUpContextValue => {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp debe usarse dentro de un StepUpProvider');
  return ctx;
};
