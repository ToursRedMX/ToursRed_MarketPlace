import React, { useState, useEffect } from 'react';
import { Award, Search, Filter, TrendingUp, TrendingDown, Clock, Users, Plus, Minus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../utils/formatCurrency';

interface PointsWallet {
  id: string;
  user_id: string;
  balance: number;
  total_earned: number;
  total_used: number;
  total_expired: number;
  is_active: boolean;
  created_at: string;
  users: {
    first_name: string;
    last_name: string;
    email: string;
  };
}

interface PointsStats {
  totalWallets: number;
  activeWallets: number;
  totalPointsInCirculation: number;
  totalPointsEarned: number;
  totalPointsUsed: number;
  totalPointsExpired: number;
}

const AdminPoints: React.FC = () => {
  const [wallets, setWallets] = useState<PointsWallet[]>([]);
  const [stats, setStats] = useState<PointsStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<PointsWallet | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'subtract'>('add');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('toursred_points_wallets')
        .select(`
          *,
          users!inner(first_name, last_name, email)
        `)
        .order('balance', { ascending: false });

      if (statusFilter === 'active') {
        query = query.eq('is_active', true);
      } else if (statusFilter === 'inactive') {
        query = query.eq('is_active', false);
      }

      const { data: walletsData, error: walletsError } = await query;

      if (walletsError) throw walletsError;
      setWallets(walletsData || []);

      const { data: statsData, error: statsError } = await supabase
        .from('toursred_points_wallets')
        .select('balance, total_earned, total_used, total_expired, is_active');

      if (statsError) throw statsError;

      if (statsData) {
        const calculatedStats: PointsStats = {
          totalWallets: statsData.length,
          activeWallets: statsData.filter(w => w.is_active).length,
          totalPointsInCirculation: statsData.reduce((sum, w) => sum + (w.balance || 0), 0),
          totalPointsEarned: statsData.reduce((sum, w) => sum + (w.total_earned || 0), 0),
          totalPointsUsed: statsData.reduce((sum, w) => sum + (w.total_used || 0), 0),
          totalPointsExpired: statsData.reduce((sum, w) => sum + (w.total_expired || 0), 0),
        };
        setStats(calculatedStats);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredWallets = wallets.filter(wallet => {
    const fullName = `${wallet.users.first_name || ''} ${wallet.users.last_name || ''}`.trim();
    return fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      wallet.users.email.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleOpenAdjustModal = (wallet: PointsWallet, type: 'add' | 'subtract') => {
    setSelectedWallet(wallet);
    setAdjustmentType(type);
    setAdjustmentAmount('');
    setAdjustmentReason('');
    setShowAdjustModal(true);
  };

  const handleCloseAdjustModal = () => {
    setShowAdjustModal(false);
    setSelectedWallet(null);
    setAdjustmentAmount('');
    setAdjustmentReason('');
  };

  const handleAdjustPoints = async () => {
    if (!selectedWallet || !adjustmentAmount || !adjustmentReason.trim()) {
      alert('Por favor completa todos los campos');
      return;
    }

    const amount = parseInt(adjustmentAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('Por favor ingresa una cantidad válida');
      return;
    }

    const finalAmount = adjustmentType === 'subtract' ? -amount : amount;

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('admin_adjust_points', {
        target_user_id: selectedWallet.user_id,
        points_amount: finalAmount,
        adjustment_reason: adjustmentReason
      });

      if (error) throw error;

      alert(`Puntos ajustados exitosamente. Nuevo balance: ${data.new_balance}`);
      handleCloseAdjustModal();
      loadData();
    } catch (error: any) {
      console.error('Error adjusting points:', error);
      alert(error.message || 'Error al ajustar los puntos');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center">
          <Award className="h-8 w-8 text-amber-600 mr-3" />
          <h1 className="text-3xl font-bold text-gray-900">ToursRed Points</h1>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <Users className="h-6 w-6 text-blue-600" />
              <span className="text-sm font-medium text-gray-600">Billeteras</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{stats.totalWallets}</div>
            <div className="text-sm text-gray-500">{stats.activeWallets} activas</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <Award className="h-6 w-6 text-amber-600" />
              <span className="text-sm font-medium text-gray-600">En Circulación</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {stats.totalPointsInCirculation.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500">
              ${formatCurrency(stats.totalPointsInCirculation / 100)} MXN
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="h-6 w-6 text-green-600" />
              <span className="text-sm font-medium text-gray-600">Ganados</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {stats.totalPointsEarned.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500">Total histórico</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <TrendingDown className="h-6 w-6 text-blue-600" />
              <span className="text-sm font-medium text-gray-600">Canjeados</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {stats.totalPointsUsed.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500">
              {stats.totalPointsExpired.toLocaleString()} expirados
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nombre o email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todas</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
          </div>
        ) : filteredWallets.length === 0 ? (
          <div className="text-center py-12">
            <Award className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No se encontraron billeteras</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Usuario
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Balance
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ganados
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Usados
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Expirados
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Creada
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredWallets.map((wallet) => (
                  <tr key={wallet.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {`${wallet.users.first_name || ''} ${wallet.users.last_name || ''}`.trim() || 'Sin nombre'}
                        </div>
                        <div className="text-sm text-gray-500">{wallet.users.email}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-amber-600">
                        {wallet.balance.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-500">
                        ${formatCurrency(wallet.balance / 100)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {wallet.total_earned.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {wallet.total_used.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {wallet.total_expired.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        wallet.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {wallet.is_active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(wallet.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleOpenAdjustModal(wallet, 'add')}
                          className="inline-flex items-center px-3 py-1 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                          title="Agregar puntos"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleOpenAdjustModal(wallet, 'subtract')}
                          className="inline-flex items-center px-3 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                          title="Restar puntos"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 bg-blue-50 border-l-4 border-blue-500 p-4 rounded-md">
        <div className="flex items-start">
          <Award className="h-5 w-5 text-blue-600 mr-2 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-blue-900 mb-1">
              Información del Sistema
            </h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Los puntos se otorgan automáticamente cuando una reserva se completa</li>
              <li>• 1 punto = $0.01 MXN (100 puntos = $1 MXN)</li>
              <li>• Los puntos NUNCA expiran (beneficio ToursRed+)</li>
              <li>• Los usuarios solo pueden usar puntos con membresía activa</li>
              <li>• Límite de uso: hasta 50% del total de la reserva</li>
            </ul>
          </div>
        </div>
      </div>

      {showAdjustModal && selectedWallet && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                {adjustmentType === 'add' ? 'Agregar Puntos' : 'Restar Puntos'}
              </h3>
              <button
                onClick={handleCloseAdjustModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600">Usuario</div>
              <div className="font-semibold text-gray-900">
                {`${selectedWallet.users.first_name || ''} ${selectedWallet.users.last_name || ''}`.trim()}
              </div>
              <div className="text-sm text-gray-500">{selectedWallet.users.email}</div>
              <div className="mt-2 text-sm">
                <span className="text-gray-600">Balance actual: </span>
                <span className="font-bold text-amber-600">
                  {selectedWallet.balance.toLocaleString()} puntos
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cantidad de puntos
                </label>
                <input
                  type="number"
                  min="1"
                  value={adjustmentAmount}
                  onChange={(e) => setAdjustmentAmount(e.target.value)}
                  placeholder="Ingresa la cantidad"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
                {adjustmentAmount && (
                  <div className="mt-2 text-sm text-gray-600">
                    Equivalente a: ${formatCurrency(parseInt(adjustmentAmount) / 100)} MXN
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Razón del ajuste
                </label>
                <textarea
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="Explica por qué se ajustan los puntos..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={handleCloseAdjustModal}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAdjustPoints}
                disabled={isSubmitting || !adjustmentAmount || !adjustmentReason.trim()}
                className={`flex-1 px-4 py-2 text-white rounded-lg disabled:opacity-50 ${
                  adjustmentType === 'add'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {isSubmitting ? 'Procesando...' : adjustmentType === 'add' ? 'Agregar' : 'Restar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPoints;
