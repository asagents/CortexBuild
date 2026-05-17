// CortexBuild Integrations Service
// Handles third-party integrations: QuickBooks, Slack, Google Drive, etc.

import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import httpClient, { HTTPError } from '../utils/httpClient';

export interface Integration {
  id: number;
  user_id: string;
  company_id: string;
  provider: string;
  name: string;
  credentials: string;
  config?: string;
  is_active: boolean;
  last_sync_at?: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
}

// Supported integration providers
export const INTEGRATION_PROVIDERS = {
  QUICKBOOKS: 'quickbooks',
  SLACK: 'slack',
  GOOGLE_DRIVE: 'google_drive',
  DROPBOX: 'dropbox',
  XERO: 'xero',
  STRIPE: 'stripe',
  MAILCHIMP: 'mailchimp',
  ZAPIER: 'zapier',
  GITHUB: 'github',
  JIRA: 'jira'
};

// Encryption key for credentials (should be in env)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'cortexbuild-encryption-key-2025-change-this';

/**
 * Encrypt sensitive data
 */
export function encryptData(data: string): string {
  const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

/**
 * Decrypt sensitive data
 */
export function decryptData(encrypted: string): string {
  const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Create a new integration
 */
export async function createIntegration(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
  provider: string,
  name: string,
  credentials: any,
  config?: any
): Promise<Integration | null> {
  const encryptedCreds = encryptData(JSON.stringify(credentials));
  const configStr = config ? JSON.stringify(config) : null;

  const { data, error } = await supabase
    .from('integrations')
    .insert({
      user_id: userId,
      company_id: companyId,
      provider,
      name,
      credentials: encryptedCreds,
      config: configStr,
      is_active: true,
      sync_status: 'idle',
    })
    .select()
    .single();

  if (error) {
    console.error('createIntegration error:', error.message);
    return null;
  }

  return data as Integration;
}

/**
 * Get integration by ID
 */
export async function getIntegration(supabase: SupabaseClient, integrationId: number): Promise<Integration | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('id', integrationId)
    .single();

  if (error) {
    console.error('getIntegration error:', error.message);
    return null;
  }

  return data as Integration;
}

/**
 * Get all integrations for a user
 */
export async function getUserIntegrations(supabase: SupabaseClient, userId: string): Promise<Integration[]> {
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getUserIntegrations error:', error.message);
    return [];
  }

  return (data || []) as Integration[];
}

/**
 * Get all integrations for a company
 */
export async function getCompanyIntegrations(supabase: SupabaseClient, companyId: string): Promise<Integration[]> {
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getCompanyIntegrations error:', error.message);
    return [];
  }

  return (data || []) as Integration[];
}

/**
 * Update integration status
 */
export async function updateIntegrationStatus(
  supabase: SupabaseClient,
  integrationId: number,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from('integrations')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', integrationId);

  if (error) {
    console.error('updateIntegrationStatus error:', error.message);
  }
}

/**
 * Update sync status
 */
export async function updateSyncStatus(
  supabase: SupabaseClient,
  integrationId: number,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from('integrations')
    .update({ sync_status: status, last_sync_at: new Date().toISOString() })
    .eq('id', integrationId);

  if (error) {
    console.error('updateSyncStatus error:', error.message);
  }
}

/**
 * Delete integration
 */
export async function deleteIntegration(supabase: SupabaseClient, integrationId: number): Promise<void> {
  const { error } = await supabase
    .from('integrations')
    .delete()
    .eq('id', integrationId);

  if (error) {
    console.error('deleteIntegration error:', error.message);
  }
}

/**
 * Store OAuth tokens
 */
export async function storeOAuthTokens(
  supabase: SupabaseClient,
  integrationId: number,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number,
  scope?: string
): Promise<void> {
  const encryptedAccess = encryptData(accessToken);
  const encryptedRefresh = refreshToken ? encryptData(refreshToken) : null;
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  // Delete existing tokens
  await supabase
    .from('oauth_tokens')
    .delete()
    .eq('integration_id', integrationId);

  // Insert new tokens
  const { error } = await supabase
    .from('oauth_tokens')
    .insert({
      integration_id: integrationId,
      access_token: encryptedAccess,
      refresh_token: encryptedRefresh,
      expires_at: expiresAt,
      scope,
    });

  if (error) {
    console.error('storeOAuthTokens error:', error.message);
  }
}

/**
 * Get OAuth tokens
 */
export async function getOAuthTokens(supabase: SupabaseClient, integrationId: number): Promise<any> {
  const { data: tokens, error } = await supabase
    .from('oauth_tokens')
    .select('*')
    .eq('integration_id', integrationId)
    .single();

  if (error || !tokens) return null;

  return {
    accessToken: decryptData(tokens.access_token),
    refreshToken: tokens.refresh_token ? decryptData(tokens.refresh_token) : null,
    expiresAt: tokens.expires_at,
    scope: tokens.scope
  };
}

/**
 * QuickBooks Integration
 */
export class QuickBooksIntegration {
  private supabase: SupabaseClient;
  private integrationId: number;
  private credentials: any;

  constructor(supabase: SupabaseClient, integrationId: number) {
    this.supabase = supabase;
    this.integrationId = integrationId;
  }

  async loadCredentials(): Promise<void> {
    const integration = await getIntegration(this.supabase, this.integrationId);
    if (!integration) throw new Error('Integration not found');
    this.credentials = JSON.parse(decryptData(integration.credentials));
  }

  async syncInvoices(): Promise<void> {
    await updateSyncStatus(this.supabase, this.integrationId, 'syncing');
    try {
      const tokens = await getOAuthTokens(this.supabase, this.integrationId);
      // Implementation for QuickBooks invoice sync
      await updateSyncStatus(this.supabase, this.integrationId, 'success');
    } catch (error) {
      console.error('QuickBooks sync error:', error);
      await updateSyncStatus(this.supabase, this.integrationId, 'error');
      throw error;
    }
  }

  async createInvoice(invoiceData: any): Promise<void> {
    await this.loadCredentials();
    const tokens = await getOAuthTokens(this.supabase, this.integrationId);
    // Implementation for creating invoice in QuickBooks
  }

  async syncClients(): Promise<void> {
    await this.loadCredentials();
    const tokens = await getOAuthTokens(this.supabase, this.integrationId);
    // Implementation for syncing clients from QuickBooks
  }
}

/**
 * Slack Integration
 */
export class SlackIntegration {
  private supabase: SupabaseClient;
  private integrationId: number;
  private credentials: any;

  constructor(supabase: SupabaseClient, integrationId: number) {
    this.supabase = supabase;
    this.integrationId = integrationId;
  }

  async loadCredentials(): Promise<void> {
    const integration = await getIntegration(this.supabase, this.integrationId);
    if (!integration) throw new Error('Integration not found');
    this.credentials = JSON.parse(decryptData(integration.credentials));
  }

  async sendMessage(channel: string, message: string): Promise<void> {
    await this.loadCredentials();
    const tokens = await getOAuthTokens(this.supabase, this.integrationId);

    try {
      await httpClient.post('https://slack.com/api/chat.postMessage', {
        channel,
        text: message
      }, {
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json'
        },
        customTimeout: 15000
      });
    } catch (error) {
      console.error('Slack message error:', error);
      if (error instanceof Error && 'code' in error) {
        const httpError = error as HTTPError;
        throw new Error(`Slack integration failed: ${httpError.message}`);
      }
      throw error;
    }
  }

  async notifyProjectUpdate(projectName: string, status: string): Promise<void> {
    await this.loadCredentials();
    const message = `🏗️ Project Update: *${projectName}* status changed to *${status}*`;
    await this.sendMessage(this.credentials.defaultChannel || '#general', message);
  }

  async notifyRFI(rfiNumber: string, subject: string): Promise<void> {
    await this.loadCredentials();
    const message = `📋 New RFI: *${rfiNumber}* - ${subject}`;
    await this.sendMessage(this.credentials.defaultChannel || '#rfis', message);
  }
}

/**
 * Google Drive Integration
 */
export class GoogleDriveIntegration {
  private supabase: SupabaseClient;
  private integrationId: number;
  private credentials: any;

  constructor(supabase: SupabaseClient, integrationId: number) {
    this.supabase = supabase;
    this.integrationId = integrationId;
  }

  async loadCredentials(): Promise<void> {
    const integration = await getIntegration(this.supabase, this.integrationId);
    if (!integration) throw new Error('Integration not found');
    this.credentials = JSON.parse(decryptData(integration.credentials));
  }

  async uploadDocument(fileName: string, fileData: Buffer, folderId?: string): Promise<string> {
    await this.loadCredentials();
    const tokens = await getOAuthTokens(this.supabase, this.integrationId);
    let fileId = 'file-id';

    try {
      // Implementation for Google Drive upload would go here
      fileId = 'file-id';
    } catch (error) {
      console.error('Google Drive upload error:', error);
      throw error;
    }

    return fileId;
  }

  async syncDocuments(): Promise<void> {
    await updateSyncStatus(this.supabase, this.integrationId, 'syncing');
    try {
      await this.loadCredentials();
      const tokens = await getOAuthTokens(this.supabase, this.integrationId);
      // Implementation for syncing documents from Google Drive
      await updateSyncStatus(this.supabase, this.integrationId, 'success');
    } catch (error) {
      console.error('Google Drive sync error:', error);
      await updateSyncStatus(this.supabase, this.integrationId, 'error');
      throw error;
    }
  }
}

/**
 * Get integration instance by type
 */
export async function getIntegrationInstance(supabase: SupabaseClient, integrationId: number): Promise<any> {
  const integration = await getIntegration(supabase, integrationId);

  if (!integration) {
    throw new Error(`Integration ${integrationId} not found`);
  }

  switch (integration.provider) {
    case INTEGRATION_PROVIDERS.QUICKBOOKS:
      return new QuickBooksIntegration(supabase, integrationId);
    case INTEGRATION_PROVIDERS.SLACK:
      return new SlackIntegration(supabase, integrationId);
    case INTEGRATION_PROVIDERS.GOOGLE_DRIVE:
      return new GoogleDriveIntegration(supabase, integrationId);
    default:
      throw new Error(`Unsupported integration provider: ${integration.provider}`);
  }
}
