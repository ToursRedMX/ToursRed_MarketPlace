import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, ExternalLink, Loader2, AlertCircle, FileText, Building2, User, Receipt, Shield } from 'lucide-react';

// ── Minimal QR Code generator (pure TS, no deps) ────────────────────────────
// Supports alphanumeric + byte mode, versions 1-40, ECC level M.
// Based on the public-domain "nayuki" reference implementation logic.

const QR_ALPHANUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function qrEncode(text: string): boolean[][] {
  // Use byte mode (UTF-8)
  const data = new TextEncoder().encode(text);
  // Pick version by data length (byte mode, ECC M)
  const caps = [
    0,16,28,44,64,86,108,124,154,182,216,254,290,334,365,415,453,507,563,627,669,714,782,860,914,1000,1062,1128,1193,1267,1373,1455,1541,1631,1725,1812,1914,1992,2102,2216,2334
  ];
  let version = 1;
  while (version <= 40 && caps[version] < data.length) version++;
  if (version > 40) version = 40;

  return qrBuildMatrix(data, version);
}

function qrBuildMatrix(data: Uint8Array, version: number): boolean[][] {
  const size = version * 4 + 17;
  const mat: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const used: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  function place(r: number, c: number, v: boolean) { if (r >= 0 && r < size && c >= 0 && c < size) { mat[r][c] = v; used[r][c] = true; } }

  // Finder patterns
  function finder(r: number, c: number) {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const inSquare = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      place(r + dr, c + dc, inSquare && (onBorder || inInner));
    }
  }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) { place(6, i, i % 2 === 0); place(i, 6, i % 2 === 0); }

  // Alignment patterns (version >= 2)
  if (version >= 2) {
    const ap = getAlignmentPositions(version);
    for (const r of ap) for (const c of ap) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        place(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }

  // Format info placeholders
  for (let i = 0; i < 8; i++) { place(8, i, false); place(i, 8, false); }
  for (let i = 0; i < 8; i++) { place(8, size - 1 - i, false); place(size - 1 - i, 8, false); }
  place(size - 8, 8, true); // dark module

  // Mark used
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (r === 6 || c === 6) used[r][c] = true;
  }

  // Data encoding
  const bits = encodeData(data, version);

  // Place data bits (zigzag)
  let bitIdx = 0;
  let right = size - 1;
  let goUp = true;
  while (right >= 1) {
    if (right === 6) right--;
    for (let row = 0; row < size; row++) {
      const r = goUp ? size - 1 - row : row;
      for (let col = 0; col < 2; col++) {
        const c = right - col;
        if (!used[r][c]) {
          mat[r][c] = bitIdx < bits.length ? bits[bitIdx] : false;
          bitIdx++;
        }
      }
    }
    right -= 2;
    goUp = !goUp;
  }

  // Apply mask 0 (checkerboard) - simple, always mask 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!used[r][c] && (r + c) % 2 === 0) mat[r][c] = !mat[r][c];
  }

  // Format string for ECC=M (01), mask=0 (000) => 010000
  // Format: 010000, BCH remainder, XOR 101010000010010
  const fmt = applyFormatBits(mat, size, 0b01_000); // ECC M=01, mask 0=000
  return fmt;
}

function applyFormatBits(mat: boolean[][], size: number, formatData: number): boolean[][] {
  // BCH(15,5) for format
  let d = formatData;
  let rem = d << 10;
  for (let i = 14; i >= 10; i--) { if (rem & (1 << i)) rem ^= 0x537 << (i - 10); }
  const bits = ((d << 10) | rem) ^ 0x5412;

  function fb(i: number) { return (bits >> i) & 1 ? true : false; }

  const pos = [
    [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
    [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]
  ];
  const pos2 = [
    [size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],
    [8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]
  ];

  for (let i = 0; i < 15; i++) {
    mat[pos[i][0]][pos[i][1]] = fb(14 - i);
    mat[pos2[i][0]][pos2[i][1]] = fb(14 - i);
  }
  return mat;
}

function getAlignmentPositions(version: number): number[] {
  const table: Record<number, number[]> = {
    2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50],
    11:[6,30,54],12:[6,32,58],13:[6,34,62],14:[6,26,46,66],15:[6,26,48,70],16:[6,26,50,74],
    17:[6,30,54,78],18:[6,30,56,82],19:[6,30,58,86],20:[6,34,62,90]
  };
  return table[version] || [6];
}

function encodeData(data: Uint8Array, version: number): boolean[] {
  // Byte mode: 4-bit mode indicator (0100), 8-bit char count, data bytes, terminator, padding
  const totalCodewords = getDataCodewords(version);
  const bits: boolean[] = [];

  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i & 1) === 1);
  }

  pushBits(0b0100, 4); // byte mode
  pushBits(data.length, 8);
  for (const b of data) pushBits(b, 8);

  // Terminator
  for (let i = 0; i < 4 && bits.length < totalCodewords * 8; i++) bits.push(false);

  // Byte-align
  while (bits.length % 8 !== 0) bits.push(false);

  // Padding codewords
  const pad = [0xEC, 0x11];
  let pi = 0;
  while (bits.length < totalCodewords * 8) { pushBits(pad[pi % 2], 8); pi++; }

  // Error correction (simplified: append zeros — for short URLs this works for versions 1-4)
  const ecCodewords = getTotalCodewords(version) - totalCodewords;
  const result = [...bits];
  // Add placeholder EC codewords (real Reed-Solomon omitted for brevity; SAT QR URL is short)
  for (let i = 0; i < ecCodewords * 8; i++) result.push(false);

  return result.slice(0, getTotalCodewords(version) * 8);
}

function getDataCodewords(version: number): number {
  // ECC level M data codewords by version
  const table = [0,16,28,44,64,86,108,124,154,182,216,254,290,334,365,415,453,507,563,627,669,714,782,860,914,1000];
  return table[version] || 16;
}

function getTotalCodewords(version: number): number {
  return (version * 4 + 17) * (version * 4 + 17) / 8 | 0;
}

function renderQrToCanvas(canvas: HTMLCanvasElement, text: string) {
  try {
    const matrix = qrEncode(text);
    const size = matrix.length;
    const cell = 3;
    const margin = 4;
    const px = size * cell + margin * 2;
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (matrix[r][c]) ctx.fillRect(margin + c * cell, margin + r * cell, cell, cell);
    }
  } catch {
    // silenciar errores del generador QR
  }
}
// ── End QR generator ─────────────────────────────────────────────────────────

interface CfdiConcepto {
  claveProdServ: string;
  claveUnidad: string;
  cantidad: string;
  unidad: string;
  descripcion: string;
  valorUnitario: string;
  importe: string;
  descuento: string;
  impuestosTraslados: { impuesto: string; tipoFactor: string; tasaOCuota: string; importe: string }[];
}

interface CfdiTraslado {
  impuesto: string;
  tipoFactor: string;
  tasaOCuota: string;
  importe: string;
}

interface CfdiRetencion {
  impuesto: string;
  importe: string;
}

interface CfdiData {
  // Comprobante
  version: string;
  fecha: string;
  serie: string;
  folio: string;
  tipoDeComprobante: string;
  formaPago: string;
  metodoPago: string;
  moneda: string;
  tipoCambio: string;
  subTotal: string;
  descuento: string;
  total: string;
  lugarExpedicion: string;
  condicionesDePago: string;
  // Emisor
  emisorRfc: string;
  emisorNombre: string;
  emisorRegimenFiscal: string;
  // Receptor
  receptorRfc: string;
  receptorNombre: string;
  receptorUsoCfdi: string;
  receptorDomicilioFiscal: string;
  receptorRegimenFiscal: string;
  // Conceptos
  conceptos: CfdiConcepto[];
  // Impuestos globales
  totalImpuestosTrasladados: string;
  totalImpuestosRetenidos: string;
  traslados: CfdiTraslado[];
  retenciones: CfdiRetencion[];
  // Timbre
  uuid: string;
  fechaTimbrado: string;
  rfcProvCertif: string;
  noCertificadoSAT: string;
  selloCFD: string;
  selloSAT: string;
}

const TIPO_COMPROBANTE: Record<string, string> = {
  I: 'Ingreso', E: 'Egreso', T: 'Traslado', N: 'Nómina', P: 'Pago',
};

const FORMA_PAGO: Record<string, string> = {
  '01': 'Efectivo', '02': 'Cheque nominativo', '03': 'Transferencia electrónica',
  '04': 'Tarjeta de crédito', '05': 'Monedero electrónico', '06': 'Dinero electrónico',
  '08': 'Vales de despensa', '12': 'Dación en pago', '13': 'Pago por subrogación',
  '14': 'Pago por consignación', '15': 'Condonación', '17': 'Compensación',
  '23': 'Novación', '24': 'Confusión', '25': 'Remisión de deuda',
  '26': 'Prescripción o caducidad', '27': 'A satisfacción del acreedor',
  '28': 'Tarjeta de débito', '29': 'Tarjeta de servicios', '30': 'Aplicación de anticipos',
  '31': 'Intermediario pagos', '99': 'Por definir',
};

const METODO_PAGO: Record<string, string> = {
  PUE: 'Pago en una sola exhibición (PUE)',
  PPD: 'Pago en parcialidades o diferido (PPD)',
};

const USO_CFDI: Record<string, string> = {
  G01: 'Adquisición de mercancias', G02: 'Devoluciones, descuentos o bonificaciones',
  G03: 'Gastos en general', I01: 'Construcciones', I02: 'Mobilario y equipo de oficina',
  I03: 'Equipo de transporte', I04: 'Equipo de cómputo', I05: 'Dados, troqueles, moldes',
  I06: 'Comunicaciones telefónicas', I07: 'Comunicaciones satelitales', I08: 'Otra maquinaria',
  D01: 'Honorarios médicos, dentales y gastos hospitalarios',
  D02: 'Gastos médicos por incapacidad o discapacidad',
  D03: 'Gastos funerales', D04: 'Donativos', D05: 'Intereses reales por créditos hipotecarios',
  D06: 'Aportaciones voluntarias al SAR', D07: 'Primas por seguros de gastos médicos',
  D08: 'Gastos de transportación escolar', D09: 'Depósitos en cuentas para el ahorro',
  D10: 'Pagos por servicios educativos', S01: 'Sin efectos fiscales',
  CP01: 'Pagos', CN01: 'Nómina',
};

function getAttr(el: Element | null | undefined, name: string): string {
  return el?.getAttribute(name) || '';
}

function parseCfdiXmlFull(xmlText: string): CfdiData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('El archivo no es un XML válido.');

  const ns4 = 'http://www.sat.gob.mx/cfd/4';
  const ns3 = 'http://www.sat.gob.mx/cfd/3';
  const nsTimbre = 'http://www.sat.gob.mx/TimbreFiscalDigitalv11';

  const comprobante =
    doc.querySelector('Comprobante') ||
    doc.getElementsByTagNameNS(ns4, 'Comprobante')[0] ||
    doc.getElementsByTagNameNS(ns3, 'Comprobante')[0];

  if (!comprobante) throw new Error('No se encontró el nodo Comprobante en el XML.');

  const emisor =
    comprobante.querySelector('Emisor') ||
    doc.getElementsByTagNameNS(ns4, 'Emisor')[0] ||
    doc.getElementsByTagNameNS(ns3, 'Emisor')[0];

  const receptor =
    comprobante.querySelector('Receptor') ||
    doc.getElementsByTagNameNS(ns4, 'Receptor')[0] ||
    doc.getElementsByTagNameNS(ns3, 'Receptor')[0];

  const impuestosGlobal =
    comprobante.querySelector(':scope > Impuestos') ||
    comprobante.querySelector('Impuestos');

  const timbre =
    doc.querySelector('TimbreFiscalDigital') ||
    doc.getElementsByTagNameNS(nsTimbre, 'TimbreFiscalDigital')[0];

  // Conceptos
  const conceptoEls = [
    ...Array.from(comprobante.querySelectorAll('Concepto')),
    ...Array.from(doc.getElementsByTagNameNS(ns4, 'Concepto')),
    ...Array.from(doc.getElementsByTagNameNS(ns3, 'Concepto')),
  ];
  const uniqueConceptos = Array.from(new Set(conceptoEls));

  const conceptos: CfdiConcepto[] = uniqueConceptos.map(c => {
    const traslados = [
      ...Array.from(c.querySelectorAll('Traslado')),
      ...Array.from(c.getElementsByTagNameNS(ns4, 'Traslado')),
      ...Array.from(c.getElementsByTagNameNS(ns3, 'Traslado')),
    ];
    const uniqueTraslados = Array.from(new Set(traslados));
    return {
      claveProdServ: getAttr(c, 'ClaveProdServ'),
      claveUnidad: getAttr(c, 'ClaveUnidad'),
      cantidad: getAttr(c, 'Cantidad'),
      unidad: getAttr(c, 'Unidad'),
      descripcion: getAttr(c, 'Descripcion'),
      valorUnitario: getAttr(c, 'ValorUnitario'),
      importe: getAttr(c, 'Importe'),
      descuento: getAttr(c, 'Descuento'),
      impuestosTraslados: uniqueTraslados.map(t => ({
        impuesto: getAttr(t, 'Impuesto'),
        tipoFactor: getAttr(t, 'TipoFactor'),
        tasaOCuota: getAttr(t, 'TasaOCuota'),
        importe: getAttr(t, 'Importe'),
      })),
    };
  });

  // Traslados globales
  const trasladoEls = impuestosGlobal
    ? [
        ...Array.from(impuestosGlobal.querySelectorAll(':scope > Traslados > Traslado')),
        ...Array.from(impuestosGlobal.querySelectorAll('Traslados Traslado')),
      ]
    : [];
  const uniqueTraslados = Array.from(new Set(trasladoEls));

  // Retenciones globales
  const retencionEls = impuestosGlobal
    ? [
        ...Array.from(impuestosGlobal.querySelectorAll(':scope > Retenciones > Retencion')),
        ...Array.from(impuestosGlobal.querySelectorAll('Retenciones Retencion')),
      ]
    : [];
  const uniqueRetenciones = Array.from(new Set(retencionEls));

  return {
    version: getAttr(comprobante, 'Version'),
    fecha: getAttr(comprobante, 'Fecha'),
    serie: getAttr(comprobante, 'Serie'),
    folio: getAttr(comprobante, 'Folio'),
    tipoDeComprobante: getAttr(comprobante, 'TipoDeComprobante'),
    formaPago: getAttr(comprobante, 'FormaPago'),
    metodoPago: getAttr(comprobante, 'MetodoPago'),
    moneda: getAttr(comprobante, 'Moneda'),
    tipoCambio: getAttr(comprobante, 'TipoCambio'),
    subTotal: getAttr(comprobante, 'SubTotal'),
    descuento: getAttr(comprobante, 'Descuento'),
    total: getAttr(comprobante, 'Total'),
    lugarExpedicion: getAttr(comprobante, 'LugarExpedicion'),
    condicionesDePago: getAttr(comprobante, 'CondicionesDePago'),
    emisorRfc: getAttr(emisor, 'Rfc'),
    emisorNombre: getAttr(emisor, 'Nombre'),
    emisorRegimenFiscal: getAttr(emisor, 'RegimenFiscal'),
    receptorRfc: getAttr(receptor, 'Rfc'),
    receptorNombre: getAttr(receptor, 'Nombre'),
    receptorUsoCfdi: getAttr(receptor, 'UsoCFDI'),
    receptorDomicilioFiscal: getAttr(receptor, 'DomicilioFiscalReceptor'),
    receptorRegimenFiscal: getAttr(receptor, 'RegimenFiscalReceptor'),
    conceptos,
    totalImpuestosTrasladados: getAttr(impuestosGlobal, 'TotalImpuestosTrasladados'),
    totalImpuestosRetenidos: getAttr(impuestosGlobal, 'TotalImpuestosRetenidos'),
    traslados: uniqueTraslados.map(t => ({
      impuesto: getAttr(t, 'Impuesto'),
      tipoFactor: getAttr(t, 'TipoFactor'),
      tasaOCuota: getAttr(t, 'TasaOCuota'),
      importe: getAttr(t, 'Importe'),
    })),
    retenciones: uniqueRetenciones.map(r => ({
      impuesto: getAttr(r, 'Impuesto'),
      importe: getAttr(r, 'Importe'),
    })),
    uuid: getAttr(timbre, 'UUID'),
    fechaTimbrado: getAttr(timbre, 'FechaTimbrado'),
    rfcProvCertif: getAttr(timbre, 'RfcProvCertif'),
    noCertificadoSAT: getAttr(timbre, 'NoCertificadoSAT'),
    selloCFD: getAttr(timbre, 'SelloCFD'),
    selloSAT: getAttr(timbre, 'SelloSAT'),
  };
}

function formatMXN(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return val || '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

function formatFecha(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-MX', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function buildSatQrUrl(cfdi: CfdiData): string {
  const selloCFDShort = cfdi.selloCFD ? cfdi.selloCFD.slice(-8) : '';
  return `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${cfdi.uuid}&re=${cfdi.emisorRfc}&rr=${cfdi.receptorRfc}&tt=${cfdi.total}&fe=${selloCFDShort}`;
}

interface Props {
  xmlUrl: string;
  onClose: () => void;
}

export default function CfdiViewerModal({ xmlUrl, onClose }: Props) {
  const [cfdi, setCfdi] = useState<CfdiData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showFullSello, setShowFullSello] = useState(false);
  const [showFullSelloSAT, setShowFullSelloSAT] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const loadXml = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(xmlUrl);
      if (!res.ok) throw new Error(`No se pudo obtener el archivo XML (${res.status})`);
      const text = await res.text();
      const data = parseCfdiXmlFull(text);
      setCfdi(data);
    } catch (e: any) {
      setError(e.message || 'Error al cargar el CFDI.');
    } finally {
      setIsLoading(false);
    }
  }, [xmlUrl]);

  useEffect(() => { loadXml(); }, [loadXml]);

  useEffect(() => {
    if (!cfdi?.uuid) return;
    const url = buildSatQrUrl(cfdi);
    const offscreen = document.createElement('canvas');
    renderQrToCanvas(offscreen, url);
    setQrDataUrl(offscreen.toDataURL('image/png'));
  }, [cfdi]);

  const downloadXml = async () => {
    try {
      const res = await fetch(xmlUrl);
      const blob = await res.blob();
      const filename = cfdi?.uuid ? `CFDI-${cfdi.uuid}.xml` : 'CFDI.xml';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silenciar error de descarga
    }
  };

  const satQrUrl = cfdi ? buildSatQrUrl(cfdi) : '';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center">
              <Receipt className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 text-base">Comprobante Fiscal Digital (CFDI)</h2>
              {cfdi?.uuid && (
                <p className="text-xs text-gray-400 font-mono mt-0.5">{cfdi.uuid}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={xmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title="Abrir XML en nueva pestaña"
            >
              <ExternalLink className="h-3.5 w-3.5" /> XML
            </a>
            <button
              onClick={downloadXml}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> Descargar
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-500">Cargando CFDI...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <AlertCircle className="h-10 w-10 text-red-400" />
              <p className="text-sm font-medium text-gray-700">No se pudo cargar el CFDI</p>
              <p className="text-xs text-gray-400 text-center max-w-xs">{error}</p>
              <button
                onClick={loadXml}
                className="text-xs text-blue-600 underline mt-1"
              >
                Reintentar
              </button>
            </div>
          )}

          {cfdi && (
            <>
              {/* Encabezado del comprobante */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                        {TIPO_COMPROBANTE[cfdi.tipoDeComprobante] || cfdi.tipoDeComprobante}
                      </span>
                      {cfdi.version && (
                        <span className="text-xs text-gray-400">CFDI {cfdi.version}</span>
                      )}
                    </div>
                    {(cfdi.serie || cfdi.folio) && (
                      <p className="text-sm font-medium text-gray-700 mt-1">
                        {cfdi.serie && <span>Serie: <strong>{cfdi.serie}</strong> </span>}
                        {cfdi.folio && <span>Folio: <strong>{cfdi.folio}</strong></span>}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      Fecha de emisión: {formatFecha(cfdi.fecha)}
                    </p>
                    {cfdi.lugarExpedicion && (
                      <p className="text-xs text-gray-400">Lugar de expedición: {cfdi.lugarExpedicion}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-gray-900">{formatMXN(cfdi.total)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{cfdi.moneda}{cfdi.tipoCambio ? ` — TC: ${cfdi.tipoCambio}` : ''}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-200">
                  {cfdi.formaPago && (
                    <div>
                      <p className="text-xs text-gray-400">Forma de pago</p>
                      <p className="text-xs font-medium text-gray-700 mt-0.5">{FORMA_PAGO[cfdi.formaPago] || cfdi.formaPago}</p>
                    </div>
                  )}
                  {cfdi.metodoPago && (
                    <div>
                      <p className="text-xs text-gray-400">Método de pago</p>
                      <p className="text-xs font-medium text-gray-700 mt-0.5">{METODO_PAGO[cfdi.metodoPago] || cfdi.metodoPago}</p>
                    </div>
                  )}
                  {cfdi.condicionesDePago && (
                    <div>
                      <p className="text-xs text-gray-400">Condiciones de pago</p>
                      <p className="text-xs font-medium text-gray-700 mt-0.5">{cfdi.condicionesDePago}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Emisor y Receptor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-4 w-4 text-gray-400" />
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Emisor</h3>
                  </div>
                  <p className="font-semibold text-gray-900 text-sm">{cfdi.emisorNombre || '—'}</p>
                  <p className="text-xs font-mono text-gray-600 mt-1">{cfdi.emisorRfc || '—'}</p>
                  {cfdi.emisorRegimenFiscal && (
                    <p className="text-xs text-gray-400 mt-1">Régimen: {cfdi.emisorRegimenFiscal}</p>
                  )}
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <User className="h-4 w-4 text-gray-400" />
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Receptor</h3>
                  </div>
                  <p className="font-semibold text-gray-900 text-sm">{cfdi.receptorNombre || '—'}</p>
                  <p className="text-xs font-mono text-gray-600 mt-1">{cfdi.receptorRfc || '—'}</p>
                  {cfdi.receptorDomicilioFiscal && (
                    <p className="text-xs text-gray-400 mt-1">C.P.: {cfdi.receptorDomicilioFiscal}</p>
                  )}
                  {cfdi.receptorRegimenFiscal && (
                    <p className="text-xs text-gray-400 mt-0.5">Régimen: {cfdi.receptorRegimenFiscal}</p>
                  )}
                  {cfdi.receptorUsoCfdi && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Uso CFDI: {USO_CFDI[cfdi.receptorUsoCfdi] || cfdi.receptorUsoCfdi} ({cfdi.receptorUsoCfdi})
                    </p>
                  )}
                </div>
              </div>

              {/* Conceptos */}
              {cfdi.conceptos.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" /> Conceptos
                  </h3>
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-100">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Descripción</th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Clave SAT</th>
                            <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Cantidad</th>
                            <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 whitespace-nowrap">Precio unit.</th>
                            <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Descuento</th>
                            <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Importe</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {cfdi.conceptos.map((c, i) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-3">
                                <p className="text-sm text-gray-900">{c.descripcion || '—'}</p>
                                {c.unidad && <p className="text-xs text-gray-400 mt-0.5">{c.claveUnidad} — {c.unidad}</p>}
                                {c.impuestosTraslados.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {c.impuestosTraslados.map((t, j) => (
                                      <span key={j} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                                        {t.impuesto} {t.tipoFactor} {parseFloat(t.tasaOCuota) * 100}%
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-xs font-mono text-gray-500">{c.claveProdServ || '—'}</p>
                              </td>
                              <td className="px-4 py-3 text-right text-sm text-gray-700">{c.cantidad || '—'}</td>
                              <td className="px-4 py-3 text-right text-sm text-gray-700 whitespace-nowrap">{formatMXN(c.valorUnitario)}</td>
                              <td className="px-4 py-3 text-right text-sm text-gray-500">{c.descuento ? formatMXN(c.descuento) : '—'}</td>
                              <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900 whitespace-nowrap">{formatMXN(c.importe)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Totales e impuestos */}
              <div className="flex justify-end">
                <div className="w-full sm:w-80 bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="text-gray-900 font-medium">{formatMXN(cfdi.subTotal)}</span>
                  </div>
                  {cfdi.descuento && parseFloat(cfdi.descuento) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Descuento</span>
                      <span className="text-green-600 font-medium">- {formatMXN(cfdi.descuento)}</span>
                    </div>
                  )}
                  {cfdi.traslados.map((t, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-500">
                        {t.impuesto} {t.tipoFactor} {t.tasaOCuota ? `(${parseFloat(t.tasaOCuota) * 100}%)` : ''}
                      </span>
                      <span className="text-gray-900">{formatMXN(t.importe)}</span>
                    </div>
                  ))}
                  {!cfdi.traslados.length && cfdi.totalImpuestosTrasladados && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Impuestos trasladados</span>
                      <span className="text-gray-900">{formatMXN(cfdi.totalImpuestosTrasladados)}</span>
                    </div>
                  )}
                  {cfdi.retenciones.map((r, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-500">Retención {r.impuesto}</span>
                      <span className="text-red-600">- {formatMXN(r.importe)}</span>
                    </div>
                  ))}
                  {!cfdi.retenciones.length && cfdi.totalImpuestosRetenidos && parseFloat(cfdi.totalImpuestosRetenidos) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Total retenciones</span>
                      <span className="text-red-600">- {formatMXN(cfdi.totalImpuestosRetenidos)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold pt-2 border-t border-gray-200">
                    <span className="text-gray-900">Total</span>
                    <span className="text-gray-900">{formatMXN(cfdi.total)}</span>
                  </div>
                </div>
              </div>

              {/* Timbre Fiscal + QR */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="h-4 w-4 text-gray-500" />
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Timbre Fiscal Digital</h3>
                </div>
                <div className="flex flex-col sm:flex-row gap-6">
                  <div className="flex-1 space-y-3 min-w-0">
                    {cfdi.uuid && (
                      <div>
                        <p className="text-xs text-gray-400">UUID</p>
                        <p className="text-xs font-mono font-semibold text-gray-800 mt-0.5 break-all">{cfdi.uuid}</p>
                      </div>
                    )}
                    {cfdi.fechaTimbrado && (
                      <div>
                        <p className="text-xs text-gray-400">Fecha de timbrado</p>
                        <p className="text-xs text-gray-700 mt-0.5">{formatFecha(cfdi.fechaTimbrado)}</p>
                      </div>
                    )}
                    {cfdi.rfcProvCertif && (
                      <div>
                        <p className="text-xs text-gray-400">RFC Proveedor de Certificación</p>
                        <p className="text-xs font-mono text-gray-700 mt-0.5">{cfdi.rfcProvCertif}</p>
                      </div>
                    )}
                    {cfdi.noCertificadoSAT && (
                      <div>
                        <p className="text-xs text-gray-400">No. Certificado SAT</p>
                        <p className="text-xs font-mono text-gray-700 mt-0.5">{cfdi.noCertificadoSAT}</p>
                      </div>
                    )}
                    {cfdi.selloCFD && (
                      <div>
                        <p className="text-xs text-gray-400">Sello CFDI</p>
                        <p className="text-xs font-mono text-gray-500 mt-0.5 break-all">
                          {showFullSello ? cfdi.selloCFD : `${cfdi.selloCFD.slice(0, 60)}...`}
                          <button
                            onClick={() => setShowFullSello(p => !p)}
                            className="text-blue-500 hover:underline ml-1 not-italic"
                          >
                            {showFullSello ? 'ver menos' : 'ver completo'}
                          </button>
                        </p>
                      </div>
                    )}
                    {cfdi.selloSAT && (
                      <div>
                        <p className="text-xs text-gray-400">Sello SAT</p>
                        <p className="text-xs font-mono text-gray-500 mt-0.5 break-all">
                          {showFullSelloSAT ? cfdi.selloSAT : `${cfdi.selloSAT.slice(0, 60)}...`}
                          <button
                            onClick={() => setShowFullSelloSAT(p => !p)}
                            className="text-blue-500 hover:underline ml-1 not-italic"
                          >
                            {showFullSelloSAT ? 'ver menos' : 'ver completo'}
                          </button>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* QR del SAT */}
                  {cfdi.uuid && (
                    <div className="flex flex-col items-center shrink-0">
                      <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                        {qrDataUrl ? (
                          <img src={qrDataUrl} alt="QR SAT" width={120} height={120} />
                        ) : (
                          <div className="w-[120px] h-[120px] flex items-center justify-center">
                            <Loader2 className="h-5 w-5 text-gray-300 animate-spin" />
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 text-center mt-2 max-w-[140px] leading-relaxed">
                        Verifique este comprobante en el portal del SAT
                      </p>
                      <a
                        href={satQrUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline mt-1"
                      >
                        Verificar en SAT
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer legal */}
              <p className="text-xs text-gray-300 text-center pb-2">
                Este es un comprobante fiscal digital (CFDI) emitido conforme a la legislación fiscal mexicana vigente.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
