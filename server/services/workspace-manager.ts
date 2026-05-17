/**
 * Workspace Manager Service
 * Handles developer workspaces, collaboration, and project management
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

export interface Workspace {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  is_public: boolean;
  settings: any;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  permissions: string[];
  joined_at: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  template_data: any;
  created_by: string;
  is_public: boolean;
  created_at: string;
}

export class WorkspaceManager {
  constructor(private supabase: SupabaseClient) {}

  async createWorkspace(
    name: string,
    description: string,
    ownerId: string,
    isPublic: boolean = false,
    settings: any = {}
  ): Promise<Workspace> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('workspaces')
      .insert({
        id,
        name,
        description,
        owner_id: ownerId,
        is_public: isPublic,
        settings: JSON.stringify(settings),
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) throw error;
    if (!data) throw new Error('Failed to create workspace');
    return this.mapWorkspace(data);
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    return this.mapWorkspace(data);
  }

  async updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace | null> {
    const workspace = await this.getWorkspace(id);
    if (!workspace) return null;

    const patch: any = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.is_public !== undefined) patch.is_public = updates.is_public;
    if (updates.settings !== undefined) patch.settings = JSON.stringify(updates.settings);

    const { data, error } = await this.supabase
      .from('workspaces')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return null;
    return this.mapWorkspace(data);
  }

  async deleteWorkspace(id: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('workspaces')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  }

  async addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceMember['role'] = 'member',
    permissions: string[] = []
  ): Promise<WorkspaceMember> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('workspace_members')
      .insert({
        id,
        workspace_id: workspaceId,
        user_id: userId,
        role,
        permissions: JSON.stringify(permissions),
        joined_at: now
      })
      .select()
      .single();

    if (error) throw error;
    if (!data) throw new Error('Failed to add workspace member');
    return this.mapMember(data);
  }

  async getWorkspaceMember(id: string): Promise<WorkspaceMember | null> {
    const { data, error } = await this.supabase
      .from('workspace_members')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    return this.mapMember(data);
  }

  async getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const { data, error } = await this.supabase
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('joined_at');

    if (error) throw error;
    return (data || []).map((m: any) => this.mapMember(m));
  }

  async updateMemberRole(memberId: string, role: WorkspaceMember['role']): Promise<WorkspaceMember | null> {
    const { data, error } = await this.supabase
      .from('workspace_members')
      .update({ role })
      .eq('id', memberId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return null;
    return this.mapMember(data);
  }

  async removeWorkspaceMember(memberId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('workspace_members')
      .delete()
      .eq('id', memberId);

    if (error) throw error;
    return true;
  }

  async createProjectTemplate(
    name: string,
    description: string,
    category: string,
    templateData: any,
    createdBy: string,
    isPublic: boolean = false
  ): Promise<ProjectTemplate> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('project_templates')
      .insert({
        id,
        name,
        description,
        category,
        template_data: JSON.stringify(templateData),
        created_by: createdBy,
        is_public: isPublic,
        created_at: now
      })
      .select()
      .single();

    if (error) throw error;
    if (!data) throw new Error('Failed to create project template');
    return this.mapTemplate(data);
  }

  async getProjectTemplate(id: string): Promise<ProjectTemplate | null> {
    const { data, error } = await this.supabase
      .from('project_templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    return this.mapTemplate(data);
  }

  async getProjectTemplates(category?: string): Promise<ProjectTemplate[]> {
    let query = this.supabase
      .from('project_templates')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((t: any) => this.mapTemplate(t));
  }

  private mapWorkspace(row: any): Workspace {
    return {
      ...row,
      is_public: Boolean(row.is_public),
      settings: typeof row.settings === 'string' ? JSON.parse(row.settings || '{}') : (row.settings || {})
    };
  }

  private mapMember(row: any): WorkspaceMember {
    return {
      ...row,
      permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions || '[]') : (row.permissions || [])
    };
  }

  private mapTemplate(row: any): ProjectTemplate {
    return {
      ...row,
      is_public: Boolean(row.is_public),
      template_data: typeof row.template_data === 'string' ? JSON.parse(row.template_data || '{}') : (row.template_data || {})
    };
  }

  static async initTables(supabase: SupabaseClient): Promise<void> {
    // Tables should be managed via Supabase migrations; this is a no-op for runtime.
    console.log('✅ Workspace tables managed via Supabase (initTables is a no-op at runtime)');
  }
}

export const createWorkspaceManager = (supabase: SupabaseClient): WorkspaceManager => {
  return new WorkspaceManager(supabase);
};
