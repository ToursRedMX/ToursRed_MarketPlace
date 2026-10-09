import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import type { TwilioMessage } from './proveedores/twilio.ts';

// Read-only provider operations. A missing SID is NEVER a reason to send again.
export async function reconciliarTwilio(client: SupabaseClient, consultar: (sid: string) => Promise<TwilioMessage | null>): Promise<number> {
  const { data: attempts, error } = await client.rpc('claim_twilio_reconciliation', { p_limit: 5 });
  if (error) throw error;
  let reconciled = 0;
  for (const attempt of attempts ?? []) {
    const message = await consultar(attempt.provider_message_id);
    if (!message) continue;
    const result = await client.rpc('record_twilio_status', {
      p_correlation: attempt.correlation_id, p_sid: message.sid, p_destination: message.destination,
      p_state: message.state, p_code: message.code, p_cost: message.cost, p_unit: message.unit,
    });
    if (result.error) throw result.error;
    if (result.data) reconciled++;
  }
  return reconciled;
}
