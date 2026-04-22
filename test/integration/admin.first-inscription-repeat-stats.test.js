import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';
import { FIRST_INSCRIPTION_COHORT_MIN_DAYS } from '../../controllers/admin.controller.js';

let admin;
let participant;

const MS_DAY = 86400000;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-repeat@test.local',
    dni: '44441111',
    telefono: '+5411000444111'
  });
  participant = await createUser({
    estado: 'approved',
    email: 'part-repeat@test.local',
    dni: '44442222',
    telefono: '+5411000444222'
  });
});

describe('GET /api/admin/first-inscription-repeat-stats', () => {
  it('403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/first-inscription-repeat-stats')
      .set('Authorization', bearerFor(participant));
    expect(res.status).toBe(403);
  });

  it('401 without token', async () => {
    const res = await request(app).get('/api/admin/first-inscription-repeat-stats');
    expect(res.status).toBe(401);
  });

  it('200 with zeros when no inscriptions', async () => {
    const res = await request(app)
      .get('/api/admin/first-inscription-repeat-stats')
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      minDaysSinceFirstInscription: FIRST_INSCRIPTION_COHORT_MIN_DAYS,
      cohortSize: 0,
      withMoreThanOneInscription: 0,
      rate: null
    });
  });

  it('counts cohort and users with more than one inscription', async () => {
    const now = Date.now();
    const oldEnough = new Date(now - (FIRST_INSCRIPTION_COHORT_MIN_DAYS + 3) * MS_DAY);
    const tooRecent = new Date(now - (FIRST_INSCRIPTION_COHORT_MIN_DAYS - 3) * MS_DAY);

    const act1 = await createActivity(admin._id, { titulo: 'A1', estado: 'publicada' });
    const act2 = await createActivity(admin._id, { titulo: 'A2', estado: 'publicada' });
    const occ = new Date(Date.UTC(2030, 5, 1, 12, 0, 0, 0));

    const uOldSingle = await createUser({
      estado: 'approved',
      email: 'u-old-single@test.local',
      dni: '44443333',
      telefono: '+5411000444333'
    });
    await createInscription(uOldSingle._id, act1._id, occ, {
      createdAt: oldEnough,
      fechaInscripcion: oldEnough
    });

    const uOldRepeat = await createUser({
      estado: 'approved',
      email: 'u-old-repeat@test.local',
      dni: '44444444',
      telefono: '+5411000444444'
    });
    await createInscription(uOldRepeat._id, act1._id, occ, {
      createdAt: oldEnough,
      fechaInscripcion: oldEnough
    });
    await createInscription(uOldRepeat._id, act2._id, occ, {
      createdAt: new Date(oldEnough.getTime() + MS_DAY),
      fechaInscripcion: new Date(oldEnough.getTime() + MS_DAY)
    });

    const uRecent = await createUser({
      estado: 'approved',
      email: 'u-recent@test.local',
      dni: '44445555',
      telefono: '+5411000444555'
    });
    await createInscription(uRecent._id, act1._id, occ, {
      createdAt: tooRecent,
      fechaInscripcion: tooRecent
    });

    const res = await request(app)
      .get('/api/admin/first-inscription-repeat-stats')
      .set('Authorization', bearerFor(admin));

    expect(res.status).toBe(200);
    expect(res.body.cohortSize).toBe(2);
    expect(res.body.withMoreThanOneInscription).toBe(1);
    expect(res.body.rate).toBeCloseTo(0.5, 5);
  });

  it('ignores inscriptions on deleted activities for first date and counts', async () => {
    const now = Date.now();
    const oldEnough = new Date(now - (FIRST_INSCRIPTION_COHORT_MIN_DAYS + 3) * MS_DAY);

    const deletedAct = await createActivity(admin._id, { titulo: 'Del', estado: 'eliminada' });
    const liveAct = await createActivity(admin._id, { titulo: 'Live', estado: 'publicada' });
    const occ = new Date(Date.UTC(2030, 5, 1, 12, 0, 0, 0));

    const u = await createUser({
      estado: 'approved',
      email: 'u-deleted-first@test.local',
      dni: '44446666',
      telefono: '+5411000444666'
    });
    await createInscription(u._id, deletedAct._id, occ, {
      createdAt: new Date(oldEnough.getTime() - 10 * MS_DAY),
      fechaInscripcion: new Date(oldEnough.getTime() - 10 * MS_DAY)
    });
    await createInscription(u._id, liveAct._id, occ, {
      createdAt: oldEnough,
      fechaInscripcion: oldEnough
    });

    const res = await request(app)
      .get('/api/admin/first-inscription-repeat-stats')
      .set('Authorization', bearerFor(admin));

    expect(res.status).toBe(200);
    // La inscripción en actividad eliminada no cuenta: la "primera" válida es la de Live.
    expect(res.body.cohortSize).toBe(1);
    expect(res.body.withMoreThanOneInscription).toBe(0);
  });
});
