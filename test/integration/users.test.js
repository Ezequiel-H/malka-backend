import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor } from '../helpers/factories.js';

let admin;
let participantPending;
let participantApproved;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-users@test.local',
    dni: '10101010',
    telefono: '+5411000111222'
  });
  participantPending = await createUser({
    estado: 'pending',
    email: 'pend@test.local',
    dni: '20202020',
    telefono: '+5411000111333'
  });
  participantApproved = await createUser({
    estado: 'approved',
    email: 'ok@test.local',
    dni: '30303030',
    telefono: '+5411000111444',
    tags: ['música']
  });
});

describe('admin user routes', () => {
  it('GET /api/users/pending lists pending users', async () => {
    const res = await request(app)
      .get('/api/users/pending')
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    const ids = res.body.users.map((u) => String(u._id));
    expect(ids).toContain(String(participantPending._id));
  });

  it('GET /api/users returns all users for admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(3);
  });

  it('GET /api/users/tags requires tags query', async () => {
    const res = await request(app)
      .get('/api/users/tags')
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(400);
  });

  it('GET /api/users/tags filters by tag', async () => {
    const res = await request(app)
      .get('/api/users/tags')
      .query({ tags: 'música' })
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.users.some((u) => String(u._id) === String(participantApproved._id))).toBe(true);
  });

  it('PUT /api/users/:id/approve', async () => {
    const res = await request(app)
      .put(`/api/users/${participantPending._id}/approve`)
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.user.estado).toBe('approved');
  });

  it('PUT /api/users/:id/reject', async () => {
    const u = await createUser({
      estado: 'pending',
      email: 'rejectme@test.local',
      dni: '40404040',
      telefono: '+5411000111555'
    });
    const res = await request(app)
      .put(`/api/users/${u._id}/reject`)
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.user.estado).toBe('rejected');
  });

  it('participant cannot access admin routes', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', bearerFor(participantApproved));
    expect(res.status).toBe(403);
  });

  it('PUT /api/users/:id/password updates password (admin only)', async () => {
    const res = await request(app)
      .put(`/api/users/${participantApproved._id}/password`)
      .set('Authorization', bearerFor(admin))
      .send({ password: 'nuevaClaveSegura1' });
    expect(res.status).toBe(200);

    const loginOld = await request(app)
      .post('/api/auth/login')
      .send({ email: participantApproved.email, password: 'password123' });
    expect(loginOld.status).not.toBe(200);

    const loginNew = await request(app)
      .post('/api/auth/login')
      .send({ email: participantApproved.email, password: 'nuevaClaveSegura1' });
    expect(loginNew.status).toBe(200);
  });

  it('participant cannot change another user password', async () => {
    const res = await request(app)
      .put(`/api/users/${participantPending._id}/password`)
      .set('Authorization', bearerFor(participantApproved))
      .send({ password: 'hackeo123' });
    expect(res.status).toBe(403);
  });

  it('PUT /api/users/:id/password rejects short password', async () => {
    const res = await request(app)
      .put(`/api/users/${participantApproved._id}/password`)
      .set('Authorization', bearerFor(admin))
      .send({ password: '12345' });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('PUT /api/users/:id/password requires auth', async () => {
    const res = await request(app)
      .put(`/api/users/${participantApproved._id}/password`)
      .send({ password: 'validpass1' });
    expect(res.status).toBe(401);
  });

  it('PUT /api/users/:id/password returns 400 for invalid id', async () => {
    const res = await request(app)
      .put('/api/users/not-a-valid-id/password')
      .set('Authorization', bearerFor(admin))
      .send({ password: 'validpass1' });
    expect(res.status).toBe(400);
  });

  it('PUT /api/users/:id/password returns 404 for unknown user', async () => {
    const res = await request(app)
      .put('/api/users/507f1f77bcf86cd799439011/password')
      .set('Authorization', bearerFor(admin))
      .send({ password: 'validpass1' });
    expect(res.status).toBe(404);
  });
});

describe('participant profile', () => {
  it('PATCH /api/users/me updates profile', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', bearerFor(participantApproved))
      .send({ nombre: 'Updated', apellido: 'Name' });
    expect(res.status).toBe(200);
    expect(res.body.user.nombre).toBe('Updated');
    expect(res.body.user.apellido).toBe('Name');
  });
});
