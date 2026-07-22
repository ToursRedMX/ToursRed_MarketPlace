import React, { useCallback, useEffect, useState } from 'react';
import {
  FileText, CheckCircle, Clock, XCircle, ExternalLink,
  AlertTriangle, ThumbsUp, ThumbsDown, RotateCcw, Eye,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AgencyDocument {
  id: string;
  document_type_key: string;
  file_name: string;
  storage_path: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'superseded';
  rejection_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

interface Props {
  agencyId: string;
  legacySignedContractUrl?: string | null;
  onboardingStatus?: string | null;
  onRefresh?: () => void;
}

const ONBOARDING_LABELS: Record<string, { label: string; color: string }> = {
  pending_documents: { label: 'Pendiente de documentos', color: 'text-gray-600 bg-gray-100 border-gray-200' },
  pending_review:    { label: 'En revisión',              color: 'text-amber-700 bg-amber-100 border-amber-200' },
  pending_signature: { label: 'Pendiente de firma',       color: 'text-blue-700 bg-blue-100 border-blue-200' },
  active:            { label: 'Activa',                   color: 'text-green-700 bg-green-100 border-green-200' },
  rejected:          { label: 'Rechazada',                color: 'text-red-700 bg-red-100 border-red-200' },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  acta_constitutiva:           'Acta constitutiva',
  poder_notarial:              'Poder notarial',
  identificacion_oficial:      'Identificación oficial',
  comprobante_domicilio:       'Comprobante de domicilio',
  constancia_situacion_fiscal: 'Constancia de situación fiscal',
  contrato_agencia:            'Contrato de colaboración',
  registro_sec_tur:            'Registro SECTUR / Licencia',
  aviso_funcionamiento:        'Aviso de funcionamiento',
  membresia_amav_clia:         'Membresía AMAV / CLIA',
};

const isApproved = (doc: AgencyDocument) => doc.status === 'approved';

const isPending = (doc: AgencyDocument) => doc.status === 'pending_review';

const AgencyContractSection: React.FC<Props> = ({
  agencyId,
  legacySignedContractUrl,
  onboardingStatus,
  onRefresh,
}) => {
  const [documents, setDocuments]   = useState<AgencyDocument[]>([]);
  const [loading, setLoading]       = useState(true);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [busy, setBusy]             = useState<Record<string, boolean>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data: docs } = await supabase
      .from('agency_documents')
      .select('id, document_type_key, file_name, storage_path, status, rejection_reason, reviewed_at, reviewed_by, created_at')
      .eq('agency_id', agencyId)
      .eq('is_current', true)
      .order('created_at', { ascending: true });

    const list = docs ?? [];
    setDocuments(list);
    setLoading(false);

    const urls: Record<string, string> = {};
    await Promise.all(list.map(async (doc) => {
      const { data } = await supabase.storage
        .from('agency-documents')
        .createSignedUrl(doc.storage_path, 3600);
      if (data?.signedUrl) urls[doc.id] = data.signedUrl;
    }));
    setSignedUrls(urls);
  }, [agencyId]);

  useEffect(() => { load(); }, [load]);

  const invoke = async (payload: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/approve-agency-documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
    if (json.error) throw new Error(json.error);
    return json;
  };

  const handleApprove = async (doc: AgencyDocument) => {
    setBusy(p => ({ ...p, [doc.id]: true }));
    setError('');
    try {
      await invoke({ agency_id: agencyId, action: 'approve', document_ids: [doc.id] });
      await load();
      onRefresh?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(p => ({ ...p, [doc.id]: false }));
    }
  };

  const handleReject = async (doc: AgencyDocument) => {
    if (!rejectReason.trim()) return;
    setBusy(p => ({ ...p, [doc.id]: true }));
    setError('');
    try {
      await invoke({
        agency_id: agencyId,
        action: 'reject',
        document_ids: [doc.id],
        rejection_reason: rejectReason.trim(),
      });
      setRejectingId(null);
      setRejectReason('');
      await load();
      onRefresh?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(p => ({ ...p, [doc.id]: false }));
    }
  };

  const contractDoc    = documents.find(d => d.document_type_key === 'contrato_agencia');
  const reviewableDocs = documents.filter(d => d.document_type_key !== 'contrato_agencia');
  const contractUrl    = signedUrls[contractDoc?.id ?? ''] ?? legacySignedContractUrl ?? null;
  const statusCfg      = onboardingStatus ? ONBOARDING_LABELS[onboardingStatus] : null;

  return (
    <div className="space-y-5">

      {/* Onboarding status pill */}
      {statusCfg && (
        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold border rounded-full px-3 py-1 ${statusCfg.color}`}>
          <Clock className="w-3.5 h-3.5" />
          {statusCfg.label}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* ── Reviewable documents ── */}
      <div>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
          Documentos de verificación
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
            <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
            Cargando…
          </div>
        ) : reviewableDocs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            La agencia aún no ha subido documentos.
          </p>
        ) : (
          <div className="space-y-2.5">
            {reviewableDocs.map(doc => {
              const approved    = isApproved(doc);
              const pending     = isPending(doc);
              const rejected    = doc.status === 'rejected';
              const isBusy      = busy[doc.id];
              const isRejecting = rejectingId === doc.id;
              const url         = signedUrls[doc.id];

              return (
                <div
                  key={doc.id}
                  className={`rounded-xl border overflow-hidden transition-colors ${
                    approved ? 'border-green-200 bg-green-50/60' :
                    rejected  ? 'border-red-200   bg-red-50/40'   :
                                'border-gray-200  bg-white'
                  }`}
                >
                  {/* Top section: info */}
                  <div className="px-4 pt-3 pb-2">
                    {/* Doc title row */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900 leading-snug">
                        {DOC_TYPE_LABELS[doc.document_type_key] ?? doc.document_type_key}
                      </span>
                      {/* Status badge */}
                      {approved && (
                        <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold bg-green-100 text-green-700 border border-green-200 rounded-full px-2 py-0.5">
                          <CheckCircle className="w-3 h-3" /> Aprobado
                        </span>
                      )}
                      {rejected && (
                        <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                          <XCircle className="w-3 h-3" /> Rechazado
                        </span>
                      )}
                      {pending && (
                        <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                          <Clock className="w-3 h-3" /> En revisión
                        </span>
                      )}
                    </div>

                    {/* File name */}
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">{doc.file_name}</p>

                    {/* Rejection reason */}
                    {doc.rejection_reason && (
                      <p className="mt-1.5 text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5 leading-relaxed">
                        <span className="font-medium">Motivo: </span>{doc.rejection_reason}
                      </p>
                    )}
                  </div>

                  {/* Bottom section: actions */}
                  {!isRejecting ? (
                    <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                      {/* View */}
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Ver archivo
                        </a>
                      ) : (
                        <span className="text-xs text-gray-300 italic">Sin URL</span>
                      )}

                      {/* Approve */}
                      {!approved && (
                        <button
                          onClick={() => handleApprove(doc)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                        >
                          {isBusy
                            ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            : <ThumbsUp className="w-3.5 h-3.5" />}
                          Aprobar
                        </button>
                      )}

                      {/* Reject / Re-review */}
                      <button
                        onClick={() => { setRejectingId(doc.id); setRejectReason(''); }}
                        disabled={isBusy}
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow-sm disabled:opacity-60 ${
                          approved
                            ? 'text-gray-600 bg-white hover:bg-gray-50 border border-gray-200'
                            : 'text-white bg-red-500 hover:bg-red-600'
                        }`}
                      >
                        {approved
                          ? <><RotateCcw className="w-3.5 h-3.5" />Re-revisar</>
                          : <><ThumbsDown className="w-3.5 h-3.5" />Rechazar</>}
                      </button>
                    </div>
                  ) : (
                    /* Inline reject form */
                    <div className="px-4 pb-3 border-t border-dashed border-red-200 mt-1 pt-3 bg-red-50/40">
                      <p className="text-xs font-semibold text-red-700 mb-1.5">
                        Motivo de rechazo <span className="text-red-500">*</span>
                      </p>
                      <textarea
                        autoFocus
                        rows={2}
                        className="w-full text-xs border border-red-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none bg-white"
                        placeholder="Describe el problema con este documento…"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                      />
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => handleReject(doc)}
                          disabled={!rejectReason.trim() || busy[doc.id]}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {busy[doc.id]
                            ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            : <XCircle className="w-3.5 h-3.5" />}
                          Confirmar rechazo
                        </button>
                        <button
                          onClick={() => { setRejectingId(null); setRejectReason(''); }}
                          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Contract ── */}
      <div>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
          Contrato de colaboración
        </p>
        <div className="border border-gray-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <FileText className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {contractDoc?.file_name ?? 'Sin contrato generado aún'}
            </p>
            {!contractDoc && legacySignedContractUrl && (
              <p className="text-[11px] text-amber-600 flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3 h-3" /> Contrato legado
              </p>
            )}
          </div>
          {contractUrl ? (
            <a
              href={contractUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Ver contrato
            </a>
          ) : (
            <span className="flex-shrink-0 text-xs text-gray-300 italic">No generado</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgencyContractSection;