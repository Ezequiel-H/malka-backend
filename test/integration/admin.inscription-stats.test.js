import request from 'supertest';
import mongoose from 'mongoose';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';

let admin;
let approved;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-stats@test.local',
    dni: '33331111',
    telefono: '+5411000333111'
  });
  approved = await createUser({
    estado: 'approved',
    email: 'app-stats@test.local',
    dni: '33332222',
    telefono: '+5411000333222'
  });
});

describe('GET /api/admin/inscription-stats', () => {
  it('403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-01-01', to: '2025-01-31' })
      .set('Authorization', bearerFor(approved));
    expect(res.status).toBe(403);
  });

  it('401 without token', async () => {
    const res = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-01-01', to: '2025-01-31' });
    expect(res.status).toBe(401);
  });

  it('400 when from/to missing or invalid', async () => {
    const res1 = await request(app)
      .get('/api/admin/inscription-stats')
      .set('Authorization', bearerFor(admin));
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: 'bad', to: '2025-01-31' })
      .set('Authorization', bearerFor(admin));
    expect(res2.status).toBe(400);
  });

  it('400 when from > to', async () => {
    const res = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-02-01', to: '2025-01-01' })
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(400);
  });

  it('400 when activityId invalid', async () => {
    const res = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-01-01', to: '2025-01-31', activityId: 'not-an-id' })
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(400);
  });

  it('200 returns weekly and top structure', async () => {
    const act = await createActivity(admin._id, {
      titulo: 'Yoga',
      estado: 'publicada',
      tipo: 'unica',
      fecha: new Date(Date.UTC(2025, 0, 15, 12, 0, 0, 0))
    });
    const occ = new Date(Date.UTC(2025, 0, 15, 12, 0, 0, 0));

    await createInscription(approved._id, act._id, occ, {
      estado: 'aceptada',
      createdAt: new Date(Date.UTC(2025, 0, 10, 10, 0, 0, 0)),
      fechaInscripcion: new Date(Date.UTC(2025, 0, 10, 10, 0, 0, 0)),
      fechaAprobacion: new Date(Date.UTC(2025, 0, 11, 10, 0, 0, 0))
    });

    const res = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-01-01', to: '2025-01-31' })
      .set('Authorization', bearerFor(admin));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.weeklyNewInscriptions)).toBe(true);
    expect(Array.isArray(res.body.topOccurrencesAccepted)).toBe(true);
    expect(res.body.meta.from).toBe('2025-01-01');
    expect(res.body.meta.to).toBe('2025-01-31');

    const weekCounts = res.body.weeklyNewInscriptions.reduce((s, w) => s + w.count, 0);
    expect(weekCounts).toBeGreaterThanOrEqual(1);

    const top = res.body.topOccurrencesAccepted.find(
      (r) => String(r.activityId) === String(act._id) && r.occurrenceDate === '2025-01-15'
    );
    expect(top).toBeDefined();
    expect(top.count).toBe(1);
    expect(top.titulo).toBe('Yoga');
  });

  it('filters weekly series by activityId', async () => {
    const a1 = await createActivity(admin._id, { titulo: 'A1', estado: 'publicada' });
    const a2 = await createActivity(admin._id, { titulo: 'A2', estado: 'publicada' });
    const occ = new Date(Date.UTC(2025, 2, 10, 12, 0, 0, 0));

    await createInscription(approved._id, a1._id, occ, {
      createdAt: new Date(Date.UTC(2025, 2, 5, 12, 0, 0, 0))
    });
    await createInscription(approved._id, a2._id, occ, {
      createdAt: new Date(Date.UTC(2025, 2, 6, 12, 0, 0, 0))
    });

    const resAll = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-03-01', to: '2025-03-31' })
      .set('Authorization', bearerFor(admin));
    const totalAll = resAll.body.weeklyNewInscriptions.reduce((s, w) => s + w.count, 0);
    expect(totalAll).toBe(2);

    const resOne = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-03-01', to: '2025-03-31', activityId: String(a1._id) })
      .set('Authorization', bearerFor(admin));
    const totalOne = resOne.body.weeklyNewInscriptions.reduce((s, w) => s + w.count, 0);
    expect(totalOne).toBe(1);
  });

  it('splits recurrent occurrences in top ranking', async () => {
    const act = await createActivity(admin._id, {
      titulo: 'Taller recurrente',
      estado: 'publicada',
      tipo: 'recurrente',
      fecha: new Date(Date.UTC(2025, 4, 1, 12, 0, 0, 0)),
      recurrence: {
        frequency: 'weekly',
        daysOfWeek: [1],
        endDate: new Date(Date.UTC(2025, 5, 30, 12, 0, 0, 0)),
        hora: '10:00'
      }
    });
    const day1 = new Date(Date.UTC(2025, 4, 5, 12, 0, 0, 0));
    const day2 = new Date(Date.UTC(2025, 4, 12, 12, 0, 0, 0));

    await createInscription(approved._id, act._id, day1, { estado: 'aceptada' });
    await createInscription(approved._id, act._id, day1, {
      estado: 'aceptada',
      userId: admin._id
    });
    await createInscription(approved._id, act._id, day2, { estado: 'aceptada' });

    const res = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-05-01', to: '2025-05-31', limit: 20 })
      .set('Authorization', bearerFor(admin));

    expect(res.status).toBe(200);
    const rows = res.body.topOccurrencesAccepted.filter((r) => String(r.activityId) === String(act._id));
    expect(rows.length).toBe(2);
    const byDay = Object.fromEntries(rows.map((r) => [r.occurrenceDate, r.count]));
    expect(byDay['2025-05-05']).toBe(2);
    expect(byDay['2025-05-12']).toBe(1);
  });

  it('excludes weekly new inscriptions for activities in estado eliminada', async () => {
    const occ = new Date(Date.UTC(2025, 8, 15, 12, 0, 0, 0));
    const deletedAct = await createActivity(admin._id, {
      titulo: 'Borrada weekly',
      estado: 'eliminada',
      tipo: 'unica',
      fecha: occ
    });
    const liveAct = await createActivity(admin._id, {
      titulo: 'Viva weekly',
      estado: 'publicada',
      tipo: 'unica',
      fecha: occ
    });
    const t = new Date(Date.UTC(2025, 8, 10, 12, 0, 0, 0));

    await createInscription(approved._id, deletedAct._id, occ, {
      estado: 'pendiente',
      createdAt: t,
      fechaInscripcion: t
    });
    await createInscription(approved._id, liveAct._id, occ, {
      estado: 'pendiente',
      createdAt: t,
      fechaInscripcion: t
    });

    const res = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-09-01', to: '2025-09-30' })
      .set('Authorization', bearerFor(admin));

    expect(res.status).toBe(200);
    const totalWeekly = res.body.weeklyNewInscriptions.reduce((s, w) => s + w.count, 0);
    expect(totalWeekly).toBe(1);
  });

  it('excludes top occurrences for activities in estado eliminada', async () => {
    const occ = new Date(Date.UTC(2025, 6, 10, 12, 0, 0, 0));
    const deletedAct = await createActivity(admin._id, {
      titulo: 'Evento borrado',
      estado: 'eliminada',
      tipo: 'unica',
      fecha: occ
    });
    const liveAct = await createActivity(admin._id, {
      titulo: 'Evento vivo',
      estado: 'publicada',
      tipo: 'unica',
      fecha: occ
    });

    await createInscription(approved._id, deletedAct._id, occ, { estado: 'aceptada' });
    await createInscription(approved._id, deletedAct._id, occ, {
      estado: 'aceptada',
      userId: admin._id
    });
    await createInscription(approved._id, liveAct._id, occ, { estado: 'aceptada' });

    const res = await request(app)
      .get('/api/admin/inscription-stats')
      .query({ from: '2025-07-01', to: '2025-07-31', limit: 20 })
      .set('Authorization', bearerFor(admin));

    expect(res.status).toBe(200);
    expect(res.body.topOccurrencesAccepted.some((r) => String(r.activityId) === String(deletedAct._id))).toBe(
      false
    );
    const liveRow = res.body.topOccurrencesAccepted.find((r) => String(r.activityId) === String(liveAct._id));
    expect(liveRow).toBeDefined();
    expect(liveRow.count).toBe(1);
    expect(liveRow.titulo).toBe('Evento vivo');
  });
});
