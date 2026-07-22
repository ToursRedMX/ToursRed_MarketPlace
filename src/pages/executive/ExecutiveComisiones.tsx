import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, Upload, CheckCircle, AlertCircle, X,
  FileText, Download, ShieldCheck, ShieldAlert, Loader2, ExternalLink,
  Zap, Receipt
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import CfdiViewerModal from '../../components/CfdiViewerModal';

interface Commission {
  id: string;
  commission_type: string;
  amount: number;
  status: string;
  period_month: number | null;
  period_year: number | null;
  cfdi_xml_url: string | null;
  cfdi_pdf_url: string | null;
  cfdi_uuid_fiscal: string | null;
  cfdi_total: number | null;
  cfdi_uploaded_at: string | null;
  rejection_reason: string | null;
  paid_at: string | null;
  created_at: string;
  agencies: { name: string };
}

interface CfdiParsed {
  uuid: string;
  total: number;
  emisorRfc: string;
  emisorNombre: string;
  receptorRfc: string;
  tipoDeComprobante: string;
}

interface GeneratedCfdiResult {
  uuid_fiscal: string;
  xml_url: string;
  pdf_url: string;
  folio: string;
  serie: string;
  amounts: {
    subtotal: number;
    iva: number;
    isr_retenido: number;
    total: number;
    neto_a_cobrar: number;
  };
}

type ValidationStatus = 'idle' | 'parsing' | 'ok' | 'error';

interface ValidationResult {
  status: ValidationStatus;
  parsed: CfdiParsed | null;
  errors: string[];
  warnings: string[];
}

function parseCfdiXml(xmlText: string): CfdiParsed {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('El archivo no es un XML válido.');
  const comprobante =
    doc.querySelector('Comprobante') ||
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Comprobante')[0] ||
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/3', 'Comprobante')[0];
  if (!comprobante) throw new Error('No se encontró el nodo Comprobante en el XML.');
  const tipo = comprobante.getAttribute('TipoDeComprobante') || '';
  const total = parseFloat(comprobante.getAttribute('Total') || '0');
  const emisorEl =
    comprobante.querySelector('Emisor') ||
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Emisor')[0] ||
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/3', 'Emisor')[0];
  const emisorRfc = emisorEl?.getAttribute('Rfc') || '';
  const emisorNombre = emisorEl?.getAttribute('Nombre') || '';
  const receptorEl =
    comprobante.querySelector('Receptor') ||
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Receptor')[0] ||
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/3', 'Receptor')[0];
  const receptorRfc = receptorEl?.getAttribute('Rfc') || '';
  const timbre =
    doc.querySelector('TimbreFiscalDigital') ||
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/TimbreFiscalDigitalv11', 'TimbreFiscalDigital')[0];
  const uuid = timbre?.getAttribute('UUID') || '';
  return { uuid, total, emisorRfc, emisorNombre, receptorRfc, tipoDeComprobante: tipo };
}

const TYPE_LABELS: Record<string, string> = {
  approval: 'Aprobación de agencia',
  first_tour_and_booking: 'Primer tour y reserva',
  platform_period: 'Comisión de periodo',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pendiente', color: 'text-amber-700', bg: 'bg-amber-100' },
  invoiced: { label: 'CFDI enviado', color: 'text-blue-700', bg: 'bg-blue-100' },
  approved: { label: 'Aprobado', color: 'text-green-700', bg: 'bg-green-100' },
  paid: { label: 'Pagado', color: 'text-gray-700', bg: 'bg-gray-100' },
  rejected: { label: 'Rechazado', color: 'text-red-700', bg: 'bg-red-100' },
};

export default function ExecutiveComisiones() {
  const { accountExecutiveInfo } = useAuth();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [cfdiModal, setCfdiModal] = useState<Commission | null>(null);
  const [cfdiModalMode, setCfdiModalMode] = useState<'generate' | 'upload'>('generate');
  const [cfdiXmlFile, setCfdiXmlFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<GeneratedCfdiResult | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [executiveRfc, setExecutiveRfc] = useState<string | null>(null);
  const [facturApiConfigured, setFacturApiConfigured] = useState(false);
  const [validation, setValidation] = useState<ValidationResult>({ status: 'idle', parsed: null, errors: [], warnings: [] });
  const [cfdiViewerUrl, setCfdiViewerUrl] = useState<string | null>(null);

  const loadCommissions = useCallback(async () => {
    if (!accountExecutiveInfo?.executiveId) return;
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('executive_commissions')
        .select('*, agencies(name)')
        .eq('executive_id', accountExecutiveInfo.executiveId)
        .order('created_at', { ascending: false });
      setCommissions((data || []) as Commission[]);
    } finally { setIsLoading(false); }
  }, [accountExecutiveInfo?.executiveId]);

  useEffect(() => { loadCommissions(); }, [loadCommissions]);

  useEffect(() => {
    const loadExecInfo = async () => {
      if (!accountExecutiveInfo?.executiveId) return;
      const { data } = await supabase
        .from('account_executives_safe')
        .select('tax_rfc, facturapi_configured')
        .eq('id', accountExecutiveInfo.executiveId)
        .maybeSingle();
      setExecutiveRfc(data?.tax_rfc || null);
      setFacturApiConfigured(data?.facturapi_configured || false);
    };
    loadExecInfo();
  }, [accountExecutiveInfo?.executiveId]);

  const filtered = commissions.filter(c => statusFilter === 'all' || c.status === statusFilter);

  const totals = {
    pending: commissions.filter(c => ['pending', 'invoiced', 'approved'].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0),
    paid: commissions.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.amount), 0),
    total: commissions.reduce((s, c) => s + Number(c.amount), 0),
  };

  const toggleSelect = (id: string) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const openCfdiModal = (commission: Commission, mode: 'generate' | 'upload' = 'generate') => {
    setCfdiModal(commission);
    setCfdiModalMode(mode);
    setCfdiXmlFile(null);
    setGeneratedResult(null);
    setValidation({ status: 'idle', parsed: null, errors: [], warnings: [] });
  };

  const expectedTotal = cfdiModal
    ? commissions.filter(c => selectedIds.length > 0 ? selectedIds.includes(c.id) : c.id === cfdiModal.id).reduce((s, c) => s + Number(c.amount), 0)
    : 0;

  const handleXmlChange = async (file: File | null) => {
    setCfdiXmlFile(file);
    if (!file) { setValidation({ status: 'idle', parsed: null, errors: [], warnings: [] }); return; }
    setValidation({ status: 'parsing', parsed: null, errors: [], warnings: [] });
    try {
      const xmlText = await file.text();
      const parsed = parseCfdiXml(xmlText);
      const errors: string[] = [];
      const warnings: string[] = [];
      if (parsed.tipoDeComprobante && parsed.tipoDeComprobante !== 'I') errors.push(`El CFDI es de tipo "${parsed.tipoDeComprobante}", debe ser de tipo Ingreso (I).`);
      if (!parsed.uuid) errors.push('No se encontró el UUID fiscal (TimbreFiscalDigital) en el XML.');
      if (parsed.total > 0 && Math.abs(parsed.total - expectedTotal) > 0.10) errors.push(`El monto del CFDI (${formatCurrencyMXN(parsed.total)}) no coincide con el total de comisiones seleccionadas (${formatCurrencyMXN(expectedTotal)}).`);
      if (executiveRfc) {
        if (parsed.emisorRfc.toUpperCase() !== executiveRfc.toUpperCase()) errors.push(`El RFC del emisor en el CFDI (${parsed.emisorRfc}) no coincide con tu RFC registrado (${executiveRfc}).`);
      } else {
        warnings.push('No tienes RFC registrado en tu perfil. Se omitió la validación del emisor.');
      }
      setValidation({ status: errors.length > 0 ? 'error' : 'ok', parsed, errors, warnings });
    } catch (e: any) {
      setValidation({ status: 'error', parsed: null, errors: [e.message || 'Error al leer el archivo XML.'], warnings: [] });
    }
  };

  const generateCfdi = async () => {
    if (!cfdiModal) return;
    const idsToGenerate = selectedIds.length > 0 ? selectedIds : [cfdiModal.id];
    setIsGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión expirada.');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-executive-commission-cfdi`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ commission_ids: idsToGenerate }),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Error al generar el CFDI.');
      setGeneratedResult(result as GeneratedCfdiResult);
      loadCommissions();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al generar el CFDI.' });
      setCfdiModal(null);
    } finally { setIsGenerating(false); }
  };

  const uploadCfdi = async () => {
    if (!cfdiModal || !cfdiXmlFile) { setMessage({ type: 'error', text: 'Debes subir el archivo XML del CFDI.' }); return; }
    if (validation.status !== 'ok') { setMessage({ type: 'error', text: 'Corrige los errores de validación antes de enviar.' }); return; }
    const { parsed } = validation;
    if (!parsed) return;
    setIsSaving(true);
    try {
      const execId = accountExecutiveInfo!.executiveId;
      const xmlPath = `executive-cfdi/${execId}/${cfdiModal.id}/${Date.now()}.xml`;
      const { error: uploadError } = await supabase.storage.from('payment-receipts').upload(xmlPath, cfdiXmlFile, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('payment-receipts').getPublicUrl(xmlPath);
      const idsToUpdate = selectedIds.length > 0 ? selectedIds : [cfdiModal.id];
      for (const id of idsToUpdate) {
        await supabase.from('executive_commissions').update({
          status: 'invoiced', cfdi_xml_url: urlData.publicUrl || xmlPath,
          cfdi_total: parsed.total, cfdi_uuid_fiscal: parsed.uuid,
          cfdi_uploaded_at: new Date().toISOString(),
        }).eq('id', id);
      }
      setMessage({ type: 'success', text: 'CFDI enviado correctamente. El administrador lo revisará para aprobarlo.' });
      setCfdiModal(null); setCfdiXmlFile(null);
      setValidation({ status: 'idle', parsed: null, errors: [], warnings: [] });
      setSelectedIds([]); loadCommissions();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Error al subir el CFDI.' });
    } finally { setIsSaving(false); }
  };

  const openExecutiveFile = async (commissionId: string, fileType: 'xml' | 'pdf', uuid?: string | null) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-executive-cfdi?commission_id=${commissionId}&file_type=${fileType}`;
      const res = await fetch(proxyUrl, { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (fileType === 'pdf') {
        window.open(objectUrl, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = uuid ? `CFDI-${uuid}.xml` : `CFDI-${commissionId}.xml`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch { /* silenciar error */ }
  };

  const pendingCommissions = commissions.filter(c => c.status === 'pending');

  const closeModal = () => {
    setCfdiModal(null); setGeneratedResult(null); setCfdiXmlFile(null);
    setValidation({ status: 'idle', parsed: null, errors: [], warnings: [] });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mis Comisiones</h1>
        <p className="text-gray-500 mt-1">Estado de cuenta y cobro de comisiones</p>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Banner FacturAPI no configurado */}
      {!facturApiConfigured && pendingCommissions.length > 0 && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <Zap className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-violet-900">Activa la generación automática de CFDI</p>
            <p className="text-sm text-violet-700 mt-0.5">Configura tu cuenta de FacturAPI para generar tus facturas de comisiones con un solo clic.</p>
            <a href="/executive/perfil" className="text-sm font-medium text-violet-700 underline mt-1 inline-block">Ir a Mi Perfil &rarr; Facturación electrónica</a>
          </div>
        </div>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-2">Pendiente de cobro</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrencyMXN(totals.pending)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-2">Cobrado</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrencyMXN(totals.paid)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-2">Total acumulado</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrencyMXN(totals.total)}</p>
        </div>
      </div>

      {/* Cobrar comisiones pendientes */}
      {pendingCommissions.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h3 className="font-semibold text-blue-900 mb-1">Tienes comisiones pendientes de cobrar</h3>
          <p className="text-sm text-blue-700 mb-4">Total pendiente: <strong>{formatCurrencyMXN(totals.pending)}</strong> — Selecciona las comisiones que quieres cobrar.</p>
          <div className="space-y-2">
            {pendingCommissions.map(c => (
              <label key={c.id} className="flex items-center gap-3 bg-white rounded-lg px-4 py-3 cursor-pointer hover:bg-blue-50 transition-colors border border-blue-100">
                <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} className="rounded text-blue-600" />
                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{TYPE_LABELS[c.commission_type] || c.commission_type}</p>
                    <p className="text-xs text-gray-500">{(c.agencies as any)?.name}{c.period_month && ` — ${c.period_month}/${c.period_year}`}</p>
                  </div>
                  <p className="text-sm font-bold text-gray-900">{formatCurrencyMXN(c.amount)}</p>
                </div>
              </label>
            ))}
          </div>
          {selectedIds.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-blue-800 font-medium">
                {selectedIds.length} comisión(es) — Total: {formatCurrencyMXN(commissions.filter(c => selectedIds.includes(c.id)).reduce((s, c) => s + Number(c.amount), 0))}
              </p>
              <div className="flex gap-2">
                {facturApiConfigured && (
                  <button
                    onClick={() => { const first = commissions.find(c => selectedIds.includes(c.id)); if (first) openCfdiModal(first, 'generate'); }}
                    className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
                  >
                    <Zap className="h-4 w-4" /> Generar CFDI
                  </button>
                )}
                <button
                  onClick={() => { const first = commissions.find(c => selectedIds.includes(c.id)); if (first) openCfdiModal(first, 'upload'); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${facturApiConfigured ? 'border border-blue-300 text-blue-700 hover:bg-blue-100' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  <Upload className="h-4 w-4" /> {facturApiConfigured ? 'Subir manualmente' : 'Subir CFDI'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'pending', 'invoiced', 'approved', 'paid', 'rejected'].map(s => {
          const cfg = s === 'all' ? null : STATUS_CONFIG[s];
          const count = s === 'all' ? commissions.length : commissions.filter(c => c.status === s).length;
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? (cfg ? `${cfg.bg} ${cfg.color} ring-1 ring-current` : 'bg-gray-900 text-white') : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s === 'all' ? 'Todas' : cfg?.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400"><DollarSign className="h-10 w-10 mx-auto mb-3 text-gray-300" /><p>No hay comisiones en este estado</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>{['Tipo', 'Agencia', 'Monto', 'Periodo', 'Estado', 'CFDI', 'Fecha'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(comm => {
                  const cfg = STATUS_CONFIG[comm.status] || STATUS_CONFIG.pending;
                  return (
                    <tr key={comm.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3"><p className="text-sm text-gray-900">{TYPE_LABELS[comm.commission_type] || comm.commission_type}</p></td>
                      <td className="px-4 py-3"><p className="text-sm text-gray-700">{(comm.agencies as any)?.name}</p></td>
                      <td className="px-4 py-3"><p className="text-sm font-bold text-gray-900">{formatCurrencyMXN(comm.amount)}</p></td>
                      <td className="px-4 py-3"><p className="text-sm text-gray-500">{comm.period_month ? `${comm.period_month}/${comm.period_year}` : '—'}</p></td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                        {comm.status === 'rejected' && comm.rejection_reason && <p className="text-xs text-red-500 mt-0.5">{comm.rejection_reason}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {comm.cfdi_xml_url ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => openExecutiveFile(comm.id, 'xml', comm.cfdi_uuid_fiscal)} className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" title="Descargar XML"><ExternalLink className="h-3.5 w-3.5" /></button>
                            <button onClick={() => openExecutiveFile(comm.id, 'xml', comm.cfdi_uuid_fiscal)} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Descargar XML"><Download className="h-3.5 w-3.5" /></button>
                            <button onClick={() => setCfdiViewerUrl(comm.cfdi_xml_url)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Ver representación gráfica"><FileText className="h-3.5 w-3.5" /></button>
                            {comm.cfdi_pdf_url && <button onClick={() => openExecutiveFile(comm.id, 'pdf')} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Ver PDF"><Receipt className="h-3.5 w-3.5" /></button>}
                          </div>
                        ) : comm.status === 'pending' ? (
                          <div className="flex items-center gap-1">
                            {facturApiConfigured && <button onClick={() => openCfdiModal(comm, 'generate')} className="text-xs text-violet-600 hover:underline flex items-center gap-1"><Zap className="h-3 w-3" /> Generar</button>}
                            <button onClick={() => openCfdiModal(comm, 'upload')} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Upload className="h-3 w-3" /> {facturApiConfigured ? 'Manual' : 'Subir CFDI'}</button>
                          </div>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-gray-400">{new Date(comm.created_at).toLocaleDateString('es-MX')}</p>
                        {comm.paid_at && <p className="text-xs text-green-500">Pago: {new Date(comm.paid_at).toLocaleDateString('es-MX')}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal CFDI */}
      {cfdiModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {generatedResult ? (
              /* Resultado generación exitosa */
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center shrink-0"><CheckCircle className="h-5 w-5 text-green-600" /></div>
                  <div><h2 className="text-lg font-semibold text-gray-900">CFDI generado exitosamente</h2><p className="text-sm text-gray-500">Tu factura ha sido timbrada ante el SAT</p></div>
                </div>
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-2 mb-4">
                  <div className="flex justify-between text-sm"><span className="text-gray-500">UUID Fiscal</span><span className="font-mono text-xs text-gray-700 truncate max-w-xs">{generatedResult.uuid_fiscal}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-500">Folio</span><span className="text-gray-700">{generatedResult.serie}{generatedResult.folio}</span></div>
                </div>
                <div className="bg-blue-50 rounded-xl border border-blue-100 p-4 mb-5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Desglose fiscal</p>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-gray-600">Subtotal</span><span className="text-gray-900">{formatCurrencyMXN(generatedResult.amounts.subtotal)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-gray-600">IVA (16%)</span><span className="text-gray-900">+ {formatCurrencyMXN(generatedResult.amounts.iva)}</span></div>
                    {generatedResult.amounts.isr_retenido > 0 && <div className="flex justify-between text-sm"><span className="text-gray-600">ISR retenido (10%)</span><span className="text-red-600">- {formatCurrencyMXN(generatedResult.amounts.isr_retenido)}</span></div>}
                    <div className="border-t border-blue-200 pt-2 flex justify-between text-sm font-bold"><span className="text-gray-900">Total CFDI</span><span className="text-gray-900">{formatCurrencyMXN(generatedResult.amounts.total)}</span></div>
                    {generatedResult.amounts.isr_retenido > 0 && <div className="flex justify-between text-sm font-bold text-green-700"><span>Neto a cobrar</span><span>{formatCurrencyMXN(generatedResult.amounts.neto_a_cobrar)}</span></div>}
                  </div>
                </div>
                <div className="flex gap-3 mb-4">
                  <button onClick={() => openExecutiveFile(selectedIds[0] || cfdiModal!.id, 'xml', generatedResult.uuid_fiscal)} className="flex-1 flex items-center justify-center gap-2 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"><Download className="h-4 w-4" /> Descargar XML</button>
                  <button onClick={() => openExecutiveFile(selectedIds[0] || cfdiModal!.id, 'pdf')} className="flex-1 flex items-center justify-center gap-2 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"><Receipt className="h-4 w-4" /> Ver PDF</button>
                </div>
                <div className="flex justify-end">
                  <button onClick={() => { closeModal(); setSelectedIds([]); }} className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors">Cerrar</button>
                </div>
              </div>
            ) : (
              /* Formulario modal */
              <div className="p-6">
                <div className="flex items-start justify-between mb-1">
                  <h2 className="text-lg font-semibold text-gray-900">{cfdiModalMode === 'generate' ? 'Generar CFDI automáticamente' : 'Subir CFDI para cobro'}</h2>
                  <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
                </div>
                <p className="text-sm text-gray-500 mb-5">
                  {cfdiModalMode === 'generate' ? 'Se generará y timbrará el CFDI automáticamente usando tu cuenta de FacturAPI.' : 'El sistema leerá y validará automáticamente el XML que subas.'}
                </p>

                {/* Selector de modo */}
                {facturApiConfigured && (
                  <div className="flex gap-2 mb-5 p-1 bg-gray-100 rounded-lg">
                    <button onClick={() => setCfdiModalMode('generate')} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${cfdiModalMode === 'generate' ? 'bg-white shadow text-violet-700' : 'text-gray-500 hover:text-gray-700'}`}><Zap className="h-4 w-4" /> Generar con FacturAPI</button>
                    <button onClick={() => setCfdiModalMode('upload')} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${cfdiModalMode === 'upload' ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}><Upload className="h-4 w-4" /> Subir manualmente</button>
                  </div>
                )}

                {/* Comisiones incluidas */}
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 mb-5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Comisiones a cobrar</p>
                  {(selectedIds.length > 0 ? commissions.filter(c => selectedIds.includes(c.id)) : [cfdiModal]).map(c => (
                    <div key={c.id} className="flex justify-between text-sm py-1">
                      <span className="text-gray-700">{TYPE_LABELS[c.commission_type] || c.commission_type} — {(c.agencies as any)?.name}</span>
                      <span className="font-semibold text-gray-900">{formatCurrencyMXN(c.amount)}</span>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm font-bold">
                    <span className="text-gray-900">Total</span>
                    <span className="text-gray-900">{formatCurrencyMXN(expectedTotal)}</span>
                  </div>
                </div>

                {cfdiModalMode === 'generate' && (
                  <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-5">
                    <p className="text-sm text-violet-800">Se generará un CFDI tipo Ingreso donde tú eres el emisor y ToursRed es el receptor. El XML y PDF quedarán disponibles desde FacturAPI.</p>
                  </div>
                )}

                {cfdiModalMode === 'upload' && (
                  <>
                    <div className="mb-5">
                      <label className="block text-xs font-medium text-gray-600 mb-2">Archivo XML del CFDI *</label>
                      <label className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${validation.status === 'ok' ? 'border-green-400 bg-green-50' : validation.status === 'error' ? 'border-red-400 bg-red-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}>
                        {validation.status === 'parsing' ? (
                          <div className="text-center"><Loader2 className="h-5 w-5 text-blue-500 mx-auto mb-1 animate-spin" /><p className="text-sm text-blue-600">Leyendo CFDI...</p></div>
                        ) : cfdiXmlFile ? (
                          <div className="text-center px-4">
                            <FileText className={`h-5 w-5 mx-auto mb-1 ${validation.status === 'ok' ? 'text-green-500' : 'text-red-500'}`} />
                            <p className={`text-sm font-medium truncate max-w-xs ${validation.status === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{cfdiXmlFile.name}</p>
                            <p className="text-xs text-gray-400 mt-0.5">Haz clic para cambiar</p>
                          </div>
                        ) : (
                          <div className="text-center"><Upload className="h-5 w-5 text-gray-400 mx-auto mb-1" /><p className="text-sm text-gray-500">Seleccionar XML</p></div>
                        )}
                        <input type="file" className="hidden" accept=".xml,text/xml,application/xml" onChange={e => handleXmlChange(e.target.files?.[0] || null)} />
                      </label>
                    </div>
                    {validation.status === 'ok' && validation.parsed && (
                      <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 space-y-2">
                        <div className="flex items-center gap-2 mb-1"><ShieldCheck className="h-4 w-4 text-green-600 shrink-0" /><span className="text-sm font-semibold text-green-800">CFDI válido</span></div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-green-700">
                          <span className="text-green-500 font-medium">UUID</span><span className="font-mono truncate">{validation.parsed.uuid}</span>
                          <span className="text-green-500 font-medium">Monto</span><span>{formatCurrencyMXN(validation.parsed.total)}</span>
                          <span className="text-green-500 font-medium">RFC emisor</span><span className="font-mono">{validation.parsed.emisorRfc}</span>
                          <span className="text-green-500 font-medium">RFC receptor</span><span className="font-mono">{validation.parsed.receptorRfc}</span>
                        </div>
                        {validation.warnings.map((w, i) => <p key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">{w}</p>)}
                      </div>
                    )}
                    {validation.status === 'error' && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 space-y-1.5">
                        <div className="flex items-center gap-2 mb-1"><ShieldAlert className="h-4 w-4 text-red-600 shrink-0" /><span className="text-sm font-semibold text-red-800">El CFDI no pasó la validación</span></div>
                        {validation.errors.map((e, i) => <p key={i} className="text-xs text-red-700 flex items-start gap-1.5"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{e}</p>)}
                        {validation.warnings.map((w, i) => <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{w}</p>)}
                        {!executiveRfc && <a href="/executive/perfil" className="text-xs text-blue-600 underline block mt-1">Ir a Mi Perfil para agregar tu RFC</a>}
                      </div>
                    )}
                  </>
                )}

                <div className="flex justify-end gap-3 mt-2">
                  <button onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
                  {cfdiModalMode === 'generate' ? (
                    <button onClick={generateCfdi} disabled={isGenerating} className="px-5 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center gap-2">
                      {isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generando...</> : <><Zap className="h-4 w-4" /> Generar y timbrar CFDI</>}
                    </button>
                  ) : (
                    <button onClick={uploadCfdi} disabled={isSaving || validation.status !== 'ok'} className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2">
                      {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</> : <><CheckCircle className="h-4 w-4" /> Enviar para revisión</>}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {cfdiViewerUrl && <CfdiViewerModal xmlUrl={cfdiViewerUrl} onClose={() => setCfdiViewerUrl(null)} />}
    </div>
  );
}
