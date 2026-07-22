import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, Eye, Download, Shield, Clock, Users, ChevronDown, ChevronUp, X, Check, AlertTriangle, Search, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import RichTextEditor from '../../components/RichTextEditor';

interface TermsVersion {
  id: string;
  terms_type: 'traveler' | 'agency';
  version_number: number;
  title: string;
  content: string;
  change_summary: string | null;
  is_active: boolean;
  published_at: string;
  published_by_user_id: string | null;
  created_at: string;
}

interface TermsAcceptance {
  id: string;
  user_id: string;
  terms_version_id: string;
  terms_type: 'traveler' | 'agency';
  version_number: number;
  user_email: string;
  ip_address: string | null;
  user_agent: string | null;
  accepted_at: string;
}

const TABS = [
  { key: 'traveler', label: 'Viajeros', icon: Users },
  { key: 'agency', label: 'Agencias', icon: Shield },
  { key: 'audit', label: 'Auditoría', icon: Clock },
] as const;

type TabKey = typeof TABS[number]['key'];

// ── Publish Modal ─────────────────────────────────────────────────────────────
const PublishModal: React.FC<{
  termsType: 'traveler' | 'agency';
  currentVersion: TermsVersion | null;
  onClose: () => void;
  onPublished: () => void;
}> = ({ termsType, currentVersion, onClose, onPublished }) => {
  const [title, setTitle] = useState(currentVersion?.title || '');
  const [changeSummary, setChangeSummary] = useState('');
  const [content, setContent] = useState(currentVersion?.content || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handlePublish = async () => {
    if (!title.trim()) { setError('El título es obligatorio.'); return; }
    if (!changeSummary.trim()) { setError('El resumen de cambios es obligatorio.'); return; }
    if (!content || content === '<p></p>') { setError('El contenido no puede estar vacío.'); return; }

    setSaving(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('publish_new_terms_version', {
        p_type: termsType,
        p_title: title.trim(),
        p_content: content,
        p_change_summary: changeSummary.trim(),
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error || 'Error al publicar');
      onPublished();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Publicar Nueva Versión</h2>
            <p className="text-sm text-gray-500 mt-1">
              T&C para {termsType === 'traveler' ? 'Viajeros' : 'Agencias'} —
              será la Versión {(currentVersion?.version_number ?? 0) + 1}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Título del documento</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Términos y Condiciones para Viajeros — ToursRed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Resumen de cambios <span className="text-gray-400">(visible para los usuarios)</span></label>
            <textarea
              value={changeSummary}
              onChange={e => setChangeSummary(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Describe brevemente qué cambió en esta versión..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contenido</label>
            <RichTextEditor
              value={content}
              onChange={setContent}
              placeholder="Escribe el contenido de los términos aquí..."
              enableImages={false}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg px-4 py-3 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <strong>Aviso:</strong> Al publicar, todos los usuarios con la versión anterior deberán aceptar explícitamente esta nueva versión la próxima vez que inicien sesión.
          </div>
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handlePublish}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? 'Publicando...' : 'Publicar Versión'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Version Card ──────────────────────────────────────────────────────────────
const VersionCard: React.FC<{ version: TermsVersion; acceptanceCount: number }> = ({ version, acceptanceCount }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border rounded-xl overflow-hidden ${version.is_active ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <div className="flex items-center gap-3">
          {version.is_active ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-green-700 bg-green-100 rounded-full">
              <Check className="w-3 h-3" /> Activa
            </span>
          ) : (
            <span className="inline-flex px-2 py-0.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-full">
              Archivada
            </span>
          )}
          <span className="font-semibold text-gray-900">Versión {version.version_number}</span>
          <span className="text-sm text-gray-500">
            {format(new Date(version.published_at), "dd 'de' MMMM yyyy", { locale: es })}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{acceptanceCount} aceptaciones</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-200 p-4 space-y-3">
          {version.change_summary && (
            <div className="text-sm text-gray-600 bg-white rounded-lg px-4 py-3 border border-gray-200">
              <span className="font-medium text-gray-700">Resumen de cambios: </span>{version.change_summary}
            </div>
          )}
          <div
            className="prose prose-sm max-w-none text-sm bg-white rounded-lg p-4 border border-gray-200 max-h-80 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: version.content }}
          />
        </div>
      )}
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const TermsManagementPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('traveler');
  const [versions, setVersions] = useState<{ traveler: TermsVersion[]; agency: TermsVersion[] }>({ traveler: [], agency: [] });
  const [acceptanceCounts, setAcceptanceCounts] = useState<Record<string, number>>({});
  const [acceptances, setAcceptances] = useState<TermsAcceptance[]>([]);
  const [totalAcceptances, setTotalAcceptances] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showPublishModal, setShowPublishModal] = useState<'traveler' | 'agency' | null>(null);

  // Audit filters
  const [auditFilter, setAuditFilter] = useState({ type: 'all', email: '', from: '', to: '' });
  const [auditPage, setAuditPage] = useState(0);
  const PAGE_SIZE = 50;

  const loadVersions = useCallback(async () => {
    const { data } = await supabase
      .from('terms_versions')
      .select('*')
      .order('terms_type')
      .order('version_number', { ascending: false });
    if (data) {
      setVersions({
        traveler: data.filter(v => v.terms_type === 'traveler'),
        agency: data.filter(v => v.terms_type === 'agency'),
      });
    }
  }, []);

  const loadAcceptanceCounts = useCallback(async () => {
    const { data } = await supabase
      .from('terms_acceptances')
      .select('terms_version_id');
    if (data) {
      const counts: Record<string, number> = {};
      for (const row of data) {
        counts[row.terms_version_id] = (counts[row.terms_version_id] || 0) + 1;
      }
      setAcceptanceCounts(counts);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    let query = supabase
      .from('terms_acceptances')
      .select('*', { count: 'exact' })
      .order('accepted_at', { ascending: false })
      .range(auditPage * PAGE_SIZE, auditPage * PAGE_SIZE + PAGE_SIZE - 1);

    if (auditFilter.type !== 'all') query = query.eq('terms_type', auditFilter.type);
    if (auditFilter.email) query = query.ilike('user_email', `%${auditFilter.email}%`);
    if (auditFilter.from) query = query.gte('accepted_at', auditFilter.from);
    if (auditFilter.to) query = query.lte('accepted_at', auditFilter.to + 'T23:59:59');

    const { data, count } = await query;
    if (data) setAcceptances(data);
    if (count !== null) setTotalAcceptances(count);
  }, [auditFilter, auditPage]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadVersions(), loadAcceptanceCounts()]);
      setLoading(false);
    };
    init();
  }, [loadVersions, loadAcceptanceCounts]);

  useEffect(() => {
    if (activeTab === 'audit') loadAudit();
  }, [activeTab, loadAudit]);

  const handlePublished = async () => {
    setShowPublishModal(null);
    setLoading(true);
    await Promise.all([loadVersions(), loadAcceptanceCounts()]);
    setLoading(false);
  };

  const exportCSV = () => {
    const rows = acceptances.map(a => ({
      'Fecha/Hora': format(new Date(a.accepted_at), 'dd/MM/yyyy HH:mm:ss'),
      'Correo': a.user_email,
      'Tipo': a.terms_type === 'traveler' ? 'Viajero' : 'Agencia',
      'Versión': a.version_number,
      'IP': a.ip_address || '-',
      'Dispositivo/Navegador': a.user_agent || '-',
      'ID Usuario': a.user_id,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Aceptaciones');
    XLSX.writeFile(wb, `auditoria_terms_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text('Registro de Auditoría — Aceptación de Términos y Condiciones', 14, 15);
    doc.setFontSize(9);
    doc.text(`Exportado el ${format(new Date(), "dd/MM/yyyy 'a las' HH:mm")}`, 14, 22);

    autoTable(doc, {
      startY: 28,
      head: [['Fecha/Hora', 'Correo', 'Tipo', 'Versión', 'IP', 'Dispositivo/Navegador']],
      body: acceptances.map(a => [
        format(new Date(a.accepted_at), 'dd/MM/yyyy HH:mm:ss'),
        a.user_email,
        a.terms_type === 'traveler' ? 'Viajero' : 'Agencia',
        `v${a.version_number}`,
        a.ip_address || '-',
        (a.user_agent || '-').substring(0, 60),
      ]),
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [37, 99, 235] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    doc.save(`auditoria_terms_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
  };

  const activeVersions = { traveler: versions.traveler[0], agency: versions.agency[0] };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Términos y Condiciones</h1>
              <p className="text-sm text-gray-500">Gestión de versiones, publicación y auditoría de aceptaciones</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-200 p-1 rounded-xl mb-6 w-fit">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Traveler / Agency tabs */}
            {(activeTab === 'traveler' || activeTab === 'agency') && (
              <div className="space-y-6">
                {/* Active version summary */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        Versión Activa — {activeTab === 'traveler' ? 'Viajeros' : 'Agencias'}
                      </h2>
                      {activeVersions[activeTab] ? (
                        <p className="text-sm text-gray-500 mt-1">
                          Versión {activeVersions[activeTab].version_number} publicada el{' '}
                          {format(new Date(activeVersions[activeTab].published_at), "dd 'de' MMMM yyyy", { locale: es })}
                        </p>
                      ) : (
                        <p className="text-sm text-amber-600 mt-1">No hay versión activa publicada.</p>
                      )}
                    </div>
                    <button
                      onClick={() => setShowPublishModal(activeTab)}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Publicar nueva versión
                    </button>
                  </div>

                  {activeVersions[activeTab] && (
                    <div
                      className="prose prose-sm max-w-none text-sm border border-gray-100 rounded-lg p-4 max-h-72 overflow-y-auto bg-gray-50"
                      dangerouslySetInnerHTML={{ __html: activeVersions[activeTab].content }}
                    />
                  )}
                </div>

                {/* Version history */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Historial de versiones</h3>
                  <div className="space-y-3">
                    {(activeTab === 'traveler' ? versions.traveler : versions.agency).map(v => (
                      <VersionCard
                        key={v.id}
                        version={v}
                        acceptanceCount={acceptanceCounts[v.id] || 0}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Audit tab */}
            {activeTab === 'audit' && (
              <div className="space-y-5">
                {/* Filters */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h2 className="text-base font-semibold text-gray-900 mb-4">Filtros</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
                      <select
                        value={auditFilter.type}
                        onChange={e => { setAuditFilter(f => ({ ...f, type: e.target.value })); setAuditPage(0); }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="all">Todos</option>
                        <option value="traveler">Viajeros</option>
                        <option value="agency">Agencias</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Correo</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          value={auditFilter.email}
                          onChange={e => { setAuditFilter(f => ({ ...f, email: e.target.value })); setAuditPage(0); }}
                          placeholder="Buscar por correo..."
                          className="w-full pl-9 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
                      <input
                        type="date"
                        value={auditFilter.from}
                        onChange={e => { setAuditFilter(f => ({ ...f, from: e.target.value })); setAuditPage(0); }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
                      <input
                        type="date"
                        value={auditFilter.to}
                        onChange={e => { setAuditFilter(f => ({ ...f, to: e.target.value })); setAuditPage(0); }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Export + count */}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{totalAcceptances.toLocaleString()}</span> registros encontrados
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={exportCSV}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Exportar Excel
                    </button>
                    <button
                      onClick={exportPDF}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                      Exportar PDF
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Fecha / Hora', 'Correo', 'Tipo', 'Versión', 'Dirección IP', 'Dispositivo / Navegador'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {acceptances.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="text-center py-12 text-gray-400 text-sm">
                              No hay registros que coincidan con los filtros.
                            </td>
                          </tr>
                        ) : (
                          acceptances.map(a => (
                            <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                                {format(new Date(a.accepted_at), 'dd/MM/yyyy HH:mm:ss')}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">{a.user_email}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                                  a.terms_type === 'traveler'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                  {a.terms_type === 'traveler' ? 'Viajero' : 'Agencia'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700 text-center">v{a.version_number}</td>
                              <td className="px-4 py-3 text-sm text-gray-500 font-mono">{a.ip_address || '—'}</td>
                              <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate" title={a.user_agent || ''}>
                                {a.user_agent || '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalAcceptances > PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                      <p className="text-sm text-gray-500">
                        Mostrando {auditPage * PAGE_SIZE + 1}–{Math.min((auditPage + 1) * PAGE_SIZE, totalAcceptances)} de {totalAcceptances}
                      </p>
                      <div className="flex gap-2">
                        <button
                          disabled={auditPage === 0}
                          onClick={() => setAuditPage(p => p - 1)}
                          className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
                        >
                          Anterior
                        </button>
                        <button
                          disabled={(auditPage + 1) * PAGE_SIZE >= totalAcceptances}
                          onClick={() => setAuditPage(p => p + 1)}
                          className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showPublishModal && (
        <PublishModal
          termsType={showPublishModal}
          currentVersion={activeVersions[showPublishModal] || null}
          onClose={() => setShowPublishModal(null)}
          onPublished={handlePublished}
        />
      )}
    </div>
  );
};

export default TermsManagementPage;
