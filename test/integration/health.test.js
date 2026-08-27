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

describe('CORS preflight', () => {
  it('allows PATCH for participant profile updates', async () => {
    const res = await request(app)
      .options('/api/users/me')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'Content-Type,Authorization');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
  });
});
