// CortexBuild - SDK API Routes
// Version: 3.0.0 - Supabase PostgreSQL Migration
// Last Updated: 2025-10-31

import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { authenticateToken } from '../auth-supabase';
import { v4 as uuidv4 } from 'uuid';
import { createWorkspaceManager } from '../services/workspace-manager';
import { createCollaborationService } from '../services/collaboration-service';

// Middleware to check if user is a developer
const requireDeveloper = (req: Request, res: Response, next: any) => {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!['developer', 'super_admin', 'company_admin'].includes(user.role)) {
    return res.status(403).json({ error: 'Developer or admin access required' });
  }
  next();
};

// Middleware for basic SDK access (any authenticated user)
const requireAuth = (req: Request, res: Response, next: any) => {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// No-op init for Supabase-managed tables
export const initSdkTables = (_db: any) => {
  console.log('✅ SDK tables managed by Supabase');
};

export const createSDKRouter = (supabase: SupabaseClient) => {
  const router = Router();

  // Apply authentication to all routes
  router.use(authenticateToken);

  // =====================================================
  // PROFILE
  // =====================================================

  // Get or create SDK profile
  router.get('/profile', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      let { data: profile, error } = await supabase
        .from('sdk_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code === 'PGRST116') {
        const id = `sdk-profile-${Date.now()}`;
        const { data: newProfile, error: createError } = await supabase
          .from('sdk_profiles')
          .insert({
            id,
            user_id: user.id,
            subscription_tier: 'free',
            api_requests_limit: 100,
            api_requests_used: 0
          })
          .select()
          .single();

        if (createError) throw createError;
        profile = newProfile;
      } else if (error) {
        throw error;
      }

      res.json({
        success: true,
        profile: {
          ...profile,
          apiRequestsUsed: profile.api_requests_used || 0,
          apiRequestsLimit: profile.api_requests_limit || 100,
          subscriptionTier: profile.subscription_tier || 'free'
        }
      });
    } catch (error: any) {
      console.error('Get SDK profile error:', error);
      res.status(500).json({ error: 'Failed to get SDK profile' });
    }
  });

  // Update subscription tier
  router.patch('/profile/subscription', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { tier } = req.body;
      const limits: Record<string, number> = {
        free: 100,
        starter: 1000,
        pro: 10000,
        enterprise: 100000
      };
      const limit = limits[tier] || 100;

      const { data: currentProfile } = await supabase
        .from('sdk_profiles')
        .select('subscription_tier')
        .eq('user_id', user.id)
        .single();

      const { data: profile, error } = await supabase
        .from('sdk_profiles')
        .update({
          subscription_tier: tier,
          api_requests_limit: limit,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;

      // Record history
      await supabase.from('subscription_history').insert({
        id: `sub-history-${Date.now()}`,
        user_id: user.id,
        old_tier: currentProfile?.subscription_tier || 'free',
        new_tier: tier,
        change_reason: 'User requested tier change',
        changed_by: user.id,
        metadata: JSON.stringify({ timestamp: new Date().toISOString() })
      });

      // Notify
      await supabase.from('subscription_notifications').insert({
        id: `notif-${Date.now()}`,
        user_id: user.id,
        type: 'subscription_change',
        title: 'Subscription Updated',
        message: `Your subscription has been updated to ${tier} tier`,
        data: JSON.stringify({ oldTier: currentProfile?.subscription_tier, newTier: tier })
      });

      res.json({
        success: true,
        profile: {
          ...profile,
          apiRequestsUsed: profile.api_requests_used || 0,
          apiRequestsLimit: profile.api_requests_limit || 100,
          subscriptionTier: profile.subscription_tier || 'free'
        }
      });
    } catch (error: any) {
      console.error('Update subscription error:', error);
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  });

  // Get subscription history
  router.get('/profile/subscription/history', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const limit = Number(req.query.limit || 10);

      const { data: history, error } = await supabase
        .from('subscription_history')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      res.json({
        success: true,
        history: (history || []).map((h: any) => ({
          ...h,
          metadata: h.metadata ? JSON.parse(h.metadata) : {}
        }))
      });
    } catch (error: any) {
      console.error('Get subscription history error:', error);
      res.status(500).json({ error: 'Failed to get subscription history' });
    }
  });

  // Save API key
  router.post('/profile/api-key', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { provider, encryptedKey } = req.body;

      const updates: any = {};
      if (provider === 'gemini') updates.gemini_api_key = encryptedKey;

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        const { error } = await supabase
          .from('sdk_profiles')
          .update(updates)
          .eq('user_id', user.id);
        if (error) throw error;
      }

      res.json({ success: true, message: 'API key saved successfully' });
    } catch (error: any) {
      console.error('Save API key error:', error);
      res.status(500).json({ error: 'Failed to save API key' });
    }
  });

  // =====================================================
  // NOTIFICATIONS
  // =====================================================

  // Get subscription notifications
  router.get('/notifications', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const unreadOnly = req.query.unreadOnly === 'true';

      let query = supabase
        .from('subscription_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (unreadOnly) query = query.eq('is_read', false);

      const { data: notifications, error } = await query;
      if (error) throw error;

      res.json({
        success: true,
        notifications: (notifications || []).map((n: any) => ({
          ...n,
          data: n.data ? JSON.parse(n.data) : {}
        }))
      });
    } catch (error: any) {
      console.error('Get notifications error:', error);
      res.status(500).json({ error: 'Failed to get notifications' });
    }
  });

  // Mark notification as read
  router.patch('/notifications/:id/read', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = (req as any).user;

      const { error } = await supabase
        .from('subscription_notifications')
        .update({ is_read: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;
      res.json({ success: true });
    } catch (error: any) {
      console.error('Mark notification read error:', error);
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  });

  // =====================================================
  // WORKFLOWS
  // =====================================================

  // Get all workflows
  router.get('/workflows', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      const { data: workflows, error } = await supabase
        .from('sdk_workflows')
        .select('*')
        .eq('developer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        workflows: (workflows || []).map((w: any) => ({
          ...w,
          definition: w.definition ? (typeof w.definition === 'string' ? JSON.parse(w.definition) : w.definition) : {},
          isActive: w.is_active === true || w.is_active === 1
        }))
      });
    } catch (error: any) {
      console.error('Get workflows error:', error);
      res.status(500).json({ error: 'Failed to get workflows' });
    }
  });

  // Save workflow
  router.post('/workflows', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { name, definition, isActive, companyId } = req.body;
      const id = uuidv4();

      const { data: workflow, error } = await supabase
        .from('sdk_workflows')
        .insert({
          id,
          developer_id: user.id,
          company_id: companyId || null,
          name,
          definition: typeof definition === 'string' ? definition : JSON.stringify(definition || {}),
          is_active: isActive === true || isActive === 1
        })
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        workflow: {
          ...workflow,
          definition: workflow.definition ? (typeof workflow.definition === 'string' ? JSON.parse(workflow.definition) : workflow.definition) : {},
          isActive: workflow.is_active === true || workflow.is_active === 1
        }
      });
    } catch (error: any) {
      console.error('Save workflow error:', error);
      res.status(500).json({ error: 'Failed to save workflow' });
    }
  });

  // =====================================================
  // APPS
  // =====================================================

  // Get all developer apps
  router.get('/apps', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      const { data: apps, error } = await supabase
        .from('sdk_apps')
        .select('*')
        .eq('developer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        apps: (apps || []).map((a: any) => ({
          ...a,
          developerId: a.developer_id,
          companyId: a.company_id,
          createdAt: a.created_at,
          updatedAt: a.updated_at
        }))
      });
    } catch (error: any) {
      console.error('Get apps error:', error);
      res.status(500).json({ error: 'Failed to get apps' });
    }
  });

  // Save app
  router.post('/apps', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { name, description, code, version, status, companyId } = req.body;
      const id = uuidv4();

      const { data: app, error } = await supabase
        .from('sdk_apps')
        .insert({
          id,
          developer_id: user.id,
          company_id: companyId || null,
          name,
          description: description || '',
          code: code || '',
          version: version || '1.0.0',
          status: status || 'draft'
        })
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        app: {
          ...app,
          developerId: app.developer_id,
          companyId: app.company_id,
          createdAt: app.created_at,
          updatedAt: app.updated_at
        }
      });
    } catch (error: any) {
      console.error('Save app error:', error);
      res.status(500).json({ error: 'Failed to save app' });
    }
  });

  // Update app status
  router.patch('/apps/:id/status', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;
      const { status } = req.body;

      const { data: app, error } = await supabase
        .from('sdk_apps')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('developer_id', user.id)
        .select()
        .single();

      if (error || !app) {
        return res.status(404).json({ error: 'App not found' });
      }

      res.json({ success: true, app });
    } catch (error: any) {
      console.error('Update app status error:', error);
      res.status(500).json({ error: 'Failed to update app status' });
    }
  });

  // =====================================================
  // AI AGENTS
  // =====================================================

  // Get all AI agents
  router.get('/agents', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      const { data: agents, error } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('developer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        agents: (agents || []).map((a: any) => ({
          ...a,
          developerId: a.developer_id,
          companyId: a.company_id,
          config: a.config ? (typeof a.config === 'string' ? JSON.parse(a.config) : a.config) : {},
          createdAt: a.created_at,
          updatedAt: a.updated_at
        }))
      });
    } catch (error: any) {
      console.error('Get agents error:', error);
      res.status(500).json({ error: 'Failed to get agents' });
    }
  });

  // Update agent status
  router.patch('/agents/:id/status', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;
      const { status } = req.body;

      const { data: agent, error } = await supabase
        .from('ai_agents')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('developer_id', user.id)
        .select()
        .single();

      if (error || !agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      res.json({
        success: true,
        agent: {
          ...agent,
          config: agent.config ? (typeof agent.config === 'string' ? JSON.parse(agent.config) : agent.config) : {}
        }
      });
    } catch (error: any) {
      console.error('Update agent status error:', error);
      res.status(500).json({ error: 'Failed to update agent status' });
    }
  });

  // =====================================================
  // ANALYTICS
  // =====================================================

  // Get usage analytics
  router.get('/analytics/usage', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { data: logs, error } = await supabase
        .from('api_usage_logs')
        .select('provider, cost, total_tokens')
        .eq('user_id', user.id)
        .gte('created_at', startOfMonth.toISOString());

      if (error) throw error;

      const grouped = (logs || []).reduce((acc: any, log: any) => {
        const provider = log.provider || 'unknown';
        if (!acc[provider]) {
          acc[provider] = {
            provider,
            requestsThisMonth: 0,
            monthToDateCost: 0,
            totalTokens: 0
          };
        }
        acc[provider].requestsThisMonth += 1;
        acc[provider].monthToDateCost += log.cost || 0;
        acc[provider].totalTokens += log.total_tokens || 0;
        return acc;
      }, {});

      res.json({
        success: true,
        costSummary: Object.values(grouped)
      });
    } catch (error: any) {
      console.error('Get analytics error:', error);
      res.status(500).json({ error: 'Failed to get analytics' });
    }
  });

  // Log API usage
  router.post('/analytics/log', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { provider, model, promptTokens, completionTokens, cost } = req.body;
      const id = uuidv4();
      const totalTokens = (promptTokens || 0) + (completionTokens || 0);

      const { error: logError } = await supabase
        .from('api_usage_logs')
        .insert({
          id,
          user_id: user.id,
          provider,
          model: model || '',
          prompt_tokens: promptTokens || 0,
          completion_tokens: completionTokens || 0,
          total_tokens: totalTokens,
          cost: cost || 0
        });

      if (logError) throw logError;

      const { data: profile } = await supabase
        .from('sdk_profiles')
        .select('api_requests_used')
        .eq('user_id', user.id)
        .single();

      if (profile) {
        await supabase
          .from('sdk_profiles')
          .update({
            api_requests_used: (profile.api_requests_used || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('Log usage error:', error);
      res.status(500).json({ error: 'Failed to log usage' });
    }
  });

  // =====================================================
  // ADMIN SUBSCRIPTIONS
  // =====================================================

  // Admin: Get all subscriptions
  router.get('/admin/subscriptions', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Super admin access required' });
      }

      const { data: subscriptions, error } = await supabase
        .from('sdk_profiles')
        .select('*, users(email, name), companies(name)')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        subscriptions: (subscriptions || []).map((s: any) => ({
          ...s,
          apiRequestsUsed: s.api_requests_used,
          apiRequestsLimit: s.api_requests_limit,
          subscriptionTier: s.subscription_tier,
          companyName: s.companies?.name || null
        }))
      });
    } catch (error: any) {
      console.error('Get admin subscriptions error:', error);
      res.status(500).json({ error: 'Failed to get subscriptions' });
    }
  });

  // Admin: Update user subscription
  router.patch('/admin/subscriptions/:userId', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Super admin access required' });
      }

      const { userId } = req.params;
      const { tier, status, reason } = req.body;

      const { data: currentProfile, error: profileErr } = await supabase
        .from('sdk_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (profileErr || !currentProfile) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const limits: Record<string, number> = {
        free: 100,
        starter: 1000,
        pro: 10000,
        enterprise: 100000
      };
      const limit = limits[tier] || currentProfile.api_requests_limit;

      const { data: profile, error } = await supabase
        .from('sdk_profiles')
        .update({
          subscription_tier: tier,
          api_requests_limit: limit,
          subscription_status: status,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      await supabase.from('subscription_history').insert({
        id: `admin-history-${Date.now()}`,
        user_id: userId,
        old_tier: currentProfile.subscription_tier,
        new_tier: tier,
        change_reason: reason || 'Admin adjustment',
        changed_by: user.id,
        metadata: JSON.stringify({ adminChange: true, timestamp: new Date().toISOString() })
      });

      await supabase.from('subscription_notifications').insert({
        id: `admin-notif-${Date.now()}`,
        user_id: userId,
        type: 'subscription_change',
        title: 'Subscription Updated',
        message: `Your subscription has been updated by an administrator to ${tier} tier`,
        data: JSON.stringify({ adminChange: true, changedBy: user.name })
      });

      res.json({
        success: true,
        profile: {
          ...profile,
          apiRequestsUsed: profile.api_requests_used,
          apiRequestsLimit: profile.api_requests_limit,
          subscriptionTier: profile.subscription_tier
        }
      });
    } catch (error: any) {
      console.error('Admin update subscription error:', error);
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  });

  // =====================================================
  // USAGE LIMITS
  // =====================================================

  // Check usage limits
  router.post('/check-usage-limits', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      const { data: profile, error } = await supabase
        .from('sdk_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error || !profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      const usagePercent = (profile.api_requests_used / profile.api_requests_limit) * 100;
      const notifications: string[] = [];

      if (usagePercent >= 80 && usagePercent < 100) {
        const { data: recentWarning } = await supabase
          .from('subscription_notifications')
          .select('id')
          .eq('user_id', user.id)
          .eq('type', 'usage_warning')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        if (!recentWarning || recentWarning.length === 0) {
          await supabase.from('subscription_notifications').insert({
            id: `warning-${Date.now()}`,
            user_id: user.id,
            type: 'usage_warning',
            title: 'Usage Warning',
            message: `You have used ${Math.round(usagePercent)}% of your ${profile.subscription_tier} plan limit.`,
            action_url: '/settings?tab=subscription'
          });
          notifications.push('usage_warning');
        }
      }

      res.json({
        success: true,
        usagePercent: Math.round(usagePercent),
        notifications
      });
    } catch (error: any) {
      console.error('Check usage limits error:', error);
      res.status(500).json({ error: 'Failed to check usage limits' });
    }
  });

  // =====================================================
  // WORKSPACE MANAGEMENT
  // =====================================================

  // Create workspace
  router.post('/workspaces', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { name, description, isPublic, settings } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Workspace name is required' });
      }

      const workspaceManager = createWorkspaceManager(supabase);
      const workspace = await workspaceManager.createWorkspace(
        name.trim(),
        description || '',
        user.id,
        isPublic || false,
        settings || {}
      );

      await workspaceManager.addWorkspaceMember(workspace.id, user.id, 'owner', ['read', 'write', 'admin']);

      const members = await workspaceManager.getWorkspaceMembers(workspace.id);
      res.json({
        success: true,
        workspace: {
          ...workspace,
          members
        }
      });
    } catch (error: any) {
      console.error('Create workspace error:', error);
      res.status(500).json({ error: 'Failed to create workspace' });
    }
  });

  // Get user workspaces
  router.get('/workspaces', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const workspaceManager = createWorkspaceManager(supabase);

      const { data: workspaceRows } = await supabase
        .from('workspaces')
        .select('*, workspace_members!inner(*)')
        .eq('workspace_members.user_id', user.id)
        .order('created_at', { ascending: false });

      const workspaces = (workspaceRows || []).map((w: any) => ({
        ...w,
        is_public: Boolean(w.is_public),
        settings: typeof w.settings === 'string' ? JSON.parse(w.settings || '{}') : (w.settings || {})
      }));

      const enriched = await Promise.all(
        workspaces.map(async (w: any) => ({
          ...w,
          members: await workspaceManager.getWorkspaceMembers(w.id)
        }))
      );

      res.json({ success: true, workspaces: enriched });
    } catch (error: any) {
      console.error('Get workspaces error:', error);
      res.status(500).json({ error: 'Failed to get workspaces' });
    }
  });

  // Get workspace details
  router.get('/workspaces/:id', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const workspaceManager = createWorkspaceManager(supabase);
      const workspace = await workspaceManager.getWorkspace(id);

      if (!workspace) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      const members = await workspaceManager.getWorkspaceMembers(id);
      res.json({
        success: true,
        workspace: {
          ...workspace,
          members
        }
      });
    } catch (error: any) {
      console.error('Get workspace error:', error);
      res.status(500).json({ error: 'Failed to get workspace' });
    }
  });

  // Add workspace member
  router.post('/workspaces/:id/members', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { userId, role = 'member', permissions = [] } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      const workspaceManager = createWorkspaceManager(supabase);
      const member = await workspaceManager.addWorkspaceMember(id, userId, role, permissions);

      res.json({ success: true, member });
    } catch (error: any) {
      console.error('Add workspace member error:', error);
      res.status(500).json({ error: 'Failed to add workspace member' });
    }
  });

  // =====================================================
  // COLLABORATION
  // =====================================================

  // Create collaboration session
  router.post('/collaboration/sessions', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { workspaceId, name, description, settings } = req.body;

      if (!workspaceId || !name) {
        return res.status(400).json({ error: 'Workspace ID and name are required' });
      }

      const collaborationService = createCollaborationService(supabase);
      const session = await collaborationService.createSession(
        workspaceId,
        name,
        description || '',
        user.id,
        settings || {}
      );

      res.json({ success: true, session });
    } catch (error: any) {
      console.error('Create collaboration session error:', error);
      res.status(500).json({ error: 'Failed to create collaboration session' });
    }
  });

  // Join collaboration session
  router.post('/collaboration/sessions/:id/join', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = (req as any).user;

      const collaborationService = createCollaborationService(supabase);
      const session = await collaborationService.joinSession(id, user.id);

      if (!session) {
        return res.status(404).json({ error: 'Session not found or inactive' });
      }

      res.json({ success: true, session });
    } catch (error: any) {
      console.error('Join session error:', error);
      res.status(500).json({ error: 'Failed to join session' });
    }
  });

  // Leave collaboration session
  router.post('/collaboration/sessions/:id/leave', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = (req as any).user;

      const collaborationService = createCollaborationService(supabase);
      const success = await collaborationService.leaveSession(id, user.id);

      if (!success) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('Leave session error:', error);
      res.status(500).json({ error: 'Failed to leave session' });
    }
  });

  // Get session events
  router.get('/collaboration/sessions/:id/events', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const limit = Number(req.query.limit || 50);

      const collaborationService = createCollaborationService(supabase);
      const events = await collaborationService.getSessionEvents(id, limit);

      res.json({ success: true, events });
    } catch (error: any) {
      console.error('Get session events error:', error);
      res.status(500).json({ error: 'Failed to get session events' });
    }
  });

  // Update live cursor
  router.post('/collaboration/cursor', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { sessionId, filePath, lineNumber, column, color } = req.body;

      if (!sessionId || !filePath || lineNumber === undefined || column === undefined) {
        return res.status(400).json({ error: 'Session ID, file path, line number, and column are required' });
      }

      const collaborationService = createCollaborationService(supabase);
      const cursor = await collaborationService.updateLiveCursor(
        sessionId,
        user.id,
        filePath,
        lineNumber,
        column,
        color || '#3B82F6',
        user.name || 'Unknown User'
      );

      const allCursors = await collaborationService.getLiveCursors(sessionId);

      res.json({ success: true, cursor, allCursors });
    } catch (error: any) {
      console.error('Update cursor error:', error);
      res.status(500).json({ error: 'Failed to update cursor' });
    }
  });

  // Add code comment
  router.post('/collaboration/comments', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { sessionId, filePath, lineNumber, columnStart, columnEnd, content } = req.body;

      if (!sessionId || !filePath || !content) {
        return res.status(400).json({ error: 'Session ID, file path, and content are required' });
      }

      const collaborationService = createCollaborationService(supabase);
      const comment = await collaborationService.addCodeComment(
        sessionId,
        filePath,
        lineNumber || 0,
        columnStart || 0,
        columnEnd || 0,
        content,
        user.id
      );

      res.json({ success: true, comment });
    } catch (error: any) {
      console.error('Add comment error:', error);
      res.status(500).json({ error: 'Failed to add comment' });
    }
  });

  // Get file comments
  router.get('/collaboration/sessions/:id/comments/:filePath', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const { id, filePath } = req.params;

      const collaborationService = createCollaborationService(supabase);
      const comments = await collaborationService.getFileComments(id, decodeURIComponent(filePath));

      res.json({ success: true, comments });
    } catch (error: any) {
      console.error('Get file comments error:', error);
      res.status(500).json({ error: 'Failed to get file comments' });
    }
  });

  // =====================================================
  // TEMPLATES
  // =====================================================

  // Get project templates
  router.get('/templates', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const { category } = req.query;
      const workspaceManager = createWorkspaceManager(supabase);
      const templates = await workspaceManager.getProjectTemplates(category as string | undefined);
      res.json({ success: true, templates });
    } catch (error: any) {
      console.error('Get templates error:', error);
      res.status(500).json({ error: 'Failed to get templates' });
    }
  });

  // Create project template
  router.post('/templates', requireDeveloper, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { name, description, category, templateData, isPublic } = req.body;

      if (!name || !category || !templateData) {
        return res.status(400).json({ error: 'Name, category, and template data are required' });
      }

      const workspaceManager = createWorkspaceManager(supabase);
      const template = await workspaceManager.createProjectTemplate(
        name,
        description || '',
        category,
        templateData,
        user.id,
        isPublic || false
      );

      res.json({ success: true, template });
    } catch (error: any) {
      console.error('Create template error:', error);
      res.status(500).json({ error: 'Failed to create template' });
    }
  });

  return router;
};

export default createSDKRouter;
