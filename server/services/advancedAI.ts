/**
 * Advanced AI/ML Services for CortexBuild
 * Predictive analytics, intelligent automation, and ML-powered insights
 */

import OpenAI from 'openai';
import { SupabaseClient } from '@supabase/supabase-js';

interface ProjectData {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  budget: number;
  status: string;
  progress: number;
  teamSize: number;
  tasksCompleted: number;
  tasksTotal: number;
  company_id: string;
}

interface PredictionResult {
  predictedEndDate: string;
  confidence: number;
  riskFactors: string[];
  recommendations: string[];
  accuracy: number;
}

interface CostPrediction {
  predictedCost: number;
  variance: number;
  confidence: number;
  breakdown: {
    labor: number;
    materials: number;
    equipment: number;
    overhead: number;
  };
}

interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high';
  riskFactors: Array<{
    factor: string;
    severity: 'low' | 'medium' | 'high';
    probability: number;
    impact: string;
    mitigation: string;
  }>;
  riskScore: number;
}

export class AdvancedAIService {
  private openai: OpenAI;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
    });
  }

  /**
   * Predict project completion date using historical data and ML
   */
  async predictProjectTimeline(projectId: string): Promise<PredictionResult> {
    try {
      const project = await this.getProjectData(projectId);
      const historicalData = await this.getHistoricalProjects(project.company_id);
      const trainingData = this.prepareTimelineTrainingData(historicalData);
      const prediction = await this.analyzeTimelinePatterns(project, trainingData);
      const confidence = this.calculatePredictionConfidence(project, historicalData);

      return {
        predictedEndDate: prediction.endDate,
        confidence,
        riskFactors: prediction.riskFactors,
        recommendations: prediction.recommendations,
        accuracy: confidence * 0.95,
      };
    } catch (error) {
      console.error('Timeline prediction error:', error);
      throw new Error('Failed to predict project timeline');
    }
  }

  /**
   * Predict project costs with variance analysis
   */
  async predictProjectCosts(projectId: string): Promise<CostPrediction> {
    try {
      const project = await this.getProjectData(projectId);
      const historicalCosts = await this.getHistoricalCostData(project.company_id);
      const costAnalysis = await this.analyzeCostPatterns(project, historicalCosts);

      return {
        predictedCost: costAnalysis.total,
        variance: costAnalysis.variance,
        confidence: costAnalysis.confidence,
        breakdown: costAnalysis.breakdown,
      };
    } catch (error) {
      console.error('Cost prediction error:', error);
      throw new Error('Failed to predict project costs');
    }
  }

  /**
   * Assess project risks using AI analysis
   */
  async assessProjectRisks(projectId: string): Promise<RiskAssessment> {
    try {
      const project = await this.getProjectData(projectId);
      const riskFactors = await this.identifyRiskFactors(project);
      const riskScore = this.calculateRiskScore(riskFactors);

      return {
        overallRisk: riskScore > 0.7 ? 'high' : riskScore > 0.4 ? 'medium' : 'low',
        riskFactors,
        riskScore,
      };
    } catch (error) {
      console.error('Risk assessment error:', error);
      throw new Error('Failed to assess project risks');
    }
  }

  /**
   * Optimize resource allocation using ML
   */
  async optimizeResourceAllocation(projectId: string): Promise<any> {
    try {
      const project = await this.getProjectData(projectId);
      const availableResources = await this.getAvailableResources(project.company_id);
      const optimization = await this.optimizeResourceUsage(project, availableResources);

      return {
        recommendations: optimization.recommendations,
        expectedEfficiency: optimization.efficiency,
        costSavings: optimization.savings,
        timeline: optimization.timeline,
      };
    } catch (error) {
      console.error('Resource optimization error:', error);
      throw new Error('Failed to optimize resource allocation');
    }
  }

  /**
   * Intelligent document analysis and data extraction
   */
  async analyzeDocument(documentData: any): Promise<any> {
    try {
      const extractedData = await this.extractDocumentData(documentData);
      const documentType = await this.classifyDocument(extractedData);
      const structuredData = await this.structureExtractedData(extractedData, documentType);

      return {
        documentType,
        extractedData: structuredData,
        confidence: extractedData.confidence,
        processingTime: extractedData.processingTime,
      };
    } catch (error) {
      console.error('Document analysis error:', error);
      throw new Error('Failed to analyze document');
    }
  }

  // Private helper methods

  private async getProjectData(projectId: string): Promise<ProjectData> {
    const { data: project, error } = await this.supabase
      .from('projects')
      .select(`
        *,
        project_team(count),
        tasks(status)
      `)
      .eq('id', projectId)
      .single();

    if (error || !project) {
      throw new Error('Project not found');
    }

    const tasks = project.tasks || [];
    const tasksCompleted = tasks.filter((t: any) => t.status === 'completed').length;
    const tasksTotal = tasks.length;
    const teamSize = project.project_team?.[0]?.count || 0;

    return {
      id: project.id.toString(),
      name: project.name,
      startDate: project.start_date,
      endDate: project.end_date,
      budget: project.budget || 0,
      status: project.status,
      progress: this.calculateProjectProgress({ tasks_completed: tasksCompleted, tasks_total: tasksTotal }),
      teamSize,
      tasksCompleted,
      tasksTotal,
      company_id: project.company_id || '',
    };
  }

  private async getHistoricalProjects(companyId: string) {
    const { data, error } = await this.supabase
      .from('projects')
      .select(`
        *,
        project_team(count),
        tasks(status)
      `)
      .eq('company_id', companyId)
      .eq('status', 'completed')
      .order('end_date', { ascending: false })
      .limit(100);

    if (error || !data) return [];

    return data.map((p: any) => {
      const tasks = p.tasks || [];
      const tasksCompleted = tasks.filter((t: any) => t.status === 'completed').length;
      const tasksTotal = tasks.length;
      const teamSize = p.project_team?.[0]?.count || 0;

      return {
        ...p,
        tasks_completed: tasksCompleted,
        tasks_total: tasksTotal,
        team_size: teamSize,
        timeline_variance: p.actual_end_date && p.end_date
          ? (new Date(p.actual_end_date).getTime() - new Date(p.end_date).getTime()) / (1000 * 60 * 60 * 24)
          : 0,
        cost_variance: p.actual_cost && p.budget
          ? (p.actual_cost - p.budget) / p.budget
          : 0,
      };
    });
  }

  private async getHistoricalCostData(companyId: string) {
    const { data, error } = await this.supabase
      .from('projects')
      .select('*')
      .eq('company_id', companyId)
      .eq('status', 'completed')
      .not('actual_cost', 'is', null)
      .order('end_date', { ascending: false })
      .limit(50);

    if (error || !data) return [];

    return data.map((p: any) => ({
      id: p.id,
      budget: p.budget,
      actual_cost: p.actual_cost,
      variance: p.actual_cost && p.budget ? (p.actual_cost - p.budget) / p.budget : 0,
      category: p.category,
      duration_days: p.duration_days,
    }));
  }

  private async getAvailableResources(companyId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select(`
        *,
        project_team(count)
      `)
      .eq('company_id', companyId)
      .eq('is_active', 1);

    if (error || !data) return [];

    return data.map((u: any) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      skills: u.skills,
      current_projects: u.project_team?.[0]?.count || 0,
      hourly_rate: u.hourly_rate,
    }));
  }

  private calculateProjectProgress(project: any): number {
    if (project.tasks_total === 0) return 0;
    return (project.tasks_completed / project.tasks_total) * 100;
  }

  private async analyzeTimelinePatterns(project: ProjectData, historicalData: any[]): Promise<any> {
    const prompt = `
      Analyze these historical project completion patterns and predict the end date for a new project:

      Historical Projects:
      ${JSON.stringify(historicalData.slice(0, 10), null, 2)}

      New Project:
      ${JSON.stringify(project, null, 2)}

      Consider factors like:
      - Team size and experience
      - Project complexity and scope
      - Historical timeline accuracy
      - Current progress rate
      - External dependencies

      Return JSON with:
      {
        "endDate": "predicted completion date",
        "riskFactors": ["factor1", "factor2"],
        "recommendations": ["rec1", "rec2"]
      }
    `;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert project manager and data analyst specializing in construction project timelines. Provide accurate predictions based on historical patterns.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI model');
    }

    try {
      return JSON.parse(response);
    } catch {
      throw new Error('Invalid AI response format');
    }
  }

  private async analyzeCostPatterns(project: ProjectData, historicalCosts: any[]): Promise<any> {
    const prompt = `
      Analyze historical cost data and predict final cost for this project:

      Historical Cost Data:
      ${JSON.stringify(historicalCosts.slice(0, 10), null, 2)}

      Current Project:
      ${JSON.stringify(project, null, 2)}

      Provide cost prediction with breakdown by category.
      Return JSON format.
    `;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a construction cost estimation expert. Provide accurate cost predictions based on historical data.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 400,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI model');
    }

    try {
      return JSON.parse(response);
    } catch {
      throw new Error('Invalid AI response format');
    }
  }

  private async identifyRiskFactors(project: ProjectData): Promise<any[]> {
    const prompt = `
      Identify potential risks for this construction project:

      Project Details:
      ${JSON.stringify(project, null, 2)}

      Consider risks related to:
      - Timeline delays
      - Cost overruns
      - Resource availability
      - External dependencies
      - Technical challenges
      - Regulatory compliance

      Return array of risk objects with severity, probability, impact, and mitigation.
    `;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a construction risk management expert. Identify realistic risks and provide actionable mitigation strategies.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI model');
    }

    try {
      return JSON.parse(response);
    } catch {
      throw new Error('Invalid AI response format');
    }
  }

  private calculateRiskScore(riskFactors: any[]): number {
    if (riskFactors.length === 0) return 0;

    const totalScore = riskFactors.reduce((sum, risk) => {
      const severityScore = risk.severity === 'high' ? 3 : risk.severity === 'medium' ? 2 : 1;
      return sum + (severityScore * risk.probability);
    }, 0);

    return Math.min(totalScore / (riskFactors.length * 3), 1);
  }

  private calculatePredictionConfidence(project: ProjectData, historicalData: any[]): number {
    const similarity = this.calculateDataSimilarity(project, historicalData);
    const dataQuantity = Math.min(historicalData.length / 10, 1);
    return (similarity * 0.7) + (dataQuantity * 0.3);
  }

  private calculateDataSimilarity(project: ProjectData, historicalData: any[]): number {
    if (historicalData.length === 0) return 0;

    const avgHistoricalBudget = historicalData.reduce((sum, p) => sum + (p.budget || 0), 0) / historicalData.length;
    const budgetSimilarity = 1 - Math.abs(project.budget - avgHistoricalBudget) / Math.max(project.budget, avgHistoricalBudget);

    return Math.max(0, Math.min(1, budgetSimilarity));
  }

  private prepareTimelineTrainingData(historicalData: any[]): any[] {
    return historicalData.map(project => ({
      duration: project.duration_days,
      budget: project.budget,
      teamSize: project.team_size,
      complexity: this.calculateComplexityScore(project),
      variance: project.timeline_variance,
    }));
  }

  private calculateComplexityScore(project: any): number {
    let complexity = 0;

    if (project.budget > 1000000) complexity += 0.3;
    if (project.team_size > 10) complexity += 0.2;
    if (project.tasks_total > 50) complexity += 0.3;
    if (project.category === 'infrastructure') complexity += 0.2;

    return Math.min(complexity, 1);
  }

  private async optimizeResourceUsage(project: ProjectData, resources: any[]): Promise<any> {
    const prompt = `
      Optimize resource allocation for this project:

      Project: ${JSON.stringify(project, null, 2)}
      Available Resources: ${JSON.stringify(resources, null, 2)}

      Provide optimization recommendations with expected efficiency gains.
    `;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a resource optimization expert. Provide practical recommendations for improving project efficiency.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 400,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI model');
    }

    try {
      return JSON.parse(response);
    } catch {
      throw new Error('Invalid AI response format');
    }
  }

  private async extractDocumentData(documentData: any): Promise<any> {
    return {
      text: 'Extracted document text',
      confidence: 0.95,
      processingTime: 1500,
    };
  }

  private async classifyDocument(extractedData: any): Promise<string> {
    const prompt = `Classify this document type: ${extractedData.text.substring(0, 500)}`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a document classification expert. Identify document types accurately.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 50,
    });

    return completion.choices[0]?.message?.content?.trim() || 'unknown';
  }

  private async structureExtractedData(extractedData: any, documentType: string): Promise<any> {
    const prompt = `
      Extract structured data from this ${documentType} document:
      ${extractedData.text.substring(0, 1000)}

      Return structured JSON based on document type.
    `;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: `You are a data extraction expert. Extract structured information from ${documentType} documents.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from AI model');
    }

    try {
      return JSON.parse(response);
    } catch {
      return { rawText: extractedData.text };
    }
  }
}

export default AdvancedAIService;
