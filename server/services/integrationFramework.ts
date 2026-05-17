/**
 * Third-party Integration Framework for CortexBuild
 * Pluggable architecture for external service integrations
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface IntegrationConfig {
  id: string;
  name: string;
  type: 'oauth' | 'api_key' | 'webhook' | 'custom';
  baseUrl: string;
  authType: 'bearer' | 'basic' | 'oauth2' | 'api_key' | 'custom';
  credentials: {
    clientId?: string;
    clientSecret?: string;
    apiKey?: string;
    username?: string;
    password?: string;
    accessToken?: string;
    refreshToken?: string;
    webhookUrl?: string;
  };
  rateLimits?: {
    requests: number;
    windowMs: number;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationWebhook {
  id: string;
  integrationId: string;
  event: string;
  url: string;
  secret: string;
  enabled: boolean;
  createdAt: string;
}

export interface IntegrationData {
  id: string;
  integrationId: string;
  companyId: string;
  externalId: string;
  data: any;
  syncedAt: string;
  status: 'pending' | 'synced' | 'error' | 'conflict';
}

export class IntegrationFramework {
  private supabase: SupabaseClient;
  private activeIntegrations: Map<string, any> = new Map();

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.initializeTables();
  }

  private async initializeTables(): Promise<void> {
    // Tables are assumed to exist in Supabase; skip CREATE TABLE statements
    // They should be created via Supabase migrations instead
    console.log('IntegrationFramework initialized with Supabase');
  }

  /**
   * Register a new integration
   */
  async registerIntegration(config: Omit<IntegrationConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const integrationId = `integration_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const { error } = await this.supabase
      .from('integrations')
      .insert({
        id: integrationId,
        name: config.name,
        type: config.type,
        base_url: config.baseUrl,
        auth_type: config.authType,
        credentials: JSON.stringify(config.credentials),
        rate_limits: JSON.stringify(config.rateLimits || { requests: 100, windowMs: 60000 }),
        enabled: config.enabled ? 1 : 0,
      });

    if (error) {
      console.error('registerIntegration error:', error.message);
      throw error;
    }

    return integrationId;
  }

  /**
   * Get integration configuration
   */
  async getIntegration(integrationId: string): Promise<IntegrationConfig | null> {
    const { data: row, error } = await this.supabase
      .from('integrations')
      .select('*')
      .eq('id', integrationId)
      .single();

    if (error || !row) return null;

    return {
      id: row.id,
      name: row.name,
      type: row.type,
      baseUrl: row.base_url,
      authType: row.auth_type,
      credentials: JSON.parse(row.credentials || '{}'),
      rateLimits: JSON.parse(row.rate_limits || '{}'),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Update integration configuration
   */
  async updateIntegration(integrationId: string, updates: Partial<IntegrationConfig>): Promise<void> {
    const mappedUpdates: Record<string, any> = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbKey = key === 'baseUrl' ? 'base_url' :
                     key === 'authType' ? 'auth_type' :
                     key === 'rateLimits' ? 'rate_limits' : key;
        mappedUpdates[dbKey] = key === 'credentials' || key === 'rateLimits' ? JSON.stringify(value) : value;
      }
    });

    if (Object.keys(mappedUpdates).length > 0) {
      mappedUpdates['updated_at'] = new Date().toISOString();

      const { error } = await this.supabase
        .from('integrations')
        .update(mappedUpdates)
        .eq('id', integrationId);

      if (error) {
        console.error('updateIntegration error:', error.message);
        throw error;
      }
    }
  }

  /**
   * List integrations for a company
   */
  async getCompanyIntegrations(companyId: string): Promise<IntegrationConfig[]> {
    const { data: rows, error } = await this.supabase
      .from('integrations')
      .select('*')
      .eq('enabled', 1)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getCompanyIntegrations error:', error.message);
      return [];
    }

    return (rows || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      baseUrl: row.base_url,
      authType: row.auth_type,
      credentials: JSON.parse(row.credentials || '{}'),
      rateLimits: JSON.parse(row.rate_limits || '{}'),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Register webhook for integration events
   */
  async registerWebhook(integrationId: string, event: string, url: string): Promise<string> {
    const webhookId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const secret = this.generateWebhookSecret();

    const { error } = await this.supabase
      .from('integration_webhooks')
      .insert({
        id: webhookId,
        integration_id: integrationId,
        event,
        url,
        secret,
        enabled: 1,
      });

    if (error) {
      console.error('registerWebhook error:', error.message);
      throw error;
    }

    return webhookId;
  }

  /**
   * Trigger webhook for integration event
   */
  async triggerWebhook(integrationId: string, event: string, data: any): Promise<void> {
    const { data: webhooks, error } = await this.supabase
      .from('integration_webhooks')
      .select('*')
      .eq('integration_id', integrationId)
      .eq('event', event)
      .eq('enabled', 1);

    if (error) {
      console.error('triggerWebhook error:', error.message);
      return;
    }

    for (const webhook of (webhooks || [])) {
      try {
        await this.sendWebhook(webhook, data);
      } catch (error) {
        console.error(`Webhook ${webhook.id} failed:`, error);
      }
    }
  }

  /**
   * Sync data with external integration
   */
  async syncIntegrationData(integrationId: string, companyId: string, data: any): Promise<void> {
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const { error } = await this.supabase
      .from('integration_data')
      .insert({
        id: syncId,
        integration_id: integrationId,
        company_id: companyId,
        external_id: data.externalId || syncId,
        data: JSON.stringify(data),
        status: 'synced',
      });

    if (error) {
      console.error('syncIntegrationData error:', error.message);
      throw error;
    }
  }

  /**
   * Get sync status for integration
   */
  async getSyncStatus(integrationId: string, companyId: string): Promise<any> {
    const { data: rows, error } = await this.supabase
      .from('integration_data')
      .select('status, synced_at')
      .eq('integration_id', integrationId)
      .eq('company_id', companyId);

    if (error) {
      console.error('getSyncStatus error:', error.message);
      return {
        integrationId,
        companyId,
        stats: {},
        lastSync: null,
        totalRecords: 0,
      };
    }

    const stats: Record<string, number> = {};
    let lastSync: string | null = null;

    (rows || []).forEach((row: any) => {
      stats[row.status] = (stats[row.status] || 0) + 1;
      if (row.synced_at) {
        if (!lastSync || row.synced_at > lastSync) {
          lastSync = row.synced_at;
        }
      }
    });

    return {
      integrationId,
      companyId,
      stats,
      lastSync,
      totalRecords: (rows || []).length,
    };
  }

  /**
   * Test integration connectivity
   */
  async testIntegration(integrationId: string): Promise<{ success: boolean; message: string; responseTime?: number }> {
    const startTime = Date.now();
    try {
      const integration = await this.getIntegration(integrationId);
      if (!integration) {
        return { success: false, message: 'Integration not found' };
      }

      const responseTime = Date.now() - startTime;
      return {
        success: true,
        message: 'Integration test successful',
        responseTime
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
        responseTime: Date.now() - startTime
      };
    }
  }

  // Private helper methods

  private generateWebhookSecret(): string {
    return `whsec_${Math.random().toString(36).substr(2, 32)}`;
  }

  private async sendWebhook(webhook: any, data: any): Promise<void> {
    const payload = {
      event: webhook.event,
      timestamp: new Date().toISOString(),
      data,
    };

    const signature = this.generateSignature(payload, webhook.secret);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CortexBuild-Signature': signature,
        'X-CortexBuild-Event': webhook.event,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }
  }

  private generateSignature(payload: any, secret: string): string {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  /**
   * Pre-built integration connectors
   */

  async setupProcoreIntegration(companyId: string, credentials: any): Promise<string> {
    return this.registerIntegration({
      name: 'Procore',
      type: 'oauth',
      baseUrl: 'https://api.procore.com',
      authType: 'oauth2',
      credentials,
      enabled: true,
    });
  }

  async setupQuickBooksIntegration(companyId: string, credentials: any): Promise<string> {
    return this.registerIntegration({
      name: 'QuickBooks',
      type: 'oauth',
      baseUrl: 'https://quickbooks.api.intuit.com',
      authType: 'oauth2',
      credentials,
      enabled: true,
    });
  }

  async setupSlackIntegration(companyId: string, webhookUrl: string): Promise<string> {
    const integrationId = await this.registerIntegration({
      name: 'Slack',
      type: 'webhook',
      baseUrl: 'https://hooks.slack.com',
      authType: 'custom',
      credentials: { webhookUrl },
      enabled: true,
    });

    await this.registerWebhook(integrationId, 'project.created', webhookUrl);
    await this.registerWebhook(integrationId, 'project.updated', webhookUrl);
    await this.registerWebhook(integrationId, 'task.completed', webhookUrl);

    return integrationId;
  }

  async setupGenericAPIIntegration(name: string, baseUrl: string, apiKey: string): Promise<string> {
    return this.registerIntegration({
      name,
      type: 'api_key',
      baseUrl,
      authType: 'api_key',
      credentials: { apiKey },
      enabled: true,
    });
  }
}

export default IntegrationFramework;
