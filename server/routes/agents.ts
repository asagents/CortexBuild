import { Router } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { authenticateToken } from '../auth-supabase';
import { v4 as uuidv4 } from 'uuid';

export function createAgentsRouter(supabase: SupabaseClient) {
  const router = Router();

  // Get all agents for the current user
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { data: agents, error } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const agentIds = (agents || []).map((a: any) => a.id);
      let executions: any[] = [];
      if (agentIds.length > 0) {
        const { data: exData, error: exErr } = await supabase
          .from('agent_executions')
          .select('*')
          .in('agent_id', agentIds);
        if (!exErr) executions = exData || [];
      }

      const agentsFormatted = (agents || []).map((a: any) => {
        const agentEx = executions.filter((e: any) => e.agent_id === a.id);
        const totalRuns = agentEx.length;
        const completed = agentEx.filter((e: any) => e.status === 'completed').length;
        const successRate = totalRuns > 0 ? Math.round((completed / totalRuns) * 100) : 0;
        const avgExecutionTime = totalRuns > 0
          ? parseFloat((agentEx.reduce((sum: number, e: any) => sum + (e.duration || 0), 0) / totalRuns).toFixed(2))
          : 0;

        return {
          ...a,
          config: a.config ? (typeof a.config === 'string' ? JSON.parse(a.config) : a.config) : {},
          totalRuns,
          successRate,
          avgExecutionTime
        };
      });

      res.json(agentsFormatted);
    } catch (error: any) {
      console.error('Error fetching agents:', error);
      res.status(500).json({ error: 'Failed to fetch agents' });
    }
  });

  // Get a single agent
  router.get('/:id', authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;

      const { data: agent, error } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error || !agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      res.json({
        ...agent,
        config: agent.config ? (typeof agent.config === 'string' ? JSON.parse(agent.config) : agent.config) : {}
      });
    } catch (error: any) {
      console.error('Error fetching agent:', error);
      res.status(500).json({ error: 'Failed to fetch agent' });
    }
  });

  // Create a new agent
  router.post('/', authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { name, description, type, model, temperature, maxTokens, systemPrompt, tools } = req.body;

      if (!name || !type) {
        return res.status(400).json({ error: 'Name and type are required' });
      }

      const config = {
        model: model || 'gpt-4-turbo',
        temperature: temperature || 0.7,
        maxTokens: maxTokens || 2000,
        systemPrompt: systemPrompt || '',
        tools: tools || []
      };

      const id = uuidv4();
      const { data: agent, error } = await supabase
        .from('ai_agents')
        .insert({
          id,
          user_id: userId,
          name,
          description,
          type,
          status: 'active',
          config: JSON.stringify(config),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        ...agent,
        config: JSON.parse(agent.config),
        totalRuns: 0,
        successRate: 0,
        avgExecutionTime: 0
      });
    } catch (error: any) {
      console.error('Error creating agent:', error);
      res.status(500).json({ error: 'Failed to create agent' });
    }
  });

  // Update agent
  router.patch('/:id', authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const { name, description, type, model, temperature, maxTokens, systemPrompt, tools } = req.body;

      const { data: existing, error: findError } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (findError || !existing) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const currentConfig = existing.config ? (typeof existing.config === 'string' ? JSON.parse(existing.config) : existing.config) : {};
      const newConfig = {
        model: model !== undefined ? model : currentConfig.model,
        temperature: temperature !== undefined ? temperature : currentConfig.temperature,
        maxTokens: maxTokens !== undefined ? maxTokens : currentConfig.maxTokens,
        systemPrompt: systemPrompt !== undefined ? systemPrompt : currentConfig.systemPrompt,
        tools: tools !== undefined ? tools : currentConfig.tools
      };

      const updates: any = {
        config: JSON.stringify(newConfig),
        updated_at: new Date().toISOString()
      };
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (type !== undefined) updates.type = type;

      const { data: updatedAgent, error } = await supabase
        .from('ai_agents')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      res.json({
        ...updatedAgent,
        config: typeof updatedAgent.config === 'string' ? JSON.parse(updatedAgent.config) : updatedAgent.config
      });
    } catch (error: any) {
      console.error('Error updating agent:', error);
      res.status(500).json({ error: 'Failed to update agent' });
    }
  });

  // Update agent status
  router.patch('/:id/status', authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const { status } = req.body;

      if (!['active', 'paused', 'error'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const { data, error } = await supabase
        .from('ai_agents')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      res.json({ message: 'Status updated successfully' });
    } catch (error: any) {
      console.error('Error updating agent status:', error);
      res.status(500).json({ error: 'Failed to update status' });
    }
  });

  // Delete agent
  router.delete('/:id', authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;

      // Delete executions first
      await supabase.from('agent_executions').delete().eq('agent_id', id);

      // Delete agent
      const { data, error } = await supabase
        .from('ai_agents')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      res.json({ message: 'Agent deleted successfully' });
    } catch (error: any) {
      console.error('Error deleting agent:', error);
      res.status(500).json({ error: 'Failed to delete agent' });
    }
  });

  // Execute agent
  router.post('/:id/execute', authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const { input } = req.body;

      if (!input) {
        return res.status(400).json({ error: 'Input is required' });
      }

      const { data: agent, error: agentErr } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (agentErr || !agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      if (agent.status !== 'active') {
        return res.status(400).json({ error: 'Agent is not active' });
      }

      const config = typeof agent.config === 'string' ? JSON.parse(agent.config) : (agent.config || {});
      const startTime = Date.now();

      const executionId = uuidv4();
      const { data: execution, error: execErr } = await supabase
        .from('agent_executions')
        .insert({
          id: executionId,
          agent_id: id,
          status: 'running',
          input,
          started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (execErr) throw execErr;

      try {
        const messages = [
          { role: 'system', content: config.systemPrompt || 'You are a helpful AI assistant.' },
          { role: 'user', content: input }
        ];

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.model || 'gpt-4-turbo',
            messages,
            temperature: config.temperature || 0.7,
            max_tokens: config.maxTokens || 2000
          })
        });

        if (!response.ok) {
          throw new Error('OpenAI API error');
        }

        const data = await response.json();
        const output = data.choices[0].message.content;
        const tokensUsed = data.usage.total_tokens;
        const duration = (Date.now() - startTime) / 1000;
        const cost = (tokensUsed / 1000) * 0.01;

        await supabase
          .from('agent_executions')
          .update({
            status: 'completed',
            output,
            completed_at: new Date().toISOString(),
            duration,
            tokens_used: tokensUsed,
            cost
          })
          .eq('id', executionId);

        await supabase
          .from('ai_agents')
          .update({ last_run: new Date().toISOString() })
          .eq('id', id);

        const { data: updatedExec } = await supabase
          .from('agent_executions')
          .select('*')
          .eq('id', executionId)
          .single();

        res.json(updatedExec);
      } catch (error: any) {
        const duration = (Date.now() - startTime) / 1000;

        await supabase
          .from('agent_executions')
          .update({
            status: 'failed',
            error: error.message,
            completed_at: new Date().toISOString(),
            duration
          })
          .eq('id', executionId);

        await supabase
          .from('ai_agents')
          .update({ status: 'error', last_run: new Date().toISOString() })
          .eq('id', id);

        throw error;
      }
    } catch (error: any) {
      console.error('Error executing agent:', error);
      res.status(500).json({ error: 'Failed to execute agent' });
    }
  });

  // Get agent executions for user
  router.get('/executions', authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user?.id;

      const { data: executions, error } = await supabase
        .from('agent_executions')
        .select('*, ai_agents!inner(name)')
        .eq('ai_agents.user_id', userId)
        .order('started_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const formatted = (executions || []).map((e: any) => {
        const agent_name = e.ai_agents?.name || '';
        delete e.ai_agents;
        return { ...e, agent_name };
      });

      res.json(formatted);
    } catch (error: any) {
      console.error('Error fetching executions:', error);
      res.status(500).json({ error: 'Failed to fetch executions' });
    }
  });

  // Get executions for a specific agent
  router.get('/:id/executions', authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;

      const { data: agent, error: agentErr } = await supabase
        .from('ai_agents')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (agentErr || !agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const { data: executions, error } = await supabase
        .from('agent_executions')
        .select('*')
        .eq('agent_id', id)
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      res.json(executions || []);
    } catch (error: any) {
      console.error('Error fetching agent executions:', error);
      res.status(500).json({ error: 'Failed to fetch executions' });
    }
  });

  return router;
}
