import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createTag } from '../helpers/factories.js';

let admin;
let participant;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-tag@test.local',
    dni: '33331111',
    telefono: '+5411000444111'
  });
  participant = await createUser({
    estado: 'approved',
    email: 'part-tag@test.local',
    dni: '33332222',
    telefono: '+5411000444222'
  });
});

describe('GET /api/tags', () => {
  it('non-admin gets only active tags', async () => {
    await createTag({ nombre: `activa-${Date.now()}`, activa: true });
    await createTag({ nombre: `inactiva-${Date.now()}`, activa: false });

    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', bearerFor(participant));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tags)).toBe(true);
    expect(res.body.tags.every(tag => tag.activa === true)).toBe(true);
  });

  it('public request without token gets only active tags', async () => {
    await createTag({ nombre: `activa-publica-${Date.now()}`, activa: true });
    await createTag({ nombre: `inactiva-publica-${Date.now()}`, activa: false });

    const res = await request(app).get('/api/tags?activa=true');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tags)).toBe(true);
    expect(res.body.tags.every(tag => tag.activa === true)).toBe(true);
  });

  it('admin lists tags', async () => {
    await createTag({ nombre: `taglist-${Date.now()}` });
    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tags)).toBe(true);
    expect(res.body.tags.length).toBeGreaterThanOrEqual(1);
  });
});

describe('admin tag CRUD', () => {
  it('POST validates nombre', async () => {
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', bearerFor(admin))
      .send({ nombre: '' });
    expect(res.status).toBe(400);
  });

  it('POST creates tag', async () => {
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', bearerFor(admin))
      .send({ nombre: 'Teatro', color: '#ff0000' });
    expect(res.status).toBe(201);
    const id = res.body.tag._id;
    const g = await request(app)
      .get(`/api/tags/${id}`)
      .set('Authorization', bearerFor(admin));
    expect(g.status).toBe(200);
    const u = await request(app)
      .put(`/api/tags/${id}`)
      .set('Authorization', bearerFor(admin))
      .send({ nombre: 'Teatro 2' });
    expect(u.status).toBe(200);
    const d = await request(app)
      .delete(`/api/tags/${id}`)
      .set('Authorization', bearerFor(admin));
    expect(d.status).toBe(200);
  });
});

describe('private tags /api/tags-privados', () => {
  it('403 for participant', async () => {
    const res = await request(app)
      .get('/api/tags-privados')
      .set('Authorization', bearerFor(participant));
    expect(res.status).toBe(403);
  });

  it('admin CRUD private tag', async () => {
    const c = await request(app)
      .post('/api/tags-privados')
      .set('Authorization', bearerFor(admin))
      .send({ nombre: 'staff-only' });
    expect(c.status).toBe(201);
    const id = c.body.tag._id;
    expect(id).toBeTruthy();
    const list = await request(app)
      .get('/api/tags-privados')
      .set('Authorization', bearerFor(admin));
    expect(list.status).toBe(200);
    const del = await request(app)
      .delete(`/api/tags-privados/${id}`)
      .set('Authorization', bearerFor(admin));
    expect(del.status).toBe(200);
  });
});
