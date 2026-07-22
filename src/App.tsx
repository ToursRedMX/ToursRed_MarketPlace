import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import NavBar from './components/NavBar';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import CookieBanner from './components/CookieBanner';
import GoogleAnalytics from './components/GoogleAnalytics';
import HomePage from './pages/HomePage';
import TourCatalogPage from './pages/TourCatalogPage';
import TourDetailPage from './pages/TourDetailPage';
import MessagingPage from './pages/MessagingPage';
import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import AgencySignupPage from './pages/auth/AgencySignupPage';
import GoogleOnboardingPage from './pages/auth/GoogleOnboardingPage';
import GoogleTravelerSignupPage from './pages/auth/GoogleTravelerSignupPage';
import GoogleAgencySignupPage from './pages/auth/GoogleAgencySignupPage';
import GoogleCallbackPage from './pages/auth/GoogleCallbackPage';
import AzureCallbackPage from './pages/auth/AzureCallbackPage';
import FacebookCallbackPage from './pages/auth/FacebookCallbackPage';
import FacebookOnboardingPage from './pages/auth/FacebookOnboardingPage';
import FacebookTravelerSignupPage from './pages/auth/FacebookTravelerSignupPage';
import FacebookAgencySignupPage from './pages/auth/FacebookAgencySignupPage';
import XCallbackPage from './pages/auth/XCallbackPage';
import XOnboardingPage from './pages/auth/XOnboardingPage';
import XTravelerSignupPage from './pages/auth/XTravelerSignupPage';
import XAgencySignupPage from './pages/auth/XAgencySignupPage';
import AzureOnboardingPage from './pages/auth/AzureOnboardingPage';
import AzureTravelerSignupPage from './pages/auth/AzureTravelerSignupPage';
import AzureAgencySignupPage from './pages/auth/AzureAgencySignupPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import TravelerDashboard from './pages/traveler/TravelerDashboard';
import TravelerBookings from './pages/traveler/TravelerBookings';
import SupplementSuccessPage from './pages/traveler/SupplementSuccessPage';
import PaymentPlanSuccessPage from './pages/traveler/PaymentPlanSuccessPage';
import ExtrasSuccessPage from './pages/traveler/ExtrasSuccessPage';
import TravelerProfile from './pages/traveler/TravelerProfile';
import TravelerMembership from './pages/traveler/TravelerMembership';
import MembershipCheckout from './pages/traveler/MembershipCheckout';
import TravelerWallet from './pages/traveler/TravelerWallet';
import TravelerPoints from './pages/traveler/TravelerPoints';
import TravelerCompanions from './pages/traveler/TravelerCompanions';
import TravelerReferrals from './pages/traveler/TravelerReferrals';
import TravelerInvoices from './pages/traveler/TravelerInvoices';
import AgencyDashboard from './pages/agency/AgencyDashboard';
import AgencyTours from './pages/agency/AgencyTours';
import AgencyBookings from './pages/agency/AgencyBookings';
import AgencyProfile from './pages/agency/AgencyProfile';
import AgencyDestinations from './pages/agency/AgencyDestinations';
import AgencyDiscountCodes from './pages/agency/AgencyDiscountCodes';
import AgencyFinancials from './pages/agency/AgencyFinancials';
import AgencyInvoices from './pages/agency/AgencyInvoices';
import AgencyStaff from './pages/agency/AgencyStaff';
import AgencyFeaturedTours from './pages/agency/AgencyFeaturedTours';
import AgencyPendingApproval from './pages/agency/AgencyPendingApproval';
import AgencyAmendmentSignaturePage from './pages/agency/AgencyAmendmentSignaturePage';
import AgencyOnboardingPage from './pages/agency/onboarding/AgencyOnboardingPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminAgencies from './pages/admin/AdminAgencies';
import AdminUsers from './pages/admin/AdminUsers';
import AdminTravelers from './pages/admin/AdminTravelers';
import AdminReviews from './pages/admin/AdminReviews';
import AdminMessages from './pages/admin/AdminMessages';
import AdminDestinations from './pages/admin/AdminDestinations';
import AdminDeparturePoints from './pages/admin/AdminDeparturePoints';
import AdminCategories from './pages/admin/AdminCategories';
import AdminTours from './pages/admin/AdminTours';
import AdminTourMetrics from './pages/admin/AdminTourMetrics';
import AdminProfile from './pages/admin/AdminProfile';
import AdminSettings from './pages/admin/AdminSettings';
import AdminMemberships from './pages/admin/AdminMemberships';
import AdminPoints from './pages/admin/AdminPoints';
import AdminInternationalInquiries from './pages/admin/AdminInternationalInquiries';
import AdminDiscountCodes from './pages/admin/AdminDiscountCodes';
import AdminPayouts from './pages/admin/AdminPayouts';
import AdminReferrals from './pages/admin/AdminReferrals';
import AdminPromotions from './pages/admin/AdminPromotions';
import AdminTourMessages from './pages/admin/AdminTourMessages';
import AdminBroadcastMessages from './pages/admin/AdminBroadcastMessages';
import AdminNewsletter from './pages/admin/AdminNewsletter';
import AdminCfdi from './pages/admin/AdminCfdi';
import AdminCfdiManual from './pages/admin/AdminCfdiManual';
import AdminContabilidad from './pages/admin/AdminContabilidad';
import AdminReporteMaestro from './pages/admin/AdminReporteMaestro';
import AccountingPage from './pages/accounting/AccountingPage';
import MegaTravelPage from './pages/international/MegaTravelPage';
import NefertariTravelPage from './pages/international/NefertariTravelPage';
import ExoticcaPage from './pages/international/ExoticcaPage';
import ComingSoonPage from './pages/international/ComingSoonPage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import TermsOfServicePage from './pages/TermsOfServicePage';
import CookiePolicyPage from './pages/CookiePolicyPage';
import SuccessPage from './pages/SuccessPage';
import CancelPage from './pages/CancelPage';
import BookingSuccessPage from './pages/BookingSuccessPage';
import BookingCancelPage from './pages/BookingCancelPage';
import BookingPendingPage from './pages/BookingPendingPage';
import TravelersInfoPage from './pages/TravelersInfoPage';
import NotificationsPage from './pages/NotificationsPage';
import AgencyPublicProfile from './pages/AgencyPublicProfile';
import NotFoundPage from './pages/NotFoundPage';
import UnsubscribePage from './pages/UnsubscribePage';
import GiftCardsPage from './pages/GiftCardsPage';
import GiftCardRedeemPage from './pages/GiftCardRedeemPage';
import GiftCardSuccessPage from './pages/GiftCardSuccessPage';
import PaymentReturnPage from './pages/PaymentReturnPage';
import BookingCheckinPage from './pages/BookingCheckinPage';
import ProtectedRoute from './components/ProtectedRoute';
import TermsAcceptanceGate from './components/TermsAcceptanceGate';
import TermsManagementPage from './pages/admin/TermsManagementPage';
import SupportLandingPage from './pages/support/SupportLandingPage';
import SupportGeneralPage from './pages/support/SupportGeneralPage';
import SupportTravelerPage from './pages/support/SupportTravelerPage';
import SupportAgencyPage from './pages/support/SupportAgencyPage';
import TravelerSupportTickets from './pages/traveler/TravelerSupportTickets';
import AgencySupportTickets from './pages/agency/AgencySupportTickets';
import AdminEjecutivos from './pages/admin/AdminEjecutivos';
import AdminEjecutivosComisiones from './pages/admin/AdminEjecutivosComisiones';
import AdminEjecutivosConfig from './pages/admin/AdminEjecutivosConfig';
import AdminLeads from './pages/admin/AdminLeads';
import ExecutiveDashboard from './pages/executive/ExecutiveDashboard';
import ExecutiveLeads from './pages/executive/ExecutiveLeads';
import ExecutiveMisAgencias from './pages/executive/ExecutiveMisAgencias';
import ExecutiveAgencyProfile from './pages/executive/ExecutiveAgencyProfile';
import ExecutiveComisiones from './pages/executive/ExecutiveComisiones';
import ExecutivePerfil from './pages/executive/ExecutivePerfil';
import AdminFeaturedTours from './pages/admin/AdminFeaturedTours';
import FeaturedSlotSuccessPage from './pages/agency/FeaturedSlotSuccessPage';
import AdminBookings from './pages/admin/AdminBookings';
import AdminBookingsCleanup from './pages/admin/AdminBookingsCleanup';
import AdminServiceDesk from './pages/admin/AdminServiceDesk';
import AdminTicketDetail from './pages/admin/AdminTicketDetail';
import AdminSupportCategories from './pages/admin/AdminSupportCategories';
import AdminSupportAgents from './pages/admin/AdminSupportAgents';
import AdminAuditLog from './pages/admin/AdminAuditLog';
import { useAuth } from './context/AuthContext';
import { UserRole, supabase } from './lib/supabase';
import MaintenanceGate from './components/MaintenanceGate';
import MaintenanceBanner from './components/MaintenanceBanner';
import AnnouncementPopup from './components/AnnouncementPopup';
import MaintenanceAdminPage from './pages/auth/MaintenanceAdminPage';
import FirstLoginPasswordGate from './components/FirstLoginPasswordGate';
import { useSEO } from './hooks/useSEO';

const PROTECTED_PREFIXES = [
  '/admin', '/traveler', '/agency', '/executive', '/accounting', '/auth', '/messages', '/mantenimiento-admin',
  '/login', '/signup', '/agency-signup', '/verify-email', '/forgot-password', '/reset-password',
  '/success', '/cancel', '/booking-success', '/booking-cancel', '/booking-pending', '/booking-travelers',
  '/supplement-success', '/payment-plan-success', '/extras-success', '/notifications',
  '/gift-card/redeem', '/gift-card/success', '/payment-return', '/booking-checkin',
  '/soporte/viajero', '/soporte/agencia', '/unsubscribe',
];

const ProtectedRouteSeo: React.FC = () => {
  const location = useLocation();
  const isProtected = PROTECTED_PREFIXES.some((p) => location.pathname.startsWith(p));
  useSEO({ title: 'ToursRed', noindex: isProtected });
  return null;
};

const App: React.FC = () => {
  const { isLoading, isOnboardingPending, mustChangePassword, user, refreshAuthState } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && isOnboardingPending && user) {
      if (!location.pathname.startsWith('/auth/')) {
        const provider = user?.app_metadata?.provider;
        const path = provider === 'azure' ? '/auth/azure-onboarding' : '/auth/google-onboarding';
        navigate(path, { replace: true });
      }
    }
  }, [isLoading, isOnboardingPending, user, navigate, location.pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (mustChangePassword && user) {
    return (
      <FirstLoginPasswordGate
        userId={user.id}
        onPasswordChanged={() => refreshAuthState()}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <ScrollToTop />
      <GoogleAnalytics />
      <ProtectedRouteSeo />
      <MaintenanceBanner />
      <MaintenanceGate>
      <NavBar />
      <main className="flex-grow">
        <Routes>
          <Route path="/mantenimiento-admin" element={<MaintenanceAdminPage />} />
          <Route path="/" element={<HomePage />} />
          <Route path="/tours" element={<TourCatalogPage />} />
          <Route path="/tours/:slug" element={<TourDetailPage />} />
          <Route path="/tours/international/mega-travel" element={<MegaTravelPage />} />
          <Route path="/tours/international/nefertari-travel" element={<NefertariTravelPage />} />
          <Route path="/tours/international/exoticca" element={<ExoticcaPage />} />
          <Route path="/tours/international/coming-soon" element={<ComingSoonPage />} />
          <Route path="/agencies/:agencyId" element={<AgencyPublicProfile />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/aviso-privacidad" element={<PrivacyPolicyPage />} />
          <Route path="/terminos-servicio" element={<TermsOfServicePage />} />
          <Route path="/politica-cookies" element={<CookiePolicyPage />} />
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/agency-signup" element={<AgencySignupPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/google-callback" element={<GoogleCallbackPage />} />
          <Route path="/auth/google-onboarding" element={<GoogleOnboardingPage />} />
          <Route path="/auth/google-signup/traveler" element={<GoogleTravelerSignupPage />} />
          <Route path="/auth/google-signup/agency" element={<GoogleAgencySignupPage />} />
          <Route path="/auth/azure-callback" element={<AzureCallbackPage />} />
          <Route path="/auth/facebook-callback" element={<FacebookCallbackPage />} />
          <Route path="/auth/facebook-onboarding" element={<FacebookOnboardingPage />} />
          <Route path="/auth/facebook-signup/traveler" element={<FacebookTravelerSignupPage />} />
          <Route path="/auth/facebook-signup/agency" element={<FacebookAgencySignupPage />} />
          <Route path="/auth/x-callback" element={<XCallbackPage />} />
          <Route path="/auth/x-onboarding" element={<XOnboardingPage />} />
          <Route path="/auth/x-signup/traveler" element={<XTravelerSignupPage />} />
          <Route path="/auth/x-signup/agency" element={<XAgencySignupPage />} />
          <Route path="/auth/azure-onboarding" element={<AzureOnboardingPage />} />
          <Route path="/auth/azure-signup/traveler" element={<AzureTravelerSignupPage />} />
          <Route path="/auth/azure-signup/agency" element={<AzureAgencySignupPage />} />
          <Route path="/success" element={<SuccessPage />} />
          <Route path="/cancel" element={<CancelPage />} />
          <Route path="/booking-success" element={<BookingSuccessPage />} />
          <Route path="/booking-cancel" element={<BookingCancelPage />} />
          <Route path="/booking-pending/:bookingId" element={<BookingPendingPage />} />
          <Route path="/booking-travelers/:bookingId" element={<TravelersInfoPage />} />
          <Route path="/supplement-success" element={<SupplementSuccessPage />} />
          <Route path="/payment-plan-success" element={<PaymentPlanSuccessPage />} />
          <Route path="/extras-success" element={<ExtrasSuccessPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/gift-cards" element={<GiftCardsPage />} />
          <Route path="/gift-card/redeem" element={<GiftCardRedeemPage />} />
          <Route path="/gift-card/success" element={<GiftCardSuccessPage />} />
          <Route path="/payment-return" element={<PaymentReturnPage />} />
          <Route path="/booking-checkin" element={<BookingCheckinPage />} />

          {/* Messaging Route - Available to all authenticated users */}
          <Route
            path="/messages"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER, UserRole.AGENCY, UserRole.ADMIN]}>
                <MessagingPage />
              </ProtectedRoute>
            }
          />

          {/* Traveler Routes */}
          <Route
            path="/traveler/dashboard"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/traveler/bookings"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerBookings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/traveler/profile"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/traveler/membership"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerMembership />
              </ProtectedRoute>
            }
          />
          <Route
            path="/traveler/membership/checkout"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <MembershipCheckout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/traveler/wallet"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerWallet />
              </ProtectedRoute>
            }
          />
          <Route
            path="/traveler/points"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerPoints />
              </ProtectedRoute>
            }
          />
          <Route
            path="/traveler/companions"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerCompanions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/traveler/referrals"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerReferrals />
              </ProtectedRoute>
            }
          />
          <Route
            path="/traveler/invoices"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerInvoices />
              </ProtectedRoute>
            }
          />

          {/* Agency Routes */}
          <Route
            path="/agency/dashboard"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <AgencyDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/featured-slot-success"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <FeaturedSlotSuccessPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/tours"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]} staffPermission="canViewTours">
                <AgencyTours />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/bookings"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]} staffPermission="canViewBookings">
                <AgencyBookings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/discount-codes"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]} staffPermission="canManageDiscountCodes">
                <AgencyDiscountCodes />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/profile"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <AgencyProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/destinations"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]} staffPermission="canManageDestinations">
                <AgencyDestinations />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/financials"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]} staffPermission="canViewFinancials">
                <AgencyFinancials />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/invoices"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]} staffPermission="canViewFinancials">
                <AgencyInvoices />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/staff"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <AgencyStaff />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/featured-tours"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <AgencyFeaturedTours />
              </ProtectedRoute>
            }
          />

          <Route
            path="/agency/pending-approval"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <AgencyPendingApproval />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/firmar-enmienda"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <AgencyAmendmentSignaturePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agency/onboarding"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <AgencyOnboardingPage />
              </ProtectedRoute>
            }
          />

          {/* Admin Routes */}
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/bookings"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminBookings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/bookings-cleanup"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminBookingsCleanup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/agencies"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminAgencies />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminUsers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/travelers"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminTravelers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reviews"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminReviews />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/messages"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminMessages />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/destinations"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminDestinations />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/departure-points"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminDeparturePoints />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/categories"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminCategories />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/tours"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminTours />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/tour-metrics"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminTourMetrics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/profile"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminSettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/memberships"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminMemberships />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/points"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminPoints />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/international-inquiries"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminInternationalInquiries />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/departure-points"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminDeparturePoints />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/discount-codes"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminDiscountCodes />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/payouts"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminPayouts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/referrals"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminReferrals />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/promotions"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminPromotions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/featured-tours"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminFeaturedTours />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/tour-messages"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminTourMessages />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/broadcast-messages"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminBroadcastMessages />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/newsletter"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminNewsletter />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/cfdi"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminCfdi />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/cfdi-manual"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminCfdiManual />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/contabilidad"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminContabilidad />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reporte-maestro"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminReporteMaestro />
              </ProtectedRoute>
            }
          />

          {/* Admin: Términos y Condiciones */}
          <Route
            path="/admin/terms"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <TermsManagementPage />
              </ProtectedRoute>
            }
          />

          {/* Admin: Service Desk */}
          <Route
            path="/admin/service-desk"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminServiceDesk />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/service-desk/tickets/:id"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminTicketDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/service-desk/categorias"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminSupportCategories />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/service-desk/agentes"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminSupportAgents />
              </ProtectedRoute>
            }
          />

          {/* Admin: Audit Log */}
          <Route
            path="/admin/audit-log"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminAuditLog />
              </ProtectedRoute>
            }
          />

          {/* Support public routes */}
          <Route path="/soporte" element={<SupportLandingPage />} />
          <Route path="/soporte/general" element={<SupportGeneralPage />} />
          <Route
            path="/soporte/viajero"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <SupportTravelerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/soporte/agencia"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <SupportAgencyPage />
              </ProtectedRoute>
            }
          />

          {/* Traveler support tickets */}
          <Route
            path="/traveler/soporte"
            element={
              <ProtectedRoute allowedRoles={[UserRole.TRAVELER]}>
                <TravelerSupportTickets />
              </ProtectedRoute>
            }
          />

          {/* Agency support tickets */}
          <Route
            path="/agency/soporte"
            element={
              <ProtectedRoute allowedRoles={[UserRole.AGENCY]}>
                <AgencySupportTickets />
              </ProtectedRoute>
            }
          />

          {/* Admin: Ejecutivos de Cuenta */}
          <Route
            path="/admin/ejecutivos"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminEjecutivos />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/ejecutivos/comisiones"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminEjecutivosComisiones />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/ejecutivos/configuracion"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminEjecutivosConfig />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/leads"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                <AdminLeads />
              </ProtectedRoute>
            }
          />

          {/* Executive Routes */}
          <Route
            path="/executive/dashboard"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ACCOUNT_EXECUTIVE]}>
                <ExecutiveDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/executive/leads"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ACCOUNT_EXECUTIVE]}>
                <ExecutiveLeads />
              </ProtectedRoute>
            }
          />
          <Route
            path="/executive/mis-agencias"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ACCOUNT_EXECUTIVE]}>
                <ExecutiveMisAgencias />
              </ProtectedRoute>
            }
          />
          <Route
            path="/executive/agency/:id"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ACCOUNT_EXECUTIVE]}>
                <ExecutiveAgencyProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/executive/comisiones"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ACCOUNT_EXECUTIVE]}>
                <ExecutiveComisiones />
              </ProtectedRoute>
            }
          />
          <Route
            path="/executive/perfil"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ACCOUNT_EXECUTIVE]}>
                <ExecutivePerfil />
              </ProtectedRoute>
            }
          />

          {/* Accounting module — accessible to admin and accountant */}
          <Route
            path="/accounting"
            element={
              <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.ACCOUNTANT]}>
                <AccountingPage />
              </ProtectedRoute>
            }
          />

          {/* Redirects based on role */}
          <Route
            path="/profile"
            element={<ProfileRedirect />}
          />
          <Route
            path="/dashboard"
            element={<DashboardRedirect />}
          />
          
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
      <CookieBanner />
      </MaintenanceGate>
      <AnnouncementPopup />
    </div>
  );
};

// Wraps traveler/agency routes to show T&C gate if needed
const TermsGuard: React.FC<{ termsType: 'traveler' | 'agency'; children: React.ReactNode }> = ({ termsType, children }) => {
  const { needsTermsAcceptance, markTermsAccepted } = useAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  if (needsTermsAcceptance) {
    return (
      <TermsAcceptanceGate
        termsType={termsType}
        onAccepted={markTermsAccepted}
        onSignOut={handleSignOut}
      />
    );
  }

  return <>{children}</>;
};

// Helper components for role-based redirects
const ProfileRedirect: React.FC = () => {
  const { isAdmin, isAgency, isTraveler } = useAuth();
  
  if (isAdmin) return <Navigate to="/admin/profile" />;
  if (isAgency) return <Navigate to="/agency/profile" />;
  if (isTraveler) return <Navigate to="/traveler/profile" />;
  
  return <Navigate to="/login" />;
};

const DashboardRedirect: React.FC = () => {
  const { isAdmin, isAgency, isTraveler, isAgencyStaff, isAccountant, isAccountExecutive } = useAuth();

  if (isAdmin) return <Navigate to="/admin/dashboard" />;
  if (isAgency) return <Navigate to="/agency/dashboard" />;
  if (isAgencyStaff) return <Navigate to="/agency/dashboard" />;
  if (isAccountant) return <Navigate to="/accounting" />;
  if (isAccountExecutive) return <Navigate to="/executive/dashboard" />;
  if (isTraveler) return <Navigate to="/traveler/dashboard" />;

  return <Navigate to="/login" />;
};

export default App;