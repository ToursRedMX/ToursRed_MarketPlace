import React from 'react';
import { Receipt } from 'lucide-react';
import AgencyCfdiList from '../../components/AgencyCfdiList';
import { useAgencyId } from '../../hooks/useAgencyId';

const AgencyInvoices: React.FC = () => {
  const { agencyId, loading } = useAgencyId();

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!agencyId) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <p className="text-gray-500 text-center">No se encontro la agencia.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Receipt className="h-6 w-6 text-primary-600" />
          Facturas y CFDI
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Comprobantes fiscales de reservas y comisiones cobradas por ToursRed, validos ante el SAT.
        </p>
      </div>

      <AgencyCfdiList agencyId={agencyId} />
    </div>
  );
};

export default AgencyInvoices;
