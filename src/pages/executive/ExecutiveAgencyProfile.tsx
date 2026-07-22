import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Building2, Mail, Phone, Globe, MapPin, FileText,
  CheckCircle, Clock, AlertCircle, X
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import AgencyContractSection from '../../components/AgencyContractSection';

interface AgencyDetail {
  id: string;
  name: string;
  contact_email: string;
  contact_phone: string | null;
  website: string | null;
  rfc: string | null;
  razon_social: string | null;
  regimen_fiscal: string | null;
  rnt: string | null;
  persona_type: string | null;
  representante_legal_nombre: string | null;
  onboarding_status: string | null;
  is_approved: boolean;
  is_active: boolean;
  signed_contract_url: string | null;
  street: string | null;
  exterior_number: string | null;
  interior_number: string | null;
  colony: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  banco: string | null;
  cuenta_clabe: string | null;
  titular_cuenta: string | null;
  created_at: string;
}

const ONBOARDING_LABELS: Record<string, { label: string; color: string }> = {
  pending_documents: { label: 'Pendiente de documentos', color: 'text-gray-600 bg-gray-100 border-gray-200' },
  pending_review:    { label: 'En revisión',              color: 'text-amber-700 bg-amber-100 border-amber-200' },
  pending_signature: { label: 'Pendiente de firma',       color: 'text-blue-700 bg-blue-100 border-blue-200' },
  active:            { label: 'Activa',                   color: 'text-green-700 bg-green-100 border-green-200' },
  rejected:          { label: 'Rechazada',                color: 'text-red-700 bg-red-100 border-red-200' },
};

export default function ExecutiveAgencyProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { accountExecutiveInfo } = useAuth();
  const [agency, setAgency] = useState<AgencyDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAgency = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError('');
    try {
      const { data, error: fetchError } = await supabase
        .from('agencies')
        .select(`
          id, name, contact_email, contact_phone, website, rfc, razon_social,
          regimen_fiscal, rnt, persona_type, representante_legal_nombre,
          onboarding_status, is_approved, is_active, signed_contract_url,
          street, exterior_number, interior_number, colony, city, state,
          postal_code, country, banco, cuenta_clabe, titular_cuenta, created_at
        `)
        .eq('id', id)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!data) {
        setError('Agencia no encontrada.');
        return;
      }
      setAgency(data);
    } catch (err: any) {
      setError(err.message || 'Error al cargar los datos de la agencia.');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { loadAgency(); }, [loadAgency]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
        <button
          onClick={() => navigate('/executive/mis-agencias')}
          className="mt-4 text-sm text-blue-600 hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Volver a Mis Agencias
        </button>
      </div>
    );
  }

  if (!agency) return null;

  const onboardingInfo = ONBOARDING_LABELS[agency.onboarding_status || ''] || ONBOARDING_LABELS.pending_documents;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/executive/mis-agencias')}
          className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{agency.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Perfil de agencia</p>
        </div>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${onboardingInfo.color}`}>
          <Clock className="w-3 h-3" />
          {onboardingInfo.label}
        </span>
        {agency.is_approved ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border text-green-700 bg-green-100 border-green-200">
            <CheckCircle className="w-3 h-3" /> Aprobada
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border text-amber-700 bg-amber-100 border-amber-200">
            <Clock className="w-3 h-3" /> Pendiente de aprobación
          </span>
        )}
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Contacto */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" /> Contacto
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <Mail className="w-4 h-4 text-gray-400 mt-0.5" />
              <div>
                <p className="text-gray-400 text-xs">Email</p>
                <p className="text-gray-900">{agency.contact_email}</p>
              </div>
            </div>
            {agency.contact_phone && (
              <div className="flex items-start gap-2">
                <Phone className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-gray-400 text-xs">Teléfono</p>
                  <p className="text-gray-900">{agency.contact_phone}</p>
                </div>
              </div>
            )}
            {agency.website && (
              <div className="flex items-start gap-2">
                <Globe className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-gray-400 text-xs">Sitio web</p>
                  <a href={agency.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {agency.website}
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Datos fiscales */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400" /> Datos fiscales
          </h2>
          <div className="space-y-2 text-sm">
            {agency.persona_type && (
              <div>
                <p className="text-gray-400 text-xs">Tipo de persona</p>
                <p className="text-gray-900 capitalize">
                  {agency.persona_type === 'persona_fisica' ? 'Persona Física' : 'Persona Moral'}
                </p>
              </div>
            )}
            {agency.representante_legal_nombre && (
              <div>
                <p className="text-gray-400 text-xs">Representante legal</p>
                <p className="text-gray-900">{agency.representante_legal_nombre}</p>
              </div>
            )}
            {agency.rfc && (
              <div>
                <p className="text-gray-400 text-xs">RFC</p>
                <p className="text-gray-900">{agency.rfc}</p>
              </div>
            )}
            {agency.razon_social && (
              <div>
                <p className="text-gray-400 text-xs">Razón social</p>
                <p className="text-gray-900">{agency.razon_social}</p>
              </div>
            )}
            {agency.regimen_fiscal && (
              <div>
                <p className="text-gray-400 text-xs">Régimen fiscal</p>
                <p className="text-gray-900">{agency.regimen_fiscal}</p>
              </div>
            )}
            {agency.rnt && (
              <div>
                <p className="text-gray-400 text-xs">RNT</p>
                <p className="text-gray-900">{agency.rnt}</p>
              </div>
            )}
          </div>
        </div>

        {/* Direccion */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gray-400" /> Dirección
          </h2>
          <div className="text-sm text-gray-900 space-y-1">
            {agency.street && <p>{agency.street} {agency.exterior_number}{agency.interior_number ? `, Int. ${agency.interior_number}` : ''}</p>}
            {agency.colony && <p>{agency.colony}</p>}
            {(agency.city || agency.state) && <p>{[agency.city, agency.state].filter(Boolean).join(', ')}</p>}
            {agency.postal_code && <p>CP {agency.postal_code}</p>}
            {agency.country && <p>{agency.country}</p>}
            {!agency.street && !agency.city && !agency.state && <p className="text-gray-400 italic">Sin dirección registrada</p>}
          </div>
        </div>

        {/* Datos bancarios */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" /> Datos bancarios
          </h2>
          <div className="space-y-2 text-sm">
            {agency.banco && (
              <div>
                <p className="text-gray-400 text-xs">Banco</p>
                <p className="text-gray-900">{agency.banco}</p>
              </div>
            )}
            {agency.cuenta_clabe && (
              <div>
                <p className="text-gray-400 text-xs">Cuenta CLABE</p>
                <p className="text-gray-900 font-mono">{agency.cuenta_clabe}</p>
              </div>
            )}
            {agency.titular_cuenta && (
              <div>
                <p className="text-gray-400 text-xs">Titular</p>
                <p className="text-gray-900">{agency.titular_cuenta}</p>
              </div>
            )}
            {!agency.banco && !agency.cuenta_clabe && !agency.titular_cuenta && (
              <p className="text-gray-400 italic text-sm">Sin datos bancarios registrados</p>
            )}
          </div>
        </div>
      </div>

      {/* Contract / Documents section — same component used by admin */}
      <AgencyContractSection
        agencyId={agency.id}
        legacySignedContractUrl={agency.signed_contract_url}
        onboardingStatus={agency.onboarding_status}
        onRefresh={loadAgency}
      />
    </div>
  );
}
