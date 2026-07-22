import React, { useState, useEffect, useRef } from 'react';
import { Mail, Server, Save, Loader, CheckCircle, AlertCircle, DollarSign, Percent, CreditCard, Crown, Gift, Award, Users, Globe, FileText, Shield, BookOpen, Link, Unlink, RefreshCw, ExternalLink, Tag, Image, Upload, RotateCcw, X, Wrench, Megaphone, Power, PowerOff, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../utils/formatCurrency';

interface EmailSettings {
  id: string;
  contact_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_api_key: string;
}

interface PlatformSettings {
  id: string;
  service_charge_percentage: number;
  agency_commission_percentage: number;
  stripe_monthly_price_id: string;
  stripe_annual_price_id: string;
  membership_monthly_price: number;
  membership_annual_price: number;
  default_max_referrals_per_user: number;
  referral_bonus_points: number;
  referral_program_enabled: boolean;
  mercadopago_enabled: boolean;
  paypal_enabled: boolean;
  mercadopago_public_key: string;
  mercadopago_access_token: string;
  paypal_client_id: string;
  paypal_client_secret: string;
  pac_provider: string;
  pac_api_key_encrypted: string;
  pac_organization_id: string;
  cfdi_serie_booking: string;
  cfdi_serie_commission: string;
  pac_sandbox_mode: boolean;
  pac_issuer_rfc: string;
  pac_issuer_razon_social: string;
  pac_issuer_regimen_fiscal: string;
  accounting_provider: string;
  accounting_sync_enabled: boolean;
  zoho_client_id: string;
  zoho_client_secret: string;
  zoho_org_id: string;
  zoho_region: string;
  zoho_sandbox_mode: boolean;
  odoo_url: string;
  odoo_api_key_encrypted: string;
  odoo_database: string;
  travel_insurance_price_per_day_per_traveler: number;
  travel_insurance_cost_per_day_per_traveler: number;
  travel_insurance_commission_pct: number;
  supplement_commission_percentage: number;
  optional_service_commission_percentage: number;
  hero_background_url: string | null;
  maintenance_mode: boolean;
  maintenance_message: string;
  maintenance_enabled_at: string | null;
  announcement_active: boolean;
  announcement_title: string;
  announcement_message: string;
  announcement_cta_text: string;
  announcement_activated_at: string | null;
  platform_url: string;
  oauth_google_login_enabled: boolean;
  oauth_azure_login_enabled: boolean;
  oauth_twitter_login_enabled: boolean;
  oauth_facebook_login_enabled: boolean;
  oauth_google_link_enabled: boolean;
  oauth_azure_link_enabled: boolean;
  oauth_twitter_link_enabled: boolean;
  oauth_facebook_link_enabled: boolean;
  stripe_bookings_enabled: boolean;
  stripe_gift_cards_enabled: boolean;
  stripe_memberships_enabled: boolean;
}

const AdminSettings: React.FC = () => {
  const [settings, setSettings] = useState<EmailSettings>({
    id: '',
    contact_email: '',
    smtp_host: '',
    smtp_port: 2525,
    smtp_user: '',
    smtp_password: '',
    smtp_api_key: '',
  });
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>({
    id: '',
    service_charge_percentage: 5,
    agency_commission_percentage: 15,
    stripe_monthly_price_id: '',
    stripe_annual_price_id: '',
    membership_monthly_price: 49,
    membership_annual_price: 490,
    default_max_referrals_per_user: 10,
    referral_bonus_points: 5000,
    referral_program_enabled: true,
    mercadopago_enabled: false,
    paypal_enabled: false,
    mercadopago_public_key: '',
    mercadopago_access_token: '',
    paypal_client_id: '',
    paypal_client_secret: '',
    pac_provider: 'none',
    pac_api_key_encrypted: '',
    pac_organization_id: '',
    cfdi_serie_booking: 'A',
    cfdi_serie_commission: 'B',
    pac_sandbox_mode: true,
    pac_issuer_rfc: '',
    pac_issuer_razon_social: '',
    pac_issuer_regimen_fiscal: '',
    accounting_provider: 'none',
    accounting_sync_enabled: false,
    zoho_client_id: '',
    zoho_client_secret: '',
    zoho_org_id: '',
    zoho_region: 'com',
    zoho_sandbox_mode: true,
    odoo_url: '',
    odoo_api_key_encrypted: '',
    odoo_database: '',
    travel_insurance_price_per_day_per_traveler: 79,
    travel_insurance_cost_per_day_per_traveler: 59,
    travel_insurance_commission_pct: 20,
    supplement_commission_percentage: 10,
    optional_service_commission_percentage: 15,
    hero_background_url: null,
    maintenance_mode: false,
    maintenance_message: 'Estamos realizando tareas de mantenimiento. Estaremos de vuelta muy pronto.',
    maintenance_enabled_at: null,
    announcement_active: false,
    announcement_title: '',
    announcement_message: '',
    announcement_cta_text: 'Aceptar',
    announcement_activated_at: null,
    platform_url: 'https://toursredmx.netlify.app',
    oauth_google_login_enabled: true,
    oauth_azure_login_enabled: true,
    oauth_twitter_login_enabled: false,
    oauth_facebook_login_enabled: false,
    oauth_google_link_enabled: true,
    oauth_azure_link_enabled: true,
    oauth_twitter_link_enabled: false,
    oauth_facebook_link_enabled: false,
    stripe_bookings_enabled: true,
    stripe_gift_cards_enabled: true,
    stripe_memberships_enabled: true,
  });
  const [zohoStatus, setZohoStatus] = useState<{
    connected: boolean;
    token_expires_at?: string;
    is_expired?: boolean;
    scope?: string;
    last_updated?: string;
  } | null>(null);
  const [zohoGrantToken, setZohoGrantToken] = useState('');
  const [zohoConnectError, setZohoConnectError] = useState('');
  const [isConnectingZoho, setIsConnectingZoho] = useState(false);
  const [isCheckingZoho, setIsCheckingZoho] = useState(false);
  const [odooHealthy, setOdooHealthy] = useState<boolean | null>(null);
  const [isCheckingOdoo, setIsCheckingOdoo] = useState(false);
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreview, setHeroPreview] = useState<string | null>(null);
  const [isUploadingHero, setIsUploadingHero] = useState(false);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error' | null;
    text: string;
  }>({ type: null, text: '' });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const toggleSecret = (key: string) => setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    fetchSettings();
    checkZohoStatus();
  }, []);

  const checkZohoStatus = async () => {
    setIsCheckingZoho(true);
    try {
      const { data, error } = await supabase.functions.invoke('zoho-oauth-connect', {
        body: { action: 'check_status' },
      });
      if (!error && data) setZohoStatus(data);
    } catch {
      // silent
    } finally {
      setIsCheckingZoho(false);
    }
  };

  const handleConnectZoho = async () => {
    if (!zohoGrantToken.trim()) {
      setZohoConnectError('Ingresa el Grant Token de Zoho Self Client');
      return;
    }
    setZohoConnectError('');
    setIsConnectingZoho(true);
    try {
      const { data, error } = await supabase.functions.invoke('zoho-oauth-connect', {
        body: { action: 'exchange_grant_token', grant_token: zohoGrantToken.trim() },
      });
      if (error || !data?.success) {
        const detail = data?.detail ? ` (${JSON.stringify(data.detail)})` : '';
        throw new Error((error?.message || data?.error || 'Error al conectar con Zoho') + detail);
      }
      setZohoGrantToken('');
      setMessage({ type: 'success', text: 'Zoho Books conectado exitosamente' });
      await checkZohoStatus();
    } catch (err: any) {
      setZohoConnectError(err.message);
    } finally {
      setIsConnectingZoho(false);
    }
  };

  const handleCheckOdoo = async () => {
    setIsCheckingOdoo(true);
    setOdooHealthy(null);
    try {
      const { data } = await supabase.functions.invoke('sync-to-accounting', {
        body: { action: 'health_check' },
      });
      setOdooHealthy(data?.healthy === true);
    } catch {
      setOdooHealthy(false);
    } finally {
      setIsCheckingOdoo(false);
    }
  };

  const handleDisconnectZoho = async () => {
    if (!confirm('¿Desconectar Zoho Books? La sincronizacion contable dejara de funcionar hasta volver a conectar.')) return;
    try {
      await supabase.functions.invoke('zoho-oauth-connect', { body: { action: 'disconnect' } });
      setZohoStatus({ connected: false });
      setMessage({ type: 'success', text: 'Zoho Books desconectado' });
    } catch (err: any) {
      setMessage({ type: 'error', text: `Error: ${err.message}` });
    }
  };

  const handleHeroFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHeroFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setHeroPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleHeroUpload = async () => {
    if (!heroFile) return;
    setIsUploadingHero(true);
    try {
      const ext = heroFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `hero/background.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('platform-assets')
        .upload(path, heroFile, { upsert: true, contentType: heroFile.type });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage
        .from('platform-assets')
        .getPublicUrl(path);
      const cacheBustedUrl = `${publicUrl}?v=${Date.now()}`;
      const { error: updateError } = await supabase
        .from('platform_settings')
        .update({ hero_background_url: cacheBustedUrl })
        .eq('id', platformSettings.id);
      if (updateError) throw updateError;
      setPlatformSettings(prev => ({ ...prev, hero_background_url: cacheBustedUrl }));
      setHeroFile(null);
      setHeroPreview(null);
      if (heroInputRef.current) heroInputRef.current.value = '';
      setMessage({ type: 'success', text: 'Imagen de fondo actualizada correctamente' });
      setTimeout(() => setMessage({ type: null, text: '' }), 3000);
    } catch (err: any) {
      setMessage({ type: 'error', text: `Error al subir imagen: ${err.message}` });
    } finally {
      setIsUploadingHero(false);
    }
  };

  const handleHeroRestore = async () => {
    if (!confirm('¿Restaurar la imagen de fondo original? Se eliminara la imagen personalizada.')) return;
    try {
      const { error } = await supabase
        .from('platform_settings')
        .update({ hero_background_url: null })
        .eq('id', platformSettings.id);
      if (error) throw error;
      setPlatformSettings(prev => ({ ...prev, hero_background_url: null }));
      setHeroFile(null);
      setHeroPreview(null);
      if (heroInputRef.current) heroInputRef.current.value = '';
      setMessage({ type: 'success', text: 'Imagen de fondo restaurada al original' });
      setTimeout(() => setMessage({ type: null, text: '' }), 3000);
    } catch (err: any) {
      setMessage({ type: 'error', text: `Error: ${err.message}` });
    }
  };

  const fetchSettings = async () => {
    try {
      setIsLoading(true);

      const [emailResult, platformResult] = await Promise.all([
        supabase.from('email_settings').select('*').maybeSingle(),
        supabase.from('platform_settings').select('*').maybeSingle()
      ]);

      if (emailResult.error) throw emailResult.error;
      if (platformResult.error) throw platformResult.error;

      if (emailResult.data) {
        setSettings(emailResult.data);
      }

      if (platformResult.data) {
        setPlatformSettings(platformResult.data);
      }
    } catch (error: any) {
      console.error('Error fetching settings:', error);
      setMessage({
        type: 'error',
        text: 'Error al cargar la configuración',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage({ type: null, text: '' });

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const [emailResult, platformResult] = await Promise.all([
        supabase
          .from('email_settings')
          .update({
            contact_email: settings.contact_email,
            smtp_host: settings.smtp_host,
            smtp_port: settings.smtp_port,
            smtp_user: settings.smtp_user,
            smtp_password: settings.smtp_password,
            smtp_api_key: settings.smtp_api_key,
            updated_at: new Date().toISOString(),
          })
          .eq('id', settings.id),
        supabase
          .from('platform_settings')
          .update({
            service_charge_percentage: platformSettings.service_charge_percentage,
            agency_commission_percentage: platformSettings.agency_commission_percentage,
            stripe_monthly_price_id: platformSettings.stripe_monthly_price_id,
            stripe_annual_price_id: platformSettings.stripe_annual_price_id,
            membership_monthly_price: platformSettings.membership_monthly_price,
            membership_annual_price: platformSettings.membership_annual_price,
            default_max_referrals_per_user: platformSettings.default_max_referrals_per_user,
            referral_bonus_points: platformSettings.referral_bonus_points,
            referral_program_enabled: platformSettings.referral_program_enabled,
            mercadopago_enabled: platformSettings.mercadopago_enabled,
            paypal_enabled: platformSettings.paypal_enabled,
            mercadopago_public_key: platformSettings.mercadopago_public_key,
            mercadopago_access_token: platformSettings.mercadopago_access_token,
            paypal_client_id: platformSettings.paypal_client_id,
            paypal_client_secret: platformSettings.paypal_client_secret,
            pac_provider: platformSettings.pac_provider,
            pac_api_key_encrypted: platformSettings.pac_api_key_encrypted,
            pac_organization_id: platformSettings.pac_organization_id,
            cfdi_serie_booking: platformSettings.cfdi_serie_booking,
            cfdi_serie_commission: platformSettings.cfdi_serie_commission,
            pac_sandbox_mode: platformSettings.pac_sandbox_mode,
            pac_issuer_rfc: platformSettings.pac_issuer_rfc,
            pac_issuer_razon_social: platformSettings.pac_issuer_razon_social,
            pac_issuer_regimen_fiscal: platformSettings.pac_issuer_regimen_fiscal,
            accounting_provider: platformSettings.accounting_provider,
            accounting_sync_enabled: platformSettings.accounting_sync_enabled,
            zoho_client_id: platformSettings.zoho_client_id,
            zoho_client_secret: platformSettings.zoho_client_secret,
            zoho_org_id: platformSettings.zoho_org_id,
            zoho_region: platformSettings.zoho_region,
            zoho_sandbox_mode: platformSettings.zoho_sandbox_mode,
            odoo_url: platformSettings.odoo_url,
            odoo_api_key_encrypted: platformSettings.odoo_api_key_encrypted,
            odoo_database: platformSettings.odoo_database,
            travel_insurance_price_per_day_per_traveler: platformSettings.travel_insurance_price_per_day_per_traveler,
            travel_insurance_cost_per_day_per_traveler: platformSettings.travel_insurance_cost_per_day_per_traveler ?? 59,
            travel_insurance_commission_pct: platformSettings.travel_insurance_commission_pct ?? 20,
            supplement_commission_percentage: platformSettings.supplement_commission_percentage,
            optional_service_commission_percentage: platformSettings.optional_service_commission_percentage,
            maintenance_mode: platformSettings.maintenance_mode,
            maintenance_message: platformSettings.maintenance_message,
            maintenance_enabled_at: platformSettings.maintenance_mode
              ? (platformSettings.maintenance_enabled_at || new Date().toISOString())
              : null,
            announcement_active: platformSettings.announcement_active,
            announcement_title: platformSettings.announcement_title,
            announcement_message: platformSettings.announcement_message,
            announcement_cta_text: platformSettings.announcement_cta_text,
            announcement_activated_at: platformSettings.announcement_active
              ? (platformSettings.announcement_activated_at || new Date().toISOString())
              : platformSettings.announcement_activated_at,
            platform_url: platformSettings.platform_url,
            oauth_google_login_enabled: platformSettings.oauth_google_login_enabled,
            oauth_azure_login_enabled: platformSettings.oauth_azure_login_enabled,
            oauth_twitter_login_enabled: platformSettings.oauth_twitter_login_enabled,
            oauth_facebook_login_enabled: platformSettings.oauth_facebook_login_enabled,
            oauth_google_link_enabled: platformSettings.oauth_google_link_enabled,
            oauth_azure_link_enabled: platformSettings.oauth_azure_link_enabled,
            oauth_twitter_link_enabled: platformSettings.oauth_twitter_link_enabled,
            oauth_facebook_link_enabled: platformSettings.oauth_facebook_link_enabled,
            stripe_bookings_enabled: platformSettings.stripe_bookings_enabled,
            stripe_gift_cards_enabled: platformSettings.stripe_gift_cards_enabled,
            stripe_memberships_enabled: platformSettings.stripe_memberships_enabled,
            updated_at: new Date().toISOString(),
            updated_by: user?.id
          })
          .eq('id', platformSettings.id)
      ]);

      if (emailResult.error) throw emailResult.error;
      if (platformResult.error) throw platformResult.error;

      setMessage({
        type: 'success',
        text: 'Configuración guardada correctamente',
      });

      setTimeout(() => {
        setMessage({ type: null, text: '' });
      }, 3000);
    } catch (error: any) {
      console.error('Error saving settings:', error);
      setMessage({
        type: 'error',
        text: 'Error al guardar la configuración',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: name === 'smtp_port' ? parseInt(value) || 0 : value,
    }));
  };

  const handlePlatformChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    const numericFields = ['service_charge_percentage', 'agency_commission_percentage', 'supplement_commission_percentage', 'optional_service_commission_percentage', 'membership_monthly_price', 'membership_annual_price', 'default_max_referrals_per_user', 'referral_bonus_points'];
    const booleanFields = ['referral_program_enabled', 'mercadopago_enabled', 'paypal_enabled', 'oauth_google_login_enabled', 'oauth_azure_login_enabled', 'oauth_twitter_login_enabled', 'oauth_facebook_login_enabled', 'oauth_google_link_enabled', 'oauth_azure_link_enabled', 'oauth_twitter_link_enabled', 'oauth_facebook_link_enabled', 'stripe_bookings_enabled', 'stripe_gift_cards_enabled', 'stripe_memberships_enabled'];
    setPlatformSettings(prev => ({
      ...prev,
      [name]: booleanFields.includes(name) ? checked : (numericFields.includes(name) ? (parseFloat(value) || 0) : value),
    }));
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center py-12">
          <Loader className="w-12 h-12 animate-spin text-primary-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Configuración del Sistema</h1>
        <p className="text-gray-600 mt-2">
          Gestiona la configuración de correo electrónico y notificaciones
        </p>
      </div>

      {message.type && (
        <div
          className={`mb-6 p-4 rounded-md flex items-start space-x-3 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          )}
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <DollarSign className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Configuración de Comisiones y Cargos
            </h2>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-2">Información importante sobre los porcentajes:</p>
                <ul className="space-y-1 text-xs">
                  <li>• <strong>Cargo por Servicio:</strong> Se cobra al viajero adicional al anticipo del tour</li>
                  <li>• <strong>Comisión de Agencia:</strong> Se descuenta del anticipo pagado por el viajero antes de transferir a la agencia</li>
                  <li>• Estos porcentajes se aplican automáticamente a todas las nuevas reservas</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="service_charge_percentage" className="block text-sm font-medium text-gray-700 mb-1">
                Cargo por Servicio (%)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Porcentaje adicional que se cobra al viajero por el uso de la plataforma
              </p>
              <div className="relative">
                <input
                  type="number"
                  id="service_charge_percentage"
                  name="service_charge_percentage"
                  value={platformSettings.service_charge_percentage}
                  onChange={handlePlatformChange}
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 pr-10"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <Percent className="w-4 h-4 text-gray-400" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Ejemplo: Si el anticipo es $1,000 y el cargo es {platformSettings.service_charge_percentage}%,
                el viajero pagará ${formatCurrency(1000 + (1000 * platformSettings.service_charge_percentage / 100))}
              </p>
            </div>

            <div>
              <label htmlFor="agency_commission_percentage" className="block text-sm font-medium text-gray-700 mb-1">
                Comisión de Agencia (%)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Porcentaje que se descuenta del total del tour como comisión para la plataforma
              </p>
              <div className="relative">
                <input
                  type="number"
                  id="agency_commission_percentage"
                  name="agency_commission_percentage"
                  value={platformSettings.agency_commission_percentage}
                  onChange={handlePlatformChange}
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 pr-10"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <Percent className="w-4 h-4 text-gray-400" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Ejemplo: Tour de $5,000 con anticipo de $1,000. Comisión {platformSettings.agency_commission_percentage}% = $
                {formatCurrency(5000 * platformSettings.agency_commission_percentage / 100)}.
                La agencia recibe ${formatCurrency(1000 - (5000 * platformSettings.agency_commission_percentage / 100))} del anticipo
              </p>
            </div>
          </div>
        </div>

        {/* Comision de Suplementos */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Tag className="w-6 h-6 text-teal-600" />
            <h2 className="text-xl font-semibold text-gray-900">Comision de Suplementos Adicionales</h2>
          </div>

          <div className="bg-teal-50 border border-teal-200 rounded-md p-4 mb-6 text-sm text-teal-800">
            <p className="font-semibold mb-1">Comision de plataforma sobre suplementos post-reserva</p>
            <p className="text-xs text-teal-700">
              Los suplementos son extras que el viajero compra despues de confirmar su reserva (ej. asiento preferente, equipaje adicional). Esta comision se aplica sobre el subtotal del suplemento.
            </p>
          </div>

          <div>
            <label htmlFor="supplement_commission_percentage" className="block text-sm font-medium text-gray-700 mb-1">
              Comision de Suplementos (%)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Porcentaje que la plataforma retiene del precio del suplemento como comision.
            </p>
            <div className="relative max-w-xs">
              <input
                type="number"
                id="supplement_commission_percentage"
                name="supplement_commission_percentage"
                value={platformSettings.supplement_commission_percentage}
                onChange={handlePlatformChange}
                min="0"
                max="100"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 pr-10"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <Percent className="w-4 h-4 text-gray-400" />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Ejemplo: Suplemento de $500. Comision {platformSettings.supplement_commission_percentage}% = ${(500 * platformSettings.supplement_commission_percentage / 100).toFixed(2)} para la plataforma.
            </p>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <label htmlFor="optional_service_commission_percentage" className="block text-sm font-medium text-gray-700 mb-1">
              Comision de Opcionales (%)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Porcentaje que la plataforma retiene del precio de servicios opcionales (ej. senderismo, fotografia).
            </p>
            <div className="relative max-w-xs">
              <input
                type="number"
                id="optional_service_commission_percentage"
                name="optional_service_commission_percentage"
                value={platformSettings.optional_service_commission_percentage}
                onChange={handlePlatformChange}
                min="0"
                max="100"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 pr-10"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <Percent className="w-4 h-4 text-gray-400" />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Ejemplo: Opcional de $100. Comision {platformSettings.optional_service_commission_percentage}% = ${(100 * platformSettings.optional_service_commission_percentage / 100).toFixed(2)} para la plataforma.
            </p>
          </div>
        </div>

        {/* Seguro de Viaje */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Shield className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">Seguro de Viaje</h2>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6 text-sm text-blue-800">
            <p className="font-semibold mb-1">Venta cruzada automática en el flujo de reserva</p>
            <p className="text-xs text-blue-700">
              El seguro se ofrece a todos los viajeros como una opción pre-seleccionada en el formulario de reserva.
              El precio es variable según el tipo de cambio del dólar. Se ajusta manualmente aquí cuando sea necesario.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <label htmlFor="insurance_price" className="block text-sm font-medium text-gray-700 mb-1">
                Precio al viajero por día (MXN)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-sm">$</span>
                <input
                  id="insurance_price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={platformSettings.travel_insurance_price_per_day_per_traveler}
                  onChange={(e) => setPlatformSettings(prev => ({
                    ...prev,
                    travel_insurance_price_per_day_per_traveler: parseFloat(e.target.value) || 0,
                  }))}
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Lo que se le cobra al viajero. Ajustar cuando varíe el tipo de cambio.</p>
            </div>
            <div>
              <label htmlFor="insurance_cost" className="block text-sm font-medium text-gray-700 mb-1">
                Costo por día por viajero (MXN)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-sm">$</span>
                <input
                  id="insurance_cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={platformSettings.travel_insurance_cost_per_day_per_traveler}
                  onChange={(e) => setPlatformSettings(prev => ({
                    ...prev,
                    travel_insurance_cost_per_day_per_traveler: parseFloat(e.target.value) || 0,
                  }))}
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Costo real con la aseguradora. Ajustar cuando varíe el tipo de cambio.</p>
            </div>
            <div>
              <label htmlFor="insurance_commission_pct" className="block text-sm font-medium text-gray-700 mb-1">
                % Comisión de la aseguradora
              </label>
              <div className="relative">
                <input
                  id="insurance_commission_pct"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={platformSettings.travel_insurance_commission_pct}
                  onChange={(e) => setPlatformSettings(prev => ({
                    ...prev,
                    travel_insurance_commission_pct: parseFloat(e.target.value) || 0,
                  }))}
                  className="w-full pr-8 pl-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-sm">%</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Porcentaje que paga Universal Assistance sobre el costo.</p>
            </div>
          </div>

          {/* Spread breakdown */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6 space-y-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Desglose del spread — por día / viajero</p>
            {(() => {
              const precio = platformSettings.travel_insurance_price_per_day_per_traveler;
              const costo = platformSettings.travel_insurance_cost_per_day_per_traveler;
              const pct = platformSettings.travel_insurance_commission_pct;
              const spread = precio - costo;
              const comision = costo * (pct / 100);
              const total = spread + comision;
              return (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-gray-700">
                    <span>Precio al viajero</span>
                    <span className="font-medium">{formatCurrency(precio)}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>Costo a pagar a la aseguradora</span>
                    <span className="font-medium text-red-600">− {formatCurrency(costo)}</span>
                  </div>
                  <div className="flex justify-between text-gray-700 border-t border-gray-200 pt-1.5">
                    <span>Spread de ToursRed (ingreso inmediato)</span>
                    <span className="font-semibold text-emerald-600">{formatCurrency(spread)}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>Comisión de la aseguradora ({pct}% sobre el costo, se cobra después)</span>
                    <span className="font-semibold text-emerald-600">{formatCurrency(comision)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-300 pt-1.5 mt-1">
                    <span className="font-bold text-gray-800">Ganancia total estimada</span>
                    <span className="font-bold text-emerald-700">{formatCurrency(total)}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Ejemplos de costo total al viajero</p>
            <div className="space-y-1 text-sm text-gray-700">
              <div className="flex justify-between">
                <span>1 día × 1 viajero:</span>
                <span className="font-medium">{formatCurrency(platformSettings.travel_insurance_price_per_day_per_traveler)}</span>
              </div>
              <div className="flex justify-between">
                <span>3 días × 2 viajeros:</span>
                <span className="font-medium">{formatCurrency(platformSettings.travel_insurance_price_per_day_per_traveler * 3 * 2)}</span>
              </div>
              <div className="flex justify-between">
                <span>5 días × 4 viajeros:</span>
                <span className="font-medium">{formatCurrency(platformSettings.travel_insurance_price_per_day_per_traveler * 5 * 4)}</span>
              </div>
              <div className="flex justify-between">
                <span>7 días × 2 viajeros:</span>
                <span className="font-medium">{formatCurrency(platformSettings.travel_insurance_price_per_day_per_traveler * 7 * 2)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <CreditCard className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Configuración de Stripe - Membresías ToursRed+
            </h2>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-4">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 mr-2 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium mb-2">Cómo obtener tus Price IDs de Stripe:</p>
                <ol className="space-y-2 text-xs list-decimal ml-4">
                  <li>Ve a <a href="https://dashboard.stripe.com/products" target="_blank" rel="noopener noreferrer" className="underline font-semibold">Stripe Dashboard → Products</a></li>
                  <li>Crea dos productos recurrentes: uno mensual ($49) y uno anual ($490)</li>
                  <li className="font-semibold text-red-700">
                    IMPORTANTE: Necesitas el <strong>Price ID</strong> (empieza con "price_"), NO el Product ID (que empieza con "prod_")
                  </li>
                  <li>
                    Para obtener el Price ID:
                    <ul className="list-disc ml-4 mt-1 space-y-1 font-normal">
                      <li>Haz clic en tu producto</li>
                      <li>En la tabla "Tarifas", haz clic en el precio (ej: 49.00 MXN)</li>
                      <li>Copia el <strong>API ID</strong> o <strong>Price ID</strong> que empieza con "price_"</li>
                    </ul>
                  </li>
                  <li>Pega los Price IDs (price_xxxxx) en los campos de abajo</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="stripe_monthly_price_id" className="block text-sm font-medium text-gray-700 mb-1">
                Stripe Price ID - Plan Mensual
              </label>
              <p className="text-xs text-gray-500 mb-2">
                ID del precio mensual en Stripe. Debe empezar con <span className="font-mono font-semibold">price_</span> (NO con prod_)
              </p>
              <input
                type="text"
                id="stripe_monthly_price_id"
                name="stripe_monthly_price_id"
                value={platformSettings.stripe_monthly_price_id}
                onChange={handlePlatformChange}
                placeholder="price_1ABC2DE3FGH4IJK5..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
              />
              {platformSettings.stripe_monthly_price_id && !platformSettings.stripe_monthly_price_id.startsWith('price_') && (
                <p className="text-xs text-red-600 mt-1 flex items-center">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Este ID debe empezar con "price_" no con "prod_"
                </p>
              )}
            </div>

            <div>
              <label htmlFor="stripe_annual_price_id" className="block text-sm font-medium text-gray-700 mb-1">
                Stripe Price ID - Plan Anual
              </label>
              <p className="text-xs text-gray-500 mb-2">
                ID del precio anual en Stripe. Debe empezar con <span className="font-mono font-semibold">price_</span> (NO con prod_)
              </p>
              <input
                type="text"
                id="stripe_annual_price_id"
                name="stripe_annual_price_id"
                value={platformSettings.stripe_annual_price_id}
                onChange={handlePlatformChange}
                placeholder="price_1ABC2DE3FGH4IJK5..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
              />
              {platformSettings.stripe_annual_price_id && !platformSettings.stripe_annual_price_id.startsWith('price_') && (
                <p className="text-xs text-red-600 mt-1 flex items-center">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Este ID debe empezar con "price_" no con "prod_"
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Crown className="w-6 h-6 text-amber-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Precios de Membresías ToursRed+
            </h2>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-4">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 mr-2 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium mb-2">Información importante:</p>
                <ul className="space-y-1 text-xs">
                  <li>• Los precios se mostrarán en todas las páginas de membresía y correos electrónicos</li>
                  <li>• Asegúrate de que estos precios coincidan con los productos en Stripe</li>
                  <li>• Los cambios se reflejarán inmediatamente después de guardar</li>
                  <li>• El ahorro del plan anual se calcula automáticamente</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="membership_monthly_price" className="block text-sm font-medium text-gray-700 mb-1">
                Precio Plan Mensual (MXN)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Precio mensual de la membresía ToursRed+
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  id="membership_monthly_price"
                  name="membership_monthly_price"
                  value={platformSettings.membership_monthly_price}
                  onChange={handlePlatformChange}
                  min="1"
                  step="0.01"
                  required
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="membership_annual_price" className="block text-sm font-medium text-gray-700 mb-1">
                Precio Plan Anual (MXN)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Precio anual de la membresía ToursRed+
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  id="membership_annual_price"
                  name="membership_annual_price"
                  value={platformSettings.membership_annual_price}
                  onChange={handlePlatformChange}
                  min="1"
                  step="0.01"
                  required
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-md p-4">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Vista Previa del Ahorro:</h4>
            <div className="text-sm text-blue-800 space-y-1">
              <p>• Plan Mensual x 12 meses = ${formatCurrency(platformSettings.membership_monthly_price * 12)} MXN</p>
              <p>• Plan Anual = ${formatCurrency(platformSettings.membership_annual_price)} MXN</p>
              <p className="font-semibold text-green-700">
                • Ahorro con Plan Anual = ${formatCurrency((platformSettings.membership_monthly_price * 12) - platformSettings.membership_annual_price)} MXN
                ({Math.round((((platformSettings.membership_monthly_price * 12) - platformSettings.membership_annual_price) / (platformSettings.membership_monthly_price * 12)) * 100)}% de descuento)
              </p>
              <p>• Equivalente Mensual del Plan Anual = ${formatCurrency(platformSettings.membership_annual_price / 12)} MXN/mes</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Gift className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Programa de Referidos
            </h2>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-2">Configuración del programa de referidos:</p>
                <ul className="space-y-1 text-xs">
                  <li>• Los usuarios pueden invitar amigos usando su código de referido único</li>
                  <li>• Ambos usuarios ganan puntos cuando el referido completa su primera reserva</li>
                  <li>• Los puntos solo se pueden usar con membresía activa</li>
                  <li>• El límite de referidos puede ajustarse individualmente desde la página de gestión</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="referral_program_enabled"
                name="referral_program_enabled"
                checked={platformSettings.referral_program_enabled}
                onChange={handlePlatformChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="referral_program_enabled" className="ml-2 block text-sm font-medium text-gray-700">
                Habilitar Programa de Referidos
              </label>
            </div>

            <div>
              <label htmlFor="referral_bonus_points" className="block text-sm font-medium text-gray-700 mb-1">
                Puntos de Bono por Referido
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Cantidad de puntos que ganan tanto el referidor como el referido
              </p>
              <div className="relative">
                <Award className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="number"
                  id="referral_bonus_points"
                  name="referral_bonus_points"
                  value={platformSettings.referral_bonus_points}
                  onChange={handlePlatformChange}
                  min="100"
                  step="100"
                  required
                  disabled={!platformSettings.referral_program_enabled}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Equivalente a ${formatCurrency(platformSettings.referral_bonus_points / 100)} MXN
              </p>
            </div>

            <div>
              <label htmlFor="default_max_referrals_per_user" className="block text-sm font-medium text-gray-700 mb-1">
                Límite de Referidos por Usuario
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Número máximo de referidos que cada usuario puede tener por defecto
              </p>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="number"
                  id="default_max_referrals_per_user"
                  name="default_max_referrals_per_user"
                  value={platformSettings.default_max_referrals_per_user}
                  onChange={handlePlatformChange}
                  min="1"
                  max="100"
                  required
                  disabled={!platformSettings.referral_program_enabled}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Este límite puede ajustarse individualmente por usuario desde la página de gestión de referidos
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Globe className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Proveedores de Pago Adicionales
            </h2>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">Informacion importante:</p>
                <ul className="space-y-1 text-xs">
                  <li>• Stripe es el proveedor principal y el unico disponible para membresias (requiere cobro recurrente)</li>
                  <li>• Puedes desactivar Stripe por contexto: reservas, tarjetas de regalo o membresias de forma independiente</li>
                  <li>• MercadoPago y PayPal aplican solo para reservas sin membresia y tarjetas de regalo</li>
                  <li>• Las claves secretas se configuran como secrets de Supabase Edge Functions</li>
                  <li>• Aqui solo se guardan las claves publicas (no sensibles) necesarias para el frontend</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-sky-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">MercadoPago</h3>
                    <p className="text-xs text-gray-500">Para reservas y tarjetas de regalo</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="mercadopago_enabled"
                    checked={platformSettings.mercadopago_enabled}
                    onChange={handlePlatformChange}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">Habilitado</span>
                </label>
              </div>

              {platformSettings.mercadopago_enabled && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Public Key de MercadoPago
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Clave publica de tu cuenta MercadoPago (empieza con APP_USR- o TEST-)
                    </p>
                    <input
                      type="text"
                      name="mercadopago_public_key"
                      value={platformSettings.mercadopago_public_key}
                      onChange={handlePlatformChange}
                      placeholder="APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Access Token de MercadoPago
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Token privado de acceso de tu cuenta MercadoPago (empieza con APP_USR- o TEST-)
                    </p>
                    <div className="relative">
                      <input
                        type={showSecrets['mercadopago_access_token'] ? 'text' : 'password'}
                        name="mercadopago_access_token"
                        value={platformSettings.mercadopago_access_token}
                        onChange={handlePlatformChange}
                        placeholder="APP_USR-xxxxxxxxxxxxxxxxxxxx"
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                      />
                      <button type="button" onClick={() => toggleSecret('mercadopago_access_token')} className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600">
                        {showSecrets['mercadopago_access_token'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-blue-700" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">PayPal</h3>
                    <p className="text-xs text-gray-500">Para reservas y tarjetas de regalo</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="paypal_enabled"
                    checked={platformSettings.paypal_enabled}
                    onChange={handlePlatformChange}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">Habilitado</span>
                </label>
              </div>

              {platformSettings.paypal_enabled && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Client ID de PayPal
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Client ID de tu app en PayPal Developer (empieza con AV o At en produccion)
                    </p>
                    <input
                      type="text"
                      name="paypal_client_id"
                      value={platformSettings.paypal_client_id}
                      onChange={handlePlatformChange}
                      placeholder="AVxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Client Secret de PayPal
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Secret de tu app en PayPal Developer
                    </p>
                    <div className="relative">
                      <input
                        type={showSecrets['paypal_client_secret'] ? 'text' : 'password'}
                        name="paypal_client_secret"
                        value={platformSettings.paypal_client_secret}
                        onChange={handlePlatformChange}
                        placeholder="EGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                      />
                      <button type="button" onClick={() => toggleSecret('paypal_client_secret')} className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600">
                        {showSecrets['paypal_client_secret'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ---- Stripe — Control por contexto ---- */}
            <div className="border border-violet-200 rounded-lg p-4 bg-violet-50/30">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-violet-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Stripe — Control por contexto</h3>
                  <p className="text-xs text-gray-500">Activa o desactiva Stripe segun el tipo de transaccion</p>
                </div>
              </div>

              <div className="space-y-3">
                {/* Stripe para reservas */}
                <div className="flex items-start justify-between gap-4 bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">Stripe para reservas de tours</p>
                    <p className="text-xs text-gray-500 mt-0.5">Permite pagar reservas con tarjeta via Stripe</p>
                    {!platformSettings.stripe_bookings_enabled && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                        Desactivado — los viajeros no podran pagar con Stripe al reservar tours
                      </p>
                    )}
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      name="stripe_bookings_enabled"
                      checked={platformSettings.stripe_bookings_enabled}
                      onChange={handlePlatformChange}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">Habilitado</span>
                  </label>
                </div>

                {/* Stripe para tarjetas de regalo */}
                <div className="flex items-start justify-between gap-4 bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">Stripe para tarjetas de regalo</p>
                    <p className="text-xs text-gray-500 mt-0.5">Permite comprar tarjetas de regalo con tarjeta via Stripe</p>
                    {!platformSettings.stripe_gift_cards_enabled && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                        Desactivado — la opcion de Stripe no aparecera al comprar tarjetas de regalo
                      </p>
                    )}
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      name="stripe_gift_cards_enabled"
                      checked={platformSettings.stripe_gift_cards_enabled}
                      onChange={handlePlatformChange}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">Habilitado</span>
                  </label>
                </div>

                {/* Stripe para membresias */}
                <div className="flex items-start justify-between gap-4 bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">Stripe para nuevas membresias</p>
                    <p className="text-xs text-gray-500 mt-0.5">Permite contratar nuevas suscripciones de membresia</p>
                    {!platformSettings.stripe_memberships_enabled && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          Desactivado — la pagina de compra mostrara un aviso de mantenimiento temporal
                        </p>
                        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                          Las suscripciones activas y sus renovaciones automaticas en Stripe no se ven afectadas
                        </p>
                      </div>
                    )}
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      name="stripe_memberships_enabled"
                      checked={platformSettings.stripe_memberships_enabled}
                      onChange={handlePlatformChange}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">Habilitado</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Mail className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Configuración de Email
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="contact_email" className="block text-sm font-medium text-gray-700 mb-1">
                Email de Contacto
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Los mensajes del formulario de contacto se enviarán a este email
              </p>
              <input
                type="email"
                id="contact_email"
                name="contact_email"
                value={settings.contact_email}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Server className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Configuración SMTP
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="smtp_host" className="block text-sm font-medium text-gray-700 mb-1">
                Servidor SMTP
              </label>
              <input
                type="text"
                id="smtp_host"
                name="smtp_host"
                value={settings.smtp_host}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label htmlFor="smtp_port" className="block text-sm font-medium text-gray-700 mb-1">
                Puerto SMTP
              </label>
              <input
                type="number"
                id="smtp_port"
                name="smtp_port"
                value={settings.smtp_port}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label htmlFor="smtp_user" className="block text-sm font-medium text-gray-700 mb-1">
                Usuario SMTP
              </label>
              <input
                type="text"
                id="smtp_user"
                name="smtp_user"
                value={settings.smtp_user}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label htmlFor="smtp_password" className="block text-sm font-medium text-gray-700 mb-1">
                Contraseña SMTP
              </label>
              <div className="relative">
                <input
                  type={showSecrets['smtp_password'] ? 'text' : 'password'}
                  id="smtp_password"
                  name="smtp_password"
                  value={settings.smtp_password}
                  onChange={handleChange}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
                <button type="button" onClick={() => toggleSecret('smtp_password')} className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600">
                  {showSecrets['smtp_password'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="smtp_api_key" className="block text-sm font-medium text-gray-700 mb-1">
                API Key SMTP2GO
              </label>
              <p className="text-xs text-gray-500 mb-2">
                El API key se usa para enviar emails a través de SMTP2GO
              </p>
              <div className="relative">
                <input
                  type={showSecrets['smtp_api_key'] ? 'text' : 'password'}
                  id="smtp_api_key"
                  name="smtp_api_key"
                  value={settings.smtp_api_key}
                  onChange={handleChange}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                />
                <button type="button" onClick={() => toggleSecret('smtp_api_key')} className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600">
                  {showSecrets['smtp_api_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* PAC / CFDI Configuration */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-2">
            <FileText className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">Configuración CFDI / PAC</h2>
          </div>
          <p className="text-sm text-gray-500 mb-6">
            Configura el proveedor de timbrado (PAC) para la emisión de Comprobantes Fiscales Digitales por Internet.
            La arquitectura está diseñada para cambiar de proveedor sin modificar la lógica de negocio.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor PAC Activo</label>
              <select
                value={platformSettings.pac_provider}
                onChange={(e) => setPlatformSettings(prev => ({ ...prev, pac_provider: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="none">Sin proveedor (desactivado)</option>
                <option value="zoho_books">Zoho Books (Recomendado — via SW Sapien)</option>
                <option value="facturapi">FacturAPI (PAC de contingencia)</option>
                <option value="sw_sapien">SW Sapien</option>
                <option value="contpaqi">Contpaqi Cloud</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">Cambiar el proveedor no afecta los CFDI ya emitidos.</p>
            </div>

            <div className="flex items-center gap-3 md:pt-6">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={platformSettings.pac_sandbox_mode}
                  onChange={(e) => setPlatformSettings(prev => ({ ...prev, pac_sandbox_mode: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
              <div>
                <div className="text-sm font-medium text-gray-700">Modo Sandbox</div>
                <div className="text-xs text-gray-400">{platformSettings.pac_sandbox_mode ? 'Activo (pruebas)' : 'Producción (CFDIs reales)'}</div>
              </div>
              {!platformSettings.pac_sandbox_mode && (
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-error-100 text-error-700">
                  <Shield className="h-3 w-3" /> Producción
                </span>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Key del PAC</label>
              <div className="relative">
                <input
                  type={showSecrets['pac_api_key_encrypted'] ? 'text' : 'password'}
                  value={platformSettings.pac_api_key_encrypted}
                  onChange={(e) => setPlatformSettings(prev => ({ ...prev, pac_api_key_encrypted: e.target.value }))}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                  placeholder="sk_live_xxxxxxxxxxxx o equivalente"
                  autoComplete="off"
                />
                <button type="button" onClick={() => toggleSecret('pac_api_key_encrypted')} className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600">
                  {showSecrets['pac_api_key_encrypted'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">En FacturAPI: Configuración → API Keys → Live Key.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ID de Organización / Emisor</label>
              <input
                type="text"
                value={platformSettings.pac_organization_id}
                onChange={(e) => setPlatformSettings(prev => ({ ...prev, pac_organization_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                placeholder="ID de la organización en el PAC"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Serie CFDI — Reservas</label>
              <input
                type="text"
                value={platformSettings.cfdi_serie_booking}
                onChange={(e) => setPlatformSettings(prev => ({ ...prev, cfdi_serie_booking: e.target.value.toUpperCase() }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 uppercase"
                maxLength={5}
                placeholder="A"
              />
              <p className="text-xs text-gray-400 mt-1">Serie para facturas de viajeros (comprobantes de pago de tours).</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Serie CFDI — Comisiones</label>
              <input
                type="text"
                value={platformSettings.cfdi_serie_commission}
                onChange={(e) => setPlatformSettings(prev => ({ ...prev, cfdi_serie_commission: e.target.value.toUpperCase() }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 uppercase"
                maxLength={5}
                placeholder="B"
              />
              <p className="text-xs text-gray-400 mt-1">Serie para facturas de comisión emitidas a las agencias.</p>
            </div>
          </div>

          <div className="mt-6 border-t pt-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary-500" />
              Datos del Emisor (ToursRed)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">RFC del Emisor</label>
                <input
                  type="text"
                  value={platformSettings.pac_issuer_rfc}
                  onChange={(e) => setPlatformSettings(prev => ({ ...prev, pac_issuer_rfc: e.target.value.toUpperCase() }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 uppercase font-mono text-sm"
                  placeholder="RFC de ToursRed"
                  maxLength={13}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Razón Social</label>
                <input
                  type="text"
                  value={platformSettings.pac_issuer_razon_social}
                  onChange={(e) => setPlatformSettings(prev => ({ ...prev, pac_issuer_razon_social: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Nombre legal de ToursRed"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Régimen Fiscal</label>
                <select
                  value={platformSettings.pac_issuer_regimen_fiscal}
                  onChange={(e) => setPlatformSettings(prev => ({ ...prev, pac_issuer_regimen_fiscal: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">Seleccionar</option>
                  <option value="601">601 - General de Ley Personas Morales</option>
                  <option value="603">603 - Personas Morales con Fines no Lucrativos</option>
                  <option value="612">612 - Personas Físicas con Actividades Empresariales</option>
                  <option value="621">621 - Incorporación Fiscal</option>
                  <option value="625">625 - Régimen Simplificado de Confianza</option>
                </select>
              </div>
            </div>
          </div>

          {platformSettings.pac_provider !== 'none' && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-700">
              <strong>Proveedor activo: {platformSettings.pac_provider}</strong>
              {platformSettings.pac_sandbox_mode
                ? ' — Modo sandbox. Los CFDIs generados son de prueba y no tienen validez fiscal.'
                : ' — Modo producción. Los CFDIs generados son válidos ante el SAT.'}
            </div>
          )}
        </div>

        {/* Accounting Integration */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-2">
            <BookOpen className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">Integracion Contable</h2>
          </div>
          <p className="text-sm text-gray-500 mb-6">
            Elige entre el Mini ERP nativo de ToursRed (contabilidad electronica SAT Anexo 24 integrada) o sincroniza con un sistema
            externo como Zoho Books u Odoo. Cambiar de proveedor no afecta registros previos.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor Contable Activo</label>
              <select
                value={platformSettings.accounting_provider}
                onChange={(e) => setPlatformSettings(prev => ({ ...prev, accounting_provider: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="none">Sin proveedor (desactivado)</option>
                <option value="internal">Mini ERP Interno (ToursRed)</option>
                <option value="zoho_books">Zoho Books</option>
                <option value="odoo">Odoo (JSON-2 API)</option>
                <option value="quickbooks">QuickBooks (Proximamente)</option>
                <option value="contpaqi_cloud">Contpaqi Cloud (Proximamente)</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">Cambiar el proveedor no afecta registros ya sincronizados.</p>
            </div>

            <div className="flex items-center gap-3 md:pt-6">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={platformSettings.accounting_sync_enabled}
                  onChange={(e) => setPlatformSettings(prev => ({ ...prev, accounting_sync_enabled: e.target.checked }))}
                  disabled={platformSettings.accounting_provider === 'none' || platformSettings.accounting_provider === 'internal'}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600 peer-disabled:opacity-50"></div>
              </label>
              <div>
                <div className="text-sm font-medium text-gray-700">Sincronizacion en Tiempo Real</div>
                <div className="text-xs text-gray-400">
                  {platformSettings.accounting_provider === 'internal'
                    ? 'No aplica — el ERP interno genera polizas directamente desde los eventos'
                    : platformSettings.accounting_sync_enabled
                      ? 'Activa — reservas, pagos y contactos se sincronizan automaticamente'
                      : 'Inactiva'}
                </div>
              </div>
            </div>
          </div>

          {platformSettings.accounting_provider === 'internal' && (
            <div className="space-y-4">
              <div className="border border-sky-200 rounded-lg p-5 bg-sky-50/40">
                <h3 className="text-sm font-semibold text-sky-800 mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-sky-600" />
                  Mini ERP Contable Interno — ToursRed
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="bg-white rounded-lg border border-sky-100 p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">RFC Emisor</p>
                    <p className="text-sm font-mono font-bold text-gray-800">TRG250711JWA</p>
                    <p className="text-xs text-gray-400 mt-0.5">Regimen RESICO 626</p>
                  </div>
                  <div className="bg-white rounded-lg border border-sky-100 p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Catalogo de Cuentas</p>
                    <p className="text-sm font-medium text-gray-800">SAT Anexo 24</p>
                    <p className="text-xs text-gray-400 mt-0.5">30+ cuentas pre-configuradas</p>
                  </div>
                  <div className="bg-white rounded-lg border border-sky-100 p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Exportacion SAT</p>
                    <p className="text-sm font-medium text-gray-800">CT · BC · PL en ZIP</p>
                    <p className="text-xs text-gray-400 mt-0.5">Listo para subir al SAT</p>
                  </div>
                </div>

                <a
                  href="/accounting"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 text-white text-sm font-medium rounded-lg hover:bg-sky-700 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Ir al modulo de Contabilidad
                </a>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800">
                <p className="font-semibold mb-2">Que genera automaticamente el ERP interno:</p>
                <ul className="text-xs space-y-1 list-disc ml-4">
                  <li>Reservas con pago confirmado → Poliza de ingreso (Anticipo recibido en cuenta 102 Bancos / 208 Anticipos de clientes)</li>
                  <li>Tours completados → Poliza de devengamiento (comision propia 401 + CxP Agencias 201)</li>
                  <li>Pagos a agencias → Poliza de egreso (cancela el pasivo 201 y acredita 102 Bancos)</li>
                  <li>Cargo de servicio → Ingreso inmediato en cuenta 402 al momento del pago</li>
                </ul>
                <p className="text-xs mt-2 text-emerald-700 font-medium">
                  Usa "Generar polizas" en el modulo de Contabilidad para procesar eventos historicos del periodo.
                </p>
              </div>
            </div>
          )}

          {platformSettings.accounting_provider === 'zoho_books' && (
            <div className="space-y-6">
              <div className="border border-gray-200 rounded-lg p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary-500" />
                  Credenciales Zoho Books
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                    <input
                      type="text"
                      value={platformSettings.zoho_client_id}
                      onChange={(e) => setPlatformSettings(prev => ({ ...prev, zoho_client_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                      placeholder="1000.XXXXXXXXXXXXXXXXXXXXXXXXXX"
                      autoComplete="off"
                    />
                    <p className="text-xs text-gray-400 mt-1">Zoho Developer Console → Tu App → Client ID</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                    <div className="relative">
                      <input
                        type={showSecrets['zoho_client_secret'] ? 'text' : 'password'}
                        value={platformSettings.zoho_client_secret}
                        onChange={(e) => setPlatformSettings(prev => ({ ...prev, zoho_client_secret: e.target.value }))}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        autoComplete="off"
                      />
                      <button type="button" onClick={() => toggleSecret('zoho_client_secret')} className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600">
                        {showSecrets['zoho_client_secret'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Zoho Developer Console → Tu App → Client Secret</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Organization ID</label>
                    <input
                      type="text"
                      value={platformSettings.zoho_org_id}
                      onChange={(e) => setPlatformSettings(prev => ({ ...prev, zoho_org_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                      placeholder="123456789"
                    />
                    <p className="text-xs text-gray-400 mt-1">Zoho Books → Configuracion → Organizacion → ID</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Region del Servidor</label>
                    <select
                      value={platformSettings.zoho_region}
                      onChange={(e) => setPlatformSettings(prev => ({ ...prev, zoho_region: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="com">Global (zoho.com) — Recomendado Mexico</option>
                      <option value="eu">Europa (zoho.eu)</option>
                      <option value="in">India (zoho.in)</option>
                      <option value="com.au">Australia (zoho.com.au)</option>
                      <option value="jp">Japon (zoho.jp)</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={platformSettings.zoho_sandbox_mode}
                      onChange={(e) => setPlatformSettings(prev => ({ ...prev, zoho_sandbox_mode: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                  <div>
                    <div className="text-sm font-medium text-gray-700">Modo Sandbox (Organizacion de Pruebas)</div>
                    <div className="text-xs text-gray-400">{platformSettings.zoho_sandbox_mode ? 'Activo — usando organizacion de pruebas en Zoho' : 'Produccion — datos reales'}</div>
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <Link className="w-4 h-4 text-primary-500" />
                  Conexion OAuth con Zoho Books
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  Para conectar, genera un Grant Token en Zoho Developer Console usando el metodo Self Client
                  (scope: ZohoBooks.fullaccess.all) y pegalo aqui. Este paso se hace una sola vez.
                </p>

                <div className="flex items-center gap-3 mb-4">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                    zohoStatus?.connected && !zohoStatus?.is_expired
                      ? 'bg-green-100 text-green-700'
                      : zohoStatus?.connected && zohoStatus?.is_expired
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    <div className={`w-2 h-2 rounded-full ${
                      zohoStatus?.connected && !zohoStatus?.is_expired ? 'bg-green-500' :
                      zohoStatus?.connected ? 'bg-amber-500' : 'bg-gray-400'
                    }`} />
                    {isCheckingZoho ? 'Verificando...' :
                      zohoStatus?.connected && !zohoStatus?.is_expired ? 'Conectado' :
                      zohoStatus?.connected && zohoStatus?.is_expired ? 'Token expirado' :
                      'Sin conectar'}
                  </div>
                  {zohoStatus?.token_expires_at && (
                    <span className="text-xs text-gray-500">
                      Token expira: {new Date(zohoStatus.token_expires_at).toLocaleString('es-MX')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={checkZohoStatus}
                    disabled={isCheckingZoho}
                    className="ml-auto text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isCheckingZoho ? 'animate-spin' : ''}`} />
                    Verificar
                  </button>
                </div>

                {!zohoStatus?.connected ? (
                  <div className="space-y-3">
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-800">
                      <p className="font-semibold mb-1">Pasos para conectar Zoho Books:</p>
                      <ol className="list-decimal ml-4 space-y-1">
                        <li>Ve a <a href="https://api-console.zoho.com" target="_blank" rel="noopener noreferrer" className="underline font-medium inline-flex items-center gap-0.5">api-console.zoho.com <ExternalLink className="w-3 h-3" /></a></li>
                        <li>Selecciona tu app y haz clic en "Self Client"</li>
                        <li>En "Scope" escribe: <span className="font-mono bg-blue-100 px-1 rounded">ZohoBooks.fullaccess.all</span></li>
                        <li>En "Time Duration" selecciona 10 minutos</li>
                        <li>Copia el Grant Token generado y pegalo abajo</li>
                      </ol>
                    </div>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={zohoGrantToken}
                          onChange={(e) => { setZohoGrantToken(e.target.value); setZohoConnectError(''); }}
                          placeholder="Pega el Grant Token de Zoho Self Client aqui..."
                          className={`flex-1 px-3 py-2 border rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm ${zohoConnectError ? 'border-red-400' : 'border-gray-300'}`}
                        />
                        <button
                          type="button"
                          onClick={handleConnectZoho}
                          disabled={isConnectingZoho || !zohoGrantToken.trim()}
                          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
                        >
                          {isConnectingZoho ? <Loader className="w-4 h-4 animate-spin" /> : <Link className="w-4 h-4" />}
                          {isConnectingZoho ? 'Conectando...' : 'Conectar'}
                        </button>
                      </div>
                      {zohoConnectError && (
                        <p className="text-xs text-red-600 flex items-start gap-1">
                          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          {zohoConnectError}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleDisconnectZoho}
                    className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50 text-sm font-medium"
                  >
                    <Unlink className="w-4 h-4" />
                    Desconectar Zoho Books
                  </button>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">Que se sincroniza automaticamente:</p>
                <ul className="text-xs space-y-1 list-disc ml-4">
                  <li>Agencias aprobadas → Contactos (Proveedor) en Zoho Books</li>
                  <li>Viajeros con datos fiscales → Contactos (Cliente) en Zoho Books</li>
                  <li>Reservas confirmadas → Facturas de ingreso en Zoho Books</li>
                  <li>Pagos a agencias → Facturas de proveedor + Pagos en Zoho Books</li>
                </ul>
                <p className="text-xs mt-2 text-blue-600">
                  Monitorea el estado de sincronizacion en: Admin → Contabilidad
                </p>
              </div>
            </div>
          )}

          {platformSettings.accounting_provider === 'odoo' && (
            <div className="space-y-6">
              <div className="border border-gray-200 rounded-lg p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary-500" />
                  Credenciales Odoo (JSON-2 API)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">URL de la Instancia Odoo</label>
                    <input
                      type="url"
                      value={platformSettings.odoo_url}
                      onChange={(e) => setPlatformSettings(prev => ({ ...prev, odoo_url: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                      placeholder="https://tuempresa.odoo.com"
                      autoComplete="off"
                    />
                    <p className="text-xs text-gray-400 mt-1">URL completa de tu instancia (ej. https://toursred.odoo.com)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                    <div className="relative">
                      <input
                        type={showSecrets['odoo_api_key_encrypted'] ? 'text' : 'password'}
                        value={platformSettings.odoo_api_key_encrypted}
                        onChange={(e) => setPlatformSettings(prev => ({ ...prev, odoo_api_key_encrypted: e.target.value }))}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                        placeholder="Bearer token generado en Preferencias → Seguridad"
                        autoComplete="off"
                      />
                      <button type="button" onClick={() => toggleSecret('odoo_api_key_encrypted')} className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600">
                        {showSecrets['odoo_api_key_encrypted'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Preferencias de usuario → Seguridad de la cuenta → Nueva clave API</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la Base de Datos</label>
                    <input
                      type="text"
                      value={platformSettings.odoo_database}
                      onChange={(e) => setPlatformSettings(prev => ({ ...prev, odoo_database: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                      placeholder="toursred-test"
                      autoComplete="off"
                    />
                    <p className="text-xs text-gray-400 mt-1">El subdominio de tu URL (ej. "toursred-test" de toursred-test.odoo.com)</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCheckOdoo}
                    disabled={isCheckingOdoo || !platformSettings.odoo_url || !platformSettings.odoo_api_key_encrypted}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCheckingOdoo ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {isCheckingOdoo ? 'Verificando...' : 'Probar conexion'}
                  </button>
                  {odooHealthy !== null && (
                    <span className={`flex items-center gap-1.5 text-sm font-medium ${odooHealthy ? 'text-green-600' : 'text-red-600'}`}>
                      {odooHealthy ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      {odooHealthy ? 'Conexion exitosa' : 'No se pudo conectar — verifica la URL y el API Key'}
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">Que se sincroniza automaticamente con Odoo:</p>
                <ul className="text-xs space-y-1 list-disc ml-4">
                  <li>Agencias aprobadas → Contactos (Proveedor) en Odoo</li>
                  <li>Viajeros con datos fiscales → Contactos (Cliente) en Odoo</li>
                  <li>Reservas confirmadas → Asientos contables de ingreso (account.move)</li>
                  <li>Pagos a agencias → Asientos de egreso en Odoo</li>
                </ul>
                <p className="text-xs mt-2 text-blue-600">
                  Monitorea el estado de sincronizacion en: Admin → Contabilidad. La API JSON-2 requiere plan Custom en Odoo SaaS.
                </p>
              </div>
            </div>
          )}

          {platformSettings.accounting_provider !== 'none' && platformSettings.accounting_provider !== 'internal' && platformSettings.accounting_provider !== 'zoho_books' && platformSettings.accounting_provider !== 'odoo' && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800">
              <strong>{platformSettings.accounting_provider === 'quickbooks' ? 'QuickBooks' : 'Contpaqi Cloud'}</strong> — La integracion con este proveedor esta en desarrollo.
              El adaptador existe en el codigo y puede activarse cuando se implementen las credenciales correspondientes.
            </div>
          )}
        </div>

        {/* Imagen de Fondo del Hero */}
        <div className="bg-white shadow-md rounded-lg p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Image className="h-5 w-5 text-primary-600" />
            Imagen de Fondo del Hero
          </h2>
          <p className="text-sm text-gray-500">
            Personaliza la imagen de portada de la pagina principal. Cuando hay una imagen personalizada activa, la imagen original se deshabilita completamente para evitar parpadeos de carga.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Estado actual */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Imagen actual</p>
              {platformSettings.hero_background_url ? (
                <div className="relative rounded-lg overflow-hidden border border-gray-200 aspect-video bg-gray-100">
                  <img
                    src={platformSettings.hero_background_url}
                    alt="Fondo del hero"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent flex items-end p-3">
                    <span className="text-white text-xs font-medium bg-green-500/90 px-2 py-0.5 rounded-full">Imagen personalizada activa</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg overflow-hidden border border-gray-200 aspect-video bg-gray-100 flex items-center justify-center">
                  <div className="text-center text-gray-400">
                    <Image className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Usando imagen original de Pexels</p>
                  </div>
                </div>
              )}
              {platformSettings.hero_background_url && (
                <button
                  type="button"
                  onClick={handleHeroRestore}
                  className="mt-3 flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors"
                >
                  <RotateCcw className="h-4 w-4" />
                  Restaurar imagen original
                </button>
              )}
            </div>

            {/* Subir nueva imagen */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Subir nueva imagen</p>
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-primary-400 hover:bg-primary-50/30 transition-colors cursor-pointer"
                onClick={() => heroInputRef.current?.click()}
              >
                {heroPreview ? (
                  <div className="relative">
                    <img src={heroPreview} alt="Preview" className="w-full aspect-video object-cover rounded-md" />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setHeroFile(null); setHeroPreview(null); if (heroInputRef.current) heroInputRef.current.value = ''; }}
                      className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-600 font-medium">Haz clic para seleccionar imagen</p>
                    <p className="text-xs text-gray-400 mt-1">JPG, PNG o WEBP · Maximo 5 MB</p>
                  </>
                )}
              </div>
              <input
                ref={heroInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={handleHeroFileChange}
              />
              <div className="mt-3 bg-blue-50 border border-blue-100 rounded-md p-3 text-xs text-blue-700">
                <p className="font-semibold mb-1">Dimensiones recomendadas:</p>
                <ul className="space-y-0.5 list-disc ml-4">
                  <li>Minimo: <strong>1920 × 1080 px</strong> (Full HD)</li>
                  <li>Optimo: <strong>2560 × 1440 px</strong> para pantallas retina</li>
                  <li>Formato: JPG calidad 80-85% · Peso maximo: 3 MB</li>
                  <li>Ratio: 16:9 o mas panoramico</li>
                </ul>
              </div>
              {heroFile && (
                <button
                  type="button"
                  onClick={handleHeroUpload}
                  disabled={isUploadingHero}
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isUploadingHero ? (
                    <><Loader className="h-4 w-4 animate-spin" /> Subiendo imagen...</>
                  ) : (
                    <><Upload className="h-4 w-4" /> Subir y activar imagen</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── URL de la Plataforma ─────────────────────────────────── */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Globe className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">URL de la Plataforma</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            URL base que se incluye en los enlaces de todos los correos electrónicos enviados a usuarios, agencias y administradores. Actualízala cuando cambies de dominio.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              URL base de la plataforma
            </label>
            <input
              type="url"
              value={platformSettings.platform_url}
              onChange={(e) =>
                setPlatformSettings((prev) => ({ ...prev, platform_url: e.target.value }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="https://www.toursred.com.mx"
            />
            <p className="text-xs text-gray-500 mt-1">
              Sin barra al final. Ejemplo: <code className="bg-gray-100 px-1 rounded">https://www.toursred.com.mx</code>
            </p>
          </div>
        </div>

        {/* ── Modo Mantenimiento ─────────────────────────────────── */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Wrench className="w-6 h-6 text-amber-500" />
            <h2 className="text-xl font-semibold text-gray-900">Modo Mantenimiento</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Cuando está activo, los viajeros y agencias ven una pantalla de mantenimiento y no pueden iniciar sesión ni hacer reservas. El super administrador puede acceder al sistema normalmente.
          </p>

          {/* Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 mb-5">
            <div>
              <p className="font-medium text-gray-900">Estado del sistema</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {platformSettings.maintenance_mode
                  ? 'Sistema bloqueado — en mantenimiento'
                  : 'Sistema operativo — acceso normal'}
              </p>
              {platformSettings.maintenance_enabled_at && platformSettings.maintenance_mode && (
                <p className="text-xs text-amber-600 mt-1">
                  Activado: {new Date(platformSettings.maintenance_enabled_at).toLocaleString('es-MX')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                setPlatformSettings((prev) => ({
                  ...prev,
                  maintenance_mode: !prev.maintenance_mode,
                  maintenance_enabled_at: !prev.maintenance_mode ? new Date().toISOString() : null,
                }))
              }
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                platformSettings.maintenance_mode ? 'bg-amber-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  platformSettings.maintenance_mode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {platformSettings.maintenance_mode && (
            <div className="mb-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
              <p>El sistema se bloqueará al guardar la configuración. Asegúrate de guardar antes de comenzar el mantenimiento.</p>
            </div>
          )}

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mensaje de mantenimiento
            </label>
            <p className="text-xs text-gray-500 mb-2">Este texto se muestra a los usuarios durante el mantenimiento.</p>
            <textarea
              rows={3}
              value={platformSettings.maintenance_message}
              onChange={(e) =>
                setPlatformSettings((prev) => ({ ...prev, maintenance_message: e.target.value }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
              placeholder="Estamos realizando tareas de mantenimiento. Estaremos de vuelta muy pronto."
            />
          </div>
        </div>

        {/* ── Anuncio / Aviso Importante ─────────────────────────── */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Megaphone className="w-6 h-6 text-red-500" />
            <h2 className="text-xl font-semibold text-gray-900">Anuncio / Aviso Importante</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Muestra un popup de aviso a todos los usuarios al ingresar al sitio. Puede usarse para anunciar mantenimientos, novedades o cualquier comunicado importante. El usuario lo descarta haciendo clic en el botón.
          </p>

          {/* Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 mb-5">
            <div>
              <p className="font-medium text-gray-900">Estado del anuncio</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {platformSettings.announcement_active ? 'Anuncio activo — visible para los usuarios' : 'Anuncio inactivo'}
              </p>
              {platformSettings.announcement_activated_at && platformSettings.announcement_active && (
                <p className="text-xs text-red-600 mt-1">
                  Activado: {new Date(platformSettings.announcement_activated_at).toLocaleString('es-MX')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                setPlatformSettings((prev) => ({
                  ...prev,
                  announcement_active: !prev.announcement_active,
                  announcement_activated_at: !prev.announcement_active ? new Date().toISOString() : prev.announcement_activated_at,
                }))
              }
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                platformSettings.announcement_active ? 'bg-red-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  platformSettings.announcement_active ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Título del anuncio</label>
              <input
                type="text"
                value={platformSettings.announcement_title}
                onChange={(e) =>
                  setPlatformSettings((prev) => ({ ...prev, announcement_title: e.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Ej: Mantenimiento programado el viernes 28"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mensaje del anuncio</label>
              <textarea
                rows={4}
                value={platformSettings.announcement_message}
                onChange={(e) =>
                  setPlatformSettings((prev) => ({ ...prev, announcement_message: e.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                placeholder="Ej: El próximo viernes 28 de junio de 12:00 a 14:00 hrs realizaremos una ventana de mantenimiento. Durante ese periodo el sitio no estará disponible."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Texto del botón</label>
              <input
                type="text"
                value={platformSettings.announcement_cta_text}
                onChange={(e) =>
                  setPlatformSettings((prev) => ({ ...prev, announcement_cta_text: e.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Aceptar"
              />
              <p className="text-xs text-gray-400 mt-1">Texto que aparecerá en el botón para cerrar el popup.</p>
            </div>
          </div>
        </div>

        {/* ── Proveedores OAuth ─────────────────────────────────────────── */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-2">
            <Link className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">Proveedores OAuth</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Activa o desactiva cada proveedor de inicio de sesión social. Los proveedores desactivados no aparecen en el login ni en la vinculación de cuentas.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-5">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                <strong>X (Twitter) y Facebook</strong> requieren aprobación de la plataforma antes de usarse en producción. Actívalos solo después de obtener las credenciales aprobadas y configurarlas en el panel de Supabase.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left pb-3 pr-4 font-medium text-gray-700 w-48">Proveedor</th>
                  <th className="text-center pb-3 px-4 font-medium text-gray-700">Login</th>
                  <th className="text-center pb-3 px-4 font-medium text-gray-700">Vincular cuenta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  { label: 'Google', loginKey: 'oauth_google_login_enabled', linkKey: 'oauth_google_link_enabled', icon: (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                  ) },
                  { label: 'Microsoft', loginKey: 'oauth_azure_login_enabled', linkKey: 'oauth_azure_link_enabled', icon: (
                    <svg viewBox="0 0 23 23" className="w-5 h-5" aria-hidden="true">
                      <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
                      <path fill="#f35325" d="M1 1h10v10H1z"/>
                      <path fill="#81bc06" d="M12 1h10v10H12z"/>
                      <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                      <path fill="#ffba08" d="M12 12h10v10H12z"/>
                    </svg>
                  ) },
                  { label: 'X (Twitter)', loginKey: 'oauth_twitter_login_enabled', linkKey: 'oauth_twitter_link_enabled', icon: (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  ) },
                  { label: 'Facebook', loginKey: 'oauth_facebook_login_enabled', linkKey: 'oauth_facebook_link_enabled', icon: (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2"/>
                    </svg>
                  ) },
                ].map(({ label, loginKey, linkKey, icon }) => (
                  <tr key={loginKey} className="hover:bg-gray-50">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2.5">
                        {icon}
                        <span className="font-medium text-gray-800">{label}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <label className="relative inline-flex items-center cursor-pointer justify-center">
                        <input
                          type="checkbox"
                          name={loginKey}
                          checked={platformSettings[loginKey as keyof typeof platformSettings] as boolean}
                          onChange={handlePlatformChange}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                      </label>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <label className="relative inline-flex items-center cursor-pointer justify-center">
                        <input
                          type="checkbox"
                          name={linkKey}
                          checked={platformSettings[linkKey as keyof typeof platformSettings] as boolean}
                          onChange={handlePlatformChange}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="bg-primary-600 text-white px-6 py-2 rounded-md hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isSaving ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                <span>Guardando...</span>
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                <span>Guardar Configuración</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminSettings;
