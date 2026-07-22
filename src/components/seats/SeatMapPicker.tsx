import React, { useState, useEffect, useCallback } from 'react';
import { Users, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { SeatDefinition, SeatWithStatus, VehicleShape, VehicleSeatLayout } from '../../types/seats';

interface SeatMapPickerProps {
  tourId: string;
  slotId?: string | null;
  requiredSeats: number;
  onSeatsSelected: (seats: number[]) => void;
  selectedSeats?: number[];
  disabled?: boolean;
}

const SEAT_SIZE = 36;
const SEAT_GAP = 6;
const AISLE_WIDTH = 20;
const PADDING = 16;

function getSeatColor(status: string, isSelected: boolean): string {
  if (isSelected) return 'bg-blue-600 border-blue-700 text-white shadow-md scale-105';
  switch (status) {
    case 'disponible': return 'bg-white border-gray-300 text-gray-700 hover:bg-blue-50 hover:border-blue-400 cursor-pointer';
    case 'reservado': return 'bg-gray-300 border-gray-400 text-gray-500 cursor-not-allowed';
    case 'bloqueado': return 'bg-gray-400 border-gray-500 text-gray-600 cursor-not-allowed';
    default: return 'bg-white border-gray-300 text-gray-700';
  }
}

function getSeatTitle(seat: SeatWithStatus): string {
  if (seat.status === 'reservado') return `Asiento ${seat.number} - Ocupado`;
  if (seat.status === 'bloqueado') return `Asiento ${seat.number} - Bloqueado${seat.block_note ? `: ${seat.block_note}` : ''}`;
  return `Asiento ${seat.number} - Disponible`;
}

interface SeatGridProps {
  seats: SeatWithStatus[];
  shape: VehicleShape;
  selected: number[];
  onSeatClick: (seat: SeatWithStatus) => void;
}

const SeatGrid: React.FC<SeatGridProps> = ({ seats, shape, selected, onSeatClick }) => {
  const seatMap: Record<string, SeatWithStatus> = {};
  seats.forEach(s => { seatMap[`${s.row}-${s.col}`] = s; });

  const colWidth = SEAT_SIZE + SEAT_GAP;
  const rowHeight = SEAT_SIZE + SEAT_GAP;

  const aisleX = (shape.aisleAfterCol + 1) * colWidth + PADDING;
  const totalWidth = shape.totalCols * colWidth + AISLE_WIDTH + PADDING * 2;
  const totalHeight = shape.totalRows * rowHeight + PADDING * 2 + (shape.hasDriver ? rowHeight + 8 : 0);

  const getColX = (col: number): number => {
    const baseX = PADDING;
    if (col <= shape.aisleAfterCol) {
      return baseX + col * colWidth;
    }
    return baseX + col * colWidth + AISLE_WIDTH;
  };

  const getRowY = (row: number): number => {
    const driverOffset = shape.hasDriver && shape.driverRow === 0 ? rowHeight + 8 : 0;
    return PADDING + driverOffset + row * rowHeight;
  };

  return (
    <div className="relative overflow-auto">
      <svg
        width={totalWidth}
        height={totalHeight}
        className="block mx-auto"
      >
        <rect x={0} y={0} width={totalWidth} height={totalHeight} rx={16} fill="#f8fafc" stroke="#e2e8f0" strokeWidth={1.5} />

        {shape.hasDriver && shape.driverRow === 0 && (
          <g>
            <rect
              x={getColX(shape.driverCol)}
              y={PADDING}
              width={SEAT_SIZE}
              height={SEAT_SIZE}
              rx={6}
              fill="#94a3b8"
              stroke="#64748b"
              strokeWidth={1.5}
            />
            <text x={getColX(shape.driverCol) + SEAT_SIZE / 2} y={PADDING + SEAT_SIZE / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569" fontWeight="600">COND</text>
          </g>
        )}

        <line x1={aisleX} y1={PADDING} x2={aisleX} y2={totalHeight - PADDING} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4,4" />

        {shape.hasBathroom && shape.bathroomRow !== undefined && shape.bathroomCol !== undefined && (
          <g>
            <rect
              x={getColX(shape.bathroomCol)}
              y={getRowY(shape.bathroomRow)}
              width={SEAT_SIZE}
              height={SEAT_SIZE}
              rx={6}
              fill="#bfdbfe"
              stroke="#93c5fd"
              strokeWidth={1.5}
            />
            <text x={getColX(shape.bathroomCol) + SEAT_SIZE / 2} y={getRowY(shape.bathroomRow) + SEAT_SIZE / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#1d4ed8" fontWeight="600">WC</text>
          </g>
        )}

        {Array.from({ length: shape.totalRows }, (_, row) =>
          Array.from({ length: shape.totalCols }, (_, col) => {
            const key = `${row}-${col}`;
            const seat = seatMap[key];
            if (!seat) return null;

            const isSelected = selected.includes(seat.number);
            const isDisabled = seat.status !== 'disponible';
            const x = getColX(col);
            const y = getRowY(row);

            let fill = '#ffffff';
            let stroke = '#d1d5db';
            let textFill = '#374151';
            let opacity = 1;

            if (isSelected) { fill = '#2563eb'; stroke = '#1d4ed8'; textFill = '#ffffff'; }
            else if (seat.status === 'reservado') { fill = '#9ca3af'; stroke = '#6b7280'; textFill = '#4b5563'; }
            else if (seat.status === 'bloqueado') { fill = '#6b7280'; stroke = '#4b5563'; textFill = '#374151'; opacity = 0.7; }

            return (
              <g
                key={key}
                onClick={() => !isDisabled && onSeatClick(seat)}
                style={{ cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                opacity={opacity}
              >
                <title>{getSeatTitle(seat)}</title>
                <rect
                  x={x}
                  y={y}
                  width={SEAT_SIZE}
                  height={SEAT_SIZE}
                  rx={6}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={isSelected ? 2 : 1.5}
                />
                <text
                  x={x + SEAT_SIZE / 2}
                  y={y + SEAT_SIZE / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={11}
                  fontWeight={isSelected ? '700' : '500'}
                  fill={textFill}
                >
                  {seat.number}
                </text>
                {isSelected && (
                  <circle cx={x + SEAT_SIZE - 7} cy={y + 7} r={5} fill="#ffffff" />
                )}
                {isSelected && (
                  <path d={`M ${x + SEAT_SIZE - 10} ${y + 7} l 3 3 l 4 -4`} stroke="#2563eb" strokeWidth={1.5} fill="none" />
                )}
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
};

const SeatMapPicker: React.FC<SeatMapPickerProps> = ({
  tourId,
  slotId,
  requiredSeats,
  onSeatsSelected,
  selectedSeats = [],
  disabled = false,
}) => {
  const [layout, setLayout] = useState<VehicleSeatLayout | null>(null);
  const [seatsWithStatus, setSeatsWithStatus] = useState<SeatWithStatus[]>([]);
  const [selected, setSelected] = useState<number[]>(selectedSeats);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
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

      // When a slot is selected, fetch both slot-specific statuses AND global blocks (slot_id = null).
      // Global blocks are created when the agency blocks a seat before any slots exist.
      let statusData: any[] = [];
      if (slotId) {
        const [slotResult, globalResult] = await Promise.all([
          supabase
            .from('slot_seat_status')
            .select('seat_number, status, booking_id, block_note')
            .eq('tour_id', tourId)
            .eq('slot_id', slotId),
          supabase
            .from('slot_seat_status')
            .select('seat_number, status, booking_id, block_note')
            .eq('tour_id', tourId)
            .is('slot_id', null)
            .in('status', ['bloqueado_agencia']),
        ]);
        // Slot-specific records take precedence; globals fill in the rest
        const slotMap: Record<number, any> = {};
        (globalResult.data || []).forEach((s: any) => { slotMap[s.seat_number] = s; });
        (slotResult.data || []).forEach((s: any) => { slotMap[s.seat_number] = s; });
        statusData = Object.values(slotMap);
      } else {
        const { data } = await supabase
          .from('slot_seat_status')
          .select('seat_number, status, booking_id, block_note')
          .eq('tour_id', tourId)
          .is('slot_id', null);
        statusData = data || [];
      }

      const statusMap: Record<number, { status: string; booking_id: string | null; block_note: string | null }> = {};
      statusData.forEach((s: any) => {
        const normalized = s.status === 'bloqueado_agencia' ? 'bloqueado'
          : s.status === 'reservado_online' ? 'reservado'
          : s.status;
        statusMap[s.seat_number] = { status: normalized, booking_id: s.booking_id, block_note: s.block_note };
      });

      const combined: SeatWithStatus[] = parsedLayout.seats.map(seat => ({
        ...seat,
        status: (statusMap[seat.number]?.status as any) || 'disponible',
        booking_id: statusMap[seat.number]?.booking_id || null,
        block_note: statusMap[seat.number]?.block_note || null,
      }));

      setSeatsWithStatus(combined);
    } catch (err: any) {
      setError('Error al cargar el mapa de asientos.');
    } finally {
      setIsLoading(false);
    }
  }, [tourId, slotId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const channel = supabase
      .channel(`seat-status-${tourId}-${slotId || 'no-slot'}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'slot_seat_status',
        filter: `tour_id=eq.${tourId}`,
      }, () => {
        loadData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tourId, slotId, loadData]);

  const handleSeatClick = (seat: SeatWithStatus) => {
    if (disabled || seat.status !== 'disponible') return;

    setSelected(prev => {
      let next: number[];
      if (prev.includes(seat.number)) {
        next = prev.filter(n => n !== seat.number);
      } else if (prev.length < requiredSeats) {
        next = [...prev, seat.number];
      } else {
        next = [...prev.slice(1), seat.number];
      }
      onSeatsSelected(next);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-gray-600">Cargando mapa de asientos...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  if (!layout) return null;

  const availableCount = seatsWithStatus.filter(s => s.status === 'disponible').length;
  const isComplete = selected.length === requiredSeats;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          <span className="font-semibold text-gray-800">Selecciona tus asientos</span>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${isComplete ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
          {isComplete && <CheckCircle className="w-4 h-4" />}
          {selected.length} / {requiredSeats} asientos
        </div>
      </div>

      {!isComplete && (
        <p className="text-sm text-gray-500">
          Selecciona <strong>{requiredSeats - selected.length}</strong> asiento{requiredSeats - selected.length !== 1 ? 's' : ''} mas para continuar.
          {availableCount < requiredSeats && (
            <span className="ml-1 text-amber-600 font-medium">Solo hay {availableCount} disponibles.</span>
          )}
        </p>
      )}

      <div className="overflow-auto pb-2">
        <div className="min-w-max mx-auto">
          <SeatGrid
            seats={seatsWithStatus}
            shape={layout.vehicle_shape}
            selected={selected}
            onSeatClick={handleSeatClick}
          />
        </div>
      </div>

      <div className="flex items-center gap-6 text-xs text-gray-500 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded border-2 border-gray-300 bg-white" />
          <span>Disponible</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded border-2 border-blue-700 bg-blue-600" />
          <span>Seleccionado</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded border-2 border-gray-400 bg-gray-300" />
          <span>Ocupado</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded border-2 border-gray-500 bg-gray-400 opacity-70" />
          <span>Bloqueado</span>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Asientos seleccionados: </span>
            {selected.sort((a, b) => a - b).join(', ')}
          </p>
        </div>
      )}
    </div>
  );
};

export default SeatMapPicker;
