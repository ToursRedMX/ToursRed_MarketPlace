import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Shield, ShieldAlert, ShieldCheck, KeyRound, Loader2, AlertTriangle, Info } from 'lucide-react';

export const SecurityTogglesSection: React.FC = () => {
  const [mfaAdmins, setMfaAdmins] = useState(false);
  const [mfaAccountant, setMfaAccountant] = useState(false);
  const [passkeysEnabled, setPasskeysEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [hasMfa, setHasMfa] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('platform_settings')
        .select('mfa_required_for_admins, mfa_required_for_accountant, passkeys_enabled')
        .maybeSingle();
      setMfaAdmins(data?.mfa_required_for_admins ?? false);
      setMfaAccountant(data?.mfa_required_for_accountant ?? false);
      setPasskeysEnabled(data?.passkeys_enabled ?? false);

      const { data: factors } = await supabase.auth.mfa.listFactors();
      setHasMfa((factors?.totp ?? []).some((f: any) => f.status === 'verified'));
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveToggle = async (field: string, value: boolean) => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from('platform_settings')
        .update({ [field]: value })
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (updateError) throw updateError;
      setSuccess('Configuracion guardada');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
      if (field === 'mfa_required_for_admins') setMfaAdmins(!value);
      if (field === 'mfa_required_for_accountant') setMfaAccountant(!value);
      if (field === 'passkeys_enabled') setPasskeysEnabled(!value);
    } finally {
      setSaving(false);
    }
  };

  const handleMfaAdminsToggle = async () => {
    if (!mfaAdmins && !hasMfa) {
      setError('Debes configurar MFA en tu cuenta antes de activar este requisito. Ve a Mi Perfil > Autenticacion en dos pasos.');
      return;
    }
    const newValue = !mfaAdmins;
    setMfaAdmins(newValue);
    await saveToggle('mfa_required_for_admins', newValue);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
          <Shield className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Seguridad de la plataforma</h3>
          <p className="text-sm text-slate-500">Configura autenticacion de dos factores y claves de acceso</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-center gap-2 text-green-600 text-sm bg-green-50 rounded-lg p-3">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" /> {success}
        </div>
      )}

      <div className="space-y-5">
        {/* MFA for admins */}
        <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              <h4 className="font-medium text-slate-800">MFA obligatorio para administradores</h4>
            </div>
            <p className="text-sm text-slate-500 mt-1 ml-7">
              Los admin y super admin deben tener MFA configurado para escribir en tablas protegidas.
            </p>
            {!hasMfa && (
              <div className="mt-2 ml-7 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                No tienes MFA configurado. Configuralo en Mi Perfil antes de activar este toggle.
              </div>
            )}
          </div>
          <ToggleSwitch
            checked={mfaAdmins}
            onChange={handleMfaAdminsToggle}
            disabled={saving}
          />
        </div>

        {/* MFA for accountants */}
        <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-teal-600" />
              <h4 className="font-medium text-slate-800">MFA obligatorio para contadores</h4>
            </div>
            <p className="text-sm text-slate-500 mt-1 ml-7">
              Los usuarios con rol accountant deben tener MFA para escribir en tablas contables.
            </p>
          </div>
          <ToggleSwitch
            checked={mfaAccountant}
            onChange={async () => {
              const v = !mfaAccountant;
              setMfaAccountant(v);
              await saveToggle('mfa_required_for_accountant', v);
            }}
            disabled={saving}
          />
        </div>

        {/* Passkeys */}
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-violet-600" />
              <h4 className="font-medium text-slate-800">Claves de acceso (Passkeys)</h4>
            </div>
            <p className="text-sm text-slate-500 mt-1 ml-7">
              Permite que los usuarios inicien sesion con biometria o llaves de seguridad.
            </p>
          </div>
          <ToggleSwitch
            checked={passkeysEnabled}
            onChange={async () => {
              const v = !passkeysEnabled;
              setPasskeysEnabled(v);
              await saveToggle('passkeys_enabled', v);
            }}
            disabled={saving}
          />
        </div>
      </div>

      <div className="mt-6 bg-slate-50 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-slate-500 space-y-1">
            <p><strong>Importante:</strong> Si activas MFA obligatorio y pierdes acceso a tu factor, no podras apagarlo desde la app.</p>
            <p>Para recuperacion de emergencia, ejecuta directamente en la base de datos (via SQL Editor de Supabase):</p>
            <pre className="bg-slate-200 rounded p-2 mt-1 font-mono text-[10px] overflow-x-auto">UPDATE platform_settings SET mfa_required_for_admins = false, mfa_required_for_accountant = false;</pre>
          </div>
        </div>
      </div>
    </div>
  );
};

const ToggleSwitch: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean }> = ({
  checked,
  onChange,
  disabled,
}) => (
  <button
    onClick={onChange}
    disabled={disabled}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
      checked ? 'bg-blue-600' : 'bg-slate-300'
    } ${disabled ? 'opacity-50' : ''}`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);
