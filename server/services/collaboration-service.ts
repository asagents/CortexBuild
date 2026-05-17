/**
 * Collaboration Service
 * Handles real-time collaboration features for developers
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

export interface CollaborationSession {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  created_by: string;
  is_active: boolean;
  participants: string[];
  settings: any;
  created_at: string;
  updated_at: string;
}

export interface CollaborationEvent {
  id: string;
  session_id: string;
  user_id: string;
  event_type: 'join' | 'leave' | 'cursor_move' | 'code_edit' | 'comment' | 'file_open' | 'file_close';
  event_data: any;
  created_at: string;
}

export interface CodeComment {
  id: string;
  session_id: string;
  file_path: string;
  line_number: number;
  column_start: number;
  column_end: number;
  content: string;
  author_id: string;
  is_resolved: boolean;
  created_at: string;
  updated_at: string;
}

export interface LiveCursor {
  id: string;
  session_id: string;
  user_id: string;
  file_path: string;
  line_number: number;
  column: number;
  color: string;
  user_name: string;
  updated_at: string;
}

export class CollaborationService {
  constructor(private supabase: SupabaseClient) {}

  async createSession(
    workspaceId: string,
    name: string,
    description: string,
    createdBy: string,
    settings: any = {}
  ): Promise<CollaborationSession> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('collaboration_sessions')
      .insert({
        id,
        workspace_id: workspaceId,
        name,
        description,
        created_by: createdBy,
        participants: JSON.stringify([createdBy]),
        settings: JSON.stringify(settings),
        is_active: true,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapSession(data);
  }

  async getSession(id: string): Promise<CollaborationSession | null> {
    const { data, error } = await this.supabase
      .from('collaboration_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    return this.mapSession(data);
  }

  async joinSession(sessionId: string, userId: string): Promise<CollaborationSession | null> {
    const session = await this.getSession(sessionId);
    if (!session || !session.is_active) return null;

    const participants = new Set(session.participants);
    participants.add(userId);

    const { data, error } = await this.supabase
      .from('collaboration_sessions')
      .update({
        participants: JSON.stringify([...participants]),
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) throw error;

    await this.logEvent(sessionId, userId, 'join', { message: 'User joined session' });
    return data ? this.mapSession(data) : null;
  }

  async leaveSession(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) return false;

    const participants = new Set(session.participants);
    participants.delete(userId);

    const { error } = await this.supabase
      .from('collaboration_sessions')
      .update({
        participants: JSON.stringify([...participants]),
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    if (error) throw error;

    await this.logEvent(sessionId, userId, 'leave', { message: 'User left session' });
    return true;
  }

  async logEvent(
    sessionId: string,
    userId: string,
    eventType: CollaborationEvent['event_type'],
    eventData: any
  ): Promise<CollaborationEvent> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('collaboration_events')
      .insert({
        id,
        session_id: sessionId,
        user_id: userId,
        event_type: eventType,
        event_data: JSON.stringify(eventData),
        created_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapEvent(data);
  }

  async getEvent(id: string): Promise<CollaborationEvent | null> {
    const { data, error } = await this.supabase
      .from('collaboration_events')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    return this.mapEvent(data);
  }

  async getSessionEvents(sessionId: string, limit: number = 50): Promise<CollaborationEvent[]> {
    const { data, error } = await this.supabase
      .from('collaboration_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data || []).map((e: any) => this.mapEvent(e));
  }

  async addCodeComment(
    sessionId: string,
    filePath: string,
    lineNumber: number,
    columnStart: number,
    columnEnd: number,
    content: string,
    authorId: string
  ): Promise<CodeComment> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('code_comments')
      .insert({
        id,
        session_id: sessionId,
        file_path: filePath,
        line_number: lineNumber,
        column_start: columnStart,
        column_end: columnEnd,
        content,
        author_id: authorId,
        is_resolved: false,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapComment(data);
  }

  async getCodeComment(id: string): Promise<CodeComment | null> {
    const { data, error } = await this.supabase
      .from('code_comments')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    return this.mapComment(data);
  }

  async getFileComments(sessionId: string, filePath: string): Promise<CodeComment[]> {
    const { data, error } = await this.supabase
      .from('code_comments')
      .select('*')
      .eq('session_id', sessionId)
      .eq('file_path', filePath)
      .order('line_number', { ascending: true })
      .order('column_start', { ascending: true });

    if (error) throw error;
    return (data || []).map((c: any) => this.mapComment(c));
  }

  async updateLiveCursor(
    sessionId: string,
    userId: string,
    filePath: string,
    lineNumber: number,
    column: number,
    color: string,
    userName: string
  ): Promise<LiveCursor> {
    const id = uuidv4();
    const now = new Date().toISOString();

    await this.supabase
      .from('live_cursors')
      .delete()
      .eq('session_id', sessionId)
      .eq('user_id', userId);

    const { data, error } = await this.supabase
      .from('live_cursors')
      .insert({
        id,
        session_id: sessionId,
        user_id: userId,
        file_path: filePath,
        line_number: lineNumber,
        column,
        color,
        user_name: userName,
        updated_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return data as LiveCursor;
  }

  async getLiveCursor(id: string): Promise<LiveCursor | null> {
    const { data, error } = await this.supabase
      .from('live_cursors')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data as LiveCursor | null;
  }

  async getLiveCursors(sessionId: string): Promise<LiveCursor[]> {
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
    const { data, error } = await this.supabase
      .from('live_cursors')
      .select('*')
      .eq('session_id', sessionId)
      .gte('updated_at', fiveSecondsAgo);

    if (error) throw error;
    return (data || []) as LiveCursor[];
  }

  async cleanupOldCursors(): Promise<number> {
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
    const { error } = await this.supabase
      .from('live_cursors')
      .delete()
      .lt('updated_at', fiveSecondsAgo);

    if (error) throw error;
    return 0; // Supabase delete does not return row count easily without count option
  }

  private mapSession(row: any): CollaborationSession {
    return {
      ...row,
      is_active: Boolean(row.is_active),
      participants: typeof row.participants === 'string' ? JSON.parse(row.participants || '[]') : (row.participants || []),
      settings: typeof row.settings === 'string' ? JSON.parse(row.settings || '{}') : (row.settings || {})
    };
  }

  private mapEvent(row: any): CollaborationEvent {
    return {
      ...row,
      event_data: typeof row.event_data === 'string' ? JSON.parse(row.event_data || '{}') : (row.event_data || {})
    };
  }

  private mapComment(row: any): CodeComment {
    return {
      ...row,
      is_resolved: Boolean(row.is_resolved)
    };
  }

  static initTables(supabase: SupabaseClient): void {
    console.log('✅ Collaboration tables managed via Supabase (initTables is a no-op at runtime)');
  }
}

export const createCollaborationService = (supabase: SupabaseClient): CollaborationService => {
  return new CollaborationService(supabase);
};
