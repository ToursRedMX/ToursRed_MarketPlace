import type { DepartureSeat } from '../../types/externalSales';
import type { SeatDefinition, VehicleShape } from '../../types/seats';
import { useLayout } from './seatMapData';
import type { SeatBooking } from './seatMapData';

const SEAT = 38;
const GAP = 6;
const AISLE = 22;
const PAD = 16;

function geometry(shape: VehicleShape) {
  const colW = SEAT + GAP;
  const rowH = SEAT + GAP;
  const colX = (c: number) => PAD + c * colW + (c <= shape.aisleAfterCol ? 0 : AISLE);
  const driverOffset = shape.hasDriver && shape.driverRow === 0 ? rowH + 8 : 0;
  const rowY = (r: number) => PAD + driverOffset + r * rowH;
  return {
    colX, rowY,
    width: shape.totalCols * colW + AISLE + PAD * 2,
    height: shape.totalRows * rowH + PAD * 2 + (shape.hasDriver ? rowH + 8 : 0),
    aisleX: (shape.aisleAfterCol + 1) * colW + PAD,
  };
}

type Props = {
  tourId: string;
  seats: DepartureSeat[];
  bookings: Map<string, SeatBooking>;
  activeBookingId: string | null;
  onSelectBooking: (id: string | null) => void;
};

export default function AgendaSeatMap({ tourId, seats, bookings, activeBookingId, onSelectBooking }: Props) {
  const { data: layout, isPending, error } = useLayout(tourId);
  if (isPending) return <div className="h-48 animate-pulse rounded-xl bg-slate-100" />;
  if (error) return <p role="alert" className="text-sm text-red-700">No se pudo cargar el mapa de asientos.</p>;
  if (!layout) return null;

  const { vehicle_shape: shape } = layout;
  const g = geometry(shape);
  const byNumber = new Map(seats.map(s => [s.seat_number, s]));
  const grid = new Map<string, SeatDefinition>(layout.seats.map(s => [`${s.row}-${s.col}`, s]));
  const selectable = layout.seats.filter(s => s.type !== 'driver' && s.type !== 'wc');
  const taken = selectable.filter(s => byNumber.get(s.number)?.status === 'reservado_online').length;
  const blocked = selectable.filter(s => byNumber.get(s.number)?.status === 'bloqueado_agencia').length;
  const free = selectable.length - taken - blocked;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200">{free} libres</span>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-800 ring-1 ring-blue-200">{taken} asignados</span>
        {blocked > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-300">{blocked} bloqueados</span>}
      </div>
      <div className="overflow-x-auto">
        <svg width={g.width} height={g.height} className="mx-auto block" role="img" aria-label="Mapa de asientos de la salida">
          <rect x={0} y={0} width={g.width} height={g.height} rx={18} fill="#f8fafc" stroke="#e2e8f0" strokeWidth={1.5} />
          <line x1={g.aisleX} y1={PAD} x2={g.aisleX} y2={g.height - PAD} stroke="#cbd5e1" strokeDasharray="4,4" />
          {shape.hasDriver && shape.driverRow === 0 && (
            <g>
              <rect x={g.colX(shape.driverCol)} y={PAD} width={SEAT} height={SEAT} rx={8} fill="#cbd5e1" />
              <text x={g.colX(shape.driverCol) + SEAT / 2} y={PAD + SEAT / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={600} fill="#475569">COND</text>
            </g>
          )}
          {shape.hasBathroom && shape.bathroomRow !== undefined && shape.bathroomCol !== undefined && (
            <g>
              <rect x={g.colX(shape.bathroomCol)} y={g.rowY(shape.bathroomRow)} width={SEAT} height={SEAT} rx={8} fill="#dbeafe" />
              <text x={g.colX(shape.bathroomCol) + SEAT / 2} y={g.rowY(shape.bathroomRow) + SEAT / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={600} fill="#1d4ed8">WC</text>
            </g>
          )}
          {Array.from({ length: shape.totalRows }, (_, row) => Array.from({ length: shape.totalCols }, (_, col) => {
            const def = grid.get(`${row}-${col}`);
            if (!def) return null;
            const state = byNumber.get(def.number);
            const booking = state?.booking_id ? bookings.get(state.booking_id) : undefined;
            const isBlocked = state?.status === 'bloqueado_agencia';
            const isTaken = state?.status === 'reservado_online';
            const dimmed = activeBookingId !== null && !(booking && booking.id === activeBookingId);
            const x = g.colX(col);
            const y = g.rowY(row);
            const fill = isBlocked ? '#e2e8f0' : isTaken ? (booking?.color ?? '#64748b') : '#ffffff';
            const stroke = isBlocked ? '#94a3b8' : isTaken ? (booking?.color ?? '#475569') : '#10b981';
            const label = isBlocked
              ? `Asiento ${def.number} · Bloqueado${state?.block_note ? `: ${state.block_note}` : ''}`
              : isTaken
                ? `Asiento ${def.number} · ${booking ? `${booking.holder}${booking.code ? ` (${booking.code})` : ''} · ${booking.people} ${booking.people === 1 ? 'viajero' : 'viajeros'}` : 'Reservado'}`
                : `Asiento ${def.number} · Libre`;
            return (
              <g
                key={def.number}
                opacity={dimmed && isTaken ? 0.3 : 1}
                style={{ cursor: booking ? 'pointer' : 'default' }}
                onClick={() => booking && onSelectBooking(activeBookingId === booking.id ? null : booking.id)}
              >
                <title>{label}</title>
                <rect x={x} y={y} width={SEAT} height={SEAT} rx={8} fill={fill} stroke={stroke} strokeWidth={isTaken && booking?.id === activeBookingId ? 3 : 1.5} strokeDasharray={isBlocked ? '3,3' : undefined} />
                <text x={x + SEAT / 2} y={y + SEAT / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={600} fill={isTaken ? '#ffffff' : isBlocked ? '#64748b' : '#047857'}>{def.number}</text>
              </g>
            );
          }))}
        </svg>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">Toca un asiento ocupado para resaltar toda su reserva.</p>
    </div>
  );
}
