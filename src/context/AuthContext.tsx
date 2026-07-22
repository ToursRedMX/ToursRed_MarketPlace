import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { supabase, UserRole } from '../lib/supabase';

export interface AdminPermissions {
  canManageAgencies: boolean;
  canManageUsers: boolean;
  canManageTravelers: boolean;
  canManageDestinations: boolean;
  canManageCategories: boolean;
  canManageDeparturePoints: boolean;
  canManageReviews: boolean;
  canManageMessages: boolean;
  canManageSettings: boolean;
  canManageMemberships: boolean;
  canManageInquiries: boolean;
  canManagePoints: boolean;
  canManageDiscountCodes: boolean;
  canViewAccounting: boolean;
  canExportSatXml: boolean;
  canManageChartOfAccounts: boolean;
  canManageServiceDesk: boolean;
  canManageExecutives: boolean;
  // Audit permissions
  canViewAuditLog: boolean;
  canViewAuditSensitiveData: boolean;
  canExportAuditLog: boolean;
  // Booking cancellation permission
  canCancelBookings: boolean;
}

// Stable device fingerprint (no PII — only browser characteristics)
function computeDeviceFingerprint(): string {
  try {
    const raw = [
      navigator.userAgent,
      navigator.language,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen.width + 'x' + screen.height,
      navigator.platform,
    ].join('|');
    // Simple djb2 hash — no crypto needed for this use-case
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  } catch {
    return 'unknown';
  }
}

// Inactivity timeouts per role (ms); 0 = no timeout
const INACTIVITY_TIMEOUT_MS: Record<string, number> = {
  admin: 30 * 60 * 1000,
  accountant: 30 * 60 * 1000,
  account_executive: 2 * 60 * 60 * 1000,
  agency: 2 * 60 * 60 * 1000,
  traveler: 0,
};

async function callRecordSessionEvent(payload: Record<string, unknown>): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';
    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-session-event`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );
  } catch {
    // best-effort — never throw
  }
}

export interface AgencyStaffPermissions {
  canScanCheckin: boolean;
  canViewBookings: boolean;
  canViewTours: boolean;
  canEditTours: boolean;
  canManageTours: boolean;
  canViewFinancials: boolean;
  canViewReports: boolean;
  canManageDiscountCodes: boolean;
  canViewMessages: boolean;
  canManageDestinations: boolean;
}

export interface AgencyStaffInfo {
  staffId: string;
  agencyId: string;
  agencyName: string;
  title: string;
  permissions: AgencyStaffPermissions;
}

export interface AccountantPermissions {
  canViewAccounting: boolean;
  canExportSatXml: boolean;
  canManageChartOfAccounts: boolean;
}

export interface AccountExecutiveInfo {
  executiveId: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
}

interface AuthContextType {
  user: any | null;
  userRole: UserRole | null;
  isLoading: boolean;
  isAdmin: boolean;
  isAgency: boolean;
  isTraveler: boolean;
  isAccountant: boolean;
  isAccountExecutive: boolean;
  isEmailVerified: boolean;
  isSuperAdmin: boolean;
  isOnboardingPending: boolean;
  mustChangePassword: boolean;
  permissions: AdminPermissions | null;
  accountantPermissions: AccountantPermissions | null;
  accountExecutiveInfo: AccountExecutiveInfo | null;
  isAgencyStaff: boolean;
  staffInfo: AgencyStaffInfo | null;
  allStaffInfo: AgencyStaffInfo[];
  activeAgencyId: string | null;
  switchActiveAgency: (agencyId: string) => void;
  isAgencyApproved: boolean;
  needsTermsAcceptance: boolean;
  markTermsAccepted: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithAzure: () => Promise<void>;
  signInWithTwitter: () => Promise<void>;
  signInWithFacebook: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refreshAuthState: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userRole: null,
  isLoading: true,
  isAdmin: false,
  isAgency: false,
  isTraveler: false,
  isAccountant: false,
  isAccountExecutive: false,
  isEmailVerified: false,
  isSuperAdmin: false,
  isOnboardingPending: false,
  mustChangePassword: false,
  permissions: null,
  accountantPermissions: null,
  accountExecutiveInfo: null,
  isAgencyStaff: false,
  staffInfo: null,
  allStaffInfo: [],
  activeAgencyId: null,
  switchActiveAgency: () => {},
  isAgencyApproved: true,
  needsTermsAcceptance: false,
  markTermsAccepted: () => {},
  signInWithGoogle: async () => {},
  signInWithAzure: async () => {},
  signInWithTwitter: async () => {},
  signInWithFacebook: async () => {},
  completeOnboarding: async () => {},
  refreshAuthState: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const ROLE_CACHE_TTL = 5 * 60 * 1000;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [permissions, setPermissions] = useState<AdminPermissions | null>(null);
  const [accountantPermissions, setAccountantPermissions] = useState<AccountantPermissions | null>(null);
  const [accountExecutiveInfo, setAccountExecutiveInfo] = useState<AccountExecutiveInfo | null>(null);
  const [allStaffInfo, setAllStaffInfo] = useState<AgencyStaffInfo[]>([]);
  const [activeAgencyId, setActiveAgencyId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('active_agency_id') || null;
    } catch {
      return null;
    }
  });
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [needsTermsAcceptance, setNeedsTermsAcceptance] = useState(false);
  const [isOnboardingPending, setIsOnboardingPending] = useState(false);
  const [isAgencyApproved, setIsAgencyApproved] = useState(true);

  const initializedUserIdRef = useRef<string | null>(null);
  const isUpdatingRef = useRef(false);

  const getCachedRole = (userId: string): UserRole | null => {
    try {
      const raw = sessionStorage.getItem(`user_role_${userId}`) || localStorage.getItem(`user_role_${userId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.role && parsed.ts && Date.now() - parsed.ts < ROLE_CACHE_TTL) {
        if (Object.values(UserRole).includes(parsed.role as UserRole)) {
          return parsed.role as UserRole;
        }
      }
    } catch {
      // ignore
    }
    return null;
  };

  const setCachedRole = (userId: string, role: UserRole) => {
    try {
      const value = JSON.stringify({ role, ts: Date.now() });
      sessionStorage.setItem(`user_role_${userId}`, value);
      localStorage.setItem(`user_role_${userId}`, value);
    } catch {
      // ignore
    }
  };

  const clearAuthCache = (userId?: string) => {
    try {
      sessionStorage.removeItem('auth_state');
      if (userId) {
        sessionStorage.removeItem(`user_role_${userId}`);
        localStorage.removeItem(`user_role_${userId}`);
      }
      localStorage.removeItem('active_agency_id');
    } catch {
      // ignore
    }
  };

  const loadStaffInfo = async (userId: string): Promise<AgencyStaffInfo[]> => {
    try {
      const { data, error } = await supabase.rpc('get_staff_with_permissions', { p_user_id: userId });
      if (error || !data || data.length === 0) return [];
      return data.map((row: any) => ({
        staffId: row.staff_id,
        agencyId: row.agency_id,
        agencyName: row.agency_name,
        title: row.title,
        permissions: {
          canScanCheckin: row.can_scan_checkin,
          canViewBookings: row.can_view_bookings,
          canViewTours: row.can_view_tours,
          canEditTours: row.can_edit_tours,
          canManageTours: row.can_manage_tours,
          canViewFinancials: row.can_view_financials,
          canViewReports: row.can_view_reports,
          canManageDiscountCodes: row.can_manage_discount_codes,
          canViewMessages: row.can_view_messages,
          canManageDestinations: row.can_manage_destinations,
        }
      }));
    } catch {
      return [];
    }
  };

  const switchActiveAgency = useCallback((agencyId: string) => {
    setActiveAgencyId(agencyId);
    try {
      localStorage.setItem('active_agency_id', agencyId);
    } catch {
      // ignore
    }
  }, []);

  const markTermsAccepted = useCallback(() => {
    setNeedsTermsAcceptance(false);
  }, []);

  const determineUserRole = async (authUser: any, forceRefresh: boolean = false): Promise<{ role: UserRole; emailVerified: boolean }> => {
    if (!authUser) return { role: UserRole.TRAVELER, emailVerified: false };

    if (authUser.email === 'admin@toursred.com') {
      setCachedRole(authUser.id, UserRole.ADMIN);
      return { role: UserRole.ADMIN, emailVerified: true };
    }

    if (!forceRefresh) {
      const cachedRole = getCachedRole(authUser.id);
      if (cachedRole) {
        const cachedEmailVerified = (() => {
          try {
            const raw = sessionStorage.getItem('auth_state');
            if (raw) {
              const p = JSON.parse(raw);
              if (p.userId === authUser.id) return p.emailVerified ?? true;
            }
          } catch { /**/ }
          return true;
        })();
        return { role: cachedRole, emailVerified: cachedEmailVerified };
      }
    }

    const metadataRole = authUser.user_metadata?.role;

    try {
      const { data: profile } = await supabase
        .from('users')
        .select('role, email_verified, is_active, must_change_password')
        .eq('id', authUser.id)
        .maybeSingle();

      if (profile) {
        if (profile.is_active === false) {
          await supabase.auth.signOut();
          if (typeof window !== 'undefined') {
            window.location.href = '/login?blocked=true';
          }
          throw new Error('Usuario bloqueado');
        }

        setMustChangePassword(profile.must_change_password === true);
        const role = profile.role as UserRole;
        const emailVerified = profile.email_verified || false;
        setCachedRole(authUser.id, role);
        try {
          sessionStorage.setItem('auth_state', JSON.stringify({ userId: authUser.id, role, emailVerified, timestamp: Date.now() }));
        } catch { /**/ }
        return { role, emailVerified };
      }
    } catch (err: any) {
      if (err.message === 'Usuario bloqueado') throw err;
      if (metadataRole && Object.values(UserRole).includes(metadataRole as UserRole)) {
        setCachedRole(authUser.id, metadataRole as UserRole);
        return { role: metadataRole as UserRole, emailVerified: true };
      }
    }

    if (metadataRole && Object.values(UserRole).includes(metadataRole as UserRole)) {
      setCachedRole(authUser.id, metadataRole as UserRole);
      return { role: metadataRole as UserRole, emailVerified: true };
    }

    setCachedRole(authUser.id, UserRole.TRAVELER);
    return { role: UserRole.TRAVELER, emailVerified: true };
  };

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/google-callback`;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  }, []);

  const signInWithAzure = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/azure-callback`;
    await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo, scopes: 'email profile openid https://graph.microsoft.com/User.Read' },
    });
  }, []);

  const signInWithTwitter = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/x-callback`;
    await supabase.auth.signInWithOAuth({
      provider: 'x',
      options: { redirectTo },
    });
  }, []);

  const signInWithFacebook = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/facebook-callback`;
    await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: { redirectTo },
    });
  }, []);

  const updateAuthState = async (authUser: any, forceRefresh: boolean = false) => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;
    try {
      setUser(authUser);

      if (authUser) {
        // Check if Google or Azure OAuth user hasn't completed onboarding yet
        const isOAuthProvider =
          authUser.app_metadata?.provider === 'google' ||
          authUser.app_metadata?.provider === 'azure' ||
          authUser.app_metadata?.provider === 'x' ||
          authUser.app_metadata?.provider === 'facebook' ||
          (authUser.identities ?? []).some((i: any) => ['google', 'azure', 'x', 'facebook'].includes(i.provider));
        const metaOnboarding = authUser.user_metadata?.onboarding_completed;

        if (isOAuthProvider && (metaOnboarding === false || metaOnboarding === null || metaOnboarding === undefined)) {
          // Check if profile exists in users table
          const { data: existingProfile } = await supabase
            .from('users')
            .select('id, role')
            .eq('id', authUser.id)
            .maybeSingle();

          if (!existingProfile) {
            // New OAuth user — needs onboarding; OAuth providers always verify email
            setIsEmailVerified(true);
            setIsOnboardingPending(true);
            setIsLoading(false);
            isUpdatingRef.current = false;
            return;
          }
        }

        setIsOnboardingPending(false);

        const { role, emailVerified } = await determineUserRole(authUser, forceRefresh);
        setUserRole(role);
        setIsEmailVerified(emailVerified);

        if (role === UserRole.ADMIN) {
          // Query is_super_admin primero — es la mas critica
          let isSA = false;
          try {
            const { data: saData } = await supabase
              .from('users')
              .select('is_super_admin')
              .eq('id', authUser.id)
              .maybeSingle();
            isSA = saData?.is_super_admin || false;
          } catch {
            // Si falla, asumir que no es super admin pero mantener rol admin
            isSA = false;
          }
          setIsSuperAdmin(isSA);

          // Query admin_permissions por separado para no bloquear el rol
          try {
            const { data: permsData } = await supabase
              .from('admin_permissions')
              .select('*')
              .eq('user_id', authUser.id)
              .maybeSingle();

            if (!isSA && permsData) {
              const p = permsData;
              setPermissions({
                canManageAgencies: p.can_manage_agencies,
                canManageUsers: p.can_manage_users,
                canManageTravelers: p.can_manage_travelers,
                canManageDestinations: p.can_manage_destinations,
                canManageCategories: p.can_manage_categories,
                canManageDeparturePoints: p.can_manage_departure_points,
                canManageReviews: p.can_manage_reviews,
                canManageMessages: p.can_manage_messages,
                canManageSettings: p.can_manage_settings,
                canManageMemberships: p.can_manage_memberships,
                canManageInquiries: p.can_manage_inquiries,
                canManagePoints: p.can_manage_points,
                canManageDiscountCodes: p.can_manage_discount_codes,
                canViewAccounting: p.can_view_accounting ?? true,
                canExportSatXml: p.can_export_sat_xml ?? true,
                canManageChartOfAccounts: p.can_manage_chart_of_accounts ?? false,
                canManageServiceDesk: p.can_manage_service_desk ?? false,
                canManageExecutives: p.can_manage_executives ?? false,
                canViewAuditLog: p.can_view_audit_log ?? false,
                canViewAuditSensitiveData: p.can_view_audit_sensitive_data ?? false,
                canExportAuditLog: p.can_export_audit_log ?? false,
                canCancelBookings: p.can_cancel_bookings ?? false,
              });
            } else {
              setPermissions(null);
            }
          } catch {
            setPermissions(null);
          }
          setAccountantPermissions(null);
          setAllStaffInfo([]);
          setAccountExecutiveInfo(null);
        } else if (role === UserRole.ACCOUNTANT) {
          setIsSuperAdmin(false);
          setPermissions(null);
          setAccountExecutiveInfo(null);
          // Cargar permisos contables desde admin_permissions si existen
          try {
            const { data: acctPerms } = await supabase
              .from('admin_permissions')
              .select('can_view_accounting, can_export_sat_xml, can_manage_chart_of_accounts')
              .eq('user_id', authUser.id)
              .maybeSingle();
            setAccountantPermissions({
              canViewAccounting: acctPerms?.can_view_accounting ?? true,
              canExportSatXml: acctPerms?.can_export_sat_xml ?? true,
              canManageChartOfAccounts: acctPerms?.can_manage_chart_of_accounts ?? false,
            });
          } catch {
            setAccountantPermissions({ canViewAccounting: true, canExportSatXml: true, canManageChartOfAccounts: false });
          }
          setAllStaffInfo([]);
          setAccountExecutiveInfo(null);
        } else if (role === UserRole.ACCOUNT_EXECUTIVE) {
          // Executives are always considered email-verified
          setIsEmailVerified(true);
          setIsSuperAdmin(false);
          setPermissions(null);
          setAccountantPermissions(null);
          setAllStaffInfo([]);
          setNeedsTermsAcceptance(false);
          // Cargar info del ejecutivo
          try {
            const { data: execData } = await supabase
              .from('account_executives')
              .select('id, first_name, last_name, email, is_active')
              .eq('user_id', authUser.id)
              .maybeSingle();
            if (execData) {
              setAccountExecutiveInfo({
                executiveId: execData.id,
                firstName: execData.first_name,
                lastName: execData.last_name,
                email: execData.email,
                isActive: execData.is_active ?? true,
              });
            } else {
              // Fallback: use auth metadata so the session is never broken
              setAccountExecutiveInfo({
                executiveId: authUser.id,
                firstName: authUser.user_metadata?.first_name || authUser.email?.split('@')[0] || 'Ejecutivo',
                lastName: authUser.user_metadata?.last_name || '',
                email: authUser.email || '',
                isActive: true,
              });
            }
          } catch {
            // Even on error, populate with minimal info so the app doesn't stall
            setAccountExecutiveInfo({
              executiveId: authUser.id,
              firstName: authUser.user_metadata?.first_name || 'Ejecutivo',
              lastName: authUser.user_metadata?.last_name || '',
              email: authUser.email || '',
              isActive: true,
            });
          }
        } else if (role === UserRole.TRAVELER) {
          setIsSuperAdmin(false);
          setPermissions(null);
          setAccountantPermissions(null);
          setAllStaffInfo([]);
          setNeedsTermsAcceptance(false);

          // Verificar si el viajero necesita aceptar T&C actualizados
          try {
            const [profileRes, termsRes] = await Promise.all([
              supabase.from('users').select('accepted_traveler_terms_version').eq('id', authUser.id).maybeSingle(),
              supabase.from('terms_versions').select('version_number').eq('terms_type', 'traveler').eq('is_active', true).maybeSingle(),
            ]);
            const acceptedVersion = profileRes.data?.accepted_traveler_terms_version ?? null;
            const activeVersion = termsRes.data?.version_number ?? null;
            setNeedsTermsAcceptance(activeVersion !== null && acceptedVersion !== activeVersion);
          } catch {
            setNeedsTermsAcceptance(false);
          }

          const { count } = await supabase
            .from('agency_staff')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', authUser.id)
            .eq('is_active', true);

          if (count && count > 0) {
            const staff = await loadStaffInfo(authUser.id);
            setAllStaffInfo(staff);
            if (staff.length > 0) {
              setActiveAgencyId(prev => {
                const isValid = staff.some(s => s.agencyId === prev);
                if (!isValid) {
                  const firstId = staff[0].agencyId;
                  try { localStorage.setItem('active_agency_id', firstId); } catch {}
                  return firstId;
                }
                return prev;
              });
            }
          } else {
            setAllStaffInfo([]);
          }
          setAccountExecutiveInfo(null);
        } else if (role === UserRole.AGENCY) {
          setIsSuperAdmin(false);
          setPermissions(null);
          setAccountantPermissions(null);
          setAllStaffInfo([]);
          setAccountExecutiveInfo(null);

          // Verificar si la agencia necesita aceptar T&C actualizados
          try {
            const [profileRes, termsRes] = await Promise.all([
              supabase.from('users').select('accepted_agency_terms_version').eq('id', authUser.id).maybeSingle(),
              supabase.from('terms_versions').select('version_number').eq('terms_type', 'agency').eq('is_active', true).maybeSingle(),
            ]);
            const acceptedVersion = profileRes.data?.accepted_agency_terms_version ?? null;
            const activeVersion = termsRes.data?.version_number ?? null;
            setNeedsTermsAcceptance(activeVersion !== null && acceptedVersion !== activeVersion);
          } catch {
            setNeedsTermsAcceptance(false);
          }

          // Verificar si la agencia está aprobada / en qué etapa de onboarding está
          try {
            const { data: agencyData } = await supabase
              .from('agencies')
              .select('is_approved, onboarding_status')
              .eq('user_id', authUser.id)
              .maybeSingle();
            const onboardingStatus = agencyData?.onboarding_status ?? 'pending_documents';
            setIsAgencyApproved(onboardingStatus === 'active' && agencyData?.is_approved === true);
          } catch {
            setIsAgencyApproved(false);
          }
        } else {
          setIsSuperAdmin(false);
          setPermissions(null);
          setAccountantPermissions(null);
          setAllStaffInfo([]);
          setAccountExecutiveInfo(null);
          setNeedsTermsAcceptance(false);
        }
      } else {
        setUserRole(null);
        setIsEmailVerified(false);
        setIsSuperAdmin(false);
        setIsOnboardingPending(false);
        setMustChangePassword(false);
        setPermissions(null);
        setAccountantPermissions(null);
        setAccountExecutiveInfo(null);
        setAllStaffInfo([]);
        setActiveAgencyId(null);
        setIsAgencyApproved(true);
        clearAuthCache();
      }
    } catch (err: any) {
      if (err.message === 'Usuario bloqueado') return;
      if (authUser) {
        if (authUser.email === 'admin@toursred.com') {
          setUserRole(UserRole.ADMIN);
          setIsEmailVerified(true);
          setIsSuperAdmin(true);
          setPermissions(null);
          setAccountantPermissions(null);
          setAllStaffInfo([]);
        } else {
          const cachedRole = getCachedRole(authUser.id);
          setUserRole(cachedRole || UserRole.TRAVELER);
          setIsEmailVerified(true);
          setIsSuperAdmin(false);
          setPermissions(null);
          setAccountantPermissions(null);
          setAllStaffInfo([]);
        }
      } else {
        setUserRole(null);
        setIsEmailVerified(false);
        setIsSuperAdmin(false);
        setPermissions(null);
        setAccountantPermissions(null);
        setAllStaffInfo([]);
        setActiveAgencyId(null);
      }
    } finally {
      isUpdatingRef.current = false;
      setIsLoading(false);
    }
  };

  // Inactivity detection refs
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRoleRef = useRef<UserRole | null>(null);
  const currentUserRef = useRef<any>(null);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    const role = currentRoleRef.current;
    if (!role) return;
    const timeout = INACTIVITY_TIMEOUT_MS[role] ?? 0;
    if (timeout <= 0) return;

    inactivityTimerRef.current = setTimeout(async () => {
      const authUser = currentUserRef.current;
      if (authUser) {
        callRecordSessionEvent({
          event_type: 'logout',
          user_id: authUser.id,
          email: authUser.email,
          ip_address: undefined,
          device_fingerprint: computeDeviceFingerprint(),
        });
      }
      await supabase.auth.signOut();
    }, timeout);
  }, []);

  useEffect(() => {
    let mounted = true;

    // Timeout de seguridad: si en 8 segundos nada libera el loading, forzarlo
    const safetyTimer = setTimeout(() => {
      if (mounted) setIsLoading(false);
    }, 8000);

    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const authUser = session?.user ?? null;

        if (authUser) {
          initializedUserIdRef.current = authUser.id;
        }

        if (mounted) {
          // forceRefresh=true para siempre consultar BD en la carga inicial,
          // ignorando cache potencialmente obsoleto
          await updateAuthState(authUser, true);
        }
      } catch {
        if (mounted) {
          setUser(null);
          setUserRole(null);
          setIsLoading(false);
        }
      } finally {
        clearTimeout(safetyTimer);
      }
    };

    initializeAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_IN') {
        const incomingUserId = session?.user?.id;
        if (incomingUserId && incomingUserId === initializedUserIdRef.current) {
          return;
        }
        initializedUserIdRef.current = incomingUserId ?? null;
        updateAuthState(session?.user ?? null, true).catch(() => {});

        // Record login session event (best-effort)
        if (session?.user) {
          callRecordSessionEvent({
            event_type: 'login',
            user_id: session.user.id,
            email: session.user.email,
            session_id: session.access_token ? undefined : undefined,
            device_fingerprint: computeDeviceFingerprint(),
            user_agent: navigator.userAgent,
            login_method: 'email_password',
          });
        }
      } else if (event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          setUser(session.user);
          const cachedRole = getCachedRole(session.user.id);
          if (cachedRole) setUserRole(cachedRole);
          // Restaurar isEmailVerified desde el cache para no pisar el valor
          // que initializeAuth ya cargo de la BD
          try {
            const raw = sessionStorage.getItem('auth_state');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed.userId === session.user.id && typeof parsed.emailVerified === 'boolean') {
                setIsEmailVerified(parsed.emailVerified);
              }
            }
          } catch { /**/ }
        }
        // Siempre liberar el loading en TOKEN_REFRESHED para evitar ciclo infinito
        setIsLoading(false);
      } else if (event === 'SIGNED_OUT') {
        // Record logout (best-effort)
        const prevUser = currentUserRef.current;
        if (prevUser) {
          callRecordSessionEvent({
            event_type: 'logout',
            user_id: prevUser.id,
            email: prevUser.email,
            device_fingerprint: computeDeviceFingerprint(),
            user_agent: navigator.userAgent,
          });
        }

        if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
        initializedUserIdRef.current = null;
        currentUserRef.current = null;
        currentRoleRef.current = null;
        setUser(null);
        setUserRole(null);
        setIsLoading(false);
        setIsSuperAdmin(false);
        setIsOnboardingPending(false);
        setMustChangePassword(false);
        setPermissions(null);
        setAllStaffInfo([]);
        setActiveAgencyId(null);
        try {
          sessionStorage.removeItem('auth_state');
        } catch { /**/ }
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // Keep role + user refs in sync for inactivity timer
  useEffect(() => {
    currentRoleRef.current = userRole;
    currentUserRef.current = user;
    resetInactivityTimer();
  }, [userRole, user, resetInactivityTimer]);

  // Bind user activity events to reset inactivity timer
  useEffect(() => {
    const events = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'];
    const handler = () => resetInactivityTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, handler));
  }, [resetInactivityTimer]);

  const isAdmin = userRole === UserRole.ADMIN;
  const isAgency = userRole === UserRole.AGENCY;
  const isTraveler = userRole === UserRole.TRAVELER;
  const isAccountant = userRole === UserRole.ACCOUNTANT;
  const isAccountExecutive = userRole === UserRole.ACCOUNT_EXECUTIVE;
  const isAgencyStaff = isTraveler && allStaffInfo.length > 0;

  const staffInfo: AgencyStaffInfo | null = useMemo(() => {
    if (allStaffInfo.length === 0) return null;
    return allStaffInfo.find(s => s.agencyId === activeAgencyId) ?? allStaffInfo[0];
  }, [allStaffInfo, activeAgencyId]);

  const completeOnboarding = useCallback(async () => {
    const { data: { user: freshUser } } = await supabase.auth.getUser();
    if (freshUser) {
      initializedUserIdRef.current = null;
      isUpdatingRef.current = false;
      await updateAuthState(freshUser, true);
    }
  }, []);

  const refreshAuthState = useCallback(async () => {
    const { data: { user: freshUser } } = await supabase.auth.getUser();
    if (freshUser) {
      // Clear stale cached email-verified flag so forceRefresh re-queries the DB
      try {
        sessionStorage.removeItem('auth_state');
        sessionStorage.removeItem(`user_role_${freshUser.id}`);
        localStorage.removeItem(`user_role_${freshUser.id}`);
      } catch { /**/ }
      isUpdatingRef.current = false;
      await updateAuthState(freshUser, true);
    }
  }, []);

  const contextValue = useMemo(() => ({
    user,
    userRole,
    isLoading,
    isAdmin,
    isAgency,
    isTraveler,
    isAccountant,
    isAccountExecutive,
    isEmailVerified,
    isSuperAdmin,
    isOnboardingPending,
    mustChangePassword,
    permissions,
    accountantPermissions,
    accountExecutiveInfo,
    isAgencyStaff,
    staffInfo,
    allStaffInfo,
    activeAgencyId,
    switchActiveAgency,
    isAgencyApproved,
    needsTermsAcceptance,
    markTermsAccepted,
    signInWithGoogle,
    signInWithAzure,
    signInWithTwitter,
    signInWithFacebook,
    completeOnboarding,
    refreshAuthState,
  }), [user, userRole, isLoading, isAdmin, isAgency, isTraveler, isAccountant, isAccountExecutive, isEmailVerified, isSuperAdmin, isOnboardingPending, mustChangePassword, permissions, accountantPermissions, accountExecutiveInfo, isAgencyStaff, staffInfo, allStaffInfo, activeAgencyId, switchActiveAgency, isAgencyApproved, needsTermsAcceptance, markTermsAccepted, signInWithGoogle, signInWithAzure, signInWithTwitter, signInWithFacebook, completeOnboarding, refreshAuthState]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};
