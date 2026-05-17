/**
 * Activity Logger Utility
 * Safe wrapper for logging activities to the database
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

export interface ActivityLogParams {
  user_id: string;
  action: string;
  description: string;
  company_id?: string;
  project_id?: number | string;
  entity_type?: string;
  entity_id?: string | number;
  metadata?: any;
}

/**
 * Safely log an activity to the database
 * Returns true if successful, false if failed
 */
export async function logActivity(supabase: SupabaseClient, params: ActivityLogParams): Promise<boolean> {
  try {
    const {
      user_id,
      action,
      description,
      company_id,
      project_id,
      entity_type,
      entity_id,
      metadata
    } = params;

    // Validate required fields
    if (!user_id || !action || !description) {
      console.warn('[Activity Logger] Missing required fields:', { user_id, action, description });
      return false;
    }

    // Prepare metadata as JSON string if provided
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const { error } = await supabase
      .from('activities')
      .insert({
        id: uuidv4(),
        user_id,
        company_id: company_id || null,
        project_id: project_id ? String(project_id) : null,
        action,
        description,
        entity_type: entity_type || null,
        entity_id: entity_id ? String(entity_id) : null,
        metadata: metadataJson,
      });

    if (error) {
      console.warn('[Activity Logger] Failed to log activity:', error.message);
      return false;
    }

    return true;
  } catch (error: any) {
    console.warn('[Activity Logger] Failed to log activity:', error.message);
    return false;
  }
}

/**
 * Log a project-related activity
 */
export async function logProjectActivity(
  supabase: SupabaseClient,
  user_id: string,
  project_id: number | string,
  action: string,
  description: string
): Promise<boolean> {
  return logActivity(supabase, {
    user_id,
    project_id,
    entity_type: 'project',
    entity_id: String(project_id),
    action,
    description
  });
}

/**
 * Log a user-related activity
 */
export async function logUserActivity(
  supabase: SupabaseClient,
  user_id: string,
  action: string,
  description: string
): Promise<boolean> {
  return logActivity(supabase, {
    user_id,
    action,
    description,
    entity_type: 'user',
    entity_id: user_id
  });
}

/**
 * Log a company-related activity
 */
export async function logCompanyActivity(
  supabase: SupabaseClient,
  user_id: string,
  company_id: string,
  action: string,
  description: string
): Promise<boolean> {
  return logActivity(supabase, {
    user_id,
    company_id,
    action,
    description,
    entity_type: 'company',
    entity_id: company_id
  });
}

