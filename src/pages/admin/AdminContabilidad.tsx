import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, RefreshCw, AlertCircle, CheckCircle, Clock, SkipForward, Search,
  RotateCcw, TrendingUp, Users, FileText, DollarSign, Loader, ChevronDown,
  ChevronUp, Upload, Building2, CreditCard, Play
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface SyncLogEntry {
  id: string;
  provider: string;
  record_type: string;
  record_id: string;
  external_entity_type?: string;
  external_entity_id?: string;
  status: 'pending' | 'synced' | 'error' | 'skipped';
  error_message?: string;
  synced_at?: string;
  retry_count: number;
  payload_summary?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface SyncStats {
  provider: string;
  total_synced: number;
  total_pending: number;
  total_errors: number;
  total_skipped: number;
  contacts_synced: number;
  bookings_synced: number;
  payouts_synced: number;
  last_sync_at?: string;
}

interface BulkSyncProgress {
  type: string;
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  running: boolean;
  errors: { id: string; message: string }[];
}

const RECORD_TYPE_LABELS: Record<string, string> = {
  contact_agency: 'Agencia',
  contact_traveler: 'Viajero',
  booking: 'Reserva',
  payout: 'Pago a Agencia',
  commission: 'Comision',
  journal_entry: 'Asiento Contable',
  gift_card: 'Tarjeta de Regalo',
};

const PROVIDER_LABELS: Record<string, string> = {
  zoho_books: 'Zoho Books',
  odoo: 'Odoo',
  quickbooks: 'QuickBooks',
  contpaqi_cloud: 'Contpaqi Cloud',
  none: 'Sin proveedor',
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    synced: 'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
    skipped: 'bg-gray-100 text-gray-600',
  };
  const icons: Record<string, React.ReactNode> = {
    synced: <CheckCircle className="w-3 h-3" />,
    pending: <Clock className="w-3 h-3" />,
    error: <AlertCircle className="w-3 h-3" />,
    skipped: <SkipForward className="w-3 h-3" />,
  };
  const labels: Record<string, string> = {
    synced: 'Sincronizado',
    pending: 'Pendiente',
    error: 'Error',
    skipped: 'Omitido',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {icons[status]}
      {labels[status] || status}
    </span>
  );
};

const AdminContabilidad: React.FC = () => {
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [stats, setStats] = useState<SyncStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ healthy: boolean; provider?: string; error?: string } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [currentProvider, setCurrentProvider] = useState<string>('none');
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [bulkProgress, setBulkProgress] = useState<BulkSyncProgress | null>(null);
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const [travelersWithRfcCount, setTravelersWithRfcCount] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [logsResult, statsResult, settingsResult, travelersRfcResult] = await Promise.all([
        supabase
          .from('accounting_sync_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.rpc('get_accounting_sync_stats'),
        supabase.from('platform_settings').select('accounting_provider, accounting_sync_enabled').maybeSingle(),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'traveler').not('rfc', 'is', null),
      ]);

      if (logsResult.data) setLogs(logsResult.data);
      if (statsResult.data) setStats(statsResult.data);
      if (settingsResult.data) {
        setCurrentProvider(settingsResult.data.accounting_provider || 'none');
        setSyncEnabled(settingsResult.data.accounting_sync_enabled || false);
      }
      setTravelersWithRfcCount(travelersRfcResult.count ?? 0);
    } catch (err) {
      console.error('Error fetching accounting data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 6000);
  };

  const handleHealthCheck = async () => {
    setIsCheckingHealth(true);
    setHealthStatus(null);
    try {
      const { data, error } = await supabase.functions.invoke('sync-to-accounting', {
        body: { action: 'health_check' },
      });
      if (error) throw error;
      setHealthStatus(data);
    } catch (err: any) {
      setHealthStatus({ healthy: false, error: err.message });
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const handleRetryErrors = async () => {
    if (!confirm('Reintentar todos los registros con error (hasta 5 intentos previos)? Esto puede tomar unos segundos.')) return;
    setIsRetrying(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-to-accounting', {
        body: { action: 'retry_errors' },
      });
      if (error) throw error;
      showMessage('success', `Reintento completado: ${data.succeeded} exitosos, ${data.failed} fallidos de ${data.retried} total`);
      await fetchData();
    } catch (err: any) {
      showMessage('error', `Error al reintentar: ${err.message}`);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleRetryOne = async (entry: SyncLogEntry) => {
    try {
      const action = entry.record_type.startsWith('contact') ? 'sync_contact' :
        entry.record_type === 'booking' ? 'sync_invoice' :
        entry.record_type === 'payout' ? 'sync_bill' : 'sync_payment';

      await supabase.functions.invoke('sync-to-accounting', {
        body: { action, record_type: entry.record_type, record_id: entry.record_id },
      });
      showMessage('success', 'Reintento enviado');
      await fetchData();
    } catch (err: any) {
      showMessage('error', `Error: ${err.message}`);
    }
  };

  const handleBulkSync = async (type: 'agencies' | 'travelers' | 'bookings' | 'payouts') => {
    if (!confirm(`Iniciar sincronizacion masiva de ${BULK_LABELS[type]}? Este proceso puede tardar varios minutos.`)) return;

    let records: { id: string }[] = [];

    if (type === 'agencies') {
      const { data } = await supabase
        .from('agencies')
        .select('id')
        .eq('is_active', true);
      records = data || [];
    } else if (type === 'travelers') {
      const { data } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'traveler')
        .not('rfc', 'is', null);
      records = data || [];
    } else if (type === 'bookings') {
      const { data } = await supabase
        .from('bookings')
        .select('id')
        .eq('status', 'confirmed');
      records = data || [];
    } else if (type === 'payouts') {
      const { data } = await supabase
        .from('agency_payouts')
        .select('id')
        .eq('status', 'completed');
      records = data || [];
    }

    if (records.length === 0) {
      showMessage('error', 'No se encontraron registros para sincronizar.');
      return;
    }

    setBulkProgress({ type, total: records.length, done: 0, succeeded: 0, failed: 0, running: true, errors: [] });

    let succeeded = 0;
    let failed = 0;
    const errors: { id: string; message: string }[] = [];

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      try {
        let res: { data: any; error: any };
        if (type === 'agencies') {
          res = await supabase.functions.invoke('sync-contact-to-accounting', {
            body: { contact_type: 'agency', contact_id: rec.id },
          });
        } else if (type === 'travelers') {
          res = await supabase.functions.invoke('sync-contact-to-accounting', {
            body: { contact_type: 'traveler', contact_id: rec.id },
          });
        } else if (type === 'bookings') {
          res = await supabase.functions.invoke('sync-booking-to-accounting', {
            body: { booking_id: rec.id },
          });
        } else {
          res = await supabase.functions.invoke('sync-payout-to-accounting', {
            body: { payout_id: rec.id },
          });
        }
        const errMsg = res.error?.message || res.data?.error;
        if (errMsg) {
          errors.push({ id: rec.id, message: String(errMsg) });
          failed++;
        } else {
          succeeded++;
        }
      } catch (err: any) {
        errors.push({ id: rec.id, message: err?.message || String(err) });
        failed++;
      }
      setBulkProgress({ type, total: records.length, done: i + 1, succeeded, failed, running: i + 1 < records.length, errors: [...errors] });
    }

    await fetchData();
    const msg = failed > 0
      ? `Completado: ${succeeded} exitosos, ${failed} con error de ${records.length} total.`
      : `Completado: ${succeeded} de ${records.length} sincronizados correctamente.`;
    showMessage(failed > 0 ? 'error' : 'success', msg);
  };

  const BULK_LABELS: Record<string, string> = {
    agencies: 'Agencias',
    travelers: 'Viajeros con RFC',
    bookings: 'Reservas confirmadas',
    payouts: 'Pagos a agencias',
  };

  const filteredLogs = logs.filter((l) => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false;
    if (filterType !== 'all' && l.record_type !== filterType) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        l.record_id.toLowerCase().includes(s) ||
        l.external_entity_id?.toLowerCase().includes(s) ||
        l.record_type.toLowerCase().includes(s) ||
        l.error_message?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const currentStats = stats.find((s) => s.provider === currentProvider);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Integracion Contable</h1>
          <p className="text-gray-600 mt-1">
            Monitor de sincronizacion con{' '}
            <span className="font-medium text-blue-700">{PROVIDER_LABELS[currentProvider] || currentProvider}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {currentProvider !== 'none' && syncEnabled && (
            <button
              onClick={() => setShowBulkPanel(!showBulkPanel)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              <Upload className="w-4 h-4" />
              Sincronizacion Masiva
            </button>
          )}
          <button
            onClick={handleHealthCheck}
            disabled={isCheckingHealth || currentProvider === 'none'}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm"
          >
            {isCheckingHealth ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Verificar Conexion
          </button>
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`mb-4 p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      {/* Health status */}
      {healthStatus && (
        <div className={`mb-4 p-4 rounded-lg flex items-center gap-3 ${healthStatus.healthy ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {healthStatus.healthy ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <div className="text-sm">
            {healthStatus.healthy
              ? `Conexion exitosa con ${PROVIDER_LABELS[healthStatus.provider || ''] || healthStatus.provider}`
              : `Sin conexion: ${healthStatus.error || 'Error desconocido'}`}
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-3 mb-6 p-4 bg-white rounded-lg border border-gray-200">
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${currentProvider === 'none' ? 'bg-gray-300' : syncEnabled ? 'bg-green-500 animate-pulse' : 'bg-amber-400'}`} />
        <div className="text-sm text-gray-700">
          {currentProvider === 'none'
            ? 'No hay proveedor contable configurado. Ve a Configuracion → Integracion Contable para activar.'
            : syncEnabled
            ? `Sincronizacion activa con ${PROVIDER_LABELS[currentProvider]}. Los nuevos registros se sincronizan automaticamente.`
            : `Proveedor ${PROVIDER_LABELS[currentProvider]} configurado pero sincronizacion desactivada. Activa el toggle en Configuracion.`}
        </div>
        {currentProvider === 'none' && (
          <a href="/admin/settings#contabilidad" className="ml-auto text-xs text-blue-600 hover:text-blue-700 underline whitespace-nowrap">
            Ir a Configuracion
          </a>
        )}
      </div>

      {/* Bulk sync panel */}
      {showBulkPanel && (
        <div className="mb-6 bg-white rounded-lg border border-blue-200 overflow-hidden">
          <div className="px-5 py-4 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-blue-900 flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Sincronizacion Masiva Inicial
              </h2>
              <p className="text-xs text-blue-700 mt-0.5">
                Usa esto para enviar registros existentes a {PROVIDER_LABELS[currentProvider]} por primera vez.
                Los registros ya sincronizados seran omitidos automaticamente.
              </p>
            </div>
            <button onClick={() => setShowBulkPanel(false)} className="text-blue-400 hover:text-blue-600 text-lg leading-none ml-4">×</button>
          </div>
          <div className="p-5">
            {bulkProgress && (
              <div className={`mb-4 p-4 rounded-lg border ${bulkProgress.running ? 'bg-amber-50 border-amber-200' : bulkProgress.failed > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <div className="flex items-center gap-3 mb-2">
                  {bulkProgress.running
                    ? <Loader className="w-4 h-4 animate-spin text-amber-600 flex-shrink-0" />
                    : bulkProgress.failed > 0
                    ? <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    : <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />}
                  <span className={`text-sm font-medium ${bulkProgress.running ? 'text-amber-800' : bulkProgress.failed > 0 ? 'text-red-800' : 'text-green-800'}`}>
                    {bulkProgress.running
                      ? `Sincronizando ${BULK_LABELS[bulkProgress.type]}... (${bulkProgress.done}/${bulkProgress.total})`
                      : `${BULK_LABELS[bulkProgress.type]}: ${bulkProgress.succeeded} exitosos, ${bulkProgress.failed} con error`}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                  <div
                    className={`h-2 rounded-full transition-all ${bulkProgress.running ? 'bg-amber-500' : bulkProgress.failed > 0 ? 'bg-red-500' : 'bg-green-500'}`}
                    style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                  />
                </div>
                <div className="flex gap-4 text-xs text-gray-600">
                  <span className="text-green-700 font-medium">{bulkProgress.succeeded} exitosos</span>
                  {bulkProgress.failed > 0 && <span className="text-red-600 font-medium">{bulkProgress.failed} con error</span>}
                  {bulkProgress.running && <span>{bulkProgress.total - bulkProgress.done} restantes</span>}
                </div>
                {bulkProgress.errors.length > 0 && (
                  <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                    <p className="text-xs font-semibold text-red-700 mb-1">Detalle de errores:</p>
                    {bulkProgress.errors.map((e, idx) => (
                      <div key={idx} className="text-xs bg-red-100 border border-red-200 rounded px-2 py-1 font-mono break-all">
                        <span className="text-gray-500 mr-2">{e.id.slice(0, 8)}...</span>
                        <span className="text-red-700">{e.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: 'agencies', icon: <Building2 className="w-5 h-5 text-blue-600" />, label: 'Agencias activas', desc: `Crea proveedores en ${PROVIDER_LABELS[currentProvider] || currentProvider} por cada agencia aprobada` },
                { key: 'travelers', icon: <Users className="w-5 h-5 text-green-600" />, label: 'Viajeros con RFC', desc: `Crea clientes en ${PROVIDER_LABELS[currentProvider] || currentProvider} para viajeros con datos fiscales${travelersWithRfcCount !== null ? ` (${travelersWithRfcCount} viajero${travelersWithRfcCount !== 1 ? 's' : ''} con RFC)` : ''}` },
                { key: 'bookings', icon: <FileText className="w-5 h-5 text-amber-600" />, label: 'Reservas confirmadas', desc: 'Crea facturas de ingreso por cada reserva pagada' },
                { key: 'payouts', icon: <CreditCard className="w-5 h-5 text-rose-600" />, label: 'Pagos a agencias', desc: 'Crea facturas de proveedor por cada pago procesado' },
              ].map(({ key, icon, label, desc }) => (
                <div key={key} className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <div className="mt-0.5">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                  <button
                    onClick={() => handleBulkSync(key as 'agencies' | 'travelers' | 'bookings' | 'payouts')}
                    disabled={bulkProgress?.running}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-md hover:bg-gray-700 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Play className="w-3 h-3" />
                    Sincronizar
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Nota: Este proceso es seguro de ejecutar multiples veces. Los registros ya sincronizados no se duplican en {PROVIDER_LABELS[currentProvider]}.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      {currentStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-sm font-medium text-gray-600">Sincronizados</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{currentStats.total_synced.toLocaleString()}</p>
            {currentStats.last_sync_at && (
              <p className="text-xs text-gray-400 mt-1">
                Ultimo: {new Date(currentStats.last_sync_at).toLocaleString('es-MX')}
              </p>
            )}
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <span className="text-sm font-medium text-gray-600">Errores</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{currentStats.total_errors.toLocaleString()}</p>
            {currentStats.total_errors > 0 && (
              <button
                onClick={handleRetryErrors}
                disabled={isRetrying}
                className="text-xs text-blue-600 hover:text-blue-700 mt-1 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                {isRetrying ? 'Reintentando...' : 'Reintentar todos'}
              </button>
            )}
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-blue-500" />
              <span className="text-sm font-medium text-gray-600">Contactos</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{currentStats.contacts_synced.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">Agencias + viajeros</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-amber-500" />
              <span className="text-sm font-medium text-gray-600">Facturas</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{(currentStats.bookings_synced + currentStats.payouts_synced).toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">Reservas + pagos</p>
          </div>
        </div>
      )}

      {/* Log table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-gray-500" />
            Historial de Sincronizacion
            <span className="text-sm font-normal text-gray-500">({filteredLogs.length} registros)</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 w-48"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">Todos los estados</option>
              <option value="synced">Sincronizados</option>
              <option value="error">Con error</option>
              <option value="pending">Pendientes</option>
              <option value="skipped">Omitidos</option>
            </select>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">Todos los tipos</option>
              {Object.entries(RECORD_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-700">Sin registros de sincronizacion</p>
            {currentProvider !== 'none' && syncEnabled ? (
              <p className="text-sm mt-2 text-gray-500 max-w-sm mx-auto">
                Los registros apareceran aqui cuando se sincronicen datos.
                Usa el boton <strong>Sincronizacion Masiva</strong> para cargar datos existentes.
              </p>
            ) : (
              <p className="text-sm mt-1">Configura un proveedor contable y activa la sincronizacion para comenzar.</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredLogs.map((entry) => (
              <div key={entry.id} className="hover:bg-gray-50 transition-colors">
                <div
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpandedRow(expandedRow === entry.id ? null : entry.id)}
                >
                  <StatusBadge status={entry.status} />
                  <span className="text-xs font-medium text-gray-600 w-28 flex-shrink-0">
                    {RECORD_TYPE_LABELS[entry.record_type] || entry.record_type}
                  </span>
                  <span className="font-mono text-xs text-gray-500 truncate flex-1">
                    {entry.record_id}
                  </span>
                  {entry.external_entity_id && (
                    <span className="font-mono text-xs text-blue-600 truncate hidden md:block w-32">
                      → {entry.external_entity_id}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 hidden sm:block flex-shrink-0">
                    {new Date(entry.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {entry.retry_count > 0 && (
                    <span className="text-xs text-amber-600 flex-shrink-0">{entry.retry_count} reintentos</span>
                  )}
                  {entry.status === 'error' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRetryOne(entry); }}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 flex-shrink-0"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reintentar
                    </button>
                  )}
                  {expandedRow === entry.id
                    ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                </div>
                {expandedRow === entry.id && (
                  <div className="px-4 pb-3 pt-0 bg-gray-50 text-xs space-y-1.5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <span className="text-gray-400 block">Proveedor</span>
                        <span className="font-medium">{PROVIDER_LABELS[entry.provider] || entry.provider}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 block">Tipo externo</span>
                        <span className="font-medium">{entry.external_entity_type || '—'}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 block">ID externo</span>
                        <span className="font-mono">{entry.external_entity_id || '—'}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 block">Sincronizado a las</span>
                        <span className="font-medium">{entry.synced_at ? new Date(entry.synced_at).toLocaleString('es-MX') : '—'}</span>
                      </div>
                    </div>
                    {entry.error_message && (
                      <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-700 font-mono break-all">
                        {entry.error_message}
                      </div>
                    )}
                    {entry.payload_summary && (
                      <div className="mt-2 p-2 bg-gray-100 rounded font-mono text-gray-600 break-all">
                        {JSON.stringify(entry.payload_summary)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="mt-6 p-5 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <BookOpen className="w-4 h-4" />
          Que se sincroniza automaticamente
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
            <span>Agencias aprobadas → Contactos (Proveedor) en {PROVIDER_LABELS[currentProvider]}</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
            <span>Viajeros con RFC → Contactos (Cliente) en {PROVIDER_LABELS[currentProvider]}</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
            <span>Reservas confirmadas → Facturas de ingreso en {PROVIDER_LABELS[currentProvider]}</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
            <span>Pagos a agencias → Facturas de proveedor + Pagos en {PROVIDER_LABELS[currentProvider]}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminContabilidad;
