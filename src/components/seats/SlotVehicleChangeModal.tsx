import React, { useEffect, useMemo, useState } from 'react';
import { X, Bus, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { mensajeDeError } from '../../lib/errores';

interface SlotRow {
  id: string;
  slot_date: string;
  departure_time: string | null;
  capacity: number;
  booked_count: number;
  vehicle_map_type: string | null;
}

interface LayoutOption {
  type: string;
  name: string;
  capacity: number;
}

interface Props {
  tourId: string;
  slots: SlotRow[];
  initialSlotId?: string | null;
  onClose: () => void;
  onDone: () => void;
}

interface ChangeResult {
  success: boolean;
  slots_updated: number;
  bookings_to_reselect: number;
  blocks_released: number;
  external_seats_released: number;
  global_blocks: number;
}

const DEFAULT_VEHICLE = '';

const SlotVehicleChangeModal: React.FC<Props> = ({ tourId, slots, initialSlotId, onClose, onDone }) => {
  const [layouts, setLayouts] = useState<LayoutOption[]>([]);
  const [tourVehicle, setTourVehicle] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initialSlotId ? [initialSlotId] : []);
  const [vehicle, setVehicle] = useState<string>(DEFAULT_VEHICLE);
  // null = no la ha tocado: vale la del vehiculo elegido.
  const [capacityEdit, setCapacityEdit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ChangeResult | null>(null);
  const [mailFailed, setMailFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [layoutsRes, tourRes] = await Promise.all([
        supabase.from('vehicle_seat_layouts').select('type, name, capacity').eq('is_active', true).order('display_order'),
        supabase.from('tours').select('vehicle_map_type').eq('id', tourId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (layoutsRes.error || tourRes.error) {
        setError('No se pudieron cargar los vehiculos disponibles. Cierra y vuelve a intentar.');
      } else {
        setLayouts((layoutsRes.data ?? []) as LayoutOption[]);
        setTourVehicle(tourRes.data?.vehicle_map_type ?? null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tourId]);

  const effectiveType = vehicle || tourVehicle;
  const layout = layouts.find(l => l.type === effectiveType) ?? null;
  const maxCapacity = layout?.capacity ?? 0;

  // Al cambiar de vehiculo la capacidad vuelve a la del vehiculo; la agencia la puede bajar.
  const capacity = capacityEdit ?? (layout ? String(layout.capacity) : '');

  const capacityNumber = Number(capacity);
  const capacityValid = Number.isInteger(capacityNumber) && capacityNumber >= 1 && capacityNumber <= maxCapacity;

  const selectedSlots = useMemo(() => slots.filter(s => selected.includes(s.id)), [slots, selected]);
  const sold = Math.max(0, ...selectedSlots.map(s => s.booked_count));
  const capacityBelowSold = capacityValid && capacityNumber < sold;
  const affectsExisting = selectedSlots.some(s => s.booked_count > 0 && (s.vehicle_map_type ?? tourVehicle) !== effectiveType);

  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : '');
  const vehicleName = (type: string | null) => layouts.find(l => l.type === type)?.name ?? 'Vehiculo del tour';

  const toggle = (id: string) => setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const submit = async () => {
    if (selected.length === 0 || !capacityValid || capacityBelowSold) return;
    setSubmitting(true);
    setError('');
    setMailFailed(false);
    try {
      const { data, error: rpcError } = await supabase.rpc('change_slots_vehicle', {
        p_tour_id: tourId,
        p_slot_ids: selected,
        p_vehicle_map_type: vehicle || null,
        p_capacity: capacityNumber,
      });
      if (rpcError) throw rpcError;
      const res = data as ChangeResult;
      if (res.bookings_to_reselect > 0) {
        // La notificacion en la app ya la dejo la base; el correo es un segundo aviso.
        const { error: mailError } = await supabase.functions.invoke('notify-slot-vehicle-change', {
          body: { tour_id: tourId, slot_ids: selected },
        });
        if (mailError) setMailFailed(true);
      }
      setResult(res);
    } catch (err) {
      setError(mensajeDeError(err) || 'No se pudo cambiar el vehiculo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bus className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-gray-800">Cambiar vehiculo de salidas</h3>
          </div>
          <button onClick={result ? onDone : onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {result ? (
          <div className="flex flex-col gap-y-3">
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Vehiculo actualizado en {result.slots_updated} salida{result.slots_updated !== 1 ? 's' : ''}.</span>
            </div>
            {result.bookings_to_reselect > 0 && (
              <p className="text-sm text-gray-700">
                Avisamos a {result.bookings_to_reselect} reserva{result.bookings_to_reselect !== 1 ? 's' : ''} del cambio de transporte; deben elegir sus asientos de nuevo.
                {mailFailed && ' El correo no se pudo enviar, pero la notificacion dentro de la app si salio.'}
              </p>
            )}
            {(result.blocks_released > 0 || result.external_seats_released > 0) && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                Se liberaron {result.blocks_released} bloqueo{result.blocks_released !== 1 ? 's' : ''} de asiento y {result.external_seats_released} asiento{result.external_seats_released !== 1 ? 's' : ''} de ventas externas: los numeros del vehiculo anterior no aplican al nuevo. Vuelve a bloquear o asignar donde haga falta.
              </p>
            )}
            {result.global_blocks > 0 && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                Este tour tiene {result.global_blocks} bloqueo{result.global_blocks !== 1 ? 's' : ''} general{result.global_blocks !== 1 ? 'es' : ''} (para todas las salidas). Se aplican por numero de asiento, tambien en salidas con vehiculo distinto; revisalos.
              </p>
            )}
            <button onClick={onDone} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">Listo</button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              El cambio aplica solo a las salidas que elijas; el resto del tour conserva su vehiculo. El precio no cambia.
            </p>

            <div className="flex flex-col gap-y-1">
              <label className="text-xs font-medium text-gray-700" htmlFor="slot-vehicle">Vehiculo para las salidas elegidas</label>
              <select
                id="slot-vehicle"
                value={vehicle}
                onChange={e => { setVehicle(e.target.value); setCapacityEdit(null); }}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
              >
                <option value={DEFAULT_VEHICLE}>Volver al vehiculo del tour ({vehicleName(tourVehicle)})</option>
                {layouts.filter(l => l.type !== tourVehicle).map(l => (
                  <option key={l.type} value={l.type}>{l.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-y-1">
              <label className="text-xs font-medium text-gray-700" htmlFor="slot-capacity">
                Lugares que vendes en estas salidas (maximo {maxCapacity})
              </label>
              <input
                id="slot-capacity"
                type="number"
                min={1}
                max={maxCapacity || undefined}
                value={capacity}
                onChange={e => setCapacityEdit(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-500">Puedes poner menos que los asientos del vehiculo si el lugar a visitar admite menos personas.</p>
              {capacityBelowSold && (
                <p className="text-xs text-red-700">Hay una salida con {sold} lugares vendidos; la capacidad no puede ser menor.</p>
              )}
            </div>

            <div className="flex flex-col gap-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">Salidas ({selected.length} elegida{selected.length !== 1 ? 's' : ''})</span>
                <button type="button" onClick={() => setSelected(selected.length === slots.length ? [] : slots.map(s => s.id))} className="text-xs text-blue-700 underline">
                  {selected.length === slots.length ? 'Quitar todas' : 'Elegir todas'}
                </button>
              </div>
              <ul className="max-h-56 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100">
                {slots.map(s => (
                  <li key={s.id}>
                    <label className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                      <span className="flex-1 text-gray-800">{fmtDate(s.slot_date)} {fmtTime(s.departure_time)}</span>
                      <span className="text-xs text-gray-500">{vehicleName(s.vehicle_map_type ?? tourVehicle)} · {s.booked_count}/{s.capacity}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            {affectsExisting && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  Hay reservas con asientos en estas salidas. Al confirmar, avisaremos a esos viajeros del cambio de transporte por logistica y les pediremos elegir sus asientos de nuevo. Tambien se liberaran los bloqueos y asientos de ventas externas de esas salidas.
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} disabled={submitting} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={submitting || selected.length === 0 || !capacityValid || capacityBelowSold}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Aplicando...</> : 'Aplicar cambio'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SlotVehicleChangeModal;
