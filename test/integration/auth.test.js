import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor } from '../helpers/factories.js';

const validRegister = {
  email: 'newuser@test.local',
  password: 'secret12',
  nombre: 'Ana',
  apellido: 'García',
  dni: '33444555',
  telefono: '+5411999888777'
};

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(clearCollections);

describe('POST /api/auth/register', () => {
  it('creates user pending and returns token', async () => {
    const res = await request(app).post('/api/auth/register').send(validRegister);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.estado).toBe('pending');
    expect(res.body.user.email).toBe(validRegister.email.toLowerCase());
  });

  it('rejects invalid payload', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validRegister, email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('rejects duplicate email', async () => {
    await request(app).post('/api/auth/register').send(validRegister);
    const res = await request(app).post('/api/auth/register').send({
      ...validRegister,
      dni: '44555666',
      telefono: '+5411888777666'
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with valid credentials', async () => {
    await request(app).post('/api/auth/register').send(validRegister);
    const res = await request(app).post('/api/auth/login').send({
      email: validRegister.email,
      password: validRegister.password
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(validRegister.email.toLowerCase());
  });

  it('rejects wrong password', async () => {
    await request(app).post('/api/auth/register').send(validRegister);
    const res = await request(app).post('/api/auth/login').send({
      email: validRegister.email,
      password: 'wrongpassword'
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('requires token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns current user with valid token', async () => {
    const user = await createUser({ email: 'me@test.local', estado: 'approved' });
    const res = await request(app).get('/api/auth/me').set('Authorization', bearerFor(user));
    expect(res.status).toBe(200);
    expect(res.body.user._id).toBe(String(user._id));
    expect(res.body.user.password).toBeUndefined();
  });
});
