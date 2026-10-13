import React, { useState } from 'react';
import { Lock, Eye, EyeOff, Save, AlertCircle, CheckCircle } from 'lucide-react';
import { useStepUp } from '../context/StepUpContext';
import { establecerContrasena } from '../lib/establecerContrasena';
import { esContrasenaFiltrada } from '../lib/contrasenaFiltrada';
import { validarContrasena } from '../lib/politicaContrasena';
import { mensajeDeError } from '../lib/errores';

const ChangePasswordSection: React.FC = () => {
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { invokeWithStepUp } = useStepUp();

  const [passwordForm, setPasswordForm] = useState({
    newPassword: '',
    confirmPassword: ''
  });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!passwordForm.newPassword || !passwordForm.confirmPassword) {
      setError('Todos los campos son obligatorios');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('Las contraseñas nuevas no coinciden');
      return;
    }

    const validationError = validarContrasena(passwordForm.newPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsChanging(true);

    try {
      // La contraseña actual (o el codigo de la app de autenticacion si hay MFA) la pide el SERVIDOR con un modal:
      // `updateUser({ password })` desde el navegador no la exige.
      const { error: updateError } = await establecerContrasena(passwordForm.newPassword, invokeWithStepUp);

      if (updateError) {
        if (esContrasenaFiltrada(updateError)) {
          throw new Error('Esta contraseña ha sido expuesta en brechas de datos conocidas y no puede usarse. Por favor elige una contraseña diferente y más segura.');
        }
        throw updateError;
      }

      setSuccess('Contraseña actualizada correctamente');
      setPasswordForm({
        newPassword: '',
        confirmPassword: ''
      });

      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(mensajeDeError(err) || 'Error al cambiar la contraseña');
    } finally {
      setIsChanging(false);
    }
  };

  const handleCancel = () => {
    setPasswordForm({
      newPassword: '',
      confirmPassword: ''
    });
    setError('');
    setSuccess('');
  };

  return (
    <div className="bg-white rounded-lg shadow-xs border border-gray-200 p-6">
      <div className="flex items-center mb-6">
        <Lock className="h-6 w-6 text-gray-700 mr-3" />
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Seguridad</h2>
          <p className="text-sm text-gray-500 mt-0.5">Gestiona tu contraseña de acceso</p>
        </div>
      </div>

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-start">
          <CheckCircle className="h-5 w-5 text-green-600 mr-2 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-800">{success}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start">
          <AlertCircle className="h-5 w-5 text-red-600 mr-2 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <form onSubmit={handleChangePassword} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nueva Contraseña *
          </label>
          <div className="relative">
            <input
              type={showNewPassword ? 'text' : 'password'}
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              className="input pr-10"
              placeholder="Ingresa tu nueva contraseña"
              disabled={isChanging}
            />
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Mínimo 8 caracteres, debe incluir mayúsculas, minúsculas y números
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Confirmar Nueva Contraseña *
          </label>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              className="input pr-10"
              placeholder="Confirma tu nueva contraseña"
              disabled={isChanging}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Al guardar te pediremos confirmar tu identidad: tu contraseña actual o, si tienes verificación en dos pasos, el código de tu app de autenticación.
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleCancel}
            className="btn btn-outline"
            disabled={isChanging}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isChanging}
            className="btn btn-primary flex items-center"
          >
            {isChanging ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></div>
                Cambiando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Cambiar Contraseña
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChangePasswordSection;
