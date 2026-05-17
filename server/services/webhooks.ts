// CortexBuild Webhooks Service
// Real-time event notifications to external systems
// Migrated to Supabase

import { SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import crypto from 'crypto';

export interface Webhook {
  id: number;
  user_id: string;
  company_id: string;
  name: string;
  url: string;
  events: string;
  secret: string;
  is_active: boolean;
  last_triggered_at?: string;
  success_count: number;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

// Available webhook events
export const WEBHOOK_EVENTS = {
  // Project events
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_DELETED: 'project.deleted',
  PROJECT_STATUS_CHANGED: 'project.status_changed',

  // Task events
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_DELETED: 'task.deleted',
  TASK_COMPLETED: 'task.completed',

  // RFI events
  RFI_CREATED: 'rfi.created',
  RFI_ANSWERED: 'rfi.answered',
  RFI_CLOSED: 'rfi.closed',

  // Invoice events
  INVOICE_CREATED: 'invoice.created',
  INVOICE_SENT: 'invoice.sent',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_OVERDUE: 'invoice.overdue',

  // Client events
  CLIENT_CREATED: 'client.created',
  CLIENT_UPDATED: 'client.updated',

  // Document events
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_SHARED: 'document.shared',

  // Time tracking events
  TIME_ENTRY_CREATED: 'time_entry.created',
  TIME_ENTRY_APPROVED: 'time_entry.approved',

  // Purchase order events
  PO_CREATED: 'purchase_order.created',
  PO_APPROVED: 'purchase_order.approved',
  PO_RECEIVED: 'purchase_order.received'
};

/**
 * Create a new webhook
 */
export async function createWebhook(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
  name: string,
  url: string,
  events: string[]
): Promise<Webhook> {
  const secret = crypto.randomBytes(32).toString('hex');

  const { data, error } = await supabase
    .from('webhooks')
    .insert({
      user_id: userId,
      company_id: companyId,
      name,
      url,
      events: JSON.stringify(events),
      secret,
      is_active: true,
      success_count: 0,
      failure_count: 0
    })
    .select()
    .single();

  if (error) throw error;
  return data as Webhook;
}

/**
 * Get webhook by ID
 */
export async function getWebhook(
  supabase: SupabaseClient,
  webhookId: number
): Promise<Webhook | null> {
  const { data, error } = await supabase
    .from('webhooks')
    .select('*')
    .eq('id', webhookId)
    .single();

  if (error) throw error;
  return data as Webhook | null;
}

/**
 * Get all webhooks for a user
 */
export async function getUserWebhooks(
  supabase: SupabaseClient,
  userId: string
): Promise<Webhook[]> {
  const { data, error } = await supabase
    .from('webhooks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as Webhook[];
}

/**
 * Get all webhooks for a company
 */
export async function getCompanyWebhooks(
  supabase: SupabaseClient,
  companyId: string
): Promise<Webhook[]> {
  const { data, error } = await supabase
    .from('webhooks')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as Webhook[];
}

/**
 * Update webhook
 */
export async function updateWebhook(
  supabase: SupabaseClient,
  webhookId: number,
  updates: Partial<Webhook>
): Promise<void> {
  const patch: any = {};

  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.url !== undefined) patch.url = updates.url;
  if (updates.events !== undefined) patch.events = updates.events;
  if (updates.is_active !== undefined) patch.is_active = updates.is_active ? 1 : 0;

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from('webhooks')
    .update(patch)
    .eq('id', webhookId);

  if (error) throw error;
}

/**
 * Delete webhook
 */
export async function deleteWebhook(
  supabase: SupabaseClient,
  webhookId: number
): Promise<void> {
  const { error } = await supabase
    .from('webhooks')
    .delete()
    .eq('id', webhookId);

  if (error) throw error;
}

/**
 * Generate webhook signature
 */
function generateSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Trigger webhook
 */
export async function triggerWebhook(
  supabase: SupabaseClient,
  webhookId: number,
  eventType: string,
  payload: any
): Promise<boolean> {
  const webhook = await getWebhook(supabase, webhookId);

  if (!webhook || !webhook.is_active) {
    console.log(`Webhook ${webhookId} is not active, skipping`);
    return false;
  }

  const events = JSON.parse(webhook.events);
  if (!Array.isArray(events) || (!events.includes(eventType) && !events.includes('*'))) {
    console.log(`Webhook ${webhookId} does not listen to ${eventType}, skipping`);
    return false;
  }

  const payloadStr = JSON.stringify(payload);
  const signature = generateSignature(payloadStr, webhook.secret);
  const timestamp = Date.now();

  try {
    const response = await axios.post(webhook.url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-CortexBuild-Event': eventType,
        'X-CortexBuild-Signature': signature,
        'X-CortexBuild-Timestamp': timestamp.toString(),
        'X-CortexBuild-Webhook-Id': webhookId.toString()
      },
      timeout: 10000
    });

    await logWebhookDelivery(
      supabase,
      webhookId,
      eventType,
      payloadStr,
      response.status,
      JSON.stringify(response.data)
    );

    await supabase
      .from('webhooks')
      .update({
        success_count: (webhook.success_count || 0) + 1,
        last_triggered_at: new Date().toISOString()
      })
      .eq('id', webhookId);

    return true;
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    const responseStatus = error.response?.status || 0;
    const responseBody = error.response?.data ? JSON.stringify(error.response.data) : null;

    await logWebhookDelivery(
      supabase,
      webhookId,
      eventType,
      payloadStr,
      responseStatus,
      responseBody,
      errorMessage
    );

    const updatedFailureCount = (webhook.failure_count || 0) + 1;

    await supabase
      .from('webhooks')
      .update({
        failure_count: updatedFailureCount,
        last_triggered_at: new Date().toISOString()
      })
      .eq('id', webhookId);

    if (updatedFailureCount >= 10) {
      await supabase
        .from('webhooks')
        .update({ is_active: false })
        .eq('id', webhookId);
      console.log(`Webhook ${webhookId} disabled after 10 consecutive failures`);
    }

    return false;
  }
}

/**
 * Log webhook delivery
 */
async function logWebhookDelivery(
  supabase: SupabaseClient,
  webhookId: number,
  eventType: string,
  payload: string,
  responseStatus: number,
  responseBody: string | null,
  errorMessage?: string
): Promise<void> {
  const { error } = await supabase
    .from('webhook_logs')
    .insert({
      webhook_id: webhookId,
      event_type: eventType,
      payload,
      response_status: responseStatus,
      response_body: responseBody,
      error_message: errorMessage || null
    });

  if (error) throw error;
}

/**
 * Get webhook logs
 */
export async function getWebhookLogs(
  supabase: SupabaseClient,
  webhookId: number,
  limit: number = 50
): Promise<any[]> {
  const { data, error } = await supabase
    .from('webhook_logs')
    .select('*')
    .eq('webhook_id', webhookId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Trigger webhooks for an event
 */
export async function triggerWebhooksForEvent(
  supabase: SupabaseClient,
  companyId: string,
  eventType: string,
  payload: any
): Promise<void> {
  const { data: webhooks, error } = await supabase
    .from('webhooks')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true);

  if (error) throw error;

  const promises = (webhooks || []).map((webhook: any) =>
    triggerWebhook(supabase, webhook.id, eventType, payload)
  );

  await Promise.allSettled(promises);
}

/**
 * Test webhook
 */
export async function testWebhook(
  supabase: SupabaseClient,
  webhookId: number
): Promise<boolean> {
  const testPayload = {
    event: 'webhook.test',
    timestamp: Date.now(),
    message: 'This is a test webhook delivery from CortexBuild'
  };

  return await triggerWebhook(supabase, webhookId, 'webhook.test', testPayload);
}

/**
 * Retry failed webhook delivery
 */
export async function retryWebhookDelivery(
  supabase: SupabaseClient,
  logId: number
): Promise<boolean> {
  const { data: log, error } = await supabase
    .from('webhook_logs')
    .select('*')
    .eq('id', logId)
    .single();

  if (error) throw error;
  if (!log) throw new Error('Webhook log not found');

  const payload = JSON.parse(log.payload);
  return await triggerWebhook(supabase, log.webhook_id, log.event_type, payload);
}

/**
 * Verify webhook signature (for incoming webhooks from third parties)
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = generateSignature(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
