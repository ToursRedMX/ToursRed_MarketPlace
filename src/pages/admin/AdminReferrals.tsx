import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Award, CheckCircle, Clock, AlertCircle, Search, Edit2, Save, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ReferralCode, ReferralRelationship } from '../../types';

interface ReferralWithUser extends ReferralCode {
  users: {
    first_name: string;
    last_name: string;
    email: string;
  };
}

interface ReferralStats {
  total_relationships: number;
  completed_referrals: number;
  pending_referrals: number;
  total_points_awarded: number;
  total_unique_referrers: number;
}

const AdminReferralsPage: React.FC = () => {
  const [referralCodes, setReferralCodes] = useState<ReferralWithUser[]>([]);
  const [relationships, setRelationships] = useState<ReferralRelationship[]>([]);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'cancelled'>('all');
  const [editingLimits, setEditingLimits] = useState<{[key: string]: number}>({});
  const [savingLimits, setSavingLimits] = useState<{[key: string]: boolean}>({});

  useEffect(() => {
    loadReferralData();
  }, []);

  const loadReferralData = async () => {
    try {
      setIsLoading(true);

      const [codesResult, relationshipsResult, bonusesResult] = await Promise.all([
        supabase
          .from('referral_codes')
          .select(`
            *,
            users:user_id (
              first_name,
              last_name,
              email
            )
          `)
          .order('successful_referrals_count', { ascending: false }),
        supabase
          .from('referral_relationships')
          .select(`
            *,
            referrer:referrer_user_id (
              id,
              first_name,
              last_name,
              email
            ),
            referred:referred_user_id (
              id,
              first_name,
              last_name,
              email
            )
          `)
          .order('created_at', { ascending: false }),
        supabase
          .from('referral_bonuses')
          .select('points_amount')
          .eq('status', 'awarded')
      ]);

      if (codesResult.error) throw codesResult.error;
      if (relationshipsResult.error) throw relationshipsResult.error;

      setReferralCodes(codesResult.data || []);
      setRelationships(relationshipsResult.data || []);

      const completed = relationshipsResult.data?.filter(r => r.status === 'completed').length || 0;
      const pending = relationshipsResult.data?.filter(r => r.status === 'pending').length || 0;
      const totalPoints = bonusesResult.data?.reduce((sum, b) => sum + b.points_amount, 0) || 0;

      const uniqueReferrers = new Set(relationshipsResult.data?.map(r => r.referrer_user_id)).size;

      setStats({
        total_relationships: relationshipsResult.data?.length || 0,
        completed_referrals: completed,
        pending_referrals: pending,
        total_points_awarded: totalPoints,
        total_unique_referrers: uniqueReferrers
      });
    } catch (error) {
      console.error('Error loading referral data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateLimit = async (codeId: string, newLimit: number) => {
    setSavingLimits(prev => ({ ...prev, [codeId]: true }));
    try {
      const { error } = await supabase
        .from('referral_codes')
        .update({ max_referrals_allowed: newLimit })
        .eq('id', codeId);

      if (error) throw error;

      setReferralCodes(prev =>
        prev.map(code =>
          code.id === codeId ? { ...code, max_referrals_allowed: newLimit } : code
        )
      );

      setEditingLimits(prev => {
        const newEditing = { ...prev };
        delete newEditing[codeId];
        return newEditing;
      });
    } catch (error) {
      console.error('Error updating limit:', error);
      alert('Error al actualizar el límite');
    } finally {
      setSavingLimits(prev => ({ ...prev, [codeId]: false }));
    }
  };

  const handleToggleCodeActive = async (codeId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('referral_codes')
        .update({ is_active: !isActive })
        .eq('id', codeId);

      if (error) throw error;

      setReferralCodes(prev =>
        prev.map(code =>
          code.id === codeId ? { ...code, is_active: !isActive } : code
        )
      );
    } catch (error) {
      console.error('Error toggling code status:', error);
      alert('Error al cambiar el estado del código');
    }
  };

  const filteredCodes = referralCodes.filter(code => {
    const user = code.users as any;
    const userName = `${user?.first_name || ''} ${user?.last_name || ''}`.toLowerCase();
    const userEmail = (user?.email || '').toLowerCase();
    const search = searchTerm.toLowerCase();

    return (
      userName.includes(search) ||
      userEmail.includes(search) ||
      code.code.toLowerCase().includes(search)
    );
  });

  const filteredRelationships = relationships.filter(rel => {
    if (statusFilter === 'all') return true;
    return rel.status === statusFilter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            <CheckCircle className="w-4 h-4" />
            Completado
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
            <Clock className="w-4 h-4" />
            Pendiente
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm font-medium">
            <AlertCircle className="w-4 h-4" />
            Cancelado
          </span>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Gestión de Referidos</h1>
          <p className="text-gray-600">Administra el programa de referidos y monitorea el desempeño</p>
        </div>

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3 mb-2">
                <Users className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium text-gray-600">Total Referidos</span>
              </div>
              <p className="text-3xl font-bold text-gray-900">{stats.total_relationships}</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="text-sm font-medium text-gray-600">Completados</span>
              </div>
              <p className="text-3xl font-bold text-green-600">{stats.completed_referrals}</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3 mb-2">
                <Clock className="w-5 h-5 text-yellow-600" />
                <span className="text-sm font-medium text-gray-600">Pendientes</span>
              </div>
              <p className="text-3xl font-bold text-yellow-600">{stats.pending_referrals}</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3 mb-2">
                <Award className="w-5 h-5 text-amber-600" />
                <span className="text-sm font-medium text-gray-600">Puntos Otorgados</span>
              </div>
              <p className="text-3xl font-bold text-amber-600">{stats.total_points_awarded.toLocaleString()}</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-5 h-5 text-indigo-600" />
                <span className="text-sm font-medium text-gray-600">Referidores Activos</span>
              </div>
              <p className="text-3xl font-bold text-indigo-600">{stats.total_unique_referrers}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Códigos de Referido</h2>
            <div className="flex items-center gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, email o código..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Usuario
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Código
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Completados / Límite
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredCodes.map((code) => {
                  const user = code.users as any;
                  const userName = user?.first_name && user?.last_name
                    ? `${user.first_name} ${user.last_name}`
                    : user?.email || 'Usuario';
                  const isEditing = editingLimits[code.id] !== undefined;

                  return (
                    <tr key={code.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{userName}</div>
                          <div className="text-sm text-gray-500">{user?.email}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono font-semibold text-blue-600">{code.code}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{code.successful_referrals_count} /</span>
                            <input
                              type="number"
                              min="0"
                              value={editingLimits[code.id]}
                              onChange={(e) => setEditingLimits(prev => ({ ...prev, [code.id]: parseInt(e.target.value) || 0 }))}
                              className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                            <button
                              onClick={() => handleUpdateLimit(code.id, editingLimits[code.id])}
                              disabled={savingLimits[code.id]}
                              className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setEditingLimits(prev => {
                                const newEditing = { ...prev };
                                delete newEditing[code.id];
                                return newEditing;
                              })}
                              className="p-1 text-gray-600 hover:text-gray-700"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">
                              {code.successful_referrals_count} / {code.max_referrals_allowed}
                            </span>
                            <button
                              onClick={() => setEditingLimits(prev => ({ ...prev, [code.id]: code.max_referrals_allowed }))}
                              className="p-1 text-blue-600 hover:text-blue-700"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {code.is_active ? (
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                            Activo
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                            Inactivo
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleCodeActive(code.id, code.is_active)}
                          className={`text-sm font-medium ${
                            code.is_active
                              ? 'text-red-600 hover:text-red-700'
                              : 'text-green-600 hover:text-green-700'
                          }`}
                        >
                          {code.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Relaciones de Referidos</h2>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-4 py-2 rounded-lg font-medium ${
                  statusFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-4 py-2 rounded-lg font-medium ${
                  statusFilter === 'pending'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Pendientes
              </button>
              <button
                onClick={() => setStatusFilter('completed')}
                className={`px-4 py-2 rounded-lg font-medium ${
                  statusFilter === 'completed'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Completados
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Referidor
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Referido
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Código Usado
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredRelationships.map((rel) => {
                  const referrer = rel.referrer as any;
                  const referred = rel.referred as any;
                  const referrerName = referrer?.first_name && referrer?.last_name
                    ? `${referrer.first_name} ${referrer.last_name}`
                    : referrer?.email || 'Usuario';
                  const referredName = referred?.first_name && referred?.last_name
                    ? `${referred.first_name} ${referred.last_name}`
                    : referred?.email || 'Usuario';

                  return (
                    <tr key={rel.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{referrerName}</div>
                          <div className="text-sm text-gray-500">{referrer?.email}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{referredName}</div>
                          <div className="text-sm text-gray-500">{referred?.email}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono text-sm font-semibold text-blue-600">
                          {rel.referral_code_used}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(rel.created_at).toLocaleDateString('es-MX', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(rel.status)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminReferralsPage;
