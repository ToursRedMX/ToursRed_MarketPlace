import type { SeatFeature } from '../../types/seats';

const STYLES: Record<SeatFeature['kind'], { fill: string; stroke: string; text: string }> = {
  floor: { fill: 'none', stroke: 'none', text: '#1e293b' },
  stairs: { fill: '#e2e8f0', stroke: '#cbd5e1', text: '#475569' },
  wc: { fill: '#dbeafe', stroke: '#93c5fd', text: '#1d4ed8' },
  luggage: { fill: '#f1f5f9', stroke: '#cbd5e1', text: '#475569' },
};

interface Props {
  features?: SeatFeature[];
  colX: (col: number) => number;
  rowY: (row: number) => number;
  seatSize: number;
}

/** Piezas del vehículo que no son asientos (encabezado de piso, gradas, baños, equipaje). */
export default function SeatMapFeatures({ features, colX, rowY, seatSize }: Props) {
  if (!features?.length) return null;
  return (
    <g>
      {features.map((f, i) => {
        const x = colX(f.col);
        const y = rowY(f.row);
        const width = colX(f.col + (f.colSpan ?? 1) - 1) + seatSize - x;
        const height = rowY(f.row + (f.rowSpan ?? 1) - 1) + seatSize - y;
        const st = STYLES[f.kind];
        const isFloor = f.kind === 'floor';
        return (
          <g key={i}>
            {!isFloor && <rect x={x} y={y} width={width} height={height} rx={6} fill={st.fill} stroke={st.stroke} strokeWidth={1.5} />}
            {isFloor && <line x1={x} y1={y + height - 2} x2={x + width} y2={y + height - 2} stroke="#cbd5e1" strokeWidth={1} />}
            <text
              x={x + width / 2}
              y={y + height / 2 + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={isFloor ? 13 : 10}
              fontWeight={isFloor ? 700 : 600}
              fill={st.text}
            >
              {f.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
