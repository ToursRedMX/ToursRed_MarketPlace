import type { TwilioConfig } from './proveedores/twilio.ts';

export function twilioConfig(): TwilioConfig {
  return {
    accountSid: Deno.env.get('TWILIO_ACCOUNT_SID') ?? '',
    authToken: Deno.env.get('TWILIO_AUTH_TOKEN') ?? '',
    messagingServiceSid: Deno.env.get('TWILIO_MESSAGING_SERVICE_SID'),
    from: Deno.env.get('TWILIO_FROM_NUMBER'),
    whatsappFrom: Deno.env.get('TWILIO_WHATSAPP_FROM'),
    whatsappContentSid: Deno.env.get('TWILIO_WHATSAPP_OTP_CONTENT_SID'),
    testAccountSid: Deno.env.get('TWILIO_TEST_ACCOUNT_SID'),
    testAuthToken: Deno.env.get('TWILIO_TEST_AUTH_TOKEN'),
  };
}
