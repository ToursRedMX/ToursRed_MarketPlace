import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Unlock, User, AlertCircle, Loader2, RefreshCw, X, Check, Calendar, Clock, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { SeatWithStatus, VehicleSeatLayout } from '../../types/seats';
import { useAuth } from '../../context/AuthContext';

interface SeatMapManagerProps {
  tourId: string;
  slotId?: string | null;
  agencyId: string;
  tourDate?: string;
  slotTime?: string;
  isReceptivo?: boolean;
  transferCustomTime?: boolean;
}

const SEAT_SIZE = 36;
const SEAT_GAP = 6;
const AISLE_WIDTH = 20;
const PADDING = 16;

interface BlockModalState {
  open: boolean;
  seatNumber: number;
  note: string;
  isSubmitting: boolean;
  blockAllSlots: boolean;
}

interface TourSlot {
  id: string;
  slot_date: string;
  departure_time: string | null;
  capacity: number;
  booked_count: number;
  status: string;
}

const SeatMapManager: React.FC<SeatMapManagerProps> = ({
  tourId,
  slotId: slotIdProp,
  agencyId,
  tourDate,
  slotTime,
  isReceptivo = false,
  transferCustomTime = false,
}) => {
  const { user } = useAuth();
  const [layout, setLayout] = useState<VehicleSeatLayout | null>(null);
  const [seatsWithStatus, setSeatsWithStatus] = useState<SeatWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [blockModal, setBlockModal] = useState<BlockModalState>({ open: false, seatNumber: 0, note: '', isSubmitting: false, blockAllSlots: false });
  const [hoveredSeat, setHoveredSeat] = useState<number | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ seat: number; message: string } | null>(null);

  const [slots, setSlots] = useState<TourSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(slotIdProp || null);

  const activeSlotId = isReceptivo ? selectedSlotId : (slotIdProp || null);

  const loadSlots = useCallback(async () => {
    if (!isReceptivo) return;
    setSlotsLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('tour_slots')
        .select('id, slot_date, departure_time, capacity, booked_count, status')
        .eq('tour_id', tourId)
        .neq('status', 'cancelado')
        .gte('slot_date', today)
        .order('slot_date', { ascending: true })
        .order('departure_time', { ascending: true })
        .limit(60);
      setSlots(data || []);
    } finally {
      setSlotsLoading(false);
    }
  }, [tourId, isReceptivo]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const loadData = useCallback(async () => {
    if (isReceptivo && !selectedSlotId) {
      setIsLoading(false);
      setSeatsWithStatus([]);
      setLayout(null);
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const { data: tourData, error: tourError } = await supabase
        .from('tours')
        .select('vehicle_map_type')
        .eq('id', tourId)
        .maybeSingle();

      if (tourError || !tourData?.vehicle_map_type) {
        setError('No se pudo cargar el tipo de vehiculo del tour.');
        return;
      }

      const { data: layoutData, error: layoutError } = await supabase
        .from('vehicle_seat_layouts')
        .select('*')
        .eq('type', tourData.vehicle_map_type)
        .eq('is_active', true)
        .maybeSingle();

      if (layoutError || !layoutData) {
        setError('No se pudo cargar el layout del vehiculo.');
        return;
      }

      const parsedLayout: VehicleSeatLayout = {
        ...layoutData,
        seats: typeof layoutData.seats === 'string' ? JSON.parse(layoutData.seats) : layoutData.seats,
        vehicle_shape: typeof layoutData.vehicle_shape === 'string' ? JSON.parse(layoutData.vehicle_shape) : layoutData.vehicle_shape,
      };
      setLayout(parsedLayout);

      let query = supabase
        .from('slot_seat_status')
        .select(`
          seat_number, status, booking_id, block_note, blocked_by,
          bookings:booking_id (
            booking_code,
            users:user_id (first_name, last_name)
          )
        `)
        .eq('tour_id', tourId);

      if (activeSlotId) {
        query = query.eq('slot_id', activeSlotId);
      } else {
        query = query.is('slot_id', null);
      }

      const { data: statusData } = await query;

      const statusMap: Record<number, SeatWithStatus> = {};
      (statusData || []).forEach((s: any) => {
        const travelerName = s.bookings?.users
          ? `${s.bookings.users.first_name || ''} ${s.bookings.users.last_name || ''}`.trim()
          : null;
        const normalizedStatus = s.status === 'bloqueado_agencia' ? 'bloqueado'
          : s.status === 'reservado_online' ? 'reservado'
          : 'disponible';
        statusMap[s.seat_number] = {
          number: s.seat_number,
          row: 0,
          col: 0,
          side: 'left',
          type: 'normal',
          status: normalizedStatus,
          booking_id: s.booking_id,
          block_note: s.block_note,
          traveler_name: travelerName,
          booking_code: s.bookings?.booking_code || null,
        };
      });

      const combined: SeatWithStatus[] = parsedLayout.seats.map(seat => ({
        ...seat,
        status: statusMap[seat.number]?.status || 'disponible',
        booking_id: statusMap[seat.number]?.booking_id || null,
        block_note: statusMap[seat.number]?.block_note || null,
        traveler_name: statusMap[seat.number]?.traveler_name || null,
        booking_code: statusMap[seat.number]?.booking_code || null,
      }));

      setSeatsWithStatus(combined);
    } catch (err: any) {
      setError('Error al cargar el mapa de asientos.');
    } finally {
      setIsLoading(false);
    }
  }, [tourId, activeSlotId, isReceptivo, selectedSlotId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!activeSlotId && isReceptivo) return;
    const channel = supabase
      .channel(`seat-manager-${tourId}-${activeSlotId || 'no-slot'}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'slot_seat_status',
        filter: `tour_id=eq.${tourId}`,
      }, () => { loadData(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tourId, activeSlotId, isReceptivo, loadData]);

  const handleSeatClick = (seat: SeatWithStatus) => {
    if (seat.status === 'reservado') return;
    if (seat.status === 'bloqueado') {
      handleUnblock(seat.number);
      return;
    }
    setBlockModal({ open: true, seatNumber: seat.number, note: '', isSubmitting: false, blockAllSlots: false });
  };

  const handleBlock = async () => {
    if (!user) return;
    setBlockModal(prev => ({ ...prev, isSubmitting: true }));
    try {
      if (isReceptivo && blockModal.blockAllSlots) {
        const today = new Date().toISOString().split('T')[0];
        const { data: allSlots } = await supabase
          .from('tour_slots')
          .select('id')
          .eq('tour_id', tourId)
          .neq('status', 'cancelado')
          .gte('slot_date', today);

        const slotIds = (allSlots || []).map((s: any) => s.id);

        await supabase
          .from('slot_seat_status')
          .delete()
          .eq('tour_id', tourId)
          .eq('seat_number', blockModal.seatNumber)
          .in('slot_id', slotIds.length > 0 ? slotIds : ['_none_']);

        if (slotIds.length > 0) {
          const payloads = slotIds.map((sid: string) => ({
            tour_id: tourId,
            agency_id: agencyId,
            seat_number: blockModal.seatNumber,
            status: 'bloqueado_agencia',
            block_note: blockModal.note || null,
            blocked_by: user.id,
            blocked_at: new Date().toISOString(),
            slot_id: sid,
          }));
          const { error } = await supabase.from('slot_seat_status').insert(payloads);
          if (error) throw error;
        }

        setActionFeedback({ seat: blockModal.seatNumber, message: `Asiento bloqueado en ${slotIds.length} salidas` });
      } else {
        let deleteQuery = supabase
          .from('slot_seat_status')
          .delete()
          .eq('tour_id', tourId)
          .eq('seat_number', blockModal.seatNumber);

        if (activeSlotId) {
          deleteQuery = (deleteQuery as any).eq('slot_id', activeSlotId);
        } else {
          deleteQuery = (deleteQuery as any).is('slot_id', null);
        }
        await deleteQuery;

        const payload: any = {
          tour_id: tourId,
          agency_id: agencyId,
          seat_number: blockModal.seatNumber,
          status: 'bloqueado_agencia',
          block_note: blockModal.note || null,
          blocked_by: user.id,
          blocked_at: new Date().toISOString(),
        };
        if (activeSlotId) payload.slot_id = activeSlotId;

        const { error } = await supabase.from('slot_seat_status').insert(payload);
        if (error) throw error;

        setActionFeedback({ seat: blockModal.seatNumber, message: 'Asiento bloqueado' });
      }

      setTimeout(() => setActionFeedback(null), 3000);
      setBlockModal({ open: false, seatNumber: 0, note: '', isSubmitting: false, blockAllSlots: false });
      await loadData();
    } catch (err: any) {
      setBlockModal(prev => ({ ...prev, isSubmitting: false }));
    }
  };

  const handleUnblock = async (seatNumber: number) => {
    try {
      let query = supabase
        .from('slot_seat_status')
        .delete()
        .eq('tour_id', tourId)
        .eq('seat_number', seatNumber)
        .eq('status', 'bloqueado_agencia');

      if (activeSlotId) {
        query = (query as any).eq('slot_id', activeSlotId);
      } else {
        query = (query as any).is('slot_id', null);
      }

      await query;
      setActionFeedback({ seat: seatNumber, message: 'Asiento desbloqueado' });
      setTimeout(() => setActionFeedback(null), 2500);
      await loadData();
    } catch (err: any) {
      console.error('Error desbloqueando asiento:', err);
    }
  };

  const renderSeatGrid = () => {
    if (!layout) return null;
    const shape = layout.vehicle_shape;

    const seatMap: Record<string, SeatWithStatus> = {};
    seatsWithStatus.forEach(s => { seatMap[`${s.row}-${s.col}`] = s; });

    const colWidth = SEAT_SIZE + SEAT_GAP;
    const rowHeight = SEAT_SIZE + SEAT_GAP;
    const aisleX = (shape.aisleAfterCol + 1) * colWidth + PADDING;
    const totalWidth = shape.totalCols * colWidth + AISLE_WIDTH + PADDING * 2;
    const driverOffset = shape.hasDriver && shape.driverRow === 0 ? rowHeight + 8 : 0;
    const totalHeight = shape.totalRows * rowHeight + PADDING * 2 + driverOffset;

    const getColX = (col: number) => {
      const baseX = PADDING;
      return col <= shape.aisleAfterCol
        ? baseX + col * colWidth
        : baseX + col * colWidth + AISLE_WIDTH;
    };

    const getRowY = (row: number) => row === 0
      ? PADDING
      : PADDING + driverOffset + row * rowHeight;

    return (
      <svg width={totalWidth} height={totalHeight} className="block mx-auto">
        <rect x={0} y={0} width={totalWidth} height={totalHeight} rx={16} fill="#f8fafc" stroke="#e2e8f0" strokeWidth={1.5} />

        {shape.hasDriver && shape.driverRow === 0 && (
          <g>
            <rect x={getColX(shape.driverCol)} y={PADDING} width={SEAT_SIZE} height={SEAT_SIZE} rx={6} fill="#94a3b8" stroke="#64748b" strokeWidth={1.5} />
            <text x={getColX(shape.driverCol) + SEAT_SIZE / 2} y={PADDING + SEAT_SIZE / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569" fontWeight="600">COND</text>
          </g>
        )}

        <line x1={aisleX} y1={PADDING} x2={aisleX} y2={totalHeight - PADDING} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4,4" />

        {shape.hasBathroom && shape.bathroomRow !== undefined && shape.bathroomCol !== undefined && (
          <g>
            <rect x={getColX(shape.bathroomCol)} y={getRowY(shape.bathroomRow)} width={SEAT_SIZE} height={SEAT_SIZE} rx={6} fill="#bfdbfe" stroke="#93c5fd" strokeWidth={1.5} />
            <text x={getColX(shape.bathroomCol) + SEAT_SIZE / 2} y={getRowY(shape.bathroomRow) + SEAT_SIZE / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#1d4ed8" fontWeight="600">WC</text>
          </g>
        )}

        {Array.from({ length: shape.totalRows }, (_, row) =>
          Array.from({ length: shape.totalCols }, (_, col) => {
            const key = `${row}-${col}`;
            const seat = seatMap[key];
            if (!seat) return null;

            const isHovered = hoveredSeat === seat.number;
            const x = getColX(col);
            const y = getRowY(row);

            let fill = '#ffffff';
            let stroke = '#d1d5db';
            let textFill = '#374151';
            let cursor = 'pointer';

            if (seat.status === 'reservado') {
              fill = '#9ca3af'; stroke = '#6b7280'; textFill = '#4b5563'; cursor = 'default';
            } else if (seat.status === 'bloqueado') {
              fill = '#fbbf24'; stroke = '#d97706'; textFill = '#78350f';
            } else if (isHovered) {
              fill = '#dbeafe'; stroke = '#3b82f6';
            }

            const tooltip = seat.status === 'reservado'
              ? `Asiento ${seat.number} - ${seat.traveler_name || 'Reservado'}${seat.booking_code ? ` (${seat.booking_code})` : ''}`
              : seat.status === 'bloqueado'
              ? `Asiento ${seat.number} - Bloqueado${seat.block_note ? `: ${seat.block_note}` : ''} — Click para desbloquear`
              : `Asiento ${seat.number} - Disponible — Click para bloquear`;

            return (
              <g
                key={key}
                onClick={() => seat.status !== 'reservado' && handleSeatClick(seat)}
                onMouseEnter={() => setHoveredSeat(seat.number)}
                onMouseLeave={() => setHoveredSeat(null)}
                style={{ cursor }}
              >
                <title>{tooltip}</title>
                <rect x={x} y={y} width={SEAT_SIZE} height={SEAT_SIZE} rx={6} fill={fill} stroke={stroke} strokeWidth={isHovered ? 2 : 1.5} />
                <text x={x + SEAT_SIZE / 2} y={y + SEAT_SIZE / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight="500" fill={textFill}>
                  {seat.number}
                </text>
                {seat.status === 'bloqueado' && (
                  <g>
                    <circle cx={x + SEAT_SIZE - 7} cy={y + 7} r={6} fill="#d97706" />
                    <text x={x + SEAT_SIZE - 7} y={y + 8} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill="#fff">🔒</text>
                  </g>
                )}
                {seat.status === 'reservado' && (
                  <g>
                    <circle cx={x + SEAT_SIZE - 7} cy={y + 7} r={6} fill="#6b7280" />
                    <text x={x + SEAT_SIZE - 7} y={y + 8} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill="#fff">👤</text>
                  </g>
                )}
              </g>
            );
          })
        )}
      </svg>
    );
  };

  const formatSlotDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const formatSlotTime = (timeStr: string | null) => {
    if (!timeStr) return '';
    return timeStr.substring(0, 5);
  };

  const selectedSlot = slots.find(s => s.id === selectedSlotId);

  const renderSlotSelector = () => {
    if (!isReceptivo) return null;

    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-600" />
          <p className="text-sm font-semibold text-blue-800">Selecciona el slot para gestionar asientos</p>
        </div>
        <p className="text-xs text-blue-600">Los bloqueos son por salida especifica. Elige la fecha y horario correspondiente a la venta externa que deseas registrar.</p>

        {slotsLoading ? (
          <div className="flex items-center gap-2 text-sm text-blue-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando salidas disponibles...
          </div>
        ) : slots.length === 0 ? (
          <div className="flex items-start gap-2 p-3 bg-white border border-blue-200 rounded-lg text-sm text-gray-600">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            {transferCustomTime
              ? <span>Este traslado permite que el viajero defina su hora al reservar. Para gestionar asientos por slot, agrega al menos un <strong>horario fijo</strong> en la pestana "Horarios de Salida" — esto generara los slots necesarios.</span>
              : <span>No hay salidas proximas programadas para este tour.</span>
            }
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-blue-700">Salida / Horario</label>
            <div className="relative">
              <select
                value={selectedSlotId || ''}
                onChange={e => setSelectedSlotId(e.target.value || null)}
                className="w-full appearance-none bg-white border border-blue-300 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              >
                <option value="">-- Elige una salida --</option>
                {slots.map(slot => (
                  <option key={slot.id} value={slot.id}>
                    {formatSlotDate(slot.slot_date)}{slot.departure_time ? ` · ${formatSlotTime(slot.departure_time)}` : ''} — {slot.booked_count}/{slot.capacity} lugares
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 pointer-events-none" />
            </div>

            {selectedSlot && (
              <div className="flex items-center gap-3 p-2.5 bg-white border border-blue-200 rounded-lg text-xs text-gray-600">
                <Calendar className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                <span className="font-medium text-gray-800">{formatSlotDate(selectedSlot.slot_date)}</span>
                {selectedSlot.departure_time && (
                  <>
                    <Clock className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span>{formatSlotTime(selectedSlot.departure_time)}</span>
                  </>
                )}
                <span className="ml-auto text-gray-500">{selectedSlot.booked_count} reservados · {selectedSlot.capacity - selectedSlot.booked_count} disponibles</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">
          Gestion de Asientos
          {!isReceptivo && tourDate && <span className="ml-2 text-sm font-normal text-gray-500">— {tourDate}{slotTime ? ` ${slotTime}` : ''}</span>}
        </h3>
        {(!isReceptivo || selectedSlotId) && (
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        )}
      </div>

      {renderSlotSelector()}

      {isReceptivo && !selectedSlotId ? (
        <div className="flex flex-col items-center justify-center py-10 text-center text-gray-400 space-y-2">
          <Calendar className="w-10 h-10 text-gray-300" />
          <p className="text-sm">Selecciona una salida para ver y gestionar los asientos</p>
        </div>
      ) : (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
              <span className="ml-3 text-gray-600">Cargando mapa de asientos...</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          ) : !layout ? null : (
            <>
              {(() => {
                const totalSeats = seatsWithStatus.length;
                const reservados = seatsWithStatus.filter(s => s.status === 'reservado').length;
                const bloqueados = seatsWithStatus.filter(s => s.status === 'bloqueado').length;
                const disponibles = totalSeats - reservados - bloqueados;
                return (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-green-700">{disponibles}</p>
                      <p className="text-xs text-green-600">Disponibles</p>
                    </div>
                    <div className="bg-gray-100 border border-gray-300 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-gray-600">{reservados}</p>
                      <p className="text-xs text-gray-500">Reservados</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-amber-600">{bloqueados}</p>
                      <p className="text-xs text-amber-500">Bloqueados</p>
                    </div>
                  </div>
                );
              })()}

              {actionFeedback && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm animate-pulse">
                  <Check className="w-4 h-4" />
                  <span>Asiento {actionFeedback.seat}: {actionFeedback.message}</span>
                </div>
              )}

              <div className="overflow-auto pb-2">
                <div className="min-w-max mx-auto">
                  {renderSeatGrid()}
                </div>
              </div>

              <div className="flex items-center gap-6 text-xs text-gray-500 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded border-2 border-gray-300 bg-white" />
                  <span>Disponible — click para bloquear</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded border-2 border-gray-400 bg-gray-300" />
                  <span>Reservado (online)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded border-2 border-amber-500 bg-amber-400" />
                  <span>Bloqueado — click para desbloquear</span>
                </div>
              </div>

              {hoveredSeat !== null && (() => {
                const seat = seatsWithStatus.find(s => s.number === hoveredSeat);
                if (!seat || seat.status === 'disponible') return null;
                return (
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm">
                    <div className="flex items-center gap-2 text-gray-700">
                      <User className="w-4 h-4" />
                      <span className="font-medium">Asiento {seat.number}</span>
                      {seat.status === 'reservado' && (
                        <span className="text-gray-600">
                          — {seat.traveler_name || 'Viajero'}{seat.booking_code ? ` · Reserva ${seat.booking_code}` : ''}
                        </span>
                      )}
                      {seat.status === 'bloqueado' && (
                        <span className="text-amber-700">
                          — Bloqueado{seat.block_note ? `: ${seat.block_note}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </>
      )}

      {blockModal.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-600" />
                <h3 className="font-semibold text-gray-800">Bloquear Asiento {blockModal.seatNumber}</h3>
              </div>
              <button onClick={() => setBlockModal({ open: false, seatNumber: 0, note: '', isSubmitting: false, blockAllSlots: false })} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {isReceptivo && (
              <div className="space-y-2">
                {selectedSlot && !blockModal.blockAllSlots && (
                  <div className="flex items-center gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                    <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Salida: <strong>{formatSlotDate(selectedSlot.slot_date)}{selectedSlot.departure_time ? ` · ${formatSlotTime(selectedSlot.departure_time)}` : ''}</strong></span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setBlockModal(prev => ({ ...prev, blockAllSlots: !prev.blockAllSlots }))}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-colors text-left ${
                    blockModal.blockAllSlots
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-10 h-6 rounded-full flex items-center transition-colors flex-shrink-0 ${
                    blockModal.blockAllSlots ? 'bg-amber-500 justify-end' : 'bg-gray-300 justify-start'
                  } px-0.5`}>
                    <div className="w-5 h-5 bg-white rounded-full shadow" />
                  </div>
                  <div>
                    <p className={`text-xs font-semibold ${blockModal.blockAllSlots ? 'text-amber-800' : 'text-gray-600'}`}>
                      Bloquear en todas las salidas futuras
                    </p>
                    <p className={`text-xs mt-0.5 ${blockModal.blockAllSlots ? 'text-amber-600' : 'text-gray-400'}`}>
                      Ideal para el lugar del coordinador
                    </p>
                  </div>
                </button>
              </div>
            )}

            <p className="text-sm text-gray-600">
              {isReceptivo && blockModal.blockAllSlots
                ? 'Este asiento quedara bloqueado en todas las salidas futuras de este tour.'
                : isReceptivo
                ? 'Este asiento quedara bloqueado en esta salida especifica.'
                : 'Este asiento quedara bloqueado para nuevas reservas online.'
              }{' '}Util para ventas realizadas fuera de la plataforma.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nota opcional (nombre del cliente, canal de venta)</label>
              <input
                type="text"
                value={blockModal.note}
                onChange={e => setBlockModal(prev => ({ ...prev, note: e.target.value }))}
                placeholder="Ej: Juan Garcia - Venta directa"
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setBlockModal({ open: false, seatNumber: 0, note: '', isSubmitting: false, blockAllSlots: false })}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleBlock}
                disabled={blockModal.isSubmitting}
                className="flex-1 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {blockModal.isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Bloquear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SeatMapManager;
