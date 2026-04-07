import request from 'supertest';
import { describe, it, expect } from 'vitest';
import app from '../../app.js';

describe('GET /api/health', () => {
  it('returns OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'OK', message: 'Server is running' });
  });
});
