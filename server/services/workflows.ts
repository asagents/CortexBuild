import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

export interface WorkflowRecord {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  version: string | null;
  definition: string | Record<string, any>;
  is_active: number | boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunRecord {
  id: string;
  workflow_id: string;
  company_id: string;
  status: string;
  trigger: string | null;
  input_payload: string | null;
  output_payload: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const safeJsonParse = (val: any): any => {
  if (val == null) { return undefined; }
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
};

export const mapWorkflowRow = (row: WorkflowRecord) => ({
  id: row.id,
  companyId: row.company_id,
  name: row.name,
  description: row.description ?? '',
  version: row.version ?? '1.0.0',
  definition: safeJsonParse(row.definition) || {},
  isActive: row.is_active === 1 || row.is_active === true,
  createdBy: row.created_by ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const mapWorkflowRunRow = (row: WorkflowRunRecord) => ({
  id: row.id,
  workflowId: row.workflow_id,
  companyId: row.company_id,
  status: row.status,
  trigger: safeJsonParse(row.trigger),
  input: safeJsonParse(row.input_payload),
  output: safeJsonParse(row.output_payload),
  error: row.error_message ?? undefined,
  startedAt: row.started_at,
  completedAt: row.completed_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const listWorkflows = async (
  supabase: SupabaseClient,
  companyId: string,
  includeInactive = true
) => {
  let query = supabase
    .from('workflows')
    .select('*')
    .eq('company_id', companyId);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data: rows, error } = await query
    .order('name', { ascending: true });

  if (error) throw error;
  return (rows || []).map((r: any) => mapWorkflowRow(r as WorkflowRecord));
};

export const listAllWorkflows = async (supabase: SupabaseClient, limit = 100) => {
  const { data: rows, error } = await supabase
    .from('workflows')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (rows || []).map((r: any) => mapWorkflowRow(r as WorkflowRecord));
};

export const getWorkflow = async (supabase: SupabaseClient, workflowId: string) => {
  const { data: workflow, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', workflowId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return workflow ? mapWorkflowRow(workflow as WorkflowRecord) : undefined;
};

export const createWorkflow = async (
  supabase: SupabaseClient,
  companyId: string,
  payload: { name: string; description?: string; definition?: any; createdBy?: string }
) => {
  const id = `wf-${uuidv4()}`;
  const { data: workflow, error } = await supabase
    .from('workflows')
    .insert({
      id,
      company_id: companyId,
      name: payload.name,
      description: payload.description ?? '',
      version: '1.0.0',
      definition: JSON.stringify(payload.definition ?? {}),
      is_active: true,
      created_by: payload.createdBy ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  if (!workflow) throw new Error('Workflow not found after creation');
  return mapWorkflowRow(workflow as WorkflowRecord);
};

export const updateWorkflow = async (
  supabase: SupabaseClient,
  workflowId: string,
  companyId: string,
  updates: { name?: string; description?: string; definition?: any; version?: string; isActive?: boolean }
) => {
  const { data: existing } = await supabase
    .from('workflows')
    .select('id')
    .eq('id', workflowId)
    .eq('company_id', companyId)
    .single();

  if (!existing) {
    throw new Error('Workflow not found');
  }

  const dbUpdates: any = {
    updated_at: new Date().toISOString()
  };

  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.definition !== undefined) dbUpdates.definition = JSON.stringify(updates.definition);
  if (updates.version !== undefined) dbUpdates.version = updates.version;
  if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;

  const { data: workflow, error } = await supabase
    .from('workflows')
    .update(dbUpdates)
    .eq('id', workflowId)
    .eq('company_id', companyId)
    .select()
    .single();

  if (error) throw error;
  if (!workflow) throw new Error('Workflow not found after update');
  return mapWorkflowRow(workflow as WorkflowRecord);
};

export const toggleWorkflow = async (
  supabase: SupabaseClient,
  workflowId: string,
  companyId: string,
  isActive: boolean
) => {
  const { data: workflow, error } = await supabase
    .from('workflows')
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString()
    })
    .eq('id', workflowId)
    .eq('company_id', companyId)
    .select()
    .single();

  if (error) throw error;
  if (!workflow) throw new Error('Workflow not found');
  return mapWorkflowRow(workflow as WorkflowRecord);
};

const recordWorkflowRunStep = async (
  supabase: SupabaseClient,
  runId: string,
  index: number,
  step: any,
  input: any,
  output: any,
  status: string,
  error?: string
) => {
  const { error: insertErr } = await supabase
    .from('workflow_run_steps')
    .insert({
      id: `wf-step-${uuidv4()}`,
      run_id: runId,
      step_index: index,
      step_type: step.type ?? 'action',
      name: step.name ?? `Step ${index + 1}`,
      status,
      input_payload: JSON.stringify(input ?? {}),
      output_payload: JSON.stringify(output ?? {}),
      error_message: error ?? null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });

  if (insertErr) throw insertErr;
};

export const runWorkflow = async (
  supabase: SupabaseClient,
  workflowId: string,
  companyId: string,
  trigger: any,
  inputPayload: any
) => {
  const { data: workflow, error: wfErr } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', workflowId)
    .eq('company_id', companyId)
    .single();

  if (wfErr) throw wfErr;
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  const definitionRaw = (workflow as WorkflowRecord).definition;
  const definition = safeJsonParse(definitionRaw) || {};
  const steps: any[] = Array.isArray(definition.steps) ? definition.steps : [];

  const runId = `wf-run-${uuidv4()}`;
  const startedAt = new Date().toISOString();

  const { error: insertErr } = await supabase
    .from('workflow_runs')
    .insert({
      id: runId,
      workflow_id: workflowId,
      company_id: companyId,
      status: 'running',
      trigger: JSON.stringify(trigger ?? {}),
      input_payload: JSON.stringify(inputPayload ?? {}),
      started_at: startedAt,
      created_at: startedAt,
      updated_at: startedAt
    });

  if (insertErr) throw insertErr;

  let status: 'success' | 'failed' = 'success';
  let outputPayload: any = {};
  let errorMessage: string | undefined;

  try {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      const stepInput = index === 0 ? inputPayload : outputPayload;

      const stepOutput = {
        stepId: step.id ?? `step-${index + 1}`,
        message: `${step.type ?? 'action'} executed successfully`,
        details: {
          ...step,
          timestamp: new Date().toISOString()
        }
      };

      await recordWorkflowRunStep(supabase, runId, index, step, stepInput, stepOutput, 'success');
      outputPayload = { ...outputPayload, [`step_${index + 1}`]: stepOutput };
    }
  } catch (err: any) {
    status = 'failed';
    errorMessage = err?.message ?? 'Workflow execution failed';
    await recordWorkflowRunStep(
      supabase,
      runId,
      steps.length,
      { type: 'error-handler', name: 'Error Capture' },
      {},
      {},
      'failed',
      errorMessage
    );
  }

  const { error: updateErr } = await supabase
    .from('workflow_runs')
    .update({
      status,
      output_payload: JSON.stringify(outputPayload),
      error_message: errorMessage ?? null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', runId);

  if (updateErr) throw updateErr;

  const { data: run, error: runErr } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr) throw runErr;
  if (!run) throw new Error('Run not found after update');
  return mapWorkflowRunRow(run as WorkflowRunRecord);
};

export const listWorkflowRuns = async (
  supabase: SupabaseClient,
  workflowId: string,
  companyId: string,
  limit = 20
) => {
  const { data: rows, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('workflow_id', workflowId)
    .eq('company_id', companyId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (rows || []).map((r: any) => mapWorkflowRunRow(r as WorkflowRunRecord));
};

export const listWorkflowRunSteps = async (
  supabase: SupabaseClient,
  runId: string
) => {
  const { data: rows, error } = await supabase
    .from('workflow_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('step_index', { ascending: true });

  if (error) throw error;
  return (rows || []).map((row: any) => ({
    id: row.id,
    runId: row.run_id,
    index: row.step_index,
    type: row.step_type,
    name: row.name,
    status: row.status,
    input: safeJsonParse(row.input_payload),
    output: safeJsonParse(row.output_payload),
    error: row.error_message ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }));
};

export const listTemplates = async (supabase: SupabaseClient) => {
  const { data: rows, error } = await supabase
    .from('workflow_templates')
    .select('*')
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return (rows || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description ?? '',
    icon: row.icon ?? '⚙️',
    difficulty: row.difficulty ?? 'intermediate',
    definition: safeJsonParse(row.definition) || {}
  }));
};

export const getBuilderBlocks = () => {
  return [
    {
      id: 'trigger-scheduled',
      type: 'trigger',
      label: 'Scheduled Trigger',
      description: 'Runs on a cron schedule.',
      configSchema: { cron: { type: 'string', required: true } }
    },
    {
      id: 'trigger-event',
      type: 'trigger',
      label: 'Event Trigger',
      description: 'Runs when a platform event occurs (e.g., RFI created).',
      configSchema: { event: { type: 'string', required: true } }
    },
    {
      id: 'action-notify',
      type: 'action',
      label: 'Send Notification',
      description: 'Send email, Slack, or in-app notifications.',
      configSchema: {
        channel: { type: 'string', enum: ['email', 'slack', 'in_app'], required: true },
        target: { type: 'string', required: true }
      }
    },
    {
      id: 'action-task',
      type: 'action',
      label: 'Create Task',
      description: 'Create a follow-up task with due dates and assignments.',
      configSchema: {
        title: { type: 'string', required: true },
        assigneeRole: { type: 'string', required: true },
        dueInDays: { type: 'number', default: 3 }
      }
    },
    {
      id: 'action-agent',
      type: 'action',
      label: 'Invoke Agent',
      description: 'Call an AI agent and use the response in downstream steps.',
      configSchema: {
        agentId: { type: 'string', required: true },
        inputMapping: { type: 'object', required: false }
      }
    }
  ];
};
