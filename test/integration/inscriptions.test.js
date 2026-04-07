import request from 'supertest';
import mongoose from 'mongoose';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import {
  createUser,
  bearerFor,
  createActivity,
  createInscription
} from '../helpers/factories.js';

let admin;
let approved;
let pending;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-ins@test.local',
    dni: '22221111',
    telefono: '+5411000333111'
  });
  approved = await createUser({
    estado: 'approved',
    email: 'app-ins@test.local',
    dni: '22222222',
    telefono: '+5411000333222',
    tags: ['vip']
  });
  pending = await createUser({
    estado: 'pending',
    email: 'pend-ins@test.local',
    dni: '22223333',
    telefono: '+5411000333333'
  });
});

function fechaStrFromActivity(act) {
  const d = new Date(act.fecha);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('participant restrictions', () => {
  it('pending cannot create inscription', async () => {
    const act = await createActivity(admin._id, { estado: 'publicada' });
    const res = await request(app)
      .post('/api/inscriptions')
      .set('Authorization', bearerFor(pending))
      .send({ activityId: String(act._id), fecha: fechaStrFromActivity(act) });
    expect(res.status).toBe(403);
  });
});

describe('GET available-dates', () => {
  it('404 when activity missing', async () => {
    const res = await request(app)
      .get(`/api/inscriptions/activity/${new mongoose.Types.ObjectId()}/available-dates`)
      .set('Authorization', bearerFor(approved));
    expect(res.status).toBe(404);
  });

  it('400 when activity not publicada', async () => {
    const act = await createActivity(admin._id, { estado: 'borrador' });
    const res = await request(app)
      .get(`/api/inscriptions/activity/${act._id}/available-dates`)
      .set('Authorization', bearerFor(approved));
    expect(res.status).toBe(400);
  });

  it('returns slot for actividad unica', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      tipo: 'unica',
      fecha: new Date(Date.UTC(2031, 5, 20, 12, 0, 0, 0)),
      cupo: 10
    });
    const res = await request(app)
      .get(`/api/inscriptions/activity/${act._id}/available-dates`)
      .set('Authorization', bearerFor(approved));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.availableDates)).toBe(true);
    expect(res.body.availableDates.length).toBeGreaterThan(0);
  });

  it('403 when activity is private and participant lacks required tag', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      visibilidad: 'privada',
      tagsVisibilidad: ['vip'],
      tipo: 'unica',
      fecha: new Date(Date.UTC(2031, 9, 1, 12, 0, 0, 0)),
      cupo: 10
    });
    const sinTags = await createUser({
      estado: 'approved',
      email: 'no-tag-dates@test.local',
      dni: '66661111',
      telefono: '+5411666111111',
      tags: []
    });
    const res = await request(app)
      .get(`/api/inscriptions/activity/${act._id}/available-dates`)
      .set('Authorization', bearerFor(sinTags));
    expect(res.status).toBe(403);
  });

  it('200 when activity is private and participant has required tag', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      visibilidad: 'privada',
      tagsVisibilidad: ['vip'],
      tipo: 'unica',
      fecha: new Date(Date.UTC(2031, 9, 2, 12, 0, 0, 0)),
      cupo: 10
    });
    const res = await request(app)
      .get(`/api/inscriptions/activity/${act._id}/available-dates`)
      .set('Authorization', bearerFor(approved));
    expect(res.status).toBe(200);
    expect(res.body.availableDates.length).toBeGreaterThan(0);
  });

  it('public activity with tagsVisibilidad: no access without matching tag (dates and inscription)', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      visibilidad: 'publica',
      tagsVisibilidad: ['socio'],
      tipo: 'unica',
      fecha: new Date(Date.UTC(2031, 10, 5, 12, 0, 0, 0))
    });
    const soloVipUser = await createUser({
      estado: 'approved',
      email: 'solo-vip-pub@test.local',
      dni: '66662222',
      telefono: '+5411666222222',
      tags: ['vip']
    });
    const dates = await request(app)
      .get(`/api/inscriptions/activity/${act._id}/available-dates`)
      .set('Authorization', bearerFor(soloVipUser));
    expect(dates.status).toBe(403);

    const post = await request(app)
      .post('/api/inscriptions')
      .set('Authorization', bearerFor(soloVipUser))
      .send({
        activityId: String(act._id),
        fecha: fechaStrFromActivity(act)
      });
    expect(post.status).toBe(403);
  });
});

describe('POST /api/inscriptions', () => {
  it('403 when visibility tags not satisfied', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      tagsVisibilidad: ['other-only']
    });
    const res = await request(app)
      .post('/api/inscriptions')
      .set('Authorization', bearerFor(approved))
      .send({
        activityId: String(act._id),
        fecha: fechaStrFromActivity(act)
      });
    expect(res.status).toBe(403);
  });

  it('201 when private activity and participant has required tag (full access path)', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      visibilidad: 'privada',
      tagsVisibilidad: ['vip'],
      fecha: new Date(Date.UTC(2032, 1, 20, 12, 0, 0, 0))
    });
    const res = await request(app)
      .post('/api/inscriptions')
      .set('Authorization', bearerFor(approved))
      .send({
        activityId: String(act._id),
        fecha: fechaStrFromActivity(act)
      });
    expect(res.status).toBe(201);
    expect(res.body.inscription).toBeTruthy();
  });

  it('201 creates inscription when fecha valid', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      fecha: new Date(Date.UTC(2031, 7, 10, 12, 0, 0, 0))
    });
    const res = await request(app)
      .post('/api/inscriptions')
      .set('Authorization', bearerFor(approved))
      .send({
        activityId: String(act._id),
        fecha: fechaStrFromActivity(act)
      });
    expect(res.status).toBe(201);
    expect(res.body.inscription.estado).toBeDefined();
  });

  it('400 when fecha missing', async () => {
    const act = await createActivity(admin._id, { estado: 'publicada' });
    const res = await request(app)
      .post('/api/inscriptions')
      .set('Authorization', bearerFor(approved))
      .send({ activityId: String(act._id) });
    expect(res.status).toBe(400);
  });

  it('allows re-inscription after cancel', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      requiereAprobacion: false,
      fecha: new Date(Date.UTC(2031, 8, 1, 12, 0, 0, 0))
    });
    const fecha = fechaStrFromActivity(act);
    const first = await request(app)
      .post('/api/inscriptions')
      .set('Authorization', bearerFor(approved))
      .send({ activityId: String(act._id), fecha });
    expect(first.status).toBe(201);
    const insId = first.body.inscription._id;
    await request(app)
      .put(`/api/inscriptions/${insId}/cancel`)
      .set('Authorization', bearerFor(approved));
    const second = await request(app)
      .post('/api/inscriptions')
      .set('Authorization', bearerFor(approved))
      .send({ activityId: String(act._id), fecha });
    expect(second.status).toBe(200);
  });
});

describe('GET /api/inscriptions/my', () => {
  it('lists inscriptions for user', async () => {
    const act = await createActivity(admin._id, { estado: 'publicada' });
    await createInscription(approved._id, act._id, act.fecha);
    const res = await request(app)
      .get('/api/inscriptions/my')
      .set('Authorization', bearerFor(approved));
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });
});

describe('admin inscriptions', () => {
  it('GET /api/inscriptions returns list', async () => {
    const act = await createActivity(admin._id, { estado: 'publicada' });
    await createInscription(approved._id, act._id, act.fecha, { estado: 'pendiente' });
    const res = await request(app)
      .get('/api/inscriptions')
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it('GET activity inscriptions', async () => {
    const act = await createActivity(admin._id, { estado: 'publicada' });
    await createInscription(approved._id, act._id, act.fecha);
    const res = await request(app)
      .get(`/api/inscriptions/activity/${act._id}`)
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.inscriptions.length).toBeGreaterThanOrEqual(1);
  });

  it('approve and reject inscription', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      requiereAprobacion: true
    });
    const ins = await createInscription(approved._id, act._id, act.fecha, {
      estado: 'pendiente'
    });
    const ok = await request(app)
      .put(`/api/inscriptions/${ins._id}/approve`)
      .set('Authorization', bearerFor(admin));
    expect(ok.status).toBe(200);
    expect(ok.body.inscription.estado).toBe('aceptada');

    const ins2 = await createInscription(approved._id, act._id, new Date(act.fecha.getTime() + 86400000), {
      estado: 'pendiente'
    });
    const rej = await request(app)
      .put(`/api/inscriptions/${ins2._id}/reject`)
      .set('Authorization', bearerFor(admin));
    expect(rej.status).toBe(200);
    expect(rej.body.inscription.estado).toBe('cancelada');
  });

  it('PUT /status updates estado', async () => {
    const act = await createActivity(admin._id, { estado: 'publicada' });
    const ins = await createInscription(approved._id, act._id, act.fecha, { estado: 'pendiente' });
    const res = await request(app)
      .put(`/api/inscriptions/${ins._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'aceptada' });
    expect(res.status).toBe(200);
    expect(res.body.inscription.estado).toBe('aceptada');
  });
});
