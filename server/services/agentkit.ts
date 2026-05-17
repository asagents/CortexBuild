import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

export interface AgentRecord {
  id: string;
  slug: string;
  company_id: string | null;
  developer_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  status: string;
  is_global: boolean | number;
  tags?: string | any[] | null;
  capabilities?: string | Record<string, any> | null;
  config?: string | Record<string, any> | null;
  metadata?: string | Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface AgentExecutionRecord {
  id: string;
  agent_id: string;
  company_id: string;
  triggered_by: string | null;
  input_payload: string | Record<string, any> | null;
  output_payload: string | Record<string, any> | null;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

const safeJsonParse = (val: any): any => {
  if (val == null) return undefined;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
};

const mapAgentRow = (row: AgentRecord) => ({
  id: row.id,
  slug: row.slug,
  companyId: row.company_id ?? undefined,
  developerId: row.developer_id ?? undefined,
  name: row.name,
  description: row.description ?? '',
  icon: row.icon ?? '🤖',
  status: row.status,
  isGlobal: Boolean(row.is_global),
  tags: safeJsonParse(row.tags) || [],
  capabilities: safeJsonParse(row.capabilities) || {},
  config: safeJsonParse(row.config) || {},
  metadata: safeJsonParse(row.metadata) || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapExecutionRow = (row: AgentExecutionRecord) => ({
  id: row.id,
  agentId: row.agent_id,
  companyId: row.company_id,
  triggeredBy: row.triggered_by ?? undefined,
  input: safeJsonParse(row.input_payload),
  output: safeJsonParse(row.output_payload),
  status: row.status,
  durationMs: row.duration_ms ?? undefined,
  error: row.error_message ?? undefined,
  startedAt: row.started_at,
  completedAt: row.completed_at ?? undefined
});

export const listGlobalAgents = async (supabase: SupabaseClient) => {
  const { data: rows, error } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('is_global', true)
    .order('name', { ascending: true });

  if (error) throw error;
  return (rows || []).map(mapAgentRow);
};

export const listCompanyAgents = async (supabase: SupabaseClient, companyId: string) => {
  const { data: rows, error } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('company_id', companyId)
    .order('name', { ascending: true });

  if (error) throw error;
  return (rows || []).map(mapAgentRow);
};

export const getAgentById = async (supabase: SupabaseClient, agentId: string) => {
  const { data: agent, error } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return agent ? mapAgentRow(agent as AgentRecord) : undefined;
};

export const subscribeAgent = async (
  supabase: SupabaseClient,
  baseAgentId: string,
  companyId: string,
  requestedBy: string
) => {
  const { data: baseAgent, error: baseErr } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('id', baseAgentId)
    .single();

  if (baseErr && baseErr.code !== 'PGRST116') throw baseErr;
  if (!baseAgent) {
    throw new Error('Agent not found');
  }

  if (!baseAgent.is_global && baseAgent.company_id && baseAgent.company_id !== companyId) {
    throw new Error('Agent belongs to another company');
  }

  const { data: existingSubscription } = await supabase
    .from('agent_subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .eq('agent_id', baseAgentId)
    .single();

  if (existingSubscription) {
    return mapAgentRow(baseAgent as AgentRecord);
  }

  let agentInstanceId = baseAgent.id;
  if (baseAgent.is_global === 1 || baseAgent.is_global === true) {
    agentInstanceId = `agent-${uuidv4()}`;
    const slug = `${baseAgent.slug}-${companyId}`.toLowerCase();

    const { error: insertErr } = await supabase
      .from('ai_agents')
      .insert({
        id: agentInstanceId,
        slug,
        company_id: companyId,
        developer_id: baseAgent.developer_id,
        name: baseAgent.name,
        description: baseAgent.description,
        icon: baseAgent.icon,
        status: 'active',
        is_global: false,
        tags: baseAgent.tags,
        capabilities: baseAgent.capabilities,
        config: baseAgent.config,
        metadata: baseAgent.metadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertErr) throw insertErr;
  }

  const nowIso = new Date().toISOString();
  const { error: subErr } = await supabase
    .from('agent_subscriptions')
    .insert({
      id: `sub-${agentInstanceId}`,
      company_id: companyId,
      agent_id: agentInstanceId,
      status: 'active',
      seats: 25,
      created_at: nowIso,
      updated_at: nowIso
    });

  if (subErr) throw subErr;

  await logDeveloperEvent(supabase, requestedBy, companyId, 'agent.subscribe', {
    agentId: agentInstanceId,
    baseAgentId
  });

  const { data: agent, error: agentErr } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('id', agentInstanceId)
    .single();

  if (agentErr) throw agentErr;
  if (!agent) throw new Error('Agent not found after creation');
  return mapAgentRow(agent as AgentRecord);
};

export const unsubscribeAgent = async (
  supabase: SupabaseClient,
  agentId: string,
  companyId: string
) => {
  const { data: agent, error: agentErr } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (agentErr && agentErr.code !== 'PGRST116') throw agentErr;
  if (!agent || agent.company_id !== companyId) {
    throw new Error('Agent not found for this company');
  }

  const { error: delSubErr } = await supabase
    .from('agent_subscriptions')
    .delete()
    .eq('company_id', companyId)
    .eq('agent_id', agentId);

  if (delSubErr) throw delSubErr;

  const { error: delExecErr } = await supabase
    .from('agent_executions')
    .delete()
    .eq('agent_id', agentId);

  if (delExecErr) throw delExecErr;

  const { error: delAgentErr } = await supabase
    .from('ai_agents')
    .delete()
    .eq('id', agentId);

  if (delAgentErr) throw delAgentErr;
};

const simulateAgentResponse = (agent: ReturnType<typeof mapAgentRow>, input: any) => {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    summary: `Agent ${agent.name} processed the request successfully.`,
    recommendations: [
      'Validate assumptions with project stakeholders.',
      'Schedule follow-up actions for the responsible team.'
    ],
    insights: {
      riskScore: Math.round(Math.random() * 30 + 40),
      confidence: 0.72,
      context: input || {}
    }
  };
};

export const runAgent = async (
  supabase: SupabaseClient,
  agentId: string,
  companyId: string,
  triggeredBy: string,
  inputPayload: any
) => {
  const { data: agentRow, error: agentErr } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (agentErr) throw agentErr;
  if (!agentRow || (agentRow.company_id !== companyId && !(agentRow.is_global === 1 || agentRow.is_global === true))) {
    throw new Error('Agent not accessible');
  }

  const executionId = `exec-${uuidv4()}`;
  const start = new Date();
  const startedAt = start.toISOString();

  const resultPayload = simulateAgentResponse(mapAgentRow(agentRow as AgentRecord), inputPayload);
  const completedAt = new Date().toISOString();
  const durationMs = new Date(completedAt).getTime() - start.getTime();

  const { error: insertErr } = await supabase
    .from('agent_executions')
    .insert({
      id: executionId,
      agent_id: agentId,
      company_id: companyId,
      triggered_by: triggeredBy,
      input_payload: JSON.stringify(inputPayload ?? {}),
      output_payload: JSON.stringify(resultPayload),
      status: 'success',
      duration_ms: durationMs,
      started_at: startedAt,
      completed_at: completedAt
    });

  if (insertErr) throw insertErr;

  await logDeveloperEvent(supabase, triggeredBy, companyId, 'agent.execution', {
    agentId,
    executionId,
    status: 'success'
  });

  const { data: execution, error: execErr } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (execErr) throw execErr;
  if (!execution) throw new Error('Execution not found after creation');
  return mapExecutionRow(execution as AgentExecutionRecord);
};

export const getAgentExecutions = async (
  supabase: SupabaseClient,
  agentId: string,
  companyId: string,
  limit = 25
) => {
  const { data: rows, error } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .eq('company_id', companyId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (rows || []).map((r: any) => mapExecutionRow(r as AgentExecutionRecord));
};

export const listAgentSubscriptions = async (supabase: SupabaseClient, companyId: string) => {
  const { data, error } = await supabase
    .from('agent_subscriptions')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

const logDeveloperEvent = async (
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
  eventType: string,
  payload: Record<string, unknown>
) => {
  const { error } = await supabase
    .from('developer_console_events')
    .insert({
      id: `dev-${uuidv4()}`,
      user_id: userId,
      company_id: companyId,
      event_type: eventType,
      payload: JSON.stringify(payload)
    });

  if (error) throw error;
};
