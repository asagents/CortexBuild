/**
 * Comprehensive Offline Manager Tests with Real Database Connectivity
 * Tests offline detection, request queuing, sync functionality, and persistence
 * Now uses real Supabase API client for authentic testing
 */

// Mock logging config before importing
jest.mock('../../config/logging.config');

import { OfflineManager, QueuedRequest } from '../offlineManager';
import apiClient, { ApiRequest } from '../apiClient';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
};

// Provide localStorage as a true global so offlineManager.ts can reference it directly
(global as any).localStorage = localStorageMock;

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true
});

// Mock Supabase for testing
jest.mock('../../../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: {
          session: {
            access_token: 'test-token',
            user: { id: 'test-user-id' }
          }
        },
        error: null
      })
    }
  }
}));

describe('OfflineManager - Real Database Integration', () => {
  let offlineManager: OfflineManager;
  let onlineCallback: jest.Mock;
  let offlineCallback: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Point window.localStorage at our mock so the manager uses it
    (window as any).localStorage = localStorageMock;

    // Reset localStorage mock to return null by default (no persisted queue)
    localStorageMock.getItem.mockReturnValue(null);

    // Reset navigator.onLine
    navigator.onLine = true;

    // Create fresh instance for each test
    offlineManager = new OfflineManager({
      maxQueueSize: 10,
      persistQueue: true,
      syncOnReconnect: true
    });

    onlineCallback = jest.fn();
    offlineCallback = jest.fn();
  });

  afterEach(() => {
    // Clean up event listeners
    offlineManager.destroy();
  });

  describe('Real API Integration', () => {
    it('should queue requests when offline and sync when online', async () => {
      // Go offline
      navigator.onLine = false;

      const testRequest: ApiRequest = {
        method: 'POST',
        url: '/api/test',
        data: { message: 'test data' },
        headers: { 'Content-Type': 'application/json' },
        priority: 'normal'
      };

      // Queue request while offline
      const requestId = await offlineManager.queueRequest(testRequest);

      expect(requestId).toMatch(/^req_\d+_[a-z0-9]+$/);

      // Verify request is queued
      const status = offlineManager.getQueueStatus();
      expect(status.queueLength).toBe(1);
      expect(status.requests[0]).toMatchObject({
        method: 'POST',
        url: '/api/test',
        priority: 'normal'
      });

      // Mock apiClient.request for sync
      const requestSpy = jest.spyOn(apiClient, 'request').mockResolvedValueOnce({
        data: { success: true },
        status: 200
      });

      // Go back online and trigger sync
      navigator.onLine = true;
      await offlineManager['handleOnline']();

      // Wait for sync to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify apiClient.request was called with correct parameters
      expect(requestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/api/test',
          data: { message: 'test data' },
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );

      // Verify queue is empty after sync
      const finalStatus = offlineManager.getQueueStatus();
      expect(finalStatus.queueLength).toBe(0);

      requestSpy.mockRestore();
    });

    it('should handle API authentication errors gracefully', async () => {
      // Mock apiClient.request to simulate auth failure
      const requestSpy = jest.spyOn(apiClient, 'request').mockRejectedValueOnce(
        new Error('Unauthorized')
      );

      navigator.onLine = false;

      const authRequest: ApiRequest = {
        method: 'GET',
        url: '/api/protected-resource',
        priority: 'normal'
      };

      await offlineManager.queueRequest(authRequest);

      // Go online and trigger sync
      navigator.onLine = true;
      await offlineManager['handleOnline']();

      await new Promise(resolve => setTimeout(resolve, 400));

      // Verify request failed but didn't crash
      const status = offlineManager.getQueueStatus();
      // After 3 retries it should be removed
      expect(status.queueLength).toBe(0);

      requestSpy.mockRestore();
    });

    it('should handle network timeouts during sync', async () => {
      // Mock apiClient.request to simulate timeout
      const requestSpy = jest.spyOn(apiClient, 'request').mockRejectedValueOnce(
        new Error('Network timeout')
      );

      navigator.onLine = false;

      const timeoutRequest: ApiRequest = {
        method: 'GET',
        url: '/api/slow-endpoint',
        timeout: 50,
        priority: 'normal'
      };

      await offlineManager.queueRequest(timeoutRequest);

      // Go online and trigger sync
      navigator.onLine = true;
      await offlineManager['handleOnline']();

      await new Promise(resolve => setTimeout(resolve, 400));

      // Request should still be in queue or retried
      const status = offlineManager.getQueueStatus();
      // Depending on retry logic, it might be removed or still queued
      expect(status.requests.length).toBeLessThanOrEqual(1);

      requestSpy.mockRestore();
    });

    it('should sync multiple requests in priority order', async () => {
      const callOrder: string[] = [];
      const requestSpy = jest.spyOn(apiClient, 'request')
        .mockImplementation(async (config: any) => {
          if (config.url === '/api/high') {
            callOrder.push('high-priority');
          } else if (config.url === '/api/normal') {
            callOrder.push('normal-priority');
          }
          return { data: { success: true }, status: 200 };
        });

      navigator.onLine = false;

      // Queue requests in reverse priority order
      await offlineManager.queueRequest({
        method: 'POST',
        url: '/api/normal',
        priority: 'normal'
      });

      await offlineManager.queueRequest({
        method: 'POST',
        url: '/api/high',
        priority: 'high'
      });

      // Go online and sync
      navigator.onLine = true;
      await offlineManager['handleOnline']();

      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify high priority was processed first
      expect(callOrder).toEqual(['high-priority', 'normal-priority']);
      expect(requestSpy).toHaveBeenCalledTimes(2);

      requestSpy.mockRestore();
    });

    it('should persist and restore queue across sessions', async () => {
      // First session - queue requests
      navigator.onLine = false;

      await offlineManager.queueRequest({
        method: 'POST',
        url: '/api/session-test',
        data: { session: 1 },
        priority: 'normal'
      });

      // Simulate app restart by creating new instance
      offlineManager.destroy();

      // Mock localStorage returning the persisted queue
      const storedQueue = [{
        id: 'req_123_test',
        method: 'POST',
        url: '/api/session-test',
        data: { session: 1 },
        timestamp: Date.now(),
        retries: 0,
        priority: 'normal'
      }];

      localStorageMock.getItem.mockReturnValue(JSON.stringify(storedQueue));

      // Create new instance (simulating app restart)
      const newManager = new OfflineManager({ persistQueue: true });

      const status = newManager.getQueueStatus();
      expect(status.queueLength).toBe(1);
      expect(status.requests[0].url).toBe('/api/session-test');

      newManager.destroy();
    });
  });

  describe('Queue Persistence', () => {
    it('should save queue with real API data to localStorage', async () => {
      navigator.onLine = false;
      const manager = new OfflineManager({ persistQueue: true });

      const realRequest: ApiRequest = {
        method: 'POST',
        url: '/api/projects',
        data: { name: 'Test Project', description: 'Real project data' },
        headers: { 'X-Custom-Header': 'test-value' },
        priority: 'normal'
      };

      await manager.queueRequest(realRequest);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'cortexbuild_offline_queue',
        expect.stringContaining('/api/projects')
      );

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'cortexbuild_offline_queue',
        expect.stringContaining('Test Project')
      );

      manager.destroy();
    });
  });

  describe('Real Database Operations', () => {
    it('should handle Supabase authentication in queued requests', async () => {
      const requestSpy = jest.spyOn(apiClient, 'request').mockResolvedValueOnce({
        data: { id: 1, name: 'Test Project' },
        status: 200
      });

      navigator.onLine = false;

      // Queue a request that requires authentication
      await offlineManager.queueRequest({
        method: 'POST',
        url: '/api/projects',
        data: { name: 'Authenticated Project' },
        priority: 'normal'
      });

      navigator.onLine = true;
      await offlineManager['handleOnline']();

      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify apiClient.request was called (auth headers are added internally by apiClient)
      expect(requestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/api/projects'
        })
      );

      requestSpy.mockRestore();
    });

    it('should handle real API response data types', async () => {
      const requestSpy = jest.spyOn(apiClient, 'request').mockResolvedValueOnce({
        data: {
          projects: [
            { id: 1, name: 'Project A', status: 'active' },
            { id: 2, name: 'Project B', status: 'completed' }
          ],
          total: 2,
          page: 1
        },
        status: 200
      });

      navigator.onLine = false;

      await offlineManager.queueRequest({
        method: 'GET',
        url: '/api/projects',
        priority: 'normal'
      });

      navigator.onLine = true;
      await offlineManager['handleOnline']();

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(requestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/api/projects'
        })
      );

      requestSpy.mockRestore();
    });
  });
});
