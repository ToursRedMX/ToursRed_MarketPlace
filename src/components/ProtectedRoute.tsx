import React, { useState, useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../lib/supabase';
import TermsAcceptanceGate from './TermsAcceptanceGate';
import { supabase as supabaseClient } from '../lib/supabase';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
  staffPermission?: keyof import('../context/AuthContext').AgencyStaffPermissions;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles, staffPermission }) => {
  const { user, userRole, isLoading, isEmailVerified, isAgencyStaff, staffInfo, needsTermsAcceptance, markTermsAccepted, isOnboardingPending, isAgencyApproved } = useAuth();
  const location = useLocation();
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const redirectTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }

    if (!isLoading && !user) {
      redirectTimerRef.current = setTimeout(() => {
        setShouldRedirect(true);
      }, 300);
    } else {
      setShouldRedirect(false);
    }

    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!user && shouldRedirect) {
    const currentPath = location.pathname + location.search;
    const loginPath = currentPath !== '/' ? `/login?redirect=${encodeURIComponent(currentPath)}` : '/login';
    return <Navigate to={loginPath} replace />;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // OAuth user who hasn't completed onboarding yet — route to the correct provider's onboarding
  if (isOnboardingPending) {
    const provider = user?.app_metadata?.provider;
    const onboardingPath = provider === 'azure' ? '/auth/azure-onboarding' : '/auth/google-onboarding';
    return <Navigate to={onboardingPath} replace />;
  }

  // Roles that bypass email verification (created with email pre-confirmed)
  const bypassesEmailVerification = userRole === UserRole.ADMIN
    || userRole === UserRole.ACCOUNTANT
    || userRole === UserRole.ACCOUNT_EXECUTIVE;

  if (!isEmailVerified && !bypassesEmailVerification) {
    return <Navigate to="/verify-email" replace />;
  }

  // Check if user has one of the allowed roles
  if (userRole && allowedRoles.includes(userRole)) {
    // If a specific staff permission is required and the user is agency staff,
    // check that permission
    if (staffPermission && isAgencyStaff && staffInfo) {
      if (!staffInfo.permissions[staffPermission]) {
        return <Navigate to="/agency/dashboard" replace />;
      }
    }

    // Block unapproved agencies — redirect to new onboarding flow
    const onboardingExemptPaths = ['/agency/onboarding', '/agency/pending-approval', '/agency/profile'];
    if (userRole === UserRole.AGENCY && !isAgencyApproved && !onboardingExemptPaths.includes(location.pathname)) {
      return <Navigate to="/agency/onboarding" replace />;
    }

    // Show T&C gate for traveler/agency routes if terms need acceptance
    if (needsTermsAcceptance && (userRole === UserRole.TRAVELER || userRole === UserRole.AGENCY)) {
      const termsType = userRole === UserRole.AGENCY ? 'agency' : 'traveler';
      const handleSignOut = async () => {
        await supabaseClient.auth.signOut();
        window.location.href = '/login';
      };
      return (
        <TermsAcceptanceGate
          termsType={termsType}
          onAccepted={markTermsAccepted}
          onSignOut={handleSignOut}
        />
      );
    }

    return <>{children}</>;
  }

  // Allow agency staff (traveler role with active staff vinculacion) to access agency routes
  if (allowedRoles.includes(UserRole.AGENCY) && isAgencyStaff && staffInfo) {
    if (staffPermission && !staffInfo.permissions[staffPermission]) {
      return <Navigate to="/agency/dashboard" replace />;
    }

    if (needsTermsAcceptance) {
      const handleSignOut = async () => {
        await supabaseClient.auth.signOut();
        window.location.href = '/login';
      };
      return (
        <TermsAcceptanceGate
          termsType="traveler"
          onAccepted={markTermsAccepted}
          onSignOut={handleSignOut}
        />
      );
    }

    return <>{children}</>;
  }

  // Redirect to the appropriate dashboard based on role
  if (userRole === UserRole.ADMIN) {
    return <Navigate to="/admin/dashboard" replace />;
  } else if (userRole === UserRole.AGENCY) {
    return <Navigate to="/agency/dashboard" replace />;
  } else if (userRole === UserRole.ACCOUNTANT) {
    return <Navigate to="/accounting" replace />;
  } else if (userRole === UserRole.ACCOUNT_EXECUTIVE) {
    return <Navigate to="/executive/dashboard" replace />;
  } else if (userRole === UserRole.TRAVELER) {
    if (isAgencyStaff) {
      return <Navigate to="/agency/dashboard" replace />;
    }
    return <Navigate to="/traveler/dashboard" replace />;
  } else {
    return <Navigate to="/" replace />;
  }
};

export default ProtectedRoute;
