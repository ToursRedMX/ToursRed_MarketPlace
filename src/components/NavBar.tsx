import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, User, LogOut, Search, MessageCircle, ChevronDown, LayoutDashboard, Building2, Users, UserCheck, MapPin, Tag, Navigation, Star, MessageSquare, Globe, Settings, CreditCard, Coins, Percent, DollarSign, Gift, Megaphone, Ticket, BadgePercent, Sparkles, Send, ArrowLeftRight, FileText, FilePlus2, BookOpen, Headphones as HeadphonesIcon, TicketCheck, ShoppingBag, Trash2, Bus, BarChart2, Briefcase, FileSpreadsheet, Shield, Mail, TrendingUp } from 'lucide-react';
import NotificationBell from './NotificationBell';
import { useAuth } from '../context/AuthContext';
import { signOut, supabase } from '../lib/supabase';

interface AdminMenuItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

interface AdminMenuGroup {
  title: string;
  icon: React.ReactNode;
  items: AdminMenuItem[];
}

const NavBar: React.FC = () => {
  const { user, isAdmin, isAgency, isTraveler, isEmailVerified, isSuperAdmin, permissions, isAgencyStaff, staffInfo, allStaffInfo, activeAgencyId, switchActiveAgency, isAccountExecutive, accountExecutiveInfo } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isToursDropdownOpen, setIsToursDropdownOpen] = useState(false);
  const [isMobileToursOpen, setIsMobileToursOpen] = useState(false);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [mobileExpandedGroup, setMobileExpandedGroup] = useState<string | null>(null);
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [garbageBookingsCount, setGarbageBookingsCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const adminMenuRef = useRef<HTMLDivElement>(null);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const toggleProfile = () => setIsProfileOpen(!isProfileOpen);
  const toggleMobileTours = () => setIsMobileToursOpen(!isMobileToursOpen);

  useEffect(() => {
    const fetchProfilePicture = async () => {
      if (!user?.id) { setProfilePicture(null); return; }

      if (isAccountExecutive && accountExecutiveInfo?.executiveId) {
        // Ejecutivos: leer profile_photo_url desde account_executives y generar URL firmada
        const { data } = await supabase
          .from('account_executives')
          .select('profile_photo_url')
          .eq('id', accountExecutiveInfo.executiveId)
          .maybeSingle();

        if (data?.profile_photo_url) {
          const { data: signed } = await supabase.storage
            .from('executive-avatars')
            .createSignedUrl(data.profile_photo_url, 3600);
          setProfilePicture(signed?.signedUrl || null);
        } else {
          setProfilePicture(null);
        }
        return;
      }

      const { data } = await supabase
        .from('users')
        .select('profile_picture_url')
        .eq('id', user.id)
        .maybeSingle();

      setProfilePicture(data?.profile_picture_url || null);
    };

    fetchProfilePicture();

    if (user?.id) {
      if (isAccountExecutive && accountExecutiveInfo?.executiveId) {
        const channel = supabase
          .channel(`executive-avatar-changes-${user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'account_executives',
              filter: `id=eq.${accountExecutiveInfo.executiveId}`,
            },
            async (payload) => {
              const path = payload.new?.profile_photo_url;
              if (path) {
                const { data: signed } = await supabase.storage
                  .from('executive-avatars')
                  .createSignedUrl(path, 3600);
                setProfilePicture(signed?.signedUrl || null);
              } else {
                setProfilePicture(null);
              }
            }
          )
          .subscribe();
        return () => { supabase.removeChannel(channel); };
      }

      const channel = supabase
        .channel(`profile-picture-changes-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'users',
            filter: `id=eq.${user.id}`
          },
          (payload) => {
            if (payload.new?.profile_picture_url) {
              setProfilePicture(payload.new.profile_picture_url);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, isAccountExecutive, accountExecutiveInfo?.executiveId]);

  useEffect(() => {
    if (!isAdmin) return;
    const fetchGarbageCount = async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const { count } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'cancelled'])
        .eq('payment_status', 'pending')
        .lt('created_at', cutoff.toISOString());
      setGarbageBookingsCount(count ?? 0);
    };
    fetchGarbageCount();
  }, [isAdmin]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target as Node)) {
        setIsAdminMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
    setIsProfileOpen(false);
  };

  const getDashboardLink = () => {
    if (isAdmin) return '/admin/dashboard';
    if (isAgency) return '/agency/dashboard';
    if (isAgencyStaff) return '/agency/dashboard';
    if (isAccountExecutive) return '/executive/dashboard';
    return '/traveler/dashboard';
  };

  const getProfileLink = () => {
    if (isAdmin) return '/admin/profile';
    if (isAgency) return '/agency/profile';
    if (isAccountExecutive) return '/executive/perfil';
    return '/traveler/profile';
  };

  const getAdminMenuGroups = (): AdminMenuGroup[] => {
    const groups: AdminMenuGroup[] = [];

    const usuariosItems: AdminMenuItem[] = [
      { to: '/admin/dashboard', label: 'Panel Admin', icon: <LayoutDashboard className="h-4 w-4" /> },
      { to: '/admin/bookings', label: 'Reservas', icon: <ShoppingBag className="h-4 w-4" /> },
      {
        to: '/admin/bookings-cleanup',
        label: garbageBookingsCount > 0
          ? `Limpieza (${garbageBookingsCount})`
          : 'Limpieza de Basura',
        icon: <Trash2 className="h-4 w-4 text-red-500" />,
      },
    ];
    if (isSuperAdmin || permissions?.canManageAgencies)
      usuariosItems.push({ to: '/admin/agencies', label: 'Agencias', icon: <Building2 className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManageUsers)
      usuariosItems.push({ to: '/admin/users', label: 'Usuarios', icon: <Users className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManageTravelers)
      usuariosItems.push({ to: '/admin/travelers', label: 'Viajeros', icon: <UserCheck className="h-4 w-4" /> });

    if (usuariosItems.length > 0)
      groups.push({ title: 'Usuarios', icon: <Users className="h-4 w-4" />, items: usuariosItems });

    const contenidoItems: AdminMenuItem[] = [];
    if (isSuperAdmin || permissions?.canManageDestinations)
      contenidoItems.push({ to: '/admin/destinations', label: 'Destinos', icon: <MapPin className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManageCategories)
      contenidoItems.push({ to: '/admin/categories', label: 'Categorias', icon: <Tag className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManageCategories)
      contenidoItems.push({ to: '/admin/tours', label: 'Comisiones de Tours', icon: <Bus className="h-4 w-4" /> });
    if (isSuperAdmin)
      contenidoItems.push({ to: '/admin/tour-metrics', label: 'Metricas de Tours', icon: <BarChart2 className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManageDeparturePoints)
      contenidoItems.push({ to: '/admin/departure-points', label: 'Puntos de Partida', icon: <Navigation className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManageReviews)
      contenidoItems.push({ to: '/admin/reviews', label: 'Resenas', icon: <Star className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManageSettings)
      contenidoItems.push({ to: '/admin/terms', label: 'Terminos y Condiciones', icon: <FileText className="h-4 w-4" /> });

    if (contenidoItems.length > 0)
      groups.push({ title: 'Contenido', icon: <MapPin className="h-4 w-4" />, items: contenidoItems });

    const comercialItems: AdminMenuItem[] = [];
    if (isSuperAdmin || permissions?.canManageMemberships)
      comercialItems.push({ to: '/admin/memberships', label: 'Membresias', icon: <CreditCard className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManagePoints)
      comercialItems.push({ to: '/admin/points', label: 'Puntos', icon: <Coins className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManageDiscountCodes)
      comercialItems.push({ to: '/admin/discount-codes', label: 'Codigos Descuento', icon: <Percent className="h-4 w-4" /> });
    comercialItems.push({ to: '/admin/promotions', label: 'Promociones', icon: <BadgePercent className="h-4 w-4" /> });
    comercialItems.push({ to: '/admin/featured-tours', label: 'Tours Destacados', icon: <Sparkles className="h-4 w-4" /> });
    comercialItems.push({ to: '/admin/referrals', label: 'Referidos', icon: <Gift className="h-4 w-4" /> });

    if (comercialItems.length > 0)
      groups.push({ title: 'Comercial', icon: <CreditCard className="h-4 w-4" />, items: comercialItems });

    const financieroItems: AdminMenuItem[] = [
      { to: '/admin/payouts', label: 'Gestion de Pagos', icon: <DollarSign className="h-4 w-4" /> },
      { to: '/admin/cfdi', label: 'CFDI / Facturacion', icon: <FileText className="h-4 w-4" /> },
      { to: '/admin/cfdi-manual', label: 'CFDI Manual', icon: <FilePlus2 className="h-4 w-4" /> },
      { to: '/admin/contabilidad', label: 'Contabilidad (Sync)', icon: <BookOpen className="h-4 w-4" /> },
      { to: '/accounting', label: 'Mini ERP Interno', icon: <BookOpen className="h-4 w-4" /> },
      { to: '/admin/reporte-maestro', label: 'Reporte Maestro', icon: <FileSpreadsheet className="h-4 w-4" /> },
    ];
    if (isSuperAdmin || permissions?.canManageInquiries)
      financieroItems.push({ to: '/admin/international-inquiries', label: 'Cotizaciones Internac.', icon: <Globe className="h-4 w-4" /> });

    groups.push({ title: 'Financiero', icon: <DollarSign className="h-4 w-4" />, items: financieroItems });

    const comunicacionesItems: AdminMenuItem[] = [];
    if (isSuperAdmin || permissions?.canManageMessages)
      comunicacionesItems.push({ to: '/admin/messages', label: 'Mensajes', icon: <MessageSquare className="h-4 w-4" /> });
    comunicacionesItems.push({ to: '/admin/tour-messages', label: 'Mensajes de Agencias', icon: <Megaphone className="h-4 w-4" /> });
    comunicacionesItems.push({ to: '/admin/broadcast-messages', label: 'Mensajes Masivos', icon: <Send className="h-4 w-4" /> });
    comunicacionesItems.push({ to: '/admin/newsletter', label: 'Newsletter', icon: <Mail className="h-4 w-4" /> });
    if (isSuperAdmin || permissions?.canManageSettings)
      comunicacionesItems.push({ to: '/admin/settings', label: 'Configuracion', icon: <Settings className="h-4 w-4" /> });

    if (comunicacionesItems.length > 0)
      groups.push({ title: 'Comunicaciones', icon: <MessageSquare className="h-4 w-4" />, items: comunicacionesItems });

    const serviceDeskItems: AdminMenuItem[] = [];
    if (isSuperAdmin || permissions?.canManageServiceDesk) {
      serviceDeskItems.push({ to: '/admin/service-desk', label: 'Tickets', icon: <TicketCheck className="h-4 w-4" /> });
      serviceDeskItems.push({ to: '/admin/service-desk/categorias', label: 'Categorias', icon: <Tag className="h-4 w-4" /> });
      serviceDeskItems.push({ to: '/admin/service-desk/agentes', label: 'Agentes', icon: <HeadphonesIcon className="h-4 w-4" /> });
    }

    if (serviceDeskItems.length > 0)
      groups.push({ title: 'Service Desk', icon: <HeadphonesIcon className="h-4 w-4" />, items: serviceDeskItems });

    const seguridadItems: AdminMenuItem[] = [];
    if (isSuperAdmin || permissions?.canViewAuditLog)
      seguridadItems.push({ to: '/admin/audit-log', label: 'Registro de Auditoria', icon: <Shield className="h-4 w-4" /> });

    if (seguridadItems.length > 0)
      groups.push({ title: 'Seguridad', icon: <Shield className="h-4 w-4" />, items: seguridadItems });

    const ejecutivosItems: AdminMenuItem[] = [];
    if (isSuperAdmin || permissions?.canManageExecutives) {
      ejecutivosItems.push({ to: '/admin/ejecutivos', label: 'Ejecutivos', icon: <Briefcase className="h-4 w-4" /> });
      ejecutivosItems.push({ to: '/admin/ejecutivos/comisiones', label: 'Comisiones', icon: <DollarSign className="h-4 w-4" /> });
      ejecutivosItems.push({ to: '/admin/ejecutivos/configuracion', label: 'Configuracion', icon: <Settings className="h-4 w-4" /> });
      ejecutivosItems.push({ to: '/admin/leads', label: 'Pipeline de Leads', icon: <TrendingUp className="h-4 w-4" /> });
    }

    if (ejecutivosItems.length > 0)
      groups.push({ title: 'Ejecutivos', icon: <Briefcase className="h-4 w-4" />, items: ejecutivosItems });

    return groups;
  };

  const getStaffMenuItems = (info: typeof staffInfo) => {
    if (!info) return [];
    const items: { to: string; label: string }[] = [
      { to: '/agency/dashboard', label: 'Panel' },
    ];
    if (info.permissions.canViewTours || info.permissions.canEditTours || info.permissions.canManageTours) items.push({ to: '/agency/tours', label: 'Tours' });
    if (info.permissions.canManageDestinations) items.push({ to: '/agency/destinations', label: 'Destinos' });
    if (info.permissions.canViewBookings) items.push({ to: '/agency/bookings', label: 'Reservas' });
    if (info.permissions.canManageDiscountCodes) items.push({ to: '/agency/discount-codes', label: 'Codigos Descuento' });
    if (info.permissions.canViewFinancials) items.push({ to: '/agency/financials', label: 'Finanzas' });
    return items;
  };

  const travelerMenuItems = [
    { to: '/traveler/dashboard', label: 'Panel Viajero' },
    { to: '/traveler/bookings', label: 'Mis Reservas' },
    { to: '/traveler/companions', label: 'Acompanantes' },
    { to: '/traveler/membership', label: 'ToursRed Plus' },
    { to: '/traveler/wallet', label: 'ToursRed Cash' },
    { to: '/traveler/points', label: 'ToursRed Points' },
    { to: '/traveler/referrals', label: 'Referidos' },
    { to: '/traveler/invoices', label: 'Mis Facturas' },
    { to: '/traveler/soporte', label: 'Mis Tickets' },
  ];

  const getRoleSpecificMenuItems = () => {
    if (isAgency) {
      return [
        { to: '/agency/dashboard', label: 'Panel' },
        { to: '/agency/tours', label: 'Tours' },
        { to: '/agency/destinations', label: 'Destinos' },
        { to: '/agency/bookings', label: 'Reservas' },
        { to: '/agency/discount-codes', label: 'Codigos Descuento' },
        { to: '/agency/financials', label: 'Finanzas' },
        { to: '/agency/invoices', label: 'Facturas' },
        { to: '/agency/staff', label: 'Coordinadores' },
        { to: '/agency/featured-tours', label: 'Tours Destacados' },
        { to: '/agency/soporte', label: 'Soporte' },
      ];
    }

    if (isTraveler && !isAgencyStaff) {
      return travelerMenuItems;
    }

    return [];
  };

  const isMultiAgencyStaff = isAgencyStaff && allStaffInfo.length > 1;

  const isAdminPath = location.pathname.startsWith('/admin');

  return (
    <nav className="bg-blue-50 shadow-sm sticky top-0 z-50">
      <div className="container-custom">
        <div className="flex justify-between h-16">
          <div className="flex">
            <Link to="/" className="flex-shrink-0 flex items-center">
              <img src="/Logo_Transparente.jpg" alt="ToursRed Logo" loading="lazy" className="h-12 w-auto" />
            </Link>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              <Link to="/" className="border-transparent text-gray-500 hover:border-primary-500 hover:text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                Inicio
              </Link>

              <div
                className="relative inline-flex items-center"
                onMouseEnter={() => setIsToursDropdownOpen(true)}
                onMouseLeave={() => setIsToursDropdownOpen(false)}
              >
                <button className="border-transparent text-gray-500 hover:border-primary-500 hover:text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                  Tours
                  <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${isToursDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isToursDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5">
                    <div className="py-1" role="menu">
                      <Link
                        to="/tours"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-primary-600"
                        role="menuitem"
                      >
                        Tours Nacionales
                      </Link>
                      <div className="border-t border-gray-100"></div>
                      <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        Tours Internacionales
                      </div>
                      <Link to="/tours/international/mega-travel" className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-primary-600" role="menuitem">
                        Mega Travel
                      </Link>
                      <Link to="/tours/international/nefertari-travel" className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-primary-600" role="menuitem">
                        Nefertari Travel
                      </Link>
                      <Link to="/tours/international/exoticca" className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-primary-600" role="menuitem">
                        Exoticca
                      </Link>
                      <Link to="/tours/international/coming-soon" className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-primary-600" role="menuitem">
                        Otras Agencias
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              <Link to="/about" className="border-transparent text-gray-500 hover:border-primary-500 hover:text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                Nosotros
              </Link>
              <Link to="/contact" className="border-transparent text-gray-500 hover:border-primary-500 hover:text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                Contacto
              </Link>
              <Link to="/gift-cards" className="border-transparent text-gray-500 hover:border-primary-500 hover:text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                Tarjetas de Regalo
              </Link>
              <Link to="/soporte" className="border-transparent text-gray-500 hover:border-primary-500 hover:text-gray-900 inline-flex items-center gap-1 px-1 pt-1 border-b-2 text-sm font-medium">
                <HeadphonesIcon className="h-4 w-4" />
                Soporte
              </Link>

              {isAdmin && isEmailVerified && (
                <div className="relative inline-flex items-center" ref={adminMenuRef}>
                  <button
                    onClick={() => setIsAdminMenuOpen(!isAdminMenuOpen)}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors ${
                      isAdminPath
                        ? 'border-primary-500 text-primary-700'
                        : 'border-transparent text-gray-500 hover:border-primary-500 hover:text-gray-900'
                    }`}
                  >
                    <LayoutDashboard className="mr-1.5 h-4 w-4" />
                    Admin
                    <ChevronDown className={`ml-1 h-4 w-4 transition-transform duration-200 ${isAdminMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isAdminMenuOpen && (
                    <div
                      className="absolute top-full mt-1 rounded-xl shadow-2xl bg-white ring-1 ring-black ring-opacity-5 z-50 overflow-y-auto"
                      style={{ width: 'min(720px, 95vw)', right: 'auto', left: '50%', transform: 'translateX(-50%)', maxHeight: 'calc(100vh - 5rem)' }}
                    >
                      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50 sticky top-0 z-10">
                        <div className="flex items-center gap-2">
                          <LayoutDashboard className="h-4 w-4 text-primary-600" />
                          <span className="text-sm font-semibold text-gray-700">Panel de Administracion</span>
                        </div>
                        <Link
                          to="/admin/dashboard"
                          onClick={() => setIsAdminMenuOpen(false)}
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium"
                        >
                          Ver panel principal
                        </Link>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-0 divide-x divide-gray-100">
                        {getAdminMenuGroups().map((group) => (
                          <div key={group.title} className="p-3">
                            <div className="flex items-center gap-1.5 mb-2 px-1">
                              <span className="text-primary-500">{group.icon}</span>
                              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{group.title}</span>
                            </div>
                            <div className="space-y-0.5">
                              {group.items.map((item) => (
                                <Link
                                  key={item.to}
                                  to={item.to}
                                  onClick={() => setIsAdminMenuOpen(false)}
                                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                                    location.pathname === item.to
                                      ? 'bg-primary-50 text-primary-700 font-medium'
                                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                  }`}
                                >
                                  <span className={location.pathname === item.to ? 'text-primary-500' : 'text-gray-400'}>
                                    {item.icon}
                                  </span>
                                  {item.label}
                                </Link>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="hidden sm:ml-6 sm:flex sm:items-center">
            <Link to="/search" className="p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
              <Search className="h-6 w-6" />
            </Link>

            {user && isEmailVerified && (
              <>
                <div className="ml-3 p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
                  <NotificationBell />
                </div>
                <Link to="/messages" className="ml-3 p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
                  <MessageCircle className="h-6 w-6" />
                </Link>
              </>
            )}

            {user ? (
              <div className="ml-3 relative">
                <button
                  onClick={toggleProfile}
                  className="bg-blue-100 rounded-full flex text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  id="user-menu-button"
                  aria-expanded="false"
                  aria-haspopup="true"
                >
                  <span className="sr-only">Abrir menu de usuario</span>
                  <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 overflow-hidden">
                    {profilePicture ? (
                      <img src={profilePicture} alt="Perfil" className="w-full h-full object-cover" />
                    ) : (
                      <User className="h-5 w-5" />
                    )}
                  </div>
                </button>

                {isProfileOpen && (
                  <div
                    className="origin-top-right absolute right-0 mt-2 rounded-md shadow-lg py-1 bg-blue-50 ring-1 ring-black ring-opacity-5 focus:outline-none overflow-y-auto"
                    style={{ minWidth: isAgencyStaff ? '230px' : '192px', maxHeight: 'calc(100vh - 5rem)' }}
                    role="menu"
                    aria-orientation="vertical"
                    aria-labelledby="user-menu-button"
                    tabIndex={-1}
                  >
                    {!isEmailVerified ? (
                      <>
                        <Link
                          to="/verify-email"
                          className="block px-4 py-2 text-sm text-orange-600 hover:bg-blue-100 font-medium"
                          role="menuitem"
                          onClick={() => setIsProfileOpen(false)}
                        >
                          Verificar Email
                        </Link>
                        <div className="border-t border-gray-100 my-1"></div>
                      </>
                    ) : (
                      <>
                        {isAgencyStaff ? (
                          <>
                            {isMultiAgencyStaff ? (
                              <>
                                {allStaffInfo.map((info) => (
                                  <div key={info.agencyId}>
                                    <button
                                      onClick={() => { switchActiveAgency(info.agencyId); setIsProfileOpen(false); }}
                                      className={`w-full text-left px-3 py-2 text-xs font-semibold flex items-center justify-between gap-2 ${
                                        info.agencyId === activeAgencyId
                                          ? 'bg-primary-50 text-primary-700'
                                          : 'text-gray-500 hover:bg-blue-100'
                                      }`}
                                    >
                                      <span className="flex items-center gap-1.5 truncate">
                                        <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="truncate">{info.agencyName}</span>
                                      </span>
                                      {info.agencyId === activeAgencyId && (
                                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-primary-500" />
                                      )}
                                    </button>
                                    {info.agencyId === activeAgencyId && getStaffMenuItems(info).map((item) => (
                                      <Link
                                        key={item.to}
                                        to={item.to}
                                        className="block pl-8 pr-4 py-1.5 text-sm text-gray-700 hover:bg-blue-100"
                                        role="menuitem"
                                        onClick={() => setIsProfileOpen(false)}
                                      >
                                        {item.label}
                                      </Link>
                                    ))}
                                    <div className="border-t border-gray-100 my-1" />
                                  </div>
                                ))}
                              </>
                            ) : (
                              <>
                                <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                                  <Building2 className="h-3 w-3" />
                                  {staffInfo?.agencyName}
                                </div>
                                {staffInfo && getStaffMenuItems(staffInfo).map((item) => (
                                  <Link
                                    key={item.to}
                                    to={item.to}
                                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-100"
                                    role="menuitem"
                                    onClick={() => setIsProfileOpen(false)}
                                  >
                                    {item.label}
                                  </Link>
                                ))}
                                <div className="border-t border-gray-100 my-1" />
                              </>
                            )}
                            <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                              Mi cuenta
                            </div>
                            {travelerMenuItems.map((item) => (
                              <Link
                                key={item.to}
                                to={item.to}
                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-100"
                                role="menuitem"
                                onClick={() => setIsProfileOpen(false)}
                              >
                                {item.label}
                              </Link>
                            ))}
                            <div className="border-t border-gray-100 my-1" />
                          </>
                        ) : (
                          <>
                      {!isAdmin && getRoleSpecificMenuItems().map((item) => (
                              <Link
                                key={item.to}
                                to={item.to}
                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-100"
                                role="menuitem"
                                onClick={() => setIsProfileOpen(false)}
                              >
                                {item.label}
                              </Link>
                            ))}

                            {!isAdmin && getRoleSpecificMenuItems().length > 0 && (
                              <div className="border-t border-gray-100 my-1"></div>
                            )}

                            {isAccountExecutive && (
                              <>
                                <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                                  <Briefcase className="h-3 w-3" />
                                  Ejecutivo
                                </div>
                                {[
                                  { to: '/executive/dashboard', label: 'Panel' },
                                  { to: '/executive/leads', label: 'Leads (CRM)' },
                                  { to: '/executive/mis-agencias', label: 'Mis Agencias' },
                                  { to: '/executive/comisiones', label: 'Mis Comisiones' },
                                ].map(item => (
                                  <Link
                                    key={item.to}
                                    to={item.to}
                                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-100"
                                    role="menuitem"
                                    onClick={() => setIsProfileOpen(false)}
                                  >
                                    {item.label}
                                  </Link>
                                ))}
                                <div className="border-t border-gray-100 my-1"></div>
                              </>
                            )}
                          </>
                        )}

                        <Link
                          to={getProfileLink()}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-100"
                          role="menuitem"
                          onClick={() => setIsProfileOpen(false)}
                        >
                          Perfil
                        </Link>
                      </>
                    )}
                    <button
                      onClick={handleSignOut}
                      className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-blue-100"
                      role="menuitem"
                    >
                      Cerrar sesion
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <Link to="/login" className="text-gray-500 hover:text-gray-900 text-sm font-medium">
                  Iniciar sesion
                </Link>
                <Link to="/signup" className="btn btn-primary">
                  Registrarse
                </Link>
              </div>
            )}
          </div>

          <div className="flex items-center sm:hidden">
            <Link to="/search" className="p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 mr-2">
              <Search className="h-6 w-6" />
            </Link>
            {user && (
              <div className="flex items-center">
                <Link to="/messages" className="p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 mr-2">
                  <MessageCircle className="h-6 w-6" />
                </Link>
                <div className="p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 mr-2">
                  <NotificationBell />
                </div>
              </div>
            )}
            <button
              onClick={toggleMenu}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
              aria-expanded="false"
            >
              <span className="sr-only">Abrir menu principal</span>
              {isMenuOpen ? (
                <X className="block h-6 w-6" aria-hidden="true" />
              ) : (
                <Menu className="block h-6 w-6" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className="sm:hidden max-h-[calc(100vh-4rem)] overflow-y-auto" id="mobile-menu">
          <div className="pt-2 pb-3 space-y-1">
            <Link
              to="/"
              className="bg-primary-50 border-primary-500 text-primary-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium"
              onClick={toggleMenu}
            >
              Inicio
            </Link>

            <div>
              <button
                onClick={toggleMobileTours}
                className="w-full flex items-center justify-between border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 pl-3 pr-4 py-2 border-l-4 text-base font-medium"
              >
                <span>Tours</span>
                <ChevronDown className={`h-5 w-5 transition-transform ${isMobileToursOpen ? 'rotate-180' : ''}`} />
              </button>

              {isMobileToursOpen && (
                <div className="pl-8 pr-4 py-2 space-y-1 bg-blue-50">
                  <Link to="/tours" className="block py-2 text-sm text-gray-600 hover:text-gray-900" onClick={toggleMenu}>
                    Tours Nacionales
                  </Link>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider py-1">
                    Tours Internacionales
                  </div>
                  <Link to="/tours/international/mega-travel" className="block py-2 text-sm text-gray-600 hover:text-gray-900" onClick={toggleMenu}>Mega Travel</Link>
                  <Link to="/tours/international/nefertari-travel" className="block py-2 text-sm text-gray-600 hover:text-gray-900" onClick={toggleMenu}>Nefertari Travel</Link>
                  <Link to="/tours/international/exoticca" className="block py-2 text-sm text-gray-600 hover:text-gray-900" onClick={toggleMenu}>Exoticca</Link>
                  <Link to="/tours/international/coming-soon" className="block py-2 text-sm text-gray-600 hover:text-gray-900" onClick={toggleMenu}>Otras Agencias</Link>
                </div>
              )}
            </div>

            <Link to="/about" className="border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium" onClick={toggleMenu}>
              Nosotros
            </Link>
            <Link to="/contact" className="border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium" onClick={toggleMenu}>
              Contacto
            </Link>
            <Link to="/gift-cards" className="border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium" onClick={toggleMenu}>
              Tarjetas de Regalo
            </Link>
            <Link to="/soporte" className="border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 block pl-3 pr-4 py-2 border-l-4 text-base font-medium" onClick={toggleMenu}>
              Soporte
            </Link>
          </div>

          <div className="pt-4 pb-3 border-t border-gray-200">
            {user ? (
              <>
                <div className="flex items-center px-4">
                  <div className="flex-shrink-0">
                    <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 overflow-hidden">
                      {profilePicture ? (
                        <img src={profilePicture} alt="Perfil" className="w-full h-full object-cover" />
                      ) : (
                        <User className="h-6 w-6" />
                      )}
                    </div>
                  </div>
                  <div className="ml-3">
                    <div className="text-base font-medium text-gray-800">{user.email}</div>
                    <div className="text-sm text-gray-500">
                      {isAdmin ? 'Administrador' : isAgency ? 'Agencia' : isAgencyStaff ? (staffInfo?.agencyName ?? 'Coordinador') : isAccountExecutive ? 'Ejecutivo de Cuenta' : 'Viajero'}
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-1">
                  {isAdmin && isEmailVerified ? (
                    <>
                      {getAdminMenuGroups().map((group) => (
                        <div key={group.title}>
                          <button
                            onClick={() => setMobileExpandedGroup(mobileExpandedGroup === group.title ? null : group.title)}
                            className="w-full flex items-center justify-between px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-blue-50"
                          >
                            <span className="flex items-center gap-2">
                              <span className="text-primary-500">{group.icon}</span>
                              {group.title}
                            </span>
                            <ChevronDown className={`h-4 w-4 transition-transform ${mobileExpandedGroup === group.title ? 'rotate-180' : ''}`} />
                          </button>
                          {mobileExpandedGroup === group.title && (
                            <div className="bg-blue-50 pl-10 pr-4 py-1 space-y-0.5">
                              {group.items.map((item) => (
                                <Link
                                  key={item.to}
                                  to={item.to}
                                  onClick={toggleMenu}
                                  className={`flex items-center gap-2 py-2 text-sm ${
                                    location.pathname === item.to
                                      ? 'text-primary-700 font-medium'
                                      : 'text-gray-600 hover:text-gray-900'
                                  }`}
                                >
                                  <span className={location.pathname === item.to ? 'text-primary-500' : 'text-gray-400'}>
                                    {item.icon}
                                  </span>
                                  {item.label}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  ) : isAgencyStaff ? (
                    <>
                      {isMultiAgencyStaff ? (
                        <>
                          {allStaffInfo.map((info) => (
                            <div key={info.agencyId}>
                              <button
                                onClick={() => { switchActiveAgency(info.agencyId); setMobileExpandedGroup(mobileExpandedGroup === info.agencyId ? null : info.agencyId); }}
                                className={`w-full flex items-center justify-between px-4 py-2 text-base font-medium hover:bg-blue-50 ${
                                  info.agencyId === activeAgencyId ? 'text-primary-700' : 'text-gray-500 hover:text-gray-800'
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <Building2 className="h-4 w-4 flex-shrink-0" />
                                  <span className="truncate">{info.agencyName}</span>
                                  {info.agencyId === activeAgencyId && <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />}
                                </span>
                                <ChevronDown className={`h-4 w-4 transition-transform flex-shrink-0 ${mobileExpandedGroup === info.agencyId ? 'rotate-180' : ''}`} />
                              </button>
                              {mobileExpandedGroup === info.agencyId && (
                                <div className="bg-blue-50 pl-10 pr-4 py-1 space-y-0.5">
                                  {getStaffMenuItems(info).map((item) => (
                                    <Link key={item.to} to={item.to} onClick={toggleMenu} className="block py-2 text-sm text-gray-600 hover:text-gray-900">
                                      {item.label}
                                    </Link>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      ) : (
                        <>
                          <div className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Building2 className="h-3 w-3" />
                            {staffInfo?.agencyName}
                          </div>
                          {staffInfo && getStaffMenuItems(staffInfo).map((item) => (
                            <Link key={item.to} to={item.to} className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-blue-100" onClick={toggleMenu}>
                              {item.label}
                            </Link>
                          ))}
                        </>
                      )}
                      <div className="border-t border-gray-200 my-1" />
                      <div className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        Mi cuenta
                      </div>
                      {travelerMenuItems.map((item) => (
                        <Link key={item.to} to={item.to} className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-blue-100" onClick={toggleMenu}>
                          {item.label}
                        </Link>
                      ))}
                    </>
                  ) : isAccountExecutive ? (
                    <>
                      {[
                        { to: '/executive/dashboard', label: 'Panel' },
                        { to: '/executive/leads', label: 'Leads (CRM)' },
                        { to: '/executive/mis-agencias', label: 'Mis Agencias' },
                        { to: '/executive/comisiones', label: 'Mis Comisiones' },
                      ].map(item => (
                        <Link
                          key={item.to}
                          to={item.to}
                          className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-blue-100"
                          onClick={toggleMenu}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </>
                  ) : (
                    getRoleSpecificMenuItems().map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-blue-100"
                        onClick={toggleMenu}
                      >
                        {item.label}
                      </Link>
                    ))
                  )}

                  <Link
                    to={getProfileLink()}
                    className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-blue-100"
                    onClick={toggleMenu}
                  >
                    Perfil
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-blue-100"
                  >
                    Cerrar sesion
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-1 px-4">
                <Link to="/login" className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-blue-100" onClick={toggleMenu}>
                  Iniciar sesion
                </Link>
                <Link to="/signup" className="block px-4 py-2 text-base font-medium bg-primary-600 text-white rounded-md" onClick={toggleMenu}>
                  Registrarse
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default NavBar;
