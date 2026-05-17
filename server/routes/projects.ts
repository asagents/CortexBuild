// CortexBuild Platform - Projects API Routes
// Version: 2.0.0 - Supabase Migration
// Last Updated: 2025-10-31

import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Project, ApiResponse, PaginatedResponse, ProjectFilters } from '../types';
import { logProjectActivity } from '../utils/activity-logger';
import { asyncHandler, ValidationError, NotFoundError, DatabaseError } from '../middleware/errorHandler';
import {
  validateBody,
  validateQuery,
  validateParams,
  createProjectSchema,
  updateProjectSchema,
  projectFiltersSchema,
  idParamSchema
} from '../utils/validation';

export function createProjectsRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // GET /api/projects - List all projects with filters
  router.get('/', validateQuery(projectFiltersSchema), asyncHandler(async (req: Request, res: Response) => {
    const {
      status,
      priority,
      client_id,
      project_manager_id,
      company_id,
      search,
      page = 1,
      limit = 20
    } = req.query as any;

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;

    // Use a custom rpc if available, otherwise emulate with query builder
    // Fallback: fetch projects and count in two calls
    let query = supabase.from('projects').select('*', { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (client_id) query = query.eq('client_id', Number(client_id));
    if (project_manager_id) query = query.eq('project_manager_id', Number(project_manager_id));
    if (company_id) query = query.eq('company_id', Number(company_id));
    if (search && typeof search === 'string' && search.length >= 2) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,project_number.ilike.%${search}%`);
    }

    const { data: projects, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) throw new DatabaseError('Failed to fetch projects: ' + error.message);

    const total = count || 0;

    // Enrich with client and manager names
    const clientIds = [...new Set((projects || []).map((p: any) => p.client_id).filter(Boolean))];
    const managerIds = [...new Set((projects || []).map((p: any) => p.project_manager_id).filter(Boolean))];

    const { data: clients } = clientIds.length ? await supabase.from('clients').select('id,name').in('id', clientIds) : { data: [] };
    const { data: managers } = managerIds.length ? await supabase.from('users').select('id,name').in('id', managerIds) : { data: [] };

    const clientMap = new Map((clients || []).map((c: any) => [c.id, c.name]));
    const managerMap = new Map((managers || []).map((m: any) => [m.id, m.name]));

    const enriched = (projects || []).map((p: any) => ({
      ...p,
      client_name: clientMap.get(p.client_id) || null,
      manager_name: managerMap.get(p.project_manager_id) || null
    }));

    const response: PaginatedResponse<Project> = {
      success: true,
      data: enriched as Project[],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    };

    res.json(response);
  }));

  // GET /api/projects/:id - Get single project
  router.get('/:id', validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const projectId = Number(id);

    const { data: project, error } = await supabase
      .from('projects')
      .select('*, clients(name), users!projects_project_manager_id_fkey(name)')
      .eq('id', projectId)
      .single();

    if (error || !project) {
      throw new NotFoundError('Project');
    }

    const { data: tasks } = await supabase
      .from('tasks')
      .select('*, users!tasks_assigned_to_fkey(name)')
      .eq('project_id', projectId)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true });

    const { data: milestones } = await supabase
      .from('milestones')
      .select('*')
      .eq('project_id', projectId)
      .order('due_date', { ascending: true });

    const { data: team } = await supabase
      .from('project_team')
      .select('*, users!project_team_user_id_fkey(name, email, avatar)')
      .eq('project_id', projectId)
      .is('left_at', null);

    const { data: activities } = await supabase
      .from('activities')
      .select('*, users!activities_user_id_fkey(name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(20);

    const response: ApiResponse = {
      success: true,
      data: {
        ...project,
        tasks: tasks || [],
        milestones: milestones || [],
        team: team || [],
        activities: activities || []
      }
    };

    res.json(response);
  }));

  // POST /api/projects - Create new project
  router.post('/', validateBody(createProjectSchema), asyncHandler(async (req: Request, res: Response) => {
    const {
      company_id,
      name,
      description,
      project_number,
      status = 'planning',
      priority = 'medium',
      start_date,
      end_date,
      budget,
      address,
      city,
      state,
      zip_code,
      client_id,
      project_manager_id
    } = req.body;

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        company_id,
        name: name?.trim(),
        description: description?.trim() || null,
        project_number: project_number?.trim() || null,
        status,
        priority,
        start_date: start_date || null,
        end_date: end_date || null,
        budget: budget || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        zip_code: zip_code?.trim() || null,
        client_id: client_id || null,
        project_manager_id: project_manager_id || null
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // unique_violation
        throw new ValidationError('A project with this number already exists');
      }
      if (error.code === '23503') { // foreign_key_violation
        throw new ValidationError('Invalid reference to company, client, or project manager');
      }
      throw new DatabaseError('Failed to create project');
    }

    res.status(201).json({
      success: true,
      data: project,
      message: 'Project created successfully'
    });
  }));

  // PUT /api/projects/:id - Update project
  router.put('/:id', validateParams(idParamSchema), validateBody(updateProjectSchema), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const updates = req.body;
    const projectId = Number(id);

    const { data: existing, error: findErr } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .single();

    if (findErr || !existing) {
      throw new NotFoundError('Project');
    }

    const patch: any = {};
    if (updates.name !== undefined) patch.name = updates.name?.trim();
    if (updates.description !== undefined) patch.description = updates.description?.trim() || null;
    if (updates.project_number !== undefined) patch.project_number = updates.project_number?.trim() || null;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (updates.start_date !== undefined) patch.start_date = updates.start_date || null;
    if (updates.end_date !== undefined) patch.end_date = updates.end_date || null;
    if (updates.budget !== undefined) patch.budget = updates.budget || null;
    if (updates.address !== undefined) patch.address = updates.address?.trim() || null;
    if (updates.city !== undefined) patch.city = updates.city?.trim() || null;
    if (updates.state !== undefined) patch.state = updates.state?.trim() || null;
    if (updates.zip_code !== undefined) patch.zip_code = updates.zip_code?.trim() || null;
    if (updates.client_id !== undefined) patch.client_id = updates.client_id || null;
    if (updates.project_manager_id !== undefined) patch.project_manager_id = updates.project_manager_id || null;

    const { data: project, error } = await supabase
      .from('projects')
      .update(patch)
      .eq('id', projectId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ValidationError('A project with this number already exists');
      }
      if (error.code === '23503') {
        throw new ValidationError('Invalid reference to client or project manager');
      }
      throw new DatabaseError('Failed to update project');
    }

    res.json({
      success: true,
      data: project,
      message: 'Project updated successfully'
    });
  }));

  // DELETE /api/projects/:id - Delete project
  router.delete('/:id', validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const projectId = Number(id);

    const { data: existing, error: findErr } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .single();

    if (findErr || !existing) {
      throw new NotFoundError('Project');
    }

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (error) {
      if (error.code === '23503') {
        throw new ValidationError('Cannot delete project with existing dependencies (tasks, activities, etc.)');
      }
      throw new DatabaseError('Failed to delete project');
    }

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });
  }));

  return router;
}
