import React from 'react';
import { Users, Info } from 'lucide-react';

interface MinTravelersAlertProps {
  minTravelersRequired: number;
  confirmationHours: number;
  currentSlotBooked?: number;
}

const MinTravelersAlert: React.FC<MinTravelersAlertProps> = ({
  minTravelersRequired,
  confirmationHours,
  currentSlotBooked = 0,
}) => {
  const remaining = Math.max(0, minTravelersRequired - currentSlotBooked);
  const isReached = remaining === 0;

  return (
    <div className={`rounded-xl border p-4 ${
      isReached
        ? 'bg-green-50 border-green-200'
        : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isReached ? 'bg-green-100' : 'bg-amber-100'
        }`}>
          <Users className={`w-4 h-4 ${isReached ? 'text-green-600' : 'text-amber-600'}`} />
        </div>
        <div>
          {isReached ? (
            <>
              <p className="font-semibold text-green-800 text-sm">Salida confirmada</p>
              <p className="text-green-700 text-xs mt-0.5">
                Esta salida ya alcanzó el mínimo de viajeros requeridos y está confirmada.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-amber-800 text-sm">Salida sujeta a confirmación</p>
              <p className="text-amber-700 text-xs mt-0.5">
                Esta salida se confirma cuando se alcancen{' '}
                <strong>{minTravelersRequired} viajeros</strong>. Actualmente hay{' '}
                <strong>{currentSlotBooked}</strong>. Si no se alcanza el mínimo,{' '}
                serás notificado con{' '}
                <strong>{confirmationHours} horas</strong> de anticipación y recibirás un reembolso completo.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MinTravelersAlert;
