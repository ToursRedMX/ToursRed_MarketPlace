import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { KeyRound, Plus, Trash2, Loader2, Check, AlertTriangle, Fingerprint } from 'lucide-react';

interface PasskeyInfo {
  id: string;
  friendly_name: string | null;
  created_at: string;
}

export const PasskeySettingsSection: React.FC = () => {
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passkeysEnabled, setPasskeysEnabled] = useState(false);
  const [browserSupported, setBrowserSupported] = useState(false);

  const loadPasskeys = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: listError } = await supabase.auth.passkey.list();
      if (listError) {
        console.error('Error listing passkeys:', listError);
        setPasskeys([]);
      } else {
        setPasskeys((data ?? []) as PasskeyInfo[]);
      }
    } catch (err: any) {
      console.error('Exception listing passkeys:', err);
      setPasskeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadToggle = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('platform_settings')
        .select('passkeys_enabled')
        .maybeSingle();
      setPasskeysEnabled(data?.passkeys_enabled ?? false);
    } catch {
      setPasskeysEnabled(false);
    }
  }, []);

  useEffect(() => {
    loadPasskeys();
    loadToggle();
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      setBrowserSupported(true);
    }
  }, [loadPasskeys, loadToggle]);

  const handleRegister = async () => {
    setError('');
    setSuccess('');
    setRegistering(true);
    try {
      const { error: registerError } = await supabase.auth.registerPasskey({
        friendlyName: `Clave ${new Date().toLocaleDateString()}`,
      });
      if (registerError) throw registerError;
      setSuccess('Clave de acceso registrada correctamente');
      await loadPasskeys();
    } catch (err: any) {
      console.error('Error registering passkey:', err);
      const msg = err.message || err.name || 'Error al registrar clave de acceso';
      setError(msg);
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (passkeyId: string) => {
    setError('');
    setSuccess('');
    try {
      const { error: deleteError } = await supabase.auth.passkey.delete(passkeyId);
      if (deleteError) throw deleteError;
      setSuccess('Clave eliminada');
      await loadPasskeys();
    } catch (err: any) {
      setError(err.message || 'Error al eliminar clave');
    }
  };

  if (!passkeysEnabled) {
    return (
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-slate-400" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Claves de acceso (Passkeys)</h3>
            <p className="text-sm text-slate-500">Las claves de acceso estan desactivadas</p>
          </div>
        </div>
        <p className="text-sm text-slate-400 mt-2">
          Un administrador debe activar esta funcion en Configuracion &gt; Seguridad de la plataforma.
        </p>
      </div>
    );
  }

  if (!browserSupported) {
    return (
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Claves de acceso (Passkeys)</h3>
            <p className="text-sm text-slate-500">Tu navegador no soporta claves de acceso</p>
          </div>
        </div>
        <p className="text-sm text-slate-400 mt-2">
          Usa un navegador moderno con soporte WebAuthn (Chrome, Safari, Edge, Firefox).
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center">
          <Fingerprint className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Claves de acceso (Passkeys)</h3>
          <p className="text-sm text-slate-500">Inicia sesion con biometria o llave de seguridad</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-center gap-2 text-green-600 text-sm bg-green-50 rounded-lg p-3">
          <Check className="w-4 h-4 flex-shrink-0" /> {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="space-y-3 mb-4">
            {passkeys.length === 0 ? (
              <div className="bg-slate-50 rounded-lg p-4 text-center">
                <KeyRound className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No tienes claves de acceso registradas</p>
              </div>
            ) : (
              passkeys.map((pk) => (
                <div key={pk.id} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <Fingerprint className="w-5 h-5 text-violet-600" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        {pk.friendly_name || 'Clave de acceso'}
                      </p>
                      <p className="text-xs text-slate-400">
                        Registrada {new Date(pk.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(pk.id)}
                    className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            onClick={handleRegister}
            disabled={registering}
            className="w-full flex items-center justify-center gap-2 bg-violet-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Registrar clave de acceso
          </button>
        </>
      )}
    </div>
  );
};
