import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Share2, Users, Gift, TrendingUp, CheckCircle, Clock, AlertCircle, Award, Crown, ExternalLink, HelpCircle, Pencil, X, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { ReferralCode, ReferralRelationship, ReferralStats } from '../../types';

const TravelerReferralsPage: React.FC = () => {
  const { user } = useAuth();
  const [referralCode, setReferralCode] = useState<ReferralCode | null>(null);
  const [relationships, setRelationships] = useState<ReferralRelationship[]>([]);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [hasMembership, setHasMembership] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);
  const [bonusPoints, setBonusPoints] = useState(5000);
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeSuccess, setCodeSuccess] = useState('');
  const [isSavingCode, setIsSavingCode] = useState(false);
  const [isCheckingCode, setIsCheckingCode] = useState(false);
  const [codeAvailable, setCodeAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    loadReferralData();
  }, [user?.id]);

  const loadReferralData = async () => {
    if (!user) return;

    try {
      setIsLoading(true);

      const [codeResult, relationshipsResult, membershipResult, settingsResult] = await Promise.all([
        supabase
          .from('referral_codes')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('referral_relationships')
          .select(`
            *,
            referred:referred_user_id (
              id,
              first_name,
              last_name,
              email
            ),
            bookings:first_booking_id (
              booking_code,
              created_at
            )
          `)
          .eq('referrer_user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('memberships')
          .select('status')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle(),
        supabase
          .from('platform_settings')
          .select('referral_bonus_points')
          .maybeSingle()
      ]);

      if (codeResult.error) throw codeResult.error;
      if (relationshipsResult.error) throw relationshipsResult.error;

      if (settingsResult.data) {
        setBonusPoints(settingsResult.data.referral_bonus_points || 5000);
      }

      // Reset edit state when loading new data
      setIsEditingCode(false);
      setNewCode('');
      setCodeError('');
      setCodeSuccess('');

      setReferralCode(codeResult.data);
      setRelationships(relationshipsResult.data || []);
      setHasMembership(!!membershipResult.data);

      if (codeResult.data) {
        const completed = relationshipsResult.data?.filter(r => r.status === 'completed').length || 0;
        const pending = relationshipsResult.data?.filter(r => r.status === 'pending').length || 0;

        const { data: bonusData } = await supabase
          .from('referral_bonuses')
          .select('points_amount')
          .eq('user_id', user.id)
          .eq('status', 'awarded');

        const totalPointsEarned = bonusData?.reduce((sum, b) => sum + b.points_amount, 0) || 0;

        setStats({
          total_referrals: relationshipsResult.data?.length || 0,
          completed_referrals: completed,
          pending_referrals: pending,
          total_points_earned: totalPointsEarned,
          referral_code: codeResult.data.code,
          max_referrals: codeResult.data.max_referrals_allowed,
          is_max_reached: codeResult.data.successful_referrals_count >= codeResult.data.max_referrals_allowed
        });
      }
    } catch (error) {
      console.error('Error loading referral data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (referralCode) {
      navigator.clipboard.writeText(referralCode.code);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const validateCodeFormat = (code: string): string | null => {
    const cleaned = code.trim().toLowerCase();
    if (cleaned.length < 4 || cleaned.length > 20) {
      return 'El código debe tener entre 4 y 20 caracteres';
    }
    if (!/^[a-z0-9_]+$/.test(cleaned)) {
      return 'Solo se permiten letras minúsculas, números y guiones bajos';
    }
    return null;
  };

  const checkCodeAvailability = async (code: string) => {
    const formatError = validateCodeFormat(code);
    if (formatError) {
      setCodeAvailable(null);
      return;
    }

    setIsCheckingCode(true);
    try {
      const { count } = await supabase
        .from('referral_codes')
        .select('*', { count: 'exact', head: true })
        .ilike('code', code.trim().toLowerCase())
        .neq('user_id', user?.id || '');

      setCodeAvailable(count === 0);
    } catch {
      setCodeAvailable(null);
    } finally {
      setIsCheckingCode(false);
    }
  };

  const handleCodeChange = (value: string) => {
    setNewCode(value);
    setCodeError('');
    setCodeSuccess('');
    setCodeAvailable(null);

    // Debounced availability check
    if (value.trim().length >= 4) {
      const timeoutId = setTimeout(() => checkCodeAvailability(value), 500);
      return () => clearTimeout(timeoutId);
    }
  };

  const handleSaveCode = async () => {
    const formatError = validateCodeFormat(newCode);
    if (formatError) {
      setCodeError(formatError);
      return;
    }

    if (codeAvailable === false) {
      setCodeError('Este código ya está en uso. Elige otro diferente.');
      return;
    }

    setIsSavingCode(true);
    setCodeError('');

    try {
      const { data, error } = await supabase
        .rpc('update_referral_code', { p_new_code: newCode.trim().toLowerCase() });

      if (error) {
        setCodeError(error.message || 'Error al actualizar el código');
        return;
      }

      if (data) {
        setReferralCode(data);
        setCodeSuccess('¡Código actualizado correctamente!');
        setIsEditingCode(false);
        setNewCode('');
        setCodeAvailable(null);

        // Update stats with new code
        if (stats) {
          setStats({ ...stats, referral_code: data.code });
        }

        setTimeout(() => setCodeSuccess(''), 4000);
      }
    } catch (err) {
      setCodeError('Error de conexión. Intenta de nuevo.');
    } finally {
      setIsSavingCode(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingCode(false);
    setNewCode('');
    setCodeError('');
    setCodeAvailable(null);
  };

  const handleShare = (platform: 'whatsapp' | 'twitter' | 'facebook') => {
    if (!referralCode) return;

    const message = `¡Únete a ToursRed con mi código de referido ${referralCode.code} y gana ${bonusPoints.toLocaleString()} puntos en tu primera reserva! 🎁`;
    const url = `${window.location.origin}/signup?ref=${referralCode.code}`;

    const shareUrls = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(message + ' ' + url)}`,
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(url)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(message)}`
    };

    window.open(shareUrls[platform], '_blank');
  };

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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Programa de Referidos</h1>
          <p className="text-gray-600">Invita a tus amigos y gana puntos ToursRed</p>
        </div>

        {!hasMembership && stats && stats.total_points_earned > 0 && (
          <div className="mb-6 bg-gradient-to-r from-amber-500 to-orange-600 rounded-xl shadow-lg p-6 text-white">
            <div className="flex items-start gap-4">
              <Crown className="w-8 h-8 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold mb-2">¡Activa tu membresía para usar tus puntos!</h3>
                <p className="text-amber-50 mb-4">
                  Tienes {stats.total_points_earned.toLocaleString()} puntos acumulados por referidos.
                  Activa ToursRed Plus para poder usarlos en tus reservas.
                </p>
                <Link
                  to="/traveler/membership"
                  className="inline-flex items-center gap-2 bg-white text-orange-600 px-4 py-2 rounded-lg font-medium hover:bg-amber-50 transition-colors"
                >
                  Ver Planes de Membresía
                  <ExternalLink className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl shadow-lg p-8 text-white">
              <div className="flex items-center gap-3 mb-6">
                <Gift className="w-8 h-8" />
                <h2 className="text-2xl font-bold">Tu Código de Referido</h2>
              </div>

              {referralCode && (
                <>
                  <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 mb-6">
                    <div className="text-center">
                      <p className="text-blue-100 text-sm mb-2">Tu código único</p>
                      <div className="text-5xl font-bold tracking-wider mb-4 font-mono">
                        {referralCode.code}
                      </div>
                      <button
                        onClick={handleCopyCode}
                        className="inline-flex items-center gap-2 bg-white text-blue-600 px-6 py-3 rounded-lg font-semibold hover:bg-blue-50 transition-colors"
                      >
                        {copySuccess ? (
                          <>
                            <CheckCircle className="w-5 h-5" />
                            ¡Copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="w-5 h-5" />
                            Copiar Código
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Personalize code section */}
                  {codeSuccess && (
                    <div className="bg-green-500/20 border border-green-300/30 rounded-lg p-3 mb-4 flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-200 shrink-0" />
                      <p className="text-sm text-green-50">{codeSuccess}</p>
                    </div>
                  )}

                  {!isEditingCode && !referralCode.code_changed_at && (
                    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-6">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Pencil className="w-4 h-4 text-blue-200" />
                          <p className="text-sm text-blue-100">
                            ¿Quieres un código más fácil de recordar?
                          </p>
                        </div>
                        <button
                          onClick={() => setIsEditingCode(true)}
                          className="inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Personalizar
                        </button>
                      </div>
                    </div>
                  )}

                  {!isEditingCode && referralCode.code_changed_at && (
                    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-6">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-300 shrink-0" />
                        <p className="text-sm text-blue-100">
                          Código personalizado. Solo puedes cambiarlo una vez.
                        </p>
                      </div>
                    </div>
                  )}

                  {isEditingCode && (
                    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-6">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium text-blue-100">
                          Nuevo código de referido
                        </label>
                        <button
                          onClick={handleCancelEdit}
                          className="text-blue-200 hover:text-white transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={newCode}
                        onChange={(e) => handleCodeChange(e.target.value)}
                        placeholder="ej: juan_perez"
                        maxLength={20}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className="w-full bg-white/90 text-gray-900 rounded-lg px-4 py-2.5 font-mono text-lg mb-2 focus:outline-none focus:ring-2 focus:ring-white"
                      />
                      <div className="flex items-center gap-2 mb-3 min-h-[20px]">
                        {isCheckingCode && (
                          <span className="text-xs text-blue-200 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Verificando...
                          </span>
                        )}
                        {!isCheckingCode && codeAvailable === true && newCode.length >= 4 && (
                          <span className="text-xs text-green-200 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Código disponible
                          </span>
                        )}
                        {!isCheckingCode && codeAvailable === false && newCode.length >= 4 && (
                          <span className="text-xs text-red-200 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Código no disponible
                          </span>
                        )}
                      </div>
                      {codeError && (
                        <p className="text-xs text-red-200 mb-3 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {codeError}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveCode}
                          disabled={isSavingCode || !newCode.trim() || codeAvailable === false}
                          className="flex-1 inline-flex items-center justify-center gap-2 bg-white text-blue-600 px-4 py-2 rounded-lg font-semibold hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isSavingCode ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Guardando...
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-4 h-4" />
                              Guardar Código
                            </>
                          )}
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="inline-flex items-center justify-center gap-1 bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                        >
                          <X className="w-4 h-4" />
                          Cancelar
                        </button>
                      </div>
                      <p className="text-xs text-blue-200 mt-3">
                        Solo puedes personalizar tu código una vez. Elige sabiamente.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold mb-1">{stats?.completed_referrals || 0}</div>
                      <div className="text-blue-100 text-sm">Completados</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold mb-1">{stats?.pending_referrals || 0}</div>
                      <div className="text-blue-100 text-sm">Pendientes</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold mb-1">{referralCode.successful_referrals_count}/{referralCode.max_referrals_allowed}</div>
                      <div className="text-blue-100 text-sm">Límite</div>
                    </div>
                  </div>

                  {stats && stats.is_max_reached && (
                    <div className="bg-amber-500/20 border border-amber-300/30 rounded-lg p-4 mb-6">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-amber-200" />
                        <p className="text-sm text-amber-50">
                          Has alcanzado tu límite de referidos. Contacta al administrador para aumentarlo.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => handleShare('whatsapp')}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-600 transition-colors"
                    >
                      <Share2 className="w-4 h-4" />
                      WhatsApp
                    </button>
                    <button
                      onClick={() => handleShare('twitter')}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-sky-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-sky-600 transition-colors"
                    >
                      <Share2 className="w-4 h-4" />
                      Twitter
                    </button>
                    <button
                      onClick={() => handleShare('facebook')}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-800 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-900 transition-colors"
                    >
                      <Share2 className="w-4 h-4" />
                      Facebook
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3 mb-4">
                <Award className="w-6 h-6 text-blue-600" />
                <h3 className="font-semibold text-gray-900">Recompensas</h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-gray-600">
                    <strong className="text-gray-900">{bonusPoints.toLocaleString()} puntos</strong> para ti cuando tu referido complete su primera reserva
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-gray-600">
                    <strong className="text-gray-900">{bonusPoints.toLocaleString()} puntos</strong> para tu amigo al registrarse con tu código
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3 mb-4">
                <TrendingUp className="w-6 h-6 text-green-600" />
                <h3 className="font-semibold text-gray-900">Tus Estadísticas</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm">Total Referidos</span>
                  <span className="font-semibold text-gray-900">{stats?.total_referrals || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm">Puntos Ganados</span>
                  <span className="font-semibold text-green-600">
                    {stats?.total_points_earned.toLocaleString() || 0}
                  </span>
                </div>
                <div className="border-t border-gray-200 pt-3">
                  <Link
                    to="/traveler/points"
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    Ver mis puntos
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl shadow-sm p-6 border border-amber-200">
              <div className="flex items-center gap-3 mb-3">
                <HelpCircle className="w-6 h-6 text-amber-600" />
                <h3 className="font-semibold text-gray-900">Importante</h3>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">
                Los puntos se acumulan siempre, pero solo puedes usarlos si tienes una membresía ToursRed Plus activa.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <Users className="w-6 h-6 text-gray-700" />
              <h2 className="text-xl font-semibold text-gray-900">Mis Referidos</h2>
            </div>
          </div>

          {relationships.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Aún no has referido a nadie
              </h3>
              <p className="text-gray-600 mb-6">
                Comparte tu código con amigos y empieza a ganar puntos
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Usuario
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fecha de Registro
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Estado
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Puntos Ganados
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {relationships.map((relationship) => {
                    const referred = relationship.referred as any;
                    const referredName = referred?.first_name && referred?.last_name
                      ? `${referred.first_name} ${referred.last_name}`
                      : referred?.email || 'Usuario';

                    return (
                      <tr key={relationship.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-600 font-semibold">
                                {referredName.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">{referredName}</div>
                              <div className="text-sm text-gray-500">{referred?.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(relationship.created_at).toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(relationship.status)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {relationship.referrer_bonus_awarded ? (
                            <span className="text-green-600 font-semibold">
                              +{bonusPoints.toLocaleString()} puntos
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-8 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">¿Cómo funciona?</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Comparte tu código</h4>
                <p className="text-sm text-gray-600">
                  Envía tu código único a amigos y familiares
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Tu amigo se registra</h4>
                <p className="text-sm text-gray-600">
                  Usa tu código al crear su cuenta y recibe {bonusPoints.toLocaleString()} puntos
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Ambos ganan</h4>
                <p className="text-sm text-gray-600">
                  Cuando completa su primera reserva, tú recibes {bonusPoints.toLocaleString()} puntos
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TravelerReferralsPage;
