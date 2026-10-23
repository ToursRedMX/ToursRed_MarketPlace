import { useState } from 'react';
import { Star, X, Building } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { comoFilas } from '../lib/relacionesSupabase';
import { mensajeDeError } from '../lib/errores';

interface CalificacionDeAgencia {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  agency: { name: string; logo?: string | null };
}

interface TravelerRatingBadgeProps {
  travelerId: string;
  promedio: number;
  total: number;
}

/**
 * Promedio de lo que otras agencias han calificado a un viajero, al estilo de los
 * anfitriones de Airbnb: se ve en la lista de reservas y, al abrirlo, trae cada
 * calificacion con su comentario. La lectura la gobierna el RLS de traveler_reviews
 * (solo agencias, admin y el propio viajero), no este componente.
 */
export default function TravelerRatingBadge({ travelerId, promedio, total }: TravelerRatingBadgeProps) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [calificaciones, setCalificaciones] = useState<CalificacionDeAgencia[]>([]);

  const abrir = async () => {
    setAbierto(true);
    setCargando(true);
    setError('');
    try {
      const { data, error: errorLectura } = await supabase
        .from('traveler_reviews')
        .select('id, rating, comment, created_at, agency:agencies!traveler_reviews_agency_id_fkey(name, logo)')
        .eq('traveler_id', travelerId)
        .order('created_at', { ascending: false });
      if (errorLectura) throw errorLectura;
      setCalificaciones(comoFilas<CalificacionDeAgencia>(data ?? []));
    } catch (err) {
      console.error('No se pudieron leer las calificaciones del viajero:', err);
      setError(mensajeDeError(err) || 'No pudimos cargar las calificaciones.');
    } finally {
      setCargando(false);
    }
  };

  const estrellas = (valor: number, tam = 'h-4 w-4') => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`${tam} ${n <= Math.round(valor) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
      ))}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-blue-600"
        title="Ver calificaciones de otras agencias"
      >
        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
        <span className="font-medium">{promedio.toFixed(1)}</span>
        <span className="text-gray-500">({total} {total === 1 ? 'calificación' : 'calificaciones'})</span>
      </button>

      {abierto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">Calificaciones del viajero</h2>
                <div className="flex items-center gap-2 mt-1">
                  {estrellas(promedio)}
                  <span className="text-sm text-gray-600">{promedio.toFixed(1)} · {total}</span>
                </div>
              </div>
              <button type="button" onClick={() => setAbierto(false)} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar">
                <X className="h-6 w-6" />
              </button>
            </div>

            {cargando && <p className="text-gray-500 py-6 text-center">Cargando...</p>}
            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</p>}

            <div className="space-y-3">
              {calificaciones.map((c) => (
                <div key={c.id} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.agency?.logo ? (
                        <img src={c.agency.logo} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <Building className="h-4 w-4 text-blue-600" />
                        </div>
                      )}
                      <span className="font-medium text-gray-900 truncate">{c.agency?.name ?? 'Agencia'}</span>
                    </div>
                    {estrellas(c.rating)}
                  </div>
                  {c.comment && <p className="text-sm text-gray-700 mt-2">{c.comment}</p>}
                  <p className="text-xs text-gray-500 mt-2">
                    {new Date(c.created_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-500 mt-4">
              Solo las agencias y el propio viajero pueden ver estas calificaciones.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
