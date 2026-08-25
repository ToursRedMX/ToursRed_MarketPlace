import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, Sparkles, ArrowRight, Loader2, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface SlotInfo {
  tour_name: string;
  plan_name: string;
  starts_at: string;
  expires_at: string;
  total_amount: number;
}

const FeaturedSlotSuccessPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const slotId = params.get('slot_id');
  const paypalToken = params.get('token');
  const mpCollectionStatus = params.get('collection_status');

  const [slot, setSlot] = useState<SlotInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slotId) { setLoading(false); return; }
    confirm();
  }, [slotId]);

  const confirm = async () => {
    // PayPal: capture order before polling
    if (paypalToken) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/capture-paypal-order`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              orderId: paypalToken,
              context: 'featured_slot',
              slotId,
            }),
          }
        );
        const result = await res.json();
        if (!result.success) {
          setError(result.error || 'Error al confirmar el pago con PayPal.');
          setLoading(false);
          return;
        }
      } catch {
        setError('Error al contactar el servidor de pagos. Si el cargo fue aplicado, contacta soporte.');
        setLoading(false);
        return;
      }
    }

    // MP cancellation / failure — show cancelled state
    if (mpCollectionStatus && mpCollectionStatus !== 'approved') {
      setError('El pago fue cancelado o rechazado.');
      setLoading(false);
      return;
    }

    // Poll for active status (webhook or capture already fired above)
    poll();
  };

  const poll = async (attempts = 0) => {
    const { data } = await supabase
      .from('featured_tour_slots')
      .select(`
        status, total_amount, starts_at, expires_at,
        tours (name),
        featured_plans (name)
      `)
      .eq('id', slotId!)
      .maybeSingle();

    if (data?.status === 'active') {
      setSlot({
        tour_name: (data.tours as any)?.name ?? 'Tour',
        plan_name: (data.featured_plans as any)?.name ?? 'Plan',
        starts_at: data.starts_at,
        expires_at: data.expires_at,
        total_amount: Number(data.total_amount),
      });
      setLoading(false);
    } else if (attempts < 10) {
      setTimeout(() => poll(attempts + 1), 2000);
    } else {
      setLoading(false);
    }
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className={`p-8 text-center ${error ? 'bg-gradient-to-r from-red-500 to-red-600' : 'bg-gradient-to-r from-amber-500 to-orange-500'}`}>
          <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            {loading ? (
              <Loader2 className="w-10 h-10 text-white animate-spin" />
            ) : error ? (
              <XCircle className="w-10 h-10 text-white" />
            ) : (
              <CheckCircle className="w-10 h-10 text-white" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-white">
            {loading ? 'Procesando pago...' : error ? 'Error en el pago' : '¡Pago confirmado!'}
          </h1>
          <p className="text-white/80 mt-1 text-sm">
            {loading
              ? 'Estamos activando tu tour destacado'
              : error
              ? error
              : 'Tu tour ya aparece como destacado'}
          </p>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {loading ? (
            <p className="text-center text-gray-500 text-sm py-4">
              Esto puede tardar unos segundos...
            </p>
          ) : error ? null : slot ? (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span className="font-semibold text-gray-800 text-sm">Detalles del destacado</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <span className="text-gray-500">Tour</span>
                  <span className="font-medium text-gray-800 text-right">{slot.tour_name}</span>
                  <span className="text-gray-500">Plan</span>
                  <span className="font-medium text-gray-800 text-right">{slot.plan_name}</span>
                  {slot.starts_at && (
                    <>
                      <span className="text-gray-500">Inicio</span>
                      <span className="font-medium text-gray-800 text-right">{fmt(slot.starts_at)}</span>
                    </>
                  )}
                  {slot.expires_at && (
                    <>
                      <span className="text-gray-500">Vence</span>
                      <span className="font-medium text-gray-800 text-right">{fmt(slot.expires_at)}</span>
                    </>
                  )}
                  <span className="text-gray-500">Total pagado</span>
                  <span className="font-bold text-amber-600 text-right">
                    ${slot.total_amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
                  </span>
                </div>
              </div>

              <p className="text-xs text-gray-400 text-center">
                El CFDI/factura se enviará automáticamente a tu correo registrado.
              </p>
            </>
          ) : (
            <p className="text-center text-gray-500 text-sm py-4">
              El pago fue recibido. Tu tour destacado se activará en breve.
            </p>
          )}

          <button
            onClick={() => navigate('/agency/tours')}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
          >
            Ver mis tours
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeaturedSlotSuccessPage;
