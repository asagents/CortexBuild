/**
 * MCP (Model Context Protocol) Service
 *
 * Provides enhanced AI context management for better multi-turn conversations,
 * context persistence, and intelligent context retrieval.
 * Migrated to Supabase.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// MCP Context Types
export interface MCPContext {
  id: string;
  user_id: string;
  session_id: string;
  context_type: 'developer' | 'project' | 'code' | 'conversation';
  context_data: any;
  metadata: {
    created_at: string;
    updated_at: string;
    expires_at?: string;
    tags?: string[];
    relevance_score?: number;
  };
}

export interface MCPMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
  context_refs?: string[];
}

export interface MCPSession {
  session_id: string;
  user_id: string;
  messages: MCPMessage[];
  active_contexts: string[];
  created_at: string;
  last_activity: string;
}

/**
 * Initialize MCP tables in database (legacy noop for Supabase)
 */
export function initializeMCPTables(_supabase: SupabaseClient): void {
  console.log('✅ MCP tables initialized (Supabase)');
}

/**
 * Create a new MCP session
 */
export async function createMCPSession(
  supabase: SupabaseClient,
  userId: string,
  contextType: string = 'conversation'
): Promise<string> {
  const sessionId = `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('mcp_sessions')
    .insert({
      session_id: sessionId,
      user_id: userId,
      context_type: contextType,
      active_contexts: JSON.stringify([]),
      expires_at: expiresAt,
      last_activity: new Date().toISOString()
    });

  if (error) throw error;

  return sessionId;
}

/**
 * Get or create MCP session
 */
export async function getOrCreateSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId?: string
): Promise<string> {
  if (sessionId) {
    const { data: session, error } = await supabase
      .from('mcp_sessions')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!error && session) {
      await supabase
        .from('mcp_sessions')
        .update({ last_activity: new Date().toISOString() })
        .eq('session_id', sessionId);
      return sessionId;
    }
  }

  return createMCPSession(supabase, userId);
}

/**
 * Add context to MCP session
 */
export async function addContext(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  contextType: string,
  contextData: any,
  metadata: any = {}
): Promise<string> {
  const contextId = `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error: insertError } = await supabase
    .from('mcp_contexts')
    .insert({
      id: contextId,
      session_id: sessionId,
      user_id: userId,
      context_type: contextType,
      context_data: JSON.stringify(contextData),
      metadata: JSON.stringify(metadata),
      expires_at: expiresAt
    });

  if (insertError) throw insertError;

  // Update session's active contexts
  const { data: session } = await supabase
    .from('mcp_sessions')
    .select('active_contexts')
    .eq('session_id', sessionId)
    .single();

  if (session) {
    const activeContexts = JSON.parse(session.active_contexts || '[]');
    activeContexts.push(contextId);

    await supabase
      .from('mcp_sessions')
      .update({ active_contexts: JSON.stringify(activeContexts) })
      .eq('session_id', sessionId);
  }

  return contextId;
}

/**
 * Add message to MCP session
 */
export async function addMessage(
  supabase: SupabaseClient,
  sessionId: string,
  role: 'system' | 'user' | 'assistant',
  content: string,
  contextRefs: string[] = []
): Promise<void> {
  const { error: insertError } = await supabase
    .from('mcp_messages')
    .insert({
      session_id: sessionId,
      role,
      content,
      context_refs: JSON.stringify(contextRefs)
    });

  if (insertError) throw insertError;

  // Update session last activity
  await supabase
    .from('mcp_sessions')
    .update({ last_activity: new Date().toISOString() })
    .eq('session_id', sessionId);
}

/**
 * Get session messages with context
 */
export async function getSessionMessages(
  supabase: SupabaseClient,
  sessionId: string,
  limit: number = 50
): Promise<MCPMessage[]> {
  const { data: messages, error } = await supabase
    .from('mcp_messages')
    .select('role, content, context_refs, timestamp')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (messages || []).reverse().map((msg: any) => ({
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    context_refs: JSON.parse(msg.context_refs || '[]')
  }));
}

/**
 * Get relevant contexts for a session
 */
export async function getRelevantContexts(
  supabase: SupabaseClient,
  sessionId: string,
  contextType?: string
): Promise<MCPContext[]> {
  let query = supabase
    .from('mcp_contexts')
    .select('id, user_id, session_id, context_type, context_data, metadata, relevance_score, created_at')
    .eq('session_id', sessionId)
    .gt('expires_at', new Date().toISOString());

  if (contextType) {
    query = query.eq('context_type', contextType);
  }

  const { data: contexts, error } = await query
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (contexts || []).map((ctx: any) => ({
    id: ctx.id,
    user_id: ctx.user_id,
    session_id: ctx.session_id,
    context_type: ctx.context_type,
    context_data: JSON.parse(ctx.context_data),
    metadata: JSON.parse(ctx.metadata || '{}')
  }));
}

/**
 * Build enhanced prompt with MCP context
 */
export async function buildEnhancedPrompt(
  supabase: SupabaseClient,
  sessionId: string,
  userMessage: string,
  systemPrompt?: string
): Promise<{ messages: any[]; contexts: MCPContext[] }> {
  const messages = await getSessionMessages(supabase, sessionId, 10);
  const contexts = await getRelevantContexts(supabase, sessionId);

  const contextSummary = contexts
    .map((ctx) => `[${ctx.context_type}]: ${JSON.stringify(ctx.context_data)}`)
    .join('\n');

  const enhancedMessages: any[] = [];

  if (systemPrompt || contextSummary) {
    enhancedMessages.push({
      role: 'system',
      content: `${systemPrompt || ''}\n\nRelevant Context:\n${contextSummary}`
    });
  }

  messages.forEach((msg) => {
    enhancedMessages.push({
      role: msg.role,
      content: msg.content
    });
  });

  enhancedMessages.push({
    role: 'user',
    content: userMessage
  });

  return { messages: enhancedMessages, contexts };
}

/**
 * Clean up expired sessions and contexts
 */
export async function cleanupExpiredSessions(supabase: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();

  await supabase.from('mcp_contexts').delete().lte('expires_at', now);
  await supabase.from('mcp_sessions').delete().lte('expires_at', now);

  console.log('✅ MCP cleanup completed');
}

/**
 * Get session statistics
 */
export async function getSessionStats(supabase: SupabaseClient, userId: string): Promise<any> {
  const { data: sessions, error: sessionsError } = await supabase
    .from('mcp_sessions')
    .select('session_id, last_activity')
    .eq('user_id', userId);

  if (sessionsError) throw sessionsError;

  const sessionIds = (sessions || []).map((s: any) => s.session_id);

  let totalMessages = 0;
  let lastActivity = null;

  if (sessionIds.length > 0) {
    const { data: messages, error: messagesError } = await supabase
      .from('mcp_messages')
      .select('timestamp')
      .in('session_id', sessionIds);

    if (messagesError) throw messagesError;

    totalMessages = (messages || []).length;
    const timestamps = (messages || []).map((m: any) => m.timestamp).filter(Boolean);
    if (timestamps.length > 0) {
      lastActivity = timestamps.sort().pop();
    }
  }

  const { data: contextStats, error: contextError } = await supabase
    .from('mcp_contexts')
    .select('context_type')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString());

  if (contextError) throw contextError;

  const contextsByType = (contextStats || []).reduce((acc: any, ctx: any) => {
    const type = ctx.context_type || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  return {
    total_sessions: sessionIds.length,
    total_messages: totalMessages,
    last_activity: lastActivity,
    contexts_by_type: contextsByType
  };
}
