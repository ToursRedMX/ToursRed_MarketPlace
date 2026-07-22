import React, { useState, useEffect, useCallback } from 'react';
import {
  Trash2, RefreshCw, AlertTriangle, CheckSquare, Square,
  Calendar, User, Building2, ShoppingBag, Clock, FileText,
  ChevronDown, ChevronUp, Info, CheckCircle, Banknote
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';
import { differenceInDays, parseISO, format } from 'date-fns';
import { es } from 'date-fns/locale';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GarbageBooking {
  id: string;
  booking_code: string | null;
  created_at: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  total_price: number;
  travelers_count: number;
  user_name: string;
  user_email: string;
  tour_name: string;
  agency_name: string;
  reason: string;
}

type SortField = 'created_at' | 'days_old' | 'total_price' | 'type';
type SortDir = 'asc' | 'desc';

const THRESHOLD_OPTIONS = [7, 14, 30];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBookingType(reason: string): { label: string; cls: string } {
  if (reason === 'abandoned')
    return { label: 'Nunca pagada / pendiente', cls: 'bg-amber-100 text-amber-800' };
  if (reason === 'unconfirmed_transfer')
    return { label: 'Transferencia sin confirmar', cls: 'bg-orange-100 text-orange-800' };
  if (reason === 'expired_processing')
    return { label: 'Pago en proceso expirado', cls: 'bg-red-100 text-red-800' };
  return { label: 'Cancelada sin pago', cls: 'bg-red-100 text-red-800' };
}

function isDeletable(b: GarbageBooking): boolean {
  return b.payment_status === 'pending' || b.payment_status === 'processing';
}

// ─── Component ────────────────────────────────────────────────────────────────

const AdminBookingsCleanup: React.FC = () => {
  const [bookings, setBookings] = useState<GarbageBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState(7);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<{ count: number; at: string } | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ id: string; deleted_count: number; deleted_at: string; criteria: string }[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());

    const { data, error } = await supabase
      .rpc('get_garbage_bookings', { threshold_days: threshold });

    if (error) {
      console.error('Error fetching garbage bookings:', error);
      setBookings([]);
      setLoading(false);
      return;
    }

    setBookings(data ?? []);
    setLoading(false);
  }, [threshold]);

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from('booking_cleanup_logs')
      .select('id, deleted_count, deleted_at, criteria')
      .order('deleted_at', { ascending: false })
      .limit(10);
    if (data) {
      setLogs(data);
      if (data.length > 0) setLastCleanup({ count: data[0].deleted_count, at: data[0].deleted_at });
    }
  }, []);

  useEffect(() => {
    fetchBookings();
    fetchLogs();
  }, [fetchBookings, fetchLogs]);

  // ─── Sort ──────────────────────────────────────────────────────────────────

  const sorted = [...bookings].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'created_at') {
      cmp = a.created_at.localeCompare(b.created_at);
    } else if (sortField === 'days_old') {
      cmp = differenceInDays(new Date(), parseISO(a.created_at)) -
            differenceInDays(new Date(), parseISO(b.created_at));
    } else if (sortField === 'total_price') {
      cmp = a.total_price - b.total_price;
    } else if (sortField === 'type') {
      cmp = a.reason.localeCompare(b.reason);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) =>
    sortField === field
      ? sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      : <ChevronDown className="h-3 w-3 text-gray-300" />;

  // ─── Selection ─────────────────────────────────────────────────────────────

  const allSelected = sorted.length > 0 && sorted.every(b => selected.has(b.id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map(b => b.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ─── Delete ────────────────────────────────────────────────────────────────

  const targetIds = selected.size > 0 ? [...selected] : bookings.map(b => b.id);
  const targetBookings = bookings.filter(b => targetIds.includes(b.id));

  const handleDelete = async () => {
    if (confirmText !== 'CONFIRMAR') return;
    setDeleting(true);

    const safeIds = targetBookings.filter(isDeletable).map(b => b.id);
    const codes = targetBookings.filter(isDeletable).map(b => b.booking_code ?? b.id);

    if (safeIds.length === 0) {
      setDeleting(false);
      setShowConfirm(false);
      return;
    }

    // Eliminar en tres lotes segun payment_status para respetar la policy
    const pendingIds = targetBookings
      .filter(b => b.payment_status === 'pending')
      .map(b => b.id)
      .filter(id => safeIds.includes(id));

    const transferIds = targetBookings
      .filter(b => b.payment_status === 'processing' && b.payment_method === 'Transferencia Bancaria')
      .map(b => b.id)
      .filter(id => safeIds.includes(id));

    const expiredProcessingIds = targetBookings
      .filter(b => b.payment_status === 'processing' && b.payment_method !== 'Transferencia Bancaria')
      .map(b => b.id)
      .filter(id => safeIds.includes(id));

    let totalDeleted = 0;
    let hasError = false;

    if (pendingIds.length > 0) {
      const { error } = await supabase
        .from('bookings')
        .delete()
        .in('id', pendingIds)
        .eq('payment_status', 'pending');
      if (!error) totalDeleted += pendingIds.length;
      else hasError = true;
    }

    if (transferIds.length > 0) {
      const { error } = await supabase
        .from('bookings')
        .delete()
        .in('id', transferIds)
        .eq('payment_status', 'processing')
        .eq('payment_method', 'Transferencia Bancaria');
      if (!error) totalDeleted += transferIds.length;
      else hasError = true;
    }

    if (expiredProcessingIds.length > 0) {
      const { error } = await supabase
        .from('bookings')
        .delete()
        .in('id', expiredProcessingIds)
        .eq('payment_status', 'processing')
        .neq('payment_method', 'Transferencia Bancaria');
      if (!error) totalDeleted += expiredProcessingIds.length;
      else hasError = true;
    }

    if (!hasError && totalDeleted > 0) {
      const criteria = `payment_status IN (pending, processing/bank_transfer, processing/expired-3d), status IN (pending,cancelled), antiguedad > ${threshold} dias`;
      await supabase.from('booking_cleanup_logs').insert({
        deleted_count: totalDeleted,
        deleted_by: (await supabase.auth.getUser()).data.user?.id,
        criteria,
        booking_codes: codes,
      });

      setSuccessMsg(`Se eliminaron ${totalDeleted} reserva(s) correctamente.`);
      setTimeout(() => setSuccessMsg(null), 5000);
      fetchBookings();
      fetchLogs();
    }

    setDeleting(false);
    setShowConfirm(false);
    setConfirmText('');
    setSelected(new Set());
  };

  // ─── Stats ─────────────────────────────────────────────────────────────────

  const countAbandoned = bookings.filter(b => b.reason === 'abandoned').length;
  const countTransfer = bookings.filter(b => b.reason === 'unconfirmed_transfer').length;
  const countExpiredProcessing = bookings.filter(b => b.reason === 'expired_processing').length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-red-100 rounded-lg">
              <Trash2 className="h-5 w-5 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Limpieza de Reservas Basura</h1>
          </div>
          <p className="text-sm text-gray-500 ml-14">
            Reservas sin pago completado que nunca se finalizaron. Eliminarlas es seguro y no afecta ningun dato financiero.
          </p>
        </div>

        {/* Alert info */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 mb-6">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 space-y-1">
            <p>
              <span className="font-semibold">Se detectan tres tipos de reservas basura:</span>
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700">
              <li>
                <code className="bg-amber-100 px-1 rounded">payment_status = pending</code> con mas de{' '}
                <span className="font-semibold">{threshold} dias</span> — nunca iniciaron el pago
              </li>
              <li>
                <code className="bg-amber-100 px-1 rounded">Transferencia Bancaria</code> en proceso con mas de{' '}
                <span className="font-semibold">{threshold} dias</span> — deposito nunca llego
              </li>
              <li>
                <code className="bg-amber-100 px-1 rounded">OXXO u otro metodo</code> en proceso con mas de{' '}
                <span className="font-semibold">3 dias</span> — voucher expirado (OXXO vence en 72 h)
              </li>
            </ul>
            <p className="text-xs text-amber-600 mt-1">
              Las reservas con pago confirmado (<code className="bg-amber-100 px-1 rounded">succeeded</code>) nunca son afectadas.
            </p>
          </div>
        </div>

        {/* Success message */}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex gap-3 mb-6 animate-fade-in">
            <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
            <p className="text-sm text-green-800 font-medium">{successMsg}</p>
          </div>
        )}

        {/* Controls */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">Umbral de antiguedad:</span>
              <div className="flex gap-1">
                {THRESHOLD_OPTIONS.map(d => (
                  <button
                    key={d}
                    onClick={() => setThreshold(d)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      threshold === d
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {d} dias
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {lastCleanup && (
                <span className="text-xs text-gray-400">
                  Ultima limpieza: {format(parseISO(lastCleanup.at), "d MMM yyyy HH:mm", { locale: es })}
                  {' '}({lastCleanup.count} eliminadas)
                </span>
              )}
              <button
                onClick={fetchBookings}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          {[
            {
              label: 'Total basura',
              value: bookings.length,
              icon: <Trash2 className="h-5 w-5 text-red-500" />,
              cls: 'bg-red-50 border-red-100',
            },
            {
              label: 'Nunca pagadas',
              value: countAbandoned,
              icon: <Clock className="h-5 w-5 text-amber-500" />,
              cls: 'bg-amber-50 border-amber-100',
            },
            {
              label: 'Transferencia sin confirmar',
              value: countTransfer,
              icon: <Banknote className="h-5 w-5 text-orange-500" />,
              cls: 'bg-orange-50 border-orange-100',
            },
            {
              label: 'Pago expirado (OXXO/otro)',
              value: countExpiredProcessing,
              icon: <AlertTriangle className="h-5 w-5 text-red-500" />,
              cls: 'bg-red-50 border-red-100',
            },
            {
              label: 'Seleccionadas',
              value: selected.size,
              icon: <CheckSquare className="h-5 w-5 text-blue-500" />,
              cls: 'bg-blue-50 border-blue-100',
            },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border p-4 ${s.cls}`}>
              <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs text-gray-500">{s.label}</span></div>
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Action bar */}
        {bookings.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              {selected.size > 0
                ? <><span className="font-semibold text-gray-900">{selected.size}</span> reservas seleccionadas</>
                : <><span className="font-semibold text-gray-900">{bookings.length}</span> reservas basura encontradas</>
              }
            </p>
            <div className="flex gap-2">
              {selected.size > 0 && (
                <button
                  onClick={() => setSelected(new Set())}
                  className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Deseleccionar todo
                </button>
              )}
              <button
                onClick={() => { setShowConfirm(true); setConfirmText(''); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                {selected.size > 0
                  ? `Eliminar ${selected.size} seleccionada(s)`
                  : `Eliminar todas (${bookings.length})`
                }
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : bookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <CheckCircle className="h-12 w-12 text-green-400" />
              <p className="text-gray-500 font-medium">No hay reservas basura con mas de {threshold} dias</p>
              <p className="text-sm text-gray-400">La base de datos esta limpia para este umbral</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left w-10">
                      <button onClick={toggleAll} className="text-gray-400 hover:text-gray-700">
                        {allSelected
                          ? <CheckSquare className="h-4 w-4 text-blue-600" />
                          : <Square className="h-4 w-4" />
                        }
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Folio</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      <button onClick={() => toggleSort('type')} className="flex items-center gap-1">
                        Tipo <SortIcon field="type" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      <div className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> Viajero</div>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      <div className="flex items-center gap-1"><ShoppingBag className="h-3.5 w-3.5" /> Tour</div>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      <div className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> Agencia</div>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      <button onClick={() => toggleSort('created_at')} className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" /> Fecha <SortIcon field="created_at" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      <button onClick={() => toggleSort('days_old')} className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> Dias <SortIcon field="days_old" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">
                      <button onClick={() => toggleSort('total_price')} className="flex items-center gap-1 ml-auto">
                        Total <SortIcon field="total_price" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sorted.map(b => {
                    const type = getBookingType(b.reason);
                    const days = differenceInDays(new Date(), parseISO(b.created_at));
                    const isSelected = selected.has(b.id);
                    return (
                      <tr
                        key={b.id}
                        onClick={() => toggleOne(b.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-4 py-3">
                          {isSelected
                            ? <CheckSquare className="h-4 w-4 text-blue-600" />
                            : <Square className="h-4 w-4 text-gray-300" />
                          }
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                            {b.booking_code ?? b.id.slice(0, 8)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${type.cls}`}>
                            {type.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800 truncate max-w-[140px]">{b.user_name}</p>
                          <p className="text-xs text-gray-400 truncate max-w-[140px]">{b.user_email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-700 truncate max-w-[160px]">{b.tour_name}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-600 truncate max-w-[120px]">{b.agency_name}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {format(parseISO(b.created_at), "d MMM yyyy", { locale: es })}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                            days >= 30 ? 'bg-red-100 text-red-700'
                            : days >= 14 ? 'bg-amber-100 text-amber-700'
                            : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            <Clock className="h-3 w-3" />
                            {days}d
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-700">
                          {formatCurrencyMXN(b.total_price)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Cleanup logs */}
        {logs.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => setShowLogs(v => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-400" />
                Historial de limpiezas ({logs.length})
              </div>
              {showLogs ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>
            {showLogs && (
              <div className="border-t border-gray-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">Fecha</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">Reservas eliminadas</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">Criterio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {logs.map(log => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                          {format(parseISO(log.deleted_at), "d MMM yyyy HH:mm", { locale: es })}
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-semibold text-red-700">{log.deleted_count}</span>
                          <span className="text-gray-400 text-xs ml-1">reservas</span>
                        </td>
                        <td className="px-5 py-3 text-gray-500 text-xs">{log.criteria}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Confirmar eliminacion</h2>
            </div>

            <div className="bg-red-50 border border-red-100 rounded-lg p-4 mb-5">
              <p className="text-sm text-red-800">
                Esta accion es <span className="font-bold">irreversible</span>. Se eliminaran permanentemente{' '}
                <span className="font-bold">{targetIds.length}</span> reserva(s) sin pago confirmado.
              </p>
              <p className="text-xs text-red-600 mt-2">
                Solo se eliminan reservas con pago pendiente o transferencias sin confirmar.
                Las reservas pagadas (<code className="bg-red-100 px-1 rounded">succeeded</code>) nunca son afectadas.
              </p>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Escribe <span className="font-bold text-red-600">CONFIRMAR</span> para continuar
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="CONFIRMAR"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowConfirm(false); setConfirmText(''); }}
                disabled={deleting}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={confirmText !== 'CONFIRMAR' || deleting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deleting ? 'Eliminando...' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminBookingsCleanup;
