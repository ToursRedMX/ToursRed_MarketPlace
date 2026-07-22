import React, { useState, useEffect, useRef } from 'react';
import {
  User, Phone, FileText, Camera, CheckCircle,
  AlertCircle, X, Save, Lock, Eye, EyeOff, CreditCard,
  Zap, ExternalLink, KeyRound, RefreshCw
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

interface ExecutiveProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  profile_photo_url: string | null;
  tax_name: string | null;
  tax_rfc: string | null;
  tax_address: string | null;
  tax_zip: string | null;
  tax_regimen_fiscal: string | null;
  tax_withhold_isr: boolean | null;
  bank_beneficiary: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_clabe: string | null;
  facturapi_configured: boolean;
  facturapi_organization_id: string | null;
  facturapi_configured_at: string | null;
}

const BANKS = [
  'BBVA', 'Banorte', 'Santander', 'HSBC', 'Banamex (Citibanamex)',
  'Scotiabank', 'Inbursa', 'Bajío', 'Afirme', 'Multiva', 'Mifel', 'Otro',
];

const REGIMENES = [
  { value: '612', label: '612 — Personas Físicas con Actividades Empresariales y Profesionales' },
  { value: '625', label: '625 — Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { value: '606', label: '606 — Arrendamiento' },
  { value: '608', label: '608 — Demás ingresos' },
  { value: '621', label: '621 — Incorporación Fiscal' },
];

export default function ExecutivePerfil() {
  const { accountExecutiveInfo } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<ExecutiveProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSavingPersonal, setIsSavingPersonal] = useState(false);

  const [taxName, setTaxName] = useState('');
  const [taxRfc, setTaxRfc] = useState('');
  const [taxAddress, setTaxAddress] = useState('');
  const [taxZip, setTaxZip] = useState('');
  const [taxRegimenFiscal, setTaxRegimenFiscal] = useState('');
  const [taxWithholdIsr, setTaxWithholdIsr] = useState(false);
  const [isSavingFiscal, setIsSavingFiscal] = useState(false);

  const [bankBeneficiary, setBankBeneficiary] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankClabe, setBankClabe] = useState('');
  const [showClabe, setShowClabe] = useState(false);
  const [isSavingBank, setIsSavingBank] = useState(false);

  const [facturApiKey, setFacturApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isVerifyingFacturapi, setIsVerifyingFacturapi] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; section?: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string, section: string) => {
    setMessage({ type, text, section });
    if (type === 'success') setTimeout(() => setMessage(null), 4000);
  };

  useEffect(() => {
    const load = async () => {
      if (!accountExecutiveInfo?.executiveId) return;
      setIsLoading(true);
      try {
        const { data } = await supabase
          .from('account_executives_safe')
          .select('id, first_name, last_name, email, phone, profile_photo_url, tax_name, tax_rfc, tax_address, tax_zip, tax_regimen_fiscal, tax_withhold_isr, bank_beneficiary, bank_name, bank_account_number, bank_clabe, facturapi_configured, facturapi_organization_id, facturapi_configured_at')
          .eq('id', accountExecutiveInfo.executiveId)
          .maybeSingle();

        if (data) {
          setProfile(data as ExecutiveProfile);
          setFirstName(data.first_name || '');
          setLastName(data.last_name || '');
          setPhone(data.phone || '');
          setTaxName(data.tax_name || '');
          setTaxRfc(data.tax_rfc || '');
          setTaxAddress(data.tax_address || '');
          setTaxZip(data.tax_zip || '');
          setTaxRegimenFiscal(data.tax_regimen_fiscal || '');
          setTaxWithholdIsr(data.tax_withhold_isr || false);
          setBankBeneficiary(data.bank_beneficiary || '');
          setBankName(data.bank_name || '');
          setBankAccountNumber(data.bank_account_number || '');
          setBankClabe(data.bank_clabe || '');

          if (data.profile_photo_url) {
            const { data: signed } = await supabase.storage
              .from('executive-avatars')
              .createSignedUrl(data.profile_photo_url, 3600);
            if (signed?.signedUrl) setPhotoUrl(signed.signedUrl);
          }
        }
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [accountExecutiveInfo?.executiveId]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setIsUploadingPhoto(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `avatars/${profile.id}/photo.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('executive-avatars')
        .upload(path, file, { upsert: true, cacheControl: '3600' });
      if (uploadError) throw uploadError;
      await supabase.from('account_executives').update({ profile_photo_url: path }).eq('id', profile.id);
      const { data: signed } = await supabase.storage.from('executive-avatars').createSignedUrl(path, 3600);
      if (signed?.signedUrl) setPhotoUrl(signed.signedUrl);
      showMsg('success', 'Foto de perfil actualizada.', 'photo');
    } catch (e: any) {
      showMsg('error', e.message || 'Error al subir la foto.', 'photo');
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const savePersonal = async () => {
    if (!profile) return;
    if (!firstName.trim() || !lastName.trim()) { showMsg('error', 'El nombre y apellido son requeridos.', 'personal'); return; }
    setIsSavingPersonal(true);
    try {
      const { error } = await supabase.from('account_executives')
        .update({ first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim() || null })
        .eq('id', profile.id);
      if (error) throw error;
      showMsg('success', 'Información personal guardada.', 'personal');
    } catch (e: any) {
      showMsg('error', e.message || 'Error al guardar.', 'personal');
    } finally { setIsSavingPersonal(false); }
  };

  const saveFiscal = async () => {
    if (!profile) return;
    setIsSavingFiscal(true);
    try {
      const { error } = await supabase.from('account_executives').update({
        tax_name: taxName.trim() || null,
        tax_rfc: taxRfc.trim().toUpperCase() || null,
        tax_address: taxAddress.trim() || null,
        tax_zip: taxZip.trim() || null,
        tax_regimen_fiscal: taxRegimenFiscal || null,
        tax_withhold_isr: taxWithholdIsr,
      }).eq('id', profile.id);
      if (error) throw error;
      showMsg('success', 'Datos fiscales guardados.', 'fiscal');
    } catch (e: any) {
      showMsg('error', e.message || 'Error al guardar.', 'fiscal');
    } finally { setIsSavingFiscal(false); }
  };

  const saveBank = async () => {
    if (!profile) return;
    if (bankClabe && bankClabe.replace(/\s/g, '').length !== 18) {
      showMsg('error', 'La CLABE interbancaria debe tener exactamente 18 dígitos.', 'bank'); return;
    }
    setIsSavingBank(true);
    try {
      const { error } = await supabase.from('account_executives').update({
        bank_beneficiary: bankBeneficiary.trim() || null,
        bank_name: bankName || null,
        bank_account_number: bankAccountNumber.trim() || null,
        bank_clabe: bankClabe.replace(/\s/g, '') || null,
      }).eq('id', profile.id);
      if (error) throw error;
      showMsg('success', 'Datos bancarios guardados.', 'bank');
    } catch (e: any) {
      showMsg('error', e.message || 'Error al guardar.', 'bank');
    } finally { setIsSavingBank(false); }
  };

  const verifyAndSaveFacturapi = async () => {
    if (!profile) return;
    if (!facturApiKey.trim()) { showMsg('error', 'Ingresa tu API Key de FacturAPI.', 'facturapi'); return; }
    setIsVerifyingFacturapi(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión expirada.');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-executive-facturapi`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ executive_id: profile.id, api_key: facturApiKey.trim() }),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Error al verificar.');
      setProfile(p => p ? { ...p, facturapi_configured: true, facturapi_configured_at: new Date().toISOString() } : p);
      setFacturApiKey('');
      showMsg('success', 'FacturAPI configurado y verificado correctamente.', 'facturapi');
    } catch (e: any) {
      showMsg('error', e.message || 'Error al verificar con FacturAPI.', 'facturapi');
    } finally { setIsVerifyingFacturapi(false); }
  };

  const savePassword = async () => {
    if (!newPassword || !confirmPassword) { showMsg('error', 'Ingresa y confirma tu nueva contraseña.', 'password'); return; }
    if (newPassword.length < 8) { showMsg('error', 'La contraseña debe tener al menos 8 caracteres.', 'password'); return; }
    if (newPassword !== confirmPassword) { showMsg('error', 'Las contraseñas no coinciden.', 'password'); return; }
    setIsSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword(''); setConfirmPassword('');
      showMsg('success', 'Contraseña actualizada correctamente.', 'password');
    } catch (e: any) {
      showMsg('error', e.message || 'Error al cambiar la contraseña.', 'password');
    } finally { setIsSavingPassword(false); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-500">No se encontró el perfil del ejecutivo.</div>;
  }

  const SectionMessage = ({ section }: { section: string }) =>
    message?.section === section ? (
      <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
        {message.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
        {message.text}
        <button onClick={() => setMessage(null)} className="ml-auto"><X className="h-4 w-4" /></button>
      </div>
    ) : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mi Perfil</h1>
        <p className="text-gray-500 mt-1">Información personal, datos fiscales y bancarios</p>
      </div>

      {/* Foto de perfil */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-6">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center overflow-hidden ring-4 ring-white shadow-md">
              {photoUrl ? (
                <img src={photoUrl} alt="Foto de perfil" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-red-600">{profile.first_name.charAt(0)}{profile.last_name.charAt(0)}</span>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingPhoto}
              className="absolute -bottom-1 -right-1 w-8 h-8 bg-red-600 text-white rounded-full flex items-center justify-center hover:bg-red-700 transition-colors shadow-lg disabled:opacity-50"
            >
              {isUploadingPhoto ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">{profile.first_name} {profile.last_name}</p>
            <p className="text-sm text-gray-500">{profile.email}</p>
            <p className="text-xs text-gray-400 mt-1">Ejecutivo de Cuenta — ToursRed</p>
          </div>
        </div>
        <SectionMessage section="photo" />
      </div>

      {/* Información personal */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center"><User className="h-5 w-5 text-blue-600" /></div>
          <div><h2 className="font-semibold text-gray-900">Información personal</h2><p className="text-xs text-gray-400">Nombre y datos de contacto</p></div>
        </div>
        <div className="p-6 space-y-4">
          <SectionMessage section="personal" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Nombre *</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Nombre" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Apellido *</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Apellido" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Correo electrónico</label>
              <input value={profile.email} readOnly className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2.5 text-sm text-gray-400 cursor-not-allowed" />
              <p className="text-xs text-gray-400 mt-1">El correo no se puede cambiar desde aquí</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5"><span className="flex items-center gap-1"><Phone className="h-3 w-3" /> Teléfono</span></label>
              <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="+52 55 0000 0000" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={savePersonal} disabled={isSavingPersonal} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <Save className="h-4 w-4" />{isSavingPersonal ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>

      {/* Datos fiscales */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center"><FileText className="h-5 w-5 text-amber-600" /></div>
          <div><h2 className="font-semibold text-gray-900">Datos fiscales</h2><p className="text-xs text-gray-400">Información para emisión de CFDI</p></div>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-sm text-amber-800">Estos datos deben coincidir exactamente con tu constancia de situación fiscal del SAT.</p>
          </div>
          <SectionMessage section="fiscal" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Nombre o razón social fiscal</label>
              <input value={taxName} onChange={e => setTaxName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="JUAN PÉREZ GARCÍA" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">RFC</label>
              <input value={taxRfc} onChange={e => setTaxRfc(e.target.value.toUpperCase())} maxLength={13} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-amber-500 uppercase" placeholder="XXXX000000XXX" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Código postal fiscal</label>
              <input value={taxZip} onChange={e => setTaxZip(e.target.value.replace(/\D/g, '').slice(0, 5))} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="00000" maxLength={5} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Régimen fiscal</label>
              <select value={taxRegimenFiscal} onChange={e => setTaxRegimenFiscal(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="">Seleccionar régimen...</option>
                {REGIMENES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Domicilio fiscal</label>
              <input value={taxAddress} onChange={e => setTaxAddress(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Calle, Número, Colonia, Ciudad, Estado" />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input type="checkbox" checked={taxWithholdIsr} onChange={e => setTaxWithholdIsr(e.target.checked)} className="mt-0.5 rounded text-amber-600 focus:ring-amber-500" />
                <div>
                  <p className="text-sm font-medium text-gray-700 group-hover:text-gray-900">Aplicar retención de ISR (10%)</p>
                  <p className="text-xs text-gray-500 mt-0.5">Activa si prestas servicios en modalidad de honorarios (actividades profesionales). Consulta con tu contador si aplica en tu caso.</p>
                </div>
              </label>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={saveFiscal} disabled={isSavingFiscal} className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors">
              <Save className="h-4 w-4" />{isSavingFiscal ? 'Guardando...' : 'Guardar datos fiscales'}
            </button>
          </div>
        </div>
      </div>

      {/* Facturación electrónica (FacturAPI) */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-violet-50 rounded-lg flex items-center justify-center"><Zap className="h-5 w-5 text-violet-600" /></div>
            <div><h2 className="font-semibold text-gray-900">Facturación electrónica</h2><p className="text-xs text-gray-400">Configura FacturAPI para generar CFDIs automáticamente</p></div>
          </div>
          {profile.facturapi_configured && (
            <span className="flex items-center gap-1.5 text-xs text-green-700 bg-green-100 px-2.5 py-1 rounded-full font-medium">
              <CheckCircle className="h-3.5 w-3.5" /> Configurado
            </span>
          )}
        </div>
        <div className="p-6 space-y-5">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-blue-900">Cómo configurar tu cuenta FacturAPI</p>
            <ol className="text-sm text-blue-800 space-y-1.5 list-decimal list-inside">
              <li>Crea una cuenta gratuita en FacturAPI y registra tu RFC como organización emisora</li>
              <li>Sube tu CSD (Certificado de Sello Digital) directamente en el portal de FacturAPI</li>
              <li>Copia tu <strong>API Key</strong> de FacturAPI</li>
              <li>Pégala aquí y presiona "Verificar y guardar"</li>
            </ol>
            <a href="https://www.facturapi.io" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-700 hover:text-blue-900 font-medium">
              Ir a FacturAPI <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <SectionMessage section="facturapi" />

          {profile.facturapi_configured && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800">FacturAPI está configurado</p>
                <p className="text-xs text-green-600 mt-0.5">
                  Configurado el {profile.facturapi_configured_at ? new Date(profile.facturapi_configured_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                  {profile.facturapi_organization_id && ` · Org: ${profile.facturapi_organization_id}`}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5"><span className="flex items-center gap-1"><KeyRound className="h-3 w-3" /> API Key de FacturAPI *</span></label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={facturApiKey}
                  onChange={e => setFacturApiKey(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg pl-3 pr-10 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder={profile.facturapi_configured ? '••••••••••••••••••• (introduce para actualizar)' : 'sk_live_...'}
                />
                <button type="button" onClick={() => setShowApiKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Tu API Key nunca se muestra de nuevo por seguridad.</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={verifyAndSaveFacturapi} disabled={isVerifyingFacturapi || !facturApiKey.trim()} className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {isVerifyingFacturapi ? <><RefreshCw className="h-4 w-4 animate-spin" /> Verificando...</> : <><CheckCircle className="h-4 w-4" /> {profile.facturapi_configured ? 'Actualizar FacturAPI' : 'Verificar y guardar'}</>}
            </button>
          </div>
        </div>
      </div>

      {/* Datos bancarios */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center"><CreditCard className="h-5 w-5 text-green-600" /></div>
          <div><h2 className="font-semibold text-gray-900">Datos bancarios</h2><p className="text-xs text-gray-400">Para recibir el pago de tus comisiones</p></div>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <p className="text-sm text-green-800">Verifica que la CLABE sea correcta. Los pagos se realizan por transferencia bancaria una vez que el administrador aprueba tu CFDI.</p>
          </div>
          <SectionMessage section="bank" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Nombre del titular de la cuenta</label>
              <input value={bankBeneficiary} onChange={e => setBankBeneficiary(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Nombre exacto como aparece en la cuenta bancaria" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Banco</label>
              <select value={bankName} onChange={e => setBankName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">Seleccionar banco...</option>
                {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Número de cuenta</label>
              <input value={bankAccountNumber} onChange={e => setBankAccountNumber(e.target.value.replace(/\D/g, ''))} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="0000000000" maxLength={20} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">CLABE interbancaria (18 dígitos)</label>
              <div className="relative">
                <input value={bankClabe} onChange={e => setBankClabe(e.target.value.replace(/\D/g, '').slice(0, 18))} type={showClabe ? 'text' : 'password'} className="w-full border border-gray-200 rounded-lg pl-3 pr-10 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="000000000000000000" maxLength={18} />
                <button type="button" onClick={() => setShowClabe(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showClabe ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {bankClabe && <p className={`text-xs mt-1 ${bankClabe.length === 18 ? 'text-green-600' : 'text-amber-600'}`}>{bankClabe.length}/18 dígitos</p>}
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={saveBank} disabled={isSavingBank} className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
              <Save className="h-4 w-4" />{isSavingBank ? 'Guardando...' : 'Guardar datos bancarios'}
            </button>
          </div>
        </div>
      </div>

      {/* Cambiar contraseña */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center"><Lock className="h-5 w-5 text-gray-600" /></div>
          <div><h2 className="font-semibold text-gray-900">Seguridad</h2><p className="text-xs text-gray-400">Cambiar contraseña de acceso</p></div>
        </div>
        <div className="p-6 space-y-4">
          <SectionMessage section="password" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Nueva contraseña</label>
              <div className="relative">
                <input type={showNewPw ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full border border-gray-200 rounded-lg pl-3 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" placeholder="Mínimo 8 caracteres" />
                <button type="button" onClick={() => setShowNewPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Confirmar nueva contraseña</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" placeholder="Repite la nueva contraseña" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={savePassword} disabled={isSavingPassword} className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50 transition-colors">
              <Lock className="h-4 w-4" />{isSavingPassword ? 'Cambiando...' : 'Cambiar contraseña'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
