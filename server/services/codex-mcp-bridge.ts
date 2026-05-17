/**
 * Codex MCP Bridge Service
 *
 * Bridges the Python Codex MCP server with our TypeScript/Node.js application
 * Provides seamless integration between Codex CLI and CortexBuild platform
 * Migrated to Supabase
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { SupabaseClient } from '@supabase/supabase-js';
import { addContext, addMessage, getOrCreateSession, buildEnhancedPrompt } from './mcp';

export interface CodexMessage {
  id: string;
  method: string;
  params?: any;
  result?: any;
  error?: any;
}

export interface CodexSession {
  sessionId: string;
  userId: string;
  codexProcess?: ChildProcess;
  isActive: boolean;
  lastActivity: Date;
}

export class CodexMCPBridge extends EventEmitter {
  private supabase: SupabaseClient;
  private sessions: Map<string, CodexSession> = new Map();
  private config: {
    command: string;
    args: string[];
    timeout: number;
    autoRestart: boolean;
  };

  constructor(supabase: SupabaseClient, config?: Partial<{
    command: string;
    args: string[];
    timeout: number;
    autoRestart: boolean;
  }>) {
    super();
    this.supabase = supabase;
    this.config = {
      command: 'npx',
      args: ['-y', 'codex', 'mcp'],
      timeout: 360000,
      autoRestart: true,
      ...config
    };
  }

  /**
   * Start a new Codex MCP session for a user
   */
  async startCodexSession(userId: string, sessionId?: string): Promise<string> {
    const mcpSessionId = await getOrCreateSession(this.supabase, userId, sessionId);

    if (this.sessions.has(mcpSessionId)) {
      const session = this.sessions.get(mcpSessionId)!;
      if (session.isActive) {
        return mcpSessionId;
      }
    }

    try {
      const codexProcess = spawn(this.config.command, this.config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CODEX_SESSION_ID: mcpSessionId,
          CODEX_USER_ID: userId
        }
      });

      const session: CodexSession = {
        sessionId: mcpSessionId,
        userId,
        codexProcess,
        isActive: true,
        lastActivity: new Date()
      };

      this.sessions.set(mcpSessionId, session);

      this.setupProcessHandlers(session);

      await addContext(this.supabase, mcpSessionId, userId, 'codex', {
        action: 'session_started',
        timestamp: new Date().toISOString(),
        config: this.config
      });

      await addMessage(this.supabase, mcpSessionId, 'system', 'Codex MCP session started');

      console.log(`🤖 Codex MCP session started: ${mcpSessionId}`);
      this.emit('sessionStarted', { sessionId: mcpSessionId, userId });

      return mcpSessionId;
    } catch (error) {
      console.error('❌ Failed to start Codex MCP session:', error);
      throw new Error(`Failed to start Codex session: ${error}`);
    }
  }

  /**
   * Send message to Codex MCP server
   */
  async sendToCodex(sessionId: string, message: string, context?: any): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive || !session.codexProcess) {
      throw new Error('Codex session not active');
    }

    try {
      const { messages, contexts } = await buildEnhancedPrompt(
        this.supabase,
        sessionId,
        message,
        'You are Codex, an advanced AI coding assistant integrated with CortexBuild platform.'
      );

      await addMessage(this.supabase, sessionId, 'user', message);

      if (context) {
        await addContext(this.supabase, sessionId, session.userId, 'code', context);
      }

      const codexMessage: CodexMessage = {
        id: `msg_${Date.now()}`,
        method: 'chat',
        params: {
          messages,
          contexts,
          user_id: session.userId,
          session_id: sessionId
        }
      };

      const response = await this.sendMessageToProcess(session, codexMessage);

      if (response.result) {
        await addMessage(this.supabase, sessionId, 'assistant', response.result.content || JSON.stringify(response.result));
      }

      session.lastActivity = new Date();
      return response;
    } catch (error) {
      console.error('❌ Error sending to Codex:', error);
      await addMessage(this.supabase, sessionId, 'system', `Error: ${error}`);
      throw error;
    }
  }

  /**
   * Execute code through Codex
   */
  async executeCode(sessionId: string, code: string, language: string = 'typescript'): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error('Codex session not active');
    }

    const codexMessage: CodexMessage = {
      id: `exec_${Date.now()}`,
      method: 'execute',
      params: {
        code,
        language,
        session_id: sessionId,
        user_id: session.userId
      }
    };

    await addContext(this.supabase, sessionId, session.userId, 'code', {
      action: 'code_execution',
      language,
      code: code.substring(0, 500),
      timestamp: new Date().toISOString()
    });

    await addMessage(this.supabase, sessionId, 'user', `Execute ${language} code: ${code.substring(0, 100)}...`);

    const response = await this.sendMessageToProcess(session, codexMessage);

    if (response.result) {
      await addMessage(this.supabase, sessionId, 'assistant', `Execution result: ${JSON.stringify(response.result)}`);
    }

    return response;
  }

  /**
   * Get code suggestions from Codex
   */
  async getCodeSuggestions(sessionId: string, prompt: string, context?: any): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error('Codex session not active');
    }

    const codexMessage: CodexMessage = {
      id: `suggest_${Date.now()}`,
      method: 'suggest',
      params: {
        prompt,
        context,
        session_id: sessionId,
        user_id: session.userId
      }
    };

    await addContext(this.supabase, sessionId, session.userId, 'code', {
      action: 'code_suggestion',
      prompt,
      context,
      timestamp: new Date().toISOString()
    });

    await addMessage(this.supabase, sessionId, 'user', `Code suggestion request: ${prompt}`);

    const response = await this.sendMessageToProcess(session, codexMessage);

    if (response.result) {
      await addMessage(this.supabase, sessionId, 'assistant', `Code suggestions: ${JSON.stringify(response.result)}`);
    }

    return response;
  }

  /**
   * Stop Codex session
   */
  async stopCodexSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      if (session.codexProcess && session.isActive) {
        session.codexProcess.kill('SIGTERM');

        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (session.codexProcess) {
              session.codexProcess.kill('SIGKILL');
            }
            resolve();
          }, 5000);

          session.codexProcess!.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }

      session.isActive = false;
      this.sessions.delete(sessionId);

      await addMessage(this.supabase, sessionId, 'system', 'Codex MCP session ended');

      console.log(`🛑 Codex MCP session stopped: ${sessionId}`);
      this.emit('sessionStopped', { sessionId });
    } catch (error) {
      console.error('❌ Error stopping Codex session:', error);
    }
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): CodexSession[] {
    return Array.from(this.sessions.values()).filter(s => s.isActive);
  }

  /**
   * Cleanup inactive sessions
   */
  async cleanupInactiveSessions(maxIdleTime: number = 30 * 60 * 1000): Promise<void> {
    const now = new Date();
    const sessionsToCleanup: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (now.getTime() - session.lastActivity.getTime() > maxIdleTime) {
        sessionsToCleanup.push(sessionId);
      }
    }

    for (const sessionId of sessionsToCleanup) {
      await this.stopCodexSession(sessionId);
    }

    console.log(`🧹 Cleaned up ${sessionsToCleanup.length} inactive Codex sessions`);
  }

  /**
   * Setup process event handlers
   */
  private setupProcessHandlers(session: CodexSession): void {
    if (!session.codexProcess) return;

    session.codexProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log(`📤 Codex stdout [${session.sessionId}]:`, output);
      this.emit('codexOutput', { sessionId: session.sessionId, output, type: 'stdout' });
    });

    session.codexProcess.stderr?.on('data', (data) => {
      const error = data.toString();
      console.error(`📥 Codex stderr [${session.sessionId}]:`, error);
      this.emit('codexOutput', { sessionId: session.sessionId, output: error, type: 'stderr' });
    });

    session.codexProcess.on('exit', (code, signal) => {
      console.log(`🔚 Codex process exited [${session.sessionId}]: code=${code}, signal=${signal}`);
      session.isActive = false;

      if (this.config.autoRestart && code !== 0) {
        console.log(`🔄 Auto-restarting Codex session: ${session.sessionId}`);
        setTimeout(() => {
          this.startCodexSession(session.userId, session.sessionId);
        }, 2000);
      }

      this.emit('processExit', { sessionId: session.sessionId, code, signal });
    });

    session.codexProcess.on('error', (error) => {
      console.error(`❌ Codex process error [${session.sessionId}]:`, error);
      session.isActive = false;
      this.emit('processError', { sessionId: session.sessionId, error });
    });
  }

  /**
   * Send message to Codex process and wait for response
   */
  private async sendMessageToProcess(session: CodexSession, message: CodexMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!session.codexProcess || !session.isActive) {
        reject(new Error('Codex process not available'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Codex request timeout'));
      }, this.config.timeout);

      const responseHandler = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === message.id) {
            clearTimeout(timeout);
            session.codexProcess!.stdout?.off('data', responseHandler);
            resolve(response);
          }
        } catch {
          // Ignore parsing errors, might be partial data
        }
      };

      session.codexProcess.stdout?.on('data', responseHandler);

      const messageStr = JSON.stringify(message) + '\n';
      session.codexProcess.stdin?.write(messageStr);
    });
  }
}

export default CodexMCPBridge;
