import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Search, Download, ChevronDown, ChevronUp, X, Filter, RefreshCw, Eye, AlertTriangle, MapPin } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface AuditEntry {
  id: string;
  tenant_type: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  target_id: string | null;
  target_table: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
  ip_address?: string | null;
  ip_masked: string | null;
  user_agent?: string | null;
  session_id: string | null;
  correlation_id: string | null;
  metadata: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  country?: string | null;
  country_code?: string | null;
  city?: string | null;
  region?: string | null;
  severity?: string | null;
}

const SEVERITY_STYLES: Record<string, string> = {
  info:     'bg-blue-50 text-blue-700 border border-blue-200',
  warning:  'bg-amber-50 text-amber-700 border border-amber-200',
  critical: 'bg-red-50 text-red-700 border border-red-200',
};

const SEVERITY_LABELS: Record<string, string> = {
  info:     'Info',
  warning:  'Alerta',
  critical: 'Critico',
};

const ACTION_COLORS: Record<string, string> = {
  INSERT: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-800',
  LOGIN: 'bg-emerald-100 text-emerald-800',
  LOGOUT: 'bg-gray-100 text-gray-700',
  FAILED_LOGIN: 'bg-amber-100 text-amber-800',
};

const PAGE_SIZE = 25;

function JsonViewer({ data, label }: { data: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  if (!data) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {label}
      </button>
      {open && (
        <pre className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-xs overflow-auto max-h-48 text-gray-700">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

const AdminAuditLog: React.FC = () => {
  const { permissions, isSuperAdmin } = useAuth();
  const canView = isSuperAdmin || permissions?.canViewAuditLog;
  const canViewSensitive = isSuperAdmin || permissions?.canViewAuditSensitiveData;
  const canExport = isSuperAdmin || permissions?.canExportAuditLog;

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    action: '',
    target_table: '',
    actor_email: '',
    correlation_id: '',
    date_from: '',
    date_to: '',
    severity: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const rpc = canViewSensitive ? 'get_audit_logs_sensitive' : 'get_audit_logs';
      const params: Record<string, unknown> = {
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      };
      if (appliedFilters.action) params.p_action = appliedFilters.action.toUpperCase();
      if (appliedFilters.target_table) params.p_target_table = appliedFilters.target_table;
      if (appliedFilters.actor_email) params.p_actor_email = appliedFilters.actor_email;
      if (appliedFilters.correlation_id) params.p_correlation_id = appliedFilters.correlation_id;
      if (appliedFilters.date_from) params.p_date_from = appliedFilters.date_from;
      if (appliedFilters.date_to) params.p_date_to = appliedFilters.date_to + 'T23:59:59';
      if (appliedFilters.severity) params.p_severity = appliedFilters.severity;

      const { data, error } = await supabase.rpc(rpc, params);
      if (error) throw error;
      const rows = (data as (AuditEntry & { total_count: number })[]) || [];
      setEntries(rows);
      setTotal(rows.length > 0 ? Number(rows[0].total_count) : 0);
    } catch (err) {
      console.error('Error cargando audit log:', err);
    } finally {
      setIsLoading(false);
    }
  }, [page, appliedFilters, canViewSensitive]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const applyFilters = () => {
    setPage(0);
    setAppliedFilters(filters);
  };

  const clearFilters = () => {
    const empty = { action: '', target_table: '', actor_email: '', correlation_id: '', date_from: '', date_to: '', severity: '' };
    setFilters(empty);
    setAppliedFilters(empty);
    setPage(0);
  };

  const handleExportCSV = async () => {
    if (!canExport) return;
    try {
      const rpc = canViewSensitive ? 'get_audit_logs_sensitive' : 'get_audit_logs';
      const params: Record<string, unknown> = { p_limit: 5000, p_offset: 0 };
      if (appliedFilters.action) params.p_action = appliedFilters.action.toUpperCase();
      if (appliedFilters.target_table) params.p_target_table = appliedFilters.target_table;
      if (appliedFilters.actor_email) params.p_actor_email = appliedFilters.actor_email;
      if (appliedFilters.date_from) params.p_date_from = appliedFilters.date_from;
      if (appliedFilters.date_to) params.p_date_to = appliedFilters.date_to + 'T23:59:59';
      if (appliedFilters.severity) params.p_severity = appliedFilters.severity;

      const { data } = await supabase.rpc(rpc, params);
      if (!data?.length) return;

      const cols = ['created_at', 'severity', 'action', 'target_table', 'target_id', 'actor_email', 'actor_role', 'ip_masked', 'country', 'country_code', 'city', 'correlation_id', 'error_message'];
      const header = cols.join(',');
      const rows = data.map((r: any) =>
        cols.map(c => JSON.stringify(r[c] ?? '')).join(',')
      );
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_log_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exportando:', err);
    }
  };

  if (!canView) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Acceso Denegado</h2>
          <p className="text-gray-600">No tienes permiso para ver el registro de auditoría.</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const activeFilterCount = Object.values(appliedFilters).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Registro de Auditoría</h1>
              <p className="text-sm text-gray-500">{total.toLocaleString()} eventos registrados</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchEntries}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Actualizar
            </button>
            {canExport && (
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700 transition-colors"
              >
                <Download className="w-4 h-4" />
                Exportar CSV
              </button>
            )}
          </div>
        </div>

        {/* Sensitive data notice */}
        {!canViewSensitive && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
            <Eye className="w-4 h-4 flex-shrink-0" />
            Vista estándar activa — IP real y user agent ocultos. Solicita permiso de datos sensibles para ver información completa.
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Filtros</span>
            {activeFilterCount > 0 && (
              <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{activeFilterCount}</span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <select
              value={filters.action}
              onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Todas las acciones</option>
              <optgroup label="Autenticacion">
                <option value="LOGIN">LOGIN</option>
                <option value="LOGOUT">LOGOUT</option>
                <option value="FAILED_LOGIN">FAILED_LOGIN</option>
              </optgroup>
              <optgroup label="Agencias">
                <option value="AGENCY_APPROVED">AGENCY_APPROVED</option>
                <option value="AGENCY_REJECTED">AGENCY_REJECTED</option>
                <option value="AGENCY_SUSPENDED">AGENCY_SUSPENDED</option>
                <option value="AGENCY_REACTIVATED">AGENCY_REACTIVATED</option>
                <option value="AGENCY_BANK_ACCOUNT_UPDATED">AGENCY_BANK_ACCOUNT_UPDATED</option>
              </optgroup>
              <optgroup label="Usuarios">
                <option value="USER_APPROVED">USER_APPROVED</option>
                <option value="USER_DEACTIVATED">USER_DEACTIVATED</option>
                <option value="USER_REACTIVATED">USER_REACTIVATED</option>
                <option value="ROLE_CHANGED">ROLE_CHANGED</option>
                <option value="EMAIL_CHANGED">EMAIL_CHANGED</option>
                <option value="SUPER_ADMIN_CHANGED">SUPER_ADMIN_CHANGED</option>
              </optgroup>
              <optgroup label="Reservas">
                <option value="BOOKING_CREATED">BOOKING_CREATED</option>
                <option value="BOOKING_CONFIRMED">BOOKING_CONFIRMED</option>
                <option value="BOOKING_CANCELLED">BOOKING_CANCELLED</option>
                <option value="BOOKING_COMPLETED">BOOKING_COMPLETED</option>
              </optgroup>
              <optgroup label="Pagos">
                <option value="PAYMENT_RECEIVED">PAYMENT_RECEIVED</option>
                <option value="PAYMENT_STATUS_CHANGED">PAYMENT_STATUS_CHANGED</option>
                <option value="PAYOUT_CREATED">PAYOUT_CREATED</option>
                <option value="PAYOUT_PAID">PAYOUT_PAID</option>
              </optgroup>
              <optgroup label="Permisos y config">
                <option value="ADMIN_PERMISSIONS_GRANTED">ADMIN_PERMISSIONS_GRANTED</option>
                <option value="ADMIN_PERMISSIONS_CHANGED">ADMIN_PERMISSIONS_CHANGED</option>
                <option value="ADMIN_PERMISSIONS_REVOKED">ADMIN_PERMISSIONS_REVOKED</option>
                <option value="COMMISSION_RATE_UPDATED">COMMISSION_RATE_UPDATED</option>
                <option value="PLATFORM_SETTINGS_UPDATED">PLATFORM_SETTINGS_UPDATED</option>
              </optgroup>
              <optgroup label="Genericos">
                <option value="INSERT">INSERT</option>
                <option value="UPDATE">UPDATE</option>
                <option value="DELETE">DELETE</option>
              </optgroup>
            </select>
            <select
              value={filters.severity}
              onChange={e => setFilters(f => ({ ...f, severity: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Toda severidad</option>
              <option value="info">Info</option>
              <option value="warning">Alerta</option>
              <option value="critical">Critico</option>
            </select>
            <input
              type="text"
              placeholder="Tabla..."
              value={filters.target_table}
              onChange={e => setFilters(f => ({ ...f, target_table: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              placeholder="Email del actor..."
              value={filters.actor_email}
              onChange={e => setFilters(f => ({ ...f, actor_email: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              placeholder="Correlation ID..."
              value={filters.correlation_id}
              onChange={e => setFilters(f => ({ ...f, correlation_id: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="date"
              value={filters.date_from}
              onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="date"
              value={filters.date_to}
              onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex justify-end gap-2 mt-3">
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors">
                <X className="w-3 h-3" /> Limpiar
              </button>
            )}
            <button
              onClick={applyFilters}
              className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Search className="w-4 h-4" />
              Buscar
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <p className="text-sm text-gray-500">Cargando eventos...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="py-16 text-center">
              <Shield className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No se encontraron eventos con los filtros aplicados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-40">Fecha / Hora</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Severidad</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Accion</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">Tabla</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actor</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-36">IP</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-36">Origen</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map(entry => (
                    <React.Fragment key={entry.id}>
                      <tr
                        className={`hover:bg-gray-50 transition-colors cursor-pointer ${expandedId === entry.id ? 'bg-blue-50' : ''}`}
                        onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                      >
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                          {format(new Date(entry.created_at), 'dd MMM yyyy HH:mm:ss', { locale: es })}
                        </td>
                        <td className="px-4 py-3">
                          {entry.severity && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${SEVERITY_STYLES[entry.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                              {SEVERITY_LABELS[entry.severity] ?? entry.severity}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${ACTION_COLORS[entry.action] ?? 'bg-gray-100 text-gray-700'}`}>
                            {entry.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700 font-mono">{entry.target_table}</td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-gray-800">{entry.actor_email ?? <span className="text-gray-400">sistema</span>}</div>
                          {entry.actor_role && <div className="text-xs text-gray-400">{entry.actor_role}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-gray-600">
                          {canViewSensitive
                            ? ((entry as any).ip_address ?? entry.ip_masked ?? '—')
                            : (entry.ip_masked ?? '—')}
                        </td>
                        <td className="px-4 py-3">
                          {entry.country ? (
                            <div className="flex items-center gap-1">
                              {entry.country_code && (
                                <img
                                  src={`https://flagcdn.com/16x12/${entry.country_code.toLowerCase()}.png`}
                                  alt={entry.country_code}
                                  className="w-4 h-3 object-cover rounded-sm flex-shrink-0"
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              )}
                              <div>
                                <div className="text-xs text-gray-700">{entry.country}</div>
                                {entry.city && <div className="text-xs text-gray-400">{entry.city}</div>}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-300 text-xs flex items-center gap-1">
                              <MapPin className="w-3 h-3" />—
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button className="text-blue-600 hover:text-blue-800">
                            {expandedId === entry.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </td>
                      </tr>
                      {expandedId === entry.id && (
                        <tr className="bg-blue-50">
                          <td colSpan={8} className="px-4 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                              <div>
                                <p className="font-semibold text-gray-700 mb-1">Identificadores</p>
                                <p className="text-gray-500">ID evento: <span className="font-mono text-gray-700">{entry.id.slice(0, 8)}…</span></p>
                                {entry.target_id && <p className="text-gray-500">Target ID: <span className="font-mono text-gray-700">{entry.target_id}</span></p>}
                                {entry.correlation_id && <p className="text-gray-500">Correlation: <span className="font-mono text-gray-700">{entry.correlation_id}</span></p>}
                                {entry.session_id && <p className="text-gray-500">Session: <span className="font-mono text-gray-700">{entry.session_id.slice(0, 16)}…</span></p>}
                              </div>
                              {canViewSensitive && (entry as any).user_agent && (
                                <div>
                                  <p className="font-semibold text-gray-700 mb-1">User Agent</p>
                                  <p className="text-gray-600 break-all">{(entry as any).user_agent}</p>
                                </div>
                              )}
                              {entry.error_message && (
                                <div className="col-span-full">
                                  <p className="font-semibold text-red-700 mb-1">Error</p>
                                  <p className="text-red-600">{entry.error_message}</p>
                                </div>
                              )}
                              <div className="col-span-full grid grid-cols-1 md:grid-cols-3 gap-3">
                                <JsonViewer data={entry.old_values} label="Valores anteriores" />
                                <JsonViewer data={entry.new_values} label="Valores nuevos" />
                                <JsonViewer data={entry.diff} label="Diferencia" />
                              </div>
                              {entry.metadata && (
                                <div className="col-span-full">
                                  <JsonViewer data={entry.metadata} label="Metadata" />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
              <p className="text-xs text-gray-500">
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total.toLocaleString()} eventos
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-white disabled:opacity-40 transition-colors"
                >
                  Anterior
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const windowStart = Math.max(0, Math.min(page - 2, totalPages - 5));
                  const p = windowStart + i;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`px-3 py-1 text-xs border rounded transition-colors ${p === page ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-white'}`}
                    >
                      {p + 1}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-white disabled:opacity-40 transition-colors"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminAuditLog;