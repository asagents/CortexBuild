import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import * as auth from '../auth';

type AuthedRequest = Request & {
  user?: {
    id: string;
    company_id?: string;
    role?: string;
  };
};

const allowedIdeaStatus = new Set(['idea', 'pilot', 'proven']);
const allowedSeverity = new Set(['high', 'medium', 'low']);

export function createInnovationRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.use(auth.authenticateToken);

  const getTenant = (req: AuthedRequest, res: Response): string | null => {
    const companyId = req.user?.company_id;
    if (!companyId) {
      res.status(403).json({ success: false, error: 'A company tenant is required' });
      return null;
    }
    return String(companyId);
  };

  const normalizeProjectId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  };

  const verifyProject = async (companyId: string, projectId: string | null) => {
    if (!projectId) return true;
    const { data, error } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('company_id', companyId)
      .maybeSingle();
    return !error && Boolean(data);
  };

  const scopeQuery = <T extends any>(query: T, companyId: string, projectId: string | null): T => {
    let scoped = query.eq('company_id', companyId);
    scoped = projectId ? scoped.eq('project_id', projectId) : scoped.is('project_id', null);
    return scoped;
  };

  router.get('/', async (req: AuthedRequest, res: Response) => {
    try {
      const companyId = getTenant(req, res);
      if (!companyId) return;
      const projectId = normalizeProjectId(req.query.project_id);

      if (!(await verifyProject(companyId, projectId))) {
        return res.status(404).json({ success: false, error: 'Project not found in this company' });
      }

      const ideasQuery = scopeQuery(
        supabase.from('innovation_ideas').select('*'),
        companyId,
        projectId
      ).order('created_at', { ascending: false });

      const constraintsQuery = scopeQuery(
        supabase.from('innovation_constraints').select('*'),
        companyId,
        projectId
      ).order('resolved', { ascending: true }).order('created_at', { ascending: false });

      const productivityQuery = scopeQuery(
        supabase.from('innovation_productivity').select('*'),
        companyId,
        projectId
      ).order('work_date', { ascending: false }).order('created_at', { ascending: false }).limit(30);

      const [ideasResult, constraintsResult, productivityResult] = await Promise.all([
        ideasQuery,
        constraintsQuery,
        productivityQuery
      ]);

      const error = ideasResult.error || constraintsResult.error || productivityResult.error;
      if (error) throw error;

      return res.json({
        success: true,
        data: {
          ideas: ideasResult.data || [],
          constraints: constraintsResult.data || [],
          productivity: productivityResult.data || []
        }
      });
    } catch (error: any) {
      console.error('Innovation overview error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to load innovation data' });
    }
  });

  router.post('/ideas', async (req: AuthedRequest, res: Response) => {
    try {
      const companyId = getTenant(req, res);
      if (!companyId) return;
      const projectId = normalizeProjectId(req.body.project_id);
      const title = String(req.body.title || '').trim();
      const area = String(req.body.area || 'Productivity').trim();
      const impact = Number(req.body.impact ?? 3);
      const effort = Number(req.body.effort ?? 3);

      if (!title || title.length > 255) {
        return res.status(400).json({ success: false, error: 'Title is required and must be 255 characters or less' });
      }
      if (!Number.isInteger(impact) || impact < 1 || impact > 5 || !Number.isInteger(effort) || effort < 1 || effort > 5) {
        return res.status(400).json({ success: false, error: 'Impact and effort must be whole numbers from 1 to 5' });
      }
      if (!(await verifyProject(companyId, projectId))) {
        return res.status(404).json({ success: false, error: 'Project not found in this company' });
      }

      const { data, error } = await supabase
        .from('innovation_ideas')
        .insert({
          company_id: companyId,
          project_id: projectId,
          created_by: req.user?.id || null,
          title,
          area: area || 'Productivity',
          impact,
          effort,
          status: 'idea'
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ success: true, data });
    } catch (error: any) {
      console.error('Create innovation idea error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to create innovation idea' });
    }
  });

  router.patch('/ideas/:id', async (req: AuthedRequest, res: Response) => {
    try {
      const companyId = getTenant(req, res);
      if (!companyId) return;
      const updates: Record<string, unknown> = {};

      if (req.body.status !== undefined) {
        const status = String(req.body.status);
        if (!allowedIdeaStatus.has(status)) {
          return res.status(400).json({ success: false, error: 'Invalid idea status' });
        }
        updates.status = status;
      }
      if (req.body.title !== undefined) {
        const title = String(req.body.title).trim();
        if (!title || title.length > 255) {
          return res.status(400).json({ success: false, error: 'Invalid title' });
        }
        updates.title = title;
      }
      if (req.body.area !== undefined) updates.area = String(req.body.area).trim().slice(0, 80);
      if (req.body.impact !== undefined) {
        const impact = Number(req.body.impact);
        if (!Number.isInteger(impact) || impact < 1 || impact > 5) {
          return res.status(400).json({ success: false, error: 'Impact must be 1 to 5' });
        }
        updates.impact = impact;
      }
      if (req.body.effort !== undefined) {
        const effort = Number(req.body.effort);
        if (!Number.isInteger(effort) || effort < 1 || effort > 5) {
          return res.status(400).json({ success: false, error: 'Effort must be 1 to 5' });
        }
        updates.effort = effort;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No supported updates provided' });
      }

      const { data, error } = await supabase
        .from('innovation_ideas')
        .update(updates)
        .eq('id', req.params.id)
        .eq('company_id', companyId)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'Innovation idea not found' });
      return res.json({ success: true, data });
    } catch (error: any) {
      console.error('Update innovation idea error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to update innovation idea' });
    }
  });

  router.post('/constraints', async (req: AuthedRequest, res: Response) => {
    try {
      const companyId = getTenant(req, res);
      if (!companyId) return;
      const projectId = normalizeProjectId(req.body.project_id);
      const title = String(req.body.title || '').trim();
      const owner = String(req.body.owner || 'Site').trim().slice(0, 120);
      const severity = String(req.body.severity || 'medium');

      if (!title || title.length > 255) {
        return res.status(400).json({ success: false, error: 'Constraint title is required' });
      }
      if (!allowedSeverity.has(severity)) {
        return res.status(400).json({ success: false, error: 'Invalid severity' });
      }
      if (!(await verifyProject(companyId, projectId))) {
        return res.status(404).json({ success: false, error: 'Project not found in this company' });
      }

      const { data, error } = await supabase
        .from('innovation_constraints')
        .insert({
          company_id: companyId,
          project_id: projectId,
          created_by: req.user?.id || null,
          title,
          owner: owner || 'Site',
          severity,
          resolved: false
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ success: true, data });
    } catch (error: any) {
      console.error('Create innovation constraint error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to create constraint' });
    }
  });

  router.patch('/constraints/:id', async (req: AuthedRequest, res: Response) => {
    try {
      const companyId = getTenant(req, res);
      if (!companyId) return;
      const updates: Record<string, unknown> = {};

      if (req.body.resolved !== undefined) {
        const resolved = Boolean(req.body.resolved);
        updates.resolved = resolved;
        updates.resolved_at = resolved ? new Date().toISOString() : null;
      }
      if (req.body.owner !== undefined) updates.owner = String(req.body.owner).trim().slice(0, 120);
      if (req.body.severity !== undefined) {
        const severity = String(req.body.severity);
        if (!allowedSeverity.has(severity)) {
          return res.status(400).json({ success: false, error: 'Invalid severity' });
        }
        updates.severity = severity;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No supported updates provided' });
      }

      const { data, error } = await supabase
        .from('innovation_constraints')
        .update(updates)
        .eq('id', req.params.id)
        .eq('company_id', companyId)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'Constraint not found' });
      return res.json({ success: true, data });
    } catch (error: any) {
      console.error('Update innovation constraint error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to update constraint' });
    }
  });

  router.post('/productivity', async (req: AuthedRequest, res: Response) => {
    try {
      const companyId = getTenant(req, res);
      if (!companyId) return;
      const projectId = normalizeProjectId(req.body.project_id);
      const plannedUnits = Number(req.body.planned_units ?? 0);
      const installedUnits = Number(req.body.installed_units ?? 0);
      const crewSize = Number(req.body.crew_size ?? 0);
      const workDate = String(req.body.work_date || new Date().toISOString().slice(0, 10));
      const unitLabel = String(req.body.unit_label || 'units').trim().slice(0, 40);

      if (![plannedUnits, installedUnits, crewSize].every(value => Number.isFinite(value) && value >= 0)) {
        return res.status(400).json({ success: false, error: 'Productivity values must be zero or greater' });
      }
      if (!Number.isInteger(crewSize)) {
        return res.status(400).json({ success: false, error: 'Crew size must be a whole number' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
        return res.status(400).json({ success: false, error: 'work_date must use YYYY-MM-DD' });
      }
      if (!(await verifyProject(companyId, projectId))) {
        return res.status(404).json({ success: false, error: 'Project not found in this company' });
      }

      const { data, error } = await supabase
        .from('innovation_productivity')
        .insert({
          company_id: companyId,
          project_id: projectId,
          created_by: req.user?.id || null,
          work_date: workDate,
          planned_units: plannedUnits,
          installed_units: installedUnits,
          crew_size: crewSize,
          unit_label: unitLabel || 'units',
          notes: req.body.notes ? String(req.body.notes).slice(0, 2000) : null
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ success: true, data });
    } catch (error: any) {
      console.error('Create innovation productivity error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to save productivity snapshot' });
    }
  });

  return router;
}
