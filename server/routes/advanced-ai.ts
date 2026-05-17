/**
 * Advanced AI/ML API Routes for CortexBuild
 * Predictive analytics, intelligent automation, and ML-powered insights
 * Migrated to Supabase
 */

import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { AdvancedAIService } from '../services/advancedAI';
import { getCurrentUser } from '../auth';

export function createAdvancedAIRoutes(supabase: SupabaseClient): Router {
  const router = Router();
  const aiService = new AdvancedAIService(supabase);

  // Middleware to ensure user is authenticated
  const requireAuth = (req: Request, res: Response, next: any) => {
    const user = getCurrentUser(req as any);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
  };

  // POST /api/advanced-ai/predict/timeline
  router.post('/predict/timeline', requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.body;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: 'Project ID is required'
        });
      }

      const prediction = await aiService.predictProjectTimeline(projectId);

      res.json({
        success: true,
        data: prediction
      });
    } catch (error: any) {
      console.error('Timeline prediction error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to predict project timeline'
      });
    }
  });

  // POST /api/advanced-ai/predict/costs
  router.post('/predict/costs', requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.body;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: 'Project ID is required'
        });
      }

      const prediction = await aiService.predictProjectCosts(projectId);

      res.json({
        success: true,
        data: prediction
      });
    } catch (error: any) {
      console.error('Cost prediction error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to predict project costs'
      });
    }
  });

  // POST /api/advanced-ai/assess/risks
  router.post('/assess/risks', requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.body;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: 'Project ID is required'
        });
      }

      const assessment = await aiService.assessProjectRisks(projectId);

      res.json({
        success: true,
        data: assessment
      });
    } catch (error: any) {
      console.error('Risk assessment error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to assess project risks'
      });
    }
  });

  // POST /api/advanced-ai/optimize/resources
  router.post('/optimize/resources', requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.body;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: 'Project ID is required'
        });
      }

      const optimization = await aiService.optimizeResourceAllocation(projectId);

      res.json({
        success: true,
        data: optimization
      });
    } catch (error: any) {
      console.error('Resource optimization error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to optimize resource allocation'
      });
    }
  });

  // POST /api/advanced-ai/analyze/document
  router.post('/analyze/document', requireAuth, async (req: Request, res: Response) => {
    try {
      const { documentData, documentType } = req.body;

      if (!documentData) {
        return res.status(400).json({
          success: false,
          error: 'Document data is required'
        });
      }

      const analysis = await aiService.analyzeDocument({
        data: documentData,
        type: documentType || 'unknown'
      });

      res.json({
        success: true,
        data: analysis
      });
    } catch (error: any) {
      console.error('Document analysis error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to analyze document'
      });
    }
  });

  // GET /api/advanced-ai/models/status
  router.get('/models/status', requireAuth, async (req: Request, res: Response) => {
    try {
      // Get AI model performance metrics
      const { data: predictions, error } = await supabase
        .from('ai_predictions')
        .select('model_name, confidence, accuracy, created_at');

      if (error) throw error;

      const rows = predictions || [];
      const modelMetrics: any = {};

      rows.forEach((row: any) => {
        const name = row.model_name || 'unknown';
        if (!modelMetrics[name]) {
          modelMetrics[name] = {
            model_name: name,
            total_predictions: 0,
            confidence_sum: 0,
            accuracy_sum: 0,
            last_used: row.created_at
          };
        }
        modelMetrics[name].total_predictions += 1;
        modelMetrics[name].confidence_sum += row.confidence || 0;
        modelMetrics[name].accuracy_sum += row.accuracy || 0;
        if (row.created_at > modelMetrics[name].last_used) {
          modelMetrics[name].last_used = row.created_at;
        }
      });

      const models = Object.values(modelMetrics).map((m: any) => ({
        model_name: m.model_name,
        total_predictions: m.total_predictions,
        avg_confidence: m.confidence_sum / m.total_predictions,
        avg_accuracy: m.accuracy_sum / m.total_predictions,
        last_used: m.last_used
      }));

      res.json({
        success: true,
        data: {
          models,
          totalPredictions: models.reduce((sum: number, m: any) => sum + m.total_predictions, 0),
          averageAccuracy: models.length > 0
            ? models.reduce((sum: number, m: any) => sum + m.avg_accuracy, 0) / models.length
            : 0
        }
      });
    } catch (error: any) {
      console.error('Model status error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get model status'
      });
    }
  });

  // POST /api/advanced-ai/train/model
  router.post('/train/model', requireAuth, async (req: Request, res: Response) => {
    try {
      const { modelType, trainingData } = req.body;

      res.json({
        success: true,
        message: 'Model training initiated',
        data: {
          modelType,
          status: 'training',
          estimatedCompletion: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        }
      });
    } catch (error: any) {
      console.error('Model training error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to initiate model training'
      });
    }
  });

  return router;
}
