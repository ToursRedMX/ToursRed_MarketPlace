import React, { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface FirstLoginPasswordGateProps {
  userId: string;
  onPasswordChanged: () => void;
}

export default function FirstLoginPasswordGate({ userId, onPasswordChanged }: FirstLoginPasswordGateProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const validate = (): string | null => {
    if (newPassword.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (newPassword !== confirmPassword) return 'Las contraseñas no coinciden.';
    if (!/[A-Z]/.test(newPassword)) return 'La contraseña debe incluir al menos una mayúscula.';
    if (!/[a-z]/.test(newPassword)) return 'La contraseña debe incluir al menos una minúscula.';
    if (!/[0-9]/.test(newPassword)) return 'La contraseña debe incluir al menos un número.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      const { error: dbError } = await supabase
        .from('users')
        .update({ must_change_password: false })
        .eq('id', userId);

      if (dbError) {
        console.error('Failed to clear must_change_password flag:', dbError);
      }

      setSuccess(true);
      setTimeout(() => {
        onPasswordChanged();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Error al cambiar la contraseña. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Contraseña actualizada</h2>
            <p className="text-sm text-gray-500">Tu contraseña se ha cambiado correctamente. Cargando...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Lock className="w-7 h-7 text-blue-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Cambio de contraseña obligatorio</h1>
            <p className="text-sm text-gray-500 mt-1.5">
              Por seguridad, debes establecer una nueva contraseña antes de continuar.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700 mb-4">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Nueva contraseña</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Mínimo 8 caracteres"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Confirmar contraseña</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Repite la contraseña"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Requirements */}
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Requisitos</p>
              <ul className="text-xs text-gray-500 space-y-0.5">
                <li className={newPassword.length >= 8 ? 'text-green-600' : ''}>• Mínimo 8 caracteres</li>
                <li className={/[A-Z]/.test(newPassword) ? 'text-green-600' : ''}>• Al menos una mayúscula</li>
                <li className={/[a-z]/.test(newPassword) ? 'text-green-600' : ''}>• Al menos una minúscula</li>
                <li className={/[0-9]/.test(newPassword) ? 'text-green-600' : ''}>• Al menos un número</li>
                <li className={newPassword === confirmPassword && newPassword ? 'text-green-600' : ''}>• Las contraseñas coinciden</li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !newPassword || !confirmPassword}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Guardando...' : 'Cambiar contraseña'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
