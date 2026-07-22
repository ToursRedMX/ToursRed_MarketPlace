import React, { useEffect, useState, useCallback } from 'react';
import { Upload, CheckCircle, XCircle, Clock, AlertCircle, RefreshCw, Send, FileCheck } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface DocType {
  key: string;
  label: string;
  description: string;
  required: boolean;
  applies_to: 'ambas' | 'persona_fisica' | 'persona_moral';
}

interface AgencyDoc {
  id: string;
  document_type_key: string;
  file_name: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'superseded';
  rejection_reason: string | null;
}

interface Props {
  agencyId: string;
  personaType: 'persona_fisica' | 'persona_moral';
  documentsSubmittedAt: string | null;
  onSubmitted: () => void;
}

const STATUS_BADGE: Record<AgencyDoc['status'], { label: string; color: string; icon: React.ReactNode }> = {
  pending_review: { label: 'En revisión', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock className="w-3.5 h-3.5" /> },
  approved:       { label: 'Aprobado',    color: 'bg-green-50 text-green-700 border-green-200', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  rejected:       { label: 'Rechazado',   color: 'bg-red-50 text-red-700 border-red-200',       icon: <XCircle className="w-3.5 h-3.5" /> },
  superseded:     { label: 'Reemplazado', color: 'bg-gray-50 text-gray-500 border-gray-200',    icon: <RefreshCw className="w-3.5 h-3.5" /> },
};

const OnboardingDocumentsStep: React.FC<Props> = ({ agencyId, personaType, documentsSubmittedAt, onSubmitted }) => {
  const [docTypes, setDocTypes]     = useState<DocType[]>([]);
  const [myDocs, setMyDocs]         = useState<AgencyDoc[]>([]);
  const [uploading, setUploading]   = useState<Record<string, boolean>>({});
  const [uploadError, setUploadErr] = useState<Record<string, string>>({});
  const [sending, setSending]       = useState(false);
  const [sendError, setSendError]   = useState('');

  const fetchDocs = useCallback(async () => {
    const [{ data: types }, { data: docs }] = await Promise.all([
      supabase.from('document_types').select('*').order('sort_order'),
      supabase.from('agency_documents').select('*').eq('agency_id', agencyId).eq('is_current', true),
    ]);
    const filtered = (types ?? []).filter((t: DocType) => {
      if (t.key === 'contrato_agencia') return false;
      if (t.applies_to === 'persona_moral') return personaType === 'persona_moral';
      if (t.applies_to === 'persona_fisica') return personaType === 'persona_fisica';
      return true;
    });
    setDocTypes(filtered);
    setMyDocs(docs ?? []);
  }, [agencyId, personaType]);

  useEffect(() => {
    fetchDocs();

    const channel = supabase
      .channel('agency-documents-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agency_documents', filter: `agency_id=eq.${agencyId}` },
        () => fetchDocs()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchDocs, agencyId]);

  const getDocForType = (key: string) => myDocs.find(d => d.document_type_key === key);

  const handleUpload = async (typeKey: string, file: File) => {
    setUploading(prev => ({ ...prev, [typeKey]: true }));
    setUploadErr(prev => ({ ...prev, [typeKey]: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('file', file);
      form.append('document_type_key', typeKey);

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-agency-document`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` }, body: form }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error al subir');
      await fetchDocs();
    } catch (err: any) {
      setUploadErr(prev => ({ ...prev, [typeKey]: err.message }));
    } finally {
      setUploading(prev => ({ ...prev, [typeKey]: false }));
    }
  };

  const handleSendNotification = async () => {
    setSending(true);
    setSendError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-documents-ready`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' } }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error al enviar la notificación');
      onSubmitted();
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  const allRequiredUploaded = docTypes
    .filter(t => t.required)
    .every(t => {
      const doc = getDocForType(t.key);
      return doc && doc.status !== 'rejected';
    });

  const alreadySent = !!documentsSubmittedAt;
  const canSend     = allRequiredUploaded && !alreadySent;

  const hasRejected = myDocs.some(d => d.status === 'rejected');
  const allApproved = docTypes.length > 0 && docTypes.filter(t => t.required).every(t => {
    const doc = getDocForType(t.key);
    return doc?.status === 'approved';
  });
  const inReview = alreadySent && !allApproved;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-primary-500 to-primary-600" />
      <div className="p-8">
        <div className="flex items-center gap-3 mb-2">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${inReview ? 'bg-amber-50' : 'bg-primary-50'}`}>
            {inReview ? <Clock className="w-5 h-5 text-amber-600" /> : <Upload className="w-5 h-5 text-primary-600" />}
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{inReview ? 'Documentos en revisión' : 'Documentos de la agencia'}</h2>
            <p className="text-sm text-gray-500">{inReview ? 'Estamos verificando tus documentos. Puedes ver el estado en tiempo real.' : 'Sube los documentos requeridos para verificar tu empresa.'}</p>
          </div>
        </div>

        {inReview && (
          <div className={`rounded-xl p-4 mb-6 mt-4 ${hasRejected ? 'bg-red-50' : allApproved ? 'bg-green-50' : 'bg-amber-50'}`}>
            <div className="flex items-start gap-3">
              {hasRejected ? <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" /> : allApproved ? <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" /> : <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />}
              <div>
                <p className={`text-sm font-medium ${hasRejected ? 'text-red-800' : allApproved ? 'text-green-800' : 'text-amber-800'}`}>
                  {hasRejected ? 'Algunos documentos fueron rechazados' : allApproved ? 'Todos los documentos aprobados' : 'Documentos en revisión'}
                </p>
                <p className={`text-xs mt-0.5 ${hasRejected ? 'text-red-700' : allApproved ? 'text-green-700' : 'text-amber-700'}`}>
                  {hasRejected
                    ? 'Re-sube los documentos rechazados. El equipo los revisará nuevamente.'
                    : allApproved
                      ? 'Tu expediente está completo. Preparando tu contrato para firma…'
                      : 'El equipo de ToursRed está revisando tu documentación. Te notificaremos por correo cuando haya novedades.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {!inReview && (
          <div className="bg-blue-50 rounded-xl p-4 mb-6 mt-4">
            <p className="text-sm text-blue-800">
              <strong>Formatos aceptados:</strong> PDF, JPG, PNG o WEBP. Tamaño máximo: 10 MB por archivo. Los documentos rechazados pueden resubirse.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {docTypes.map(type => {
            const doc    = getDocForType(type.key);
            const isUp   = uploading[type.key];
            const errMsg = uploadError[type.key];
            const badge  = doc ? STATUS_BADGE[doc.status] : null;

            return (
              <div key={type.key} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">{type.label}</span>
                      {type.required && <span className="text-xs text-red-500 font-medium">Requerido</span>}
                      {badge && (
                        <span className={`inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 font-medium ${badge.color}`}>
                          {badge.icon}{badge.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{type.description}</p>
                    {doc && (
                      <p className="text-xs text-gray-400 mt-1 truncate">Archivo: {doc.file_name}</p>
                    )}
                    {doc?.rejection_reason && (
                      <div className="flex items-start gap-1.5 mt-2 text-xs text-red-700 bg-red-50 rounded-lg p-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>{doc.rejection_reason}</span>
                      </div>
                    )}
                    {errMsg && <p className="text-xs text-red-600 mt-1">{errMsg}</p>}
                  </div>

                  <label className={`flex-shrink-0 ${isUp || doc?.status === 'pending_review' || doc?.status === 'approved' ? 'pointer-events-none' : 'cursor-pointer'}`}>
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      disabled={doc?.status === 'pending_review' || doc?.status === 'approved'}
                      onChange={e => { if (e.target.files?.[0]) handleUpload(type.key, e.target.files[0]); e.target.value = ''; }}
                    />
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                      doc?.status === 'approved'
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : doc?.status === 'pending_review'
                          ? 'border-amber-200 bg-amber-50 text-amber-700 cursor-not-allowed'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}>
                      {isUp ? (
                        <div className="w-3.5 h-3.5 border-2 border-gray-400/30 border-t-gray-600 rounded-full animate-spin" />
                      ) : doc?.status === 'approved' ? (
                        <FileCheck className="w-3.5 h-3.5" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      {doc?.status === 'approved' ? 'Aprobado' : doc?.status === 'pending_review' ? 'En revisión' : doc ? 'Reemplazar' : 'Subir'}
                    </span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-6 border-t border-gray-100 space-y-4">
          {/* Status message + send button — only when NOT in review */}
          {!inReview && (
            <>
              {alreadySent ? (
                <div className="bg-green-50 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Notificación enviada</p>
                    <p className="text-xs text-green-700 mt-0.5">
                      Nuestro equipo ya fue notificado y revisará tus documentos en un plazo de 1–3 días hábiles. Te avisaremos por correo cuando haya novedades.
                    </p>
                  </div>
                </div>
              ) : !allRequiredUploaded ? (
                <div className="bg-amber-50 rounded-xl p-4 flex items-start gap-3">
                  <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">Sube todos los documentos requeridos para poder enviar a revisión.</p>
                </div>
              ) : (
                <div className="bg-blue-50 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-800">Todos los documentos requeridos han sido cargados. Haz clic en <strong>Enviar para revisión</strong> para notificar al equipo.</p>
                </div>
              )}

              {sendError && (
                <div className="bg-red-50 rounded-xl p-3 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-700">{sendError}</p>
                </div>
              )}

              <button
                onClick={handleSendNotification}
                disabled={!canSend || sending}
                className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {alreadySent ? 'Notificación enviada' : sending ? 'Enviando…' : 'Enviar para revisión'}
              </button>
            </>
          )}

          {inReview && allApproved && (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingDocumentsStep;
