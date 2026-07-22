import React from 'react';
import { ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { format } from 'date-fns';
import type { CommissionRecord } from '../types';
import { formatCurrencyMXN } from '../utils/formatCurrency';

interface DetailedAccountStatementProps {
  records: CommissionRecord[];
}

const DetailedAccountStatement: React.FC<DetailedAccountStatementProps> = ({ records }) => {
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const formatCurrency = (amount: number) => formatCurrencyMXN(amount);

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      processed: 'bg-blue-100 text-blue-800',
      paid_out: 'bg-green-100 text-green-800',
      disputed: 'bg-red-100 text-red-800',
    };

    const labels = {
      pending: 'Pendiente',
      processed: 'Procesado',
      paid_out: 'Pagado',
      disputed: 'En Disputa',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  const totalPending = records.filter(r => r.status === 'pending' || r.status === 'processed').reduce((sum, r) => sum + Number(r.agency_net_amount), 0);
  const totalPaid = records.filter(r => r.status === 'paid_out').reduce((sum, r) => sum + Number(r.agency_net_amount), 0);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10"></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Fecha
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Código Reserva
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tour
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Precio Total
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Comisión
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Neto Agencia
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Estado
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {records.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No hay registros disponibles
                </td>
              </tr>
            ) : (
              records.map((record) => (
                <React.Fragment key={record.id}>
                  <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleRow(record.id)}>
                    <td className="px-4 py-3">
                      <button className="text-gray-400 hover:text-gray-600">
                        {expandedRows.has(record.id) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {format(new Date(record.created_at), 'dd/MM/yyyy')}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-blue-600">
                      {record.booking_id?.substring(0, 8)}...
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      Tour #{record.tour_id?.substring(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {formatCurrency(Number(record.total_tour_price))}
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600">
                      -{formatCurrency(Number(record.agency_commission_amount) + Number(record.service_charge_amount))}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-green-600">
                      {formatCurrency(Number(record.agency_net_amount))}
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(record.status)}
                    </td>
                  </tr>
                  {expandedRows.has(record.id) && (
                    <tr className="bg-gray-50">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="space-y-3 text-sm">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <span className="font-medium text-gray-700">Tasa de Comisión:</span>
                              <p className="text-gray-900">
                                {(Number(record.agency_commission_rate) * 100).toFixed(2)}%
                              </p>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Cargo de Servicio:</span>
                              <p className="text-gray-900">
                                {formatCurrency(Number(record.service_charge_amount))}
                              </p>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Ingreso Plataforma:</span>
                              <p className="text-gray-900">
                                {formatCurrency(Number(record.platform_total_revenue))}
                              </p>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Fecha de Pago:</span>
                              <p className="text-gray-900">
                                {record.processed_at ? format(new Date(record.processed_at), 'dd/MM/yyyy') : 'Pendiente'}
                              </p>
                            </div>
                          </div>
                          {Number((record as any).preventa_comision_descuento) > 0 && (
                            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                              <span className="text-amber-500 font-bold text-base">★</span>
                              <div className="text-xs text-amber-800">
                                <span className="font-semibold">Reserva de Preventa:</span>
                                {' '}Comisión base: {formatCurrency(Number(record.agency_commission_amount) + Number((record as any).preventa_comision_descuento))}
                                {' — '}Descuento preventa (10%): <strong>-{formatCurrency(Number((record as any).preventa_comision_descuento))}</strong>
                                {' — '}Comisión efectiva: <strong>{formatCurrency(Number(record.agency_commission_amount))}</strong>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
          {records.length > 0 && (
            <tfoot className="bg-gray-100 font-semibold">
              <tr>
                <td colSpan={6} className="px-4 py-3 text-sm text-gray-900">
                  Total Pendiente
                </td>
                <td className="px-4 py-3 text-sm text-yellow-600">
                  {formatCurrency(totalPending)}
                </td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={6} className="px-4 py-3 text-sm text-gray-900">
                  Total Pagado
                </td>
                <td className="px-4 py-3 text-sm text-green-600">
                  {formatCurrency(totalPaid)}
                </td>
                <td></td>
              </tr>
              <tr className="text-lg">
                <td colSpan={6} className="px-4 py-3 text-gray-900">
                  Balance Total
                </td>
                <td className="px-4 py-3 text-blue-600">
                  {formatCurrency(totalPending + totalPaid)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default DetailedAccountStatement;