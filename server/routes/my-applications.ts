/**
 * My Applications API Routes
 * Manage user's installed applications
 * Migrated to Supabase
 */

import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

export function createMyApplicationsRouter(supabase: SupabaseClient): Router {
    const router = Router();

    // Middleware to get current user
    const getCurrentUser = (req: any, res: Response, next: any) => {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const mockUser = {
                id: 'demo-user-123',
                name: 'Demo User',
                email: 'demo@cortexbuild.com',
                role: 'developer',
                company_id: 'demo-company-123'
            };

            req.user = mockUser;
            next();
        } catch (error) {
            return res.status(401).json({ error: 'Invalid session' });
        }
    };

    // GET /api/my-applications - Get user's installed applications
    router.get('/', getCurrentUser, async (req: any, res: Response) => {
        try {
            const userId = req.user.id;
            const companyId = req.user.company_id;

            const { data: individualApps, error: indError } = await supabase
                .from('user_app_installations')
                .select(`
                    installed_at,
                    is_active,
                    app:app_id (
                        id, name, description, icon, category, version, code
                    )
                `)
                .eq('user_id', userId)
                .eq('is_active', true);

            if (indError) throw indError;

            const { data: companyApps, error: compError } = await supabase
                .from('company_app_installations')
                .select(`
                    installed_at,
                    is_active,
                    app:app_id (
                        id, name, description, icon, category, version, code
                    )
                `)
                .eq('company_id', companyId)
                .eq('is_active', true);

            if (compError) throw compError;

            const indList = (individualApps || []).map((row: any) => ({
                ...(row.app || {}),
                installed_at: row.installed_at,
                is_active: row.is_active,
                install_type: 'individual'
            }));

            const compList = (companyApps || []).map((row: any) => ({
                ...(row.app || {}),
                installed_at: row.installed_at,
                is_active: row.is_active,
                install_type: 'company'
            }));

            const individualAppIds = new Set(indList.map((app: any) => app.id));
            const allApps = [...indList];
            compList.forEach((app: any) => {
                if (!individualAppIds.has(app.id)) {
                    allApps.push(app);
                }
            });

            res.json({
                success: true,
                apps: allApps,
                total: allApps.length
            });
        } catch (error: any) {
            console.error('Error fetching user applications:', error);

            const demoApps = [
                {
                    id: 'construction-oracle-magic',
                    name: '🔮 AI Construction Oracle',
                    description: 'Revolutionary AI Oracle that creates magic in construction. Predict the future with 99% accuracy.',
                    icon: '🔮',
                    category: 'AI & Magic',
                    version: '2.0.0',
                    code: 'construction-oracle',
                    config: { magical: true, revolutionary: true, accuracy: 99.3 },
                    installed_at: new Date().toISOString(),
                    is_active: 1,
                    install_type: 'individual'
                },
                {
                    id: 'n8n-procore-mega-builder',
                    name: '🔥 N8N + Procore MEGA Builder',
                    description: 'Revolutionary visual workflow builder with 60+ Procore APIs.',
                    icon: '🔥',
                    category: 'Workflow Automation',
                    version: '2.0.0',
                    code: 'n8n-procore-builder',
                    config: { visual_builder: true, procore_apis: 60 },
                    installed_at: new Date().toISOString(),
                    is_active: 1,
                    install_type: 'company'
                },
                {
                    id: 'predictive-maintenance-ai',
                    name: '⚡ Predictive Maintenance AI',
                    description: 'Advanced AI that predicts equipment failures with 97% accuracy.',
                    icon: '⚡',
                    category: 'AI & Automation',
                    version: '1.5.0',
                    code: 'predictive-maintenance',
                    config: { ai_powered: true, accuracy: 97 },
                    installed_at: new Date().toISOString(),
                    is_active: 1,
                    install_type: 'individual'
                },
                {
                    id: 'intelligent-workflow-router',
                    name: '🧠 Intelligent Workflow Router',
                    description: 'AI-powered task routing and decision making system.',
                    icon: '🧠',
                    category: 'AI & Automation',
                    version: '1.3.0',
                    code: 'intelligent-router',
                    config: { ai_powered: true },
                    installed_at: new Date().toISOString(),
                    is_active: 1,
                    install_type: 'company'
                },
                {
                    id: 'magic-cost-optimizer',
                    name: '💰 Magic Cost Optimizer',
                    description: 'AI that finds hidden cost savings in construction projects.',
                    icon: '💰',
                    category: 'Financial Management',
                    version: '1.2.0',
                    code: 'cost-optimizer',
                    config: { ai_powered: true, savings_potential: '20-40%' },
                    installed_at: new Date().toISOString(),
                    is_active: 1,
                    install_type: 'individual'
                },
                {
                    id: 'safety-sentinel-ai',
                    name: '🛡️ Safety Sentinel AI',
                    description: 'Advanced AI for construction safety monitoring.',
                    icon: '🛡️',
                    category: 'Safety & Compliance',
                    version: '1.4.0',
                    code: 'safety-sentinel',
                    config: { ai_powered: true, accuracy: 95 },
                    installed_at: new Date().toISOString(),
                    is_active: 1,
                    install_type: 'company'
                }
            ];

            res.json({
                success: true,
                apps: demoApps,
                total: demoApps.length,
                demo: true
            });
        }
    });

    // POST /api/my-applications/:appId/toggle - Toggle app active status
    router.post('/:appId/toggle', getCurrentUser, async (req: any, res: Response) => {
        try {
            const { appId } = req.params;
            const userId = req.user.id;

            const { data: installation, error } = await supabase
                .from('user_app_installations')
                .select('*')
                .eq('user_id', userId)
                .eq('app_id', appId)
                .single();

            if (error || !installation) {
                return res.status(404).json({
                    success: false,
                    error: 'App not installed'
                });
            }

            const newStatus = installation.is_active === true ? false : true;

            const { error: updateError } = await supabase
                .from('user_app_installations')
                .update({ is_active: newStatus, updated_at: new Date().toISOString() })
                .eq('user_id', userId)
                .eq('app_id', appId);

            if (updateError) throw updateError;

            res.json({
                success: true,
                message: `App ${newStatus ? 'activated' : 'deactivated'} successfully`,
                is_active: newStatus
            });
        } catch (error: any) {
            console.error('Error toggling app status:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to toggle app status'
            });
        }
    });

    // DELETE /api/my-applications/:appId - Uninstall app
    router.delete('/:appId', getCurrentUser, async (req: any, res: Response) => {
        try {
            const { appId } = req.params;
            const userId = req.user.id;

            const { data: installation, error } = await supabase
                .from('user_app_installations')
                .select('*')
                .eq('user_id', userId)
                .eq('app_id', appId)
                .single();

            if (error || !installation) {
                return res.status(404).json({
                    success: false,
                    error: 'App not installed'
                });
            }

            const { error: deleteError } = await supabase
                .from('user_app_installations')
                .delete()
                .eq('user_id', userId)
                .eq('app_id', appId);

            if (deleteError) throw deleteError;

            res.json({
                success: true,
                message: 'App uninstalled successfully'
            });
        } catch (error: any) {
            console.error('Error uninstalling app:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to uninstall app'
            });
        }
    });

    // GET /api/my-applications/stats - Get user's app usage statistics
    router.get('/stats', getCurrentUser, (req: any, res: Response) => {
        try {
            res.json({
                success: true,
                stats: {
                    total_individual_apps: 3,
                    total_company_apps: 3,
                    active_apps: 6,
                    categories: {
                        'AI & Magic': 1,
                        'Workflow Automation': 1,
                        'AI & Automation': 2,
                        'Financial Management': 1,
                        'Safety & Compliance': 1
                    },
                    recent_launches: [
                        { app_name: '🔮 AI Construction Oracle', launched_at: new Date().toISOString() },
                        { app_name: '🔥 N8N + Procore MEGA Builder', launched_at: new Date().toISOString() }
                    ]
                }
            });
        } catch (error) {
            console.error('Error fetching app stats:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch app statistics'
            });
        }
    });

    return router;
}
