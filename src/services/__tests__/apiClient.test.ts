/**
 * API Client Tests — aligned with fetch-based ApiClient implementation
 */

jest.mock('../../../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null })
    }
  }
}));

jest.mock('../utils/env', () => ({
  getEnv: jest.fn().mockReturnValue('http://localhost:3001/api')
}));

import { ApiClient, APIClient } from '../apiClient';
import { supabase } from '../../../supabaseClient';

describe('ApiClient', () => {
  let client: ApiClient;
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    client = new ApiClient('/api');
  });

  describe('request', () => {
    it('should perform GET and return data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 1 }),
        text: async () => ''
      });

      const res = await client.get('/users');
      expect(res.data).toEqual({ id: 1 });
      expect(res.status).toBe(200);
      expect(res.error).toBeUndefined();
    });

    it('should perform POST with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ created: true }),
        text: async () => ''
      });

      const res = await client.post('/users', { name: 'Ada' });
      expect(res.status).toBe(201);
      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[1].body).toBe(JSON.stringify({ name: 'Ada' }));
    });

    it('should add Authorization header when session exists', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: { access_token: 'tok123' } }, error: null
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => ''
      });

      await client.get('/protected');
      const call = mockFetch.mock.calls[0];
      expect(call[1].headers['Authorization']).toBe('Bearer tok123');
    });

    it('should return error object on HTTP 400', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Invalid field' }),
        text: async () => ''
      });

      const res = await client.get('/bad');
      expect(res.status).toBe(400);
      expect(res.error).toContain('Invalid field');
      expect(res.data).toEqual({ message: 'Invalid field' });
    });

    it('should return error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const res = await client.get('/fail');
      expect(res.status).toBe(0);
      expect(res.error).toBe('Network error');
    });

    it('should handle non-JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => { throw new Error('not json'); },
        text: async () => 'plain text'
      });

      const res = await client.get('/text');
      expect(res.data).toBe('plain text');
    });

    it('should use absolute URLs when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => ''
      });

      await client.get('https://example.com/api/external');
      expect(mockFetch.mock.calls[0][0]).toBe('https://example.com/api/external');
    });

    it('should merge custom headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => ''
      });

      await client.get('/users', { headers: { 'X-Custom': 'val' } });
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-Custom']).toBe('val');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should handle DELETE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => ''
      });

      const res = await client.delete('/users/1');
      expect(res.status).toBe(204);
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('should handle PATCH', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ updated: true }),
        text: async () => ''
      });

      await client.patch('/users/1', { name: 'Bob' });
      expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
    });

    it('should handle PUT', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ updated: true }),
        text: async () => ''
      });

      await client.put('/users/1', { name: 'Bob' });
      expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    });

    it('should handle empty error data gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => null,
        text: async () => ''
      });

      const res = await client.get('/empty');
      expect(res.status).toBe(400);
      expect(res.error).toContain('HTTP 400');
    });

    it('should timeout via AbortSignal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => ''
      });

      await client.get('/timeout', { timeout: 5000 });
      const signal = mockFetch.mock.calls[0][1].signal;
      expect(signal).toBeDefined();
    });
  });

  describe('APIClient alias', () => {
    it('should be the same class', () => {
      expect(APIClient).toBe(ApiClient);
    });
  });
});
