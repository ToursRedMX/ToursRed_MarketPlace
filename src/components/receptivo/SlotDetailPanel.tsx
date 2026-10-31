import React, { useEffect, useState } from 'react';
import { X, Clock, CreditCard as Edit2, Ban, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { TourSlot, SlotStatus } from '../../types';
import { mensajeDeError } from '../../lib/errores';
import { OPCIONES_DE_VEHICULO, cuposSugeridos, evaluarCapacidad, mapaEfectivo, opcionDeVehiculo } from '../../lib/mapaDeAsientos';

interface SlotDetailPanelProps {
  tourId: string;
  agencyId: string;
  dateKey: string;
  slots: TourSlot[];
  onClose: () => void;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<SlotStatus, string> = {
  activo: 'Activo',
  lleno: 'Lleno',
  bloqueado: 'Bloqueado',
  cancelado: 'Cancelado',
  completado: 'Completado',
};

const STATUS_COLORS: Record<SlotStatus, string> = {
  activo: 'bg-green-100 text-green-700',
  lleno: 'bg-red-100 text-red-600',
  bloqueado: 'bg-orange-100 text-orange-600',
  cancelado: 'bg-gray-100 text-gray-500',
  completado: 'bg-blue-100 text-blue-600',
};

const SlotDetailPanel: React.FC<SlotDetailPanelProps> = ({ tourId, dateKey, slots, onClose, onRefresh }) => {
  // Vehiculo por horario: el RPC de horarios no trae `vehicle_map_type`, asi que se lee aparte. Un horario sin vehiculo propio usa el del tour.
  const [tourMap, setTourMap] = useState<string | null>(null);
  const [slotMaps, setSlotMaps] = useState<Record<string, string | null>>({});
  const [mapaVersion, setMapaVersion] = useState(0);
  const [editingMap, setEditingMap] = useState<string | null>(null);
  const [newMap, setNewMap] = useState('');
  const [newMapCupos, setNewMapCupos] = useState('');
  const idsKey = slots.map(s => s.id).join(',');
  const [editingCapacity, setEditingCapacity] = useState<string | null>(null);
  const [newCapacity, setNewCapacity] = useState('');
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      const ids = idsKey ? idsKey.split(',') : [];
      const [tourRes, slotsRes] = await Promise.all([
        supabase.from('tours').select('vehicle_map_type').eq('id', tourId).maybeSingle(),
        ids.length
          ? supabase.from('tour_slots').select('id, vehicle_map_type').in('id', ids)
          : Promise.resolve({ data: [] as { id: string; vehicle_map_type: string | null }[] }),
      ]);
      if (!vivo) return;
      setTourMap((tourRes.data?.vehicle_map_type as string | null | undefined) ?? null);
      setSlotMaps(Object.fromEntries((slotsRes.data ?? []).map(f => [f.id, (f.vehicle_map_type as string | null) ?? null])));
    })();
    return () => { vivo = false; };
  }, [tourId, idsKey, mapaVersion]);

  const formattedDate = format(new Date(dateKey + 'T12:00:00'), "EEEE d 'de' MMMM yyyy", { locale: es });

  const formatTime = (time: string) => {
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };

  const handleUpdateCapacity = async (slotId: string) => {
    const cap = parseInt(newCapacity);
    if (!cap || cap < 1) {
      setError('La capacidad debe ser mayor a 0.');
      return;
    }
    // La capacidad es un tope de lo que se vende: puede ser menor que los asientos del vehiculo, nunca mayor.
    const asientosDelVehiculo = opcionDeVehiculo(mapaEfectivo(slotMaps[slotId], tourMap))?.capacity;
    const evaluacion = evaluarCapacidad(cap, asientosDelVehiculo);
    if (evaluacion.estado === 'excede') {
      setError(evaluacion.mensaje);
      return;
    }
    const currentSlot = slots.find(s => s.id === slotId);
    if (currentSlot && cap < (currentSlot.booked_count || 0)) {
      setError(`No se puede reducir la capacidad a ${cap} porque ya hay ${currentSlot.booked_count} reservas confirmadas para este slot.`);
      return;
    }
    setIsUpdating(slotId);
    setError('');
    try {
      const { error: err } = await supabase
        .from('tour_slots')
        .update({ capacity: cap, updated_at: new Date().toISOString() })
        .eq('id', slotId);
      if (err) throw err;
      setEditingCapacity(null);
      onRefresh();
    } catch (err) {
      setError(mensajeDeError(err) || 'Error al actualizar la capacidad.');
    } finally {
      setIsUpdating(null);
    }
  };

  const abrirEditorDeMapa = (slot: TourSlot) => {
    setError('');
    setEditingMap(slot.id);
    setNewMap(slotMaps[slot.id] ?? '');
    setNewMapCupos(String(slot.capacity));
  };

  const handleSaveMap = async (slot: TourSlot) => {
    const nuevoTipo = newMap || null;
    const asientos = opcionDeVehiculo(mapaEfectivo(nuevoTipo, tourMap))?.capacity ?? null;
    const cupos = parseInt(newMapCupos);
    if (!cupos || cupos < 1) {
      setError('Los cupos deben ser mayores a 0.');
      return;
    }
    if (cupos < (slot.booked_count || 0)) {
      setError(`No se puede bajar a ${cupos} cupos porque ya hay ${slot.booked_count} reservados en este horario.`);
      return;
    }
    const evaluacion = evaluarCapacidad(cupos, asientos);
    if (evaluacion.estado === 'excede') {
      setError(evaluacion.mensaje);
      return;
    }
    setIsUpdating(slot.id);
    setError('');
    try {
      // Un asiento ocupado o bloqueado que no existiria en el vehiculo nuevo se quedaria huerfano.
      const { data: tomados, error: errTomados } = await supabase
        .from('slot_seat_status')
        .select('seat_number')
        .eq('slot_id', slot.id)
        .in('status', ['reservado_online', 'bloqueado_agencia'])
        .order('seat_number', { ascending: false })
        .limit(1);
      if (errTomados) throw errTomados;
      const mayor = tomados?.[0]?.seat_number as number | undefined;
      if (asientos && mayor && mayor > asientos) {
        setError(`Hay asientos ocupados o bloqueados (hasta el ${mayor}) que no existen en ese vehiculo. Cambia primero esas reservas.`);
        return;
      }
      // Vehiculo y cupos en el MISMO update: el trigger que valida cupos <= asientos ve los dos valores juntos.
      const { error: err } = await supabase
        .from('tour_slots')
        .update({ vehicle_map_type: nuevoTipo, capacity: cupos, updated_at: new Date().toISOString() })
        .eq('id', slot.id);
      if (err) throw err;
      setEditingMap(null);
      setMapaVersion(v => v + 1);
      onRefresh();
    } catch (err) {
      setError(mensajeDeError(err) || 'Error al cambiar el vehiculo.');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleToggleBlock = async (slot: TourSlot) => {
    const newStatus: SlotStatus = slot.status === 'bloqueado' ? 'activo' : 'bloqueado';
    setIsUpdating(slot.id);
    try {
      const { error: err } = await supabase
        .from('tour_slots')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', slot.id);
      if (err) throw err;
      onRefresh();
    } catch (err) {
      setError(mensajeDeError(err) || 'Error al cambiar el estado.');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleCancelSlot = async (slotId: string) => {
    if (!cancelReason.trim()) {
      setError('El motivo de cancelación es requerido.');
      return;
    }
    setIsUpdating(slotId);
    setError('');
    try {
      const { error: err } = await supabase
        .from('tour_slots')
        .update({
          status: 'cancelado',
          cancellation_reason: cancelReason,
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', slotId);
      if (err) throw err;
      setCancelingId(null);
      setCancelReason('');
      onRefresh();
    } catch (err) {
      setError(mensajeDeError(err) || 'Error al cancelar el slot.');
    } finally {
      setIsUpdating(null);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div>
          <h4 className="font-semibold text-gray-800 text-sm capitalize">{formattedDate}</h4>
          <p className="text-xs text-gray-500">{slots.length} {slots.length === 1 ? 'horario' : 'horarios'}</p>
        </div>
        <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {slots.length === 0 ? (
        <div className="p-6 text-center text-gray-400 text-sm">
          No hay slots para esta fecha.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {slots.map(slot => {
            const available = slot.available_count ?? 0;
            const isEditingThis = editingCapacity === slot.id;
            const isCanceling = cancelingId === slot.id;
            const isUpdatingThis = isUpdating === slot.id;
            const mapaActual = mapaEfectivo(slotMaps[slot.id] ?? null, tourMap);
            const opcionActual = opcionDeVehiculo(mapaActual);
            const evaluacionCupos = evaluarCapacidad(slot.capacity, opcionActual?.capacity);

            return (
              <div key={slot.id} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Clock className="w-3.5 h-3.5 text-gray-500" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{formatTime(slot.departure_time)}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLORS[slot.status]}`}>
                          {STATUS_LABELS[slot.status]}
                        </span>
                        {slot.is_auto_generated && (
                          <span className="text-[10px] text-gray-400">Auto</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {!['cancelado', 'completado'].includes(slot.status) && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleBlock(slot)}
                        disabled={isUpdatingThis}
                        title={slot.status === 'bloqueado' ? 'Desbloquear' : 'Bloquear'}
                        className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                          slot.status === 'bloqueado'
                            ? 'bg-green-50 text-green-600 hover:bg-green-100'
                            : 'text-gray-400 hover:text-orange-500 hover:bg-orange-50'
                        }`}
                      >
                        {isUpdatingThis ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                      </button>
                      {!isCanceling && (
                        <button
                          onClick={() => setCancelingId(slot.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Cancelar slot"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-gray-400 mb-0.5">Cupos totales</p>
                    {isEditingThis ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="number" min="1" value={newCapacity}
                          onChange={e => setNewCapacity(e.target.value)}
                          className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-hidden focus:ring-1 focus:ring-red-500"
                          autoFocus
                        />
                        <button onClick={() => handleUpdateCapacity(slot.id)} disabled={isUpdatingThis}
                          className="p-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50">
                          {isUpdatingThis ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <CheckCircle className="w-2.5 h-2.5" />}
                        </button>
                        <button onClick={() => setEditingCapacity(null)}
                          className="p-1 text-gray-400 hover:text-gray-600 rounded">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-700 text-sm">{slot.capacity}</span>
                        {!['cancelado', 'completado'].includes(slot.status) && (
                          <button
                            onClick={() => { setEditingCapacity(slot.id); setNewCapacity(slot.capacity.toString()); }}
                            className="p-0.5 text-gray-300 hover:text-gray-600 transition-colors">
                            <Edit2 className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-gray-400 mb-0.5">Reservados / Disponibles</p>
                    <p className="font-semibold text-gray-700 text-sm">
                      {slot.booked_count} / <span className={available > 0 ? 'text-green-600' : 'text-red-500'}>{available}</span>
                    </p>
                  </div>
                </div>

                {tourMap && !['cancelado', 'completado'].includes(slot.status) && (
                  <div className="mt-3 bg-gray-50 rounded-lg p-2.5 text-xs">
                    <p className="text-gray-400 mb-0.5">Vehiculo (mapa de asientos)</p>
                    {editingMap === slot.id ? (
                      <div className="flex flex-col gap-y-2 mt-1">
                        <select
                          value={newMap}
                          onChange={e => {
                            setNewMap(e.target.value);
                            setNewMapCupos(cuposSugeridos(slot.capacity, mapaActual, mapaEfectivo(e.target.value || null, tourMap)));
                          }}
                          className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-hidden focus:ring-1 focus:ring-red-500"
                        >
                          <option value="">Heredar del tour ({opcionDeVehiculo(tourMap)?.label ?? tourMap})</option>
                          {OPCIONES_DE_VEHICULO.map(o => (
                            <option key={o.type} value={o.type}>{o.label} ({o.capacity} asientos)</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 text-gray-500">
                          Cupos de este horario
                          <input
                            type="number" min="1" value={newMapCupos}
                            onChange={e => setNewMapCupos(e.target.value)}
                            className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-hidden focus:ring-1 focus:ring-red-500"
                          />
                        </label>
                        <div className="flex gap-1.5">
                          <button onClick={() => handleSaveMap(slot)} disabled={isUpdatingThis}
                            className="flex items-center gap-1 px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50">
                            {isUpdatingThis ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <CheckCircle className="w-2.5 h-2.5" />}
                            Guardar
                          </button>
                          <button onClick={() => setEditingMap(null)}
                            className="px-2 py-1 border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-700 text-sm">{opcionActual?.label ?? mapaActual}</span>
                        {!slotMaps[slot.id] && <span className="text-[10px] text-gray-400">(del tour)</span>}
                        <button
                          onClick={() => abrirEditorDeMapa(slot)}
                          title="Cambiar el vehiculo de este horario"
                          className="p-0.5 text-gray-300 hover:text-gray-600 transition-colors">
                          <Edit2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                    {(evaluacionCupos.estado === 'menor' || evaluacionCupos.estado === 'excede') && editingMap !== slot.id && (
                      <p className={`mt-1 text-[11px] ${evaluacionCupos.estado === 'excede' ? 'text-red-600' : 'text-gray-500'}`}>{evaluacionCupos.mensaje}</p>
                    )}
                  </div>
                )}

                {isCanceling && (
                  <div className="mt-3 flex flex-col gap-y-2">
                    <input
                      type="text" value={cancelReason} placeholder="Motivo de cancelación *"
                      onChange={e => setCancelReason(e.target.value)}
                      className="w-full border border-red-200 rounded-lg px-3 py-2 text-xs focus:outline-hidden focus:ring-2 focus:ring-red-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCancelSlot(slot.id)}
                        disabled={isUpdatingThis}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50">
                        {isUpdatingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Confirmar Cancelación
                      </button>
                      <button
                        onClick={() => { setCancelingId(null); setCancelReason(''); }}
                        className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50 transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {slot.cancellation_reason && (
                  <p className="mt-2 text-xs text-gray-400 italic">Motivo: {slot.cancellation_reason}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SlotDetailPanel;
