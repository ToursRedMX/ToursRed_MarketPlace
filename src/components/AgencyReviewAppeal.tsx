import { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { mensajeDeError } from '../lib/errores';

export interface SolicitudDeResena {
  tipo: 'desacuerdo' | 'lenguaje';
  resultado: 'mantenida' | 'ocultada' | null;
  folio: string | null;
}

interface AgencyReviewAppealProps {
  reviewId: string;
  agencyName: string;
  rating: number;
  solicitud: SolicitudDeResena | null;
  onEnviada: () => void;
}

/**
 * La agencia dueña apela una resena que no comparte ("No estoy de acuerdo") o la reporta
 * por lenguaje inadecuado o irrespetuoso. La solicitud es un ticket de soporte normal
 * (folio y correos) ligado a la resena; la base comprueba que el ticket sea suyo y de
 * ESTA resena, y que ella sea la agencia resenada. La resena sigue visible mientras se
 * revisa. Solo se monta para el dueño de la agencia.
 */
export default function AgencyReviewAppeal({ reviewId, agencyName, rating, solicitud, onEnviada }: AgencyReviewAppealProps) {
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<'desacuerdo' | 'lenguaje'>('desacuerdo');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const enviar = async () => {
    setEnviando(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');

      const { data: subcategoria, error: errorSub } = await supabase
        .from('support_subcategories')
        .select('id')
        .eq('nomenclatura', 'RESA')
        .eq('activa', true)
        .maybeSingle();
      if (errorSub || !subcategoria) throw new Error('No encontramos el tipo de solicitud. Intenta más tarde.');

      const etiqueta = tipo === 'lenguaje' ? 'Reporte de lenguaje inadecuado o irrespetuoso' : 'Apelación (no estoy de acuerdo)';
      const respuesta = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/support-create-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          tipo: 'agency',
          subcategory_id: subcategoria.id,
          solicitante_nombre: agencyName,
          solicitante_email: session.user.email,
          descripcion: `${etiqueta} sobre una reseña de ${rating} ${rating === 1 ? 'estrella' : 'estrellas'} a ${agencyName}.\n\nMotivo: ${motivo.trim()}`,
          user_id: session.user.id,
          extra_data: { motivo: 'apelacion_resena_agencia', review_id: reviewId, tipo },
        }),
      });
      const ticket = await respuesta.json();
      if (!respuesta.ok) throw new Error(ticket.error ?? 'No se pudo crear la solicitud');

      const { data: vinculo, error: errorVinculo } = await supabase.rpc('apelar_resena_agencia', {
        p_review_id: reviewId,
        p_ticket_id: ticket.ticket_id,
        p_tipo: tipo,
      });
      if (errorVinculo) throw errorVinculo;
      if (!vinculo?.success) throw new Error(vinculo?.error ?? 'No se pudo registrar la solicitud');

      setAbierto(false);
      setMotivo('');
      onEnviada();
    } catch (err) {
      console.error('Error al solicitar la revisión de la reseña:', err);
      setError(mensajeDeError(err) || 'No se pudo enviar la solicitud de revisión.');
    } finally {
      setEnviando(false);
    }
  };

  if (solicitud) {
    const folio = solicitud.folio ? ` (folio ${solicitud.folio})` : '';
    return (
      <p className="text-xs mt-3 text-amber-700">
        {solicitud.resultado === 'mantenida'
          ? `Soporte revisó tu solicitud y la reseña se mantuvo${folio}.`
          : `Enviaste esta reseña a revisión${folio}. Soporte la está revisando.`}
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setAbierto(true); setError(''); }}
        className="mt-3 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"
      >
        <Flag className="h-3 w-3" />
        Apelar o reportar
      </button>

      {abierto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-lg font-semibold">Apelar o reportar una reseña</h3>
              <button type="button" onClick={() => setAbierto(false)} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>

            <fieldset className="space-y-2 mb-3">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="radio" name="tipo-solicitud" checked={tipo === 'desacuerdo'} onChange={() => setTipo('desacuerdo')} className="mt-1" />
                <span><strong>No estoy de acuerdo.</strong> La reseña no refleja lo que pasó.</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="radio" name="tipo-solicitud" checked={tipo === 'lenguaje'} onChange={() => setTipo('lenguaje')} className="mt-1" />
                <span><strong>Lenguaje inadecuado o irrespetuoso.</strong> Ofensas, insultos o contenido indebido.</span>
              </label>
            </fieldset>

            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={4}
              maxLength={1000}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Explica el motivo (mínimo 20 caracteres)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Soporte la revisará y podrá ocultarla. Mientras tanto la reseña sigue visible.
            </p>
            {error && <p className="text-sm text-red-700 mt-2">{error}</p>}

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={enviar}
                disabled={enviando || motivo.trim().length < 20}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {enviando ? 'Enviando...' : 'Enviar a soporte'}
              </button>
              <button type="button" onClick={() => setAbierto(false)} disabled={enviando} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
