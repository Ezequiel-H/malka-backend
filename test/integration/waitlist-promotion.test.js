import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import Inscription from '../../models/Inscription.model.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';

let admin;
let titular;
let esperaVieja;
let esperaNueva;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-wl@test.local',
    dni: '33331111',
    telefono: '+5411000444111'
  });
  titular = await createUser({
    estado: 'approved',
    email: 'titular-wl@test.local',
    dni: '33332222',
    telefono: '+5411000444222'
  });
  esperaVieja = await createUser({
    estado: 'approved',
    email: 'espera1-wl@test.local',
    dni: '33333333',
    telefono: '+5411000444333'
  });
  esperaNueva = await createUser({
    estado: 'approved',
    email: 'espera2-wl@test.local',
    dni: '33334444',
    telefono: '+5411000444444'
  });
});

/* Actividad con cupo 1: un titular ocupando y dos personas en espera,
   la más antigua primero. */
async function seedFullActivity(activityOverrides = {}) {
  const activity = await createActivity(admin._id, { cupo: 1, esGratuita: true, ...activityOverrides });
  const fecha = activity.fecha;

  const ocupante = await createInscription(titular._id, activity._id, fecha, {
    estado: 'aceptada',
    fechaInscripcion: new Date('2030-01-01T10:00:00Z')
  });
  const primera = await createInscription(esperaVieja._id, activity._id, fecha, {
    estado: 'en_espera',
    fechaInscripcion: new Date('2030-01-02T10:00:00Z')
  });
  const segunda = await createInscription(esperaNueva._id, activity._id, fecha, {
    estado: 'en_espera',
    fechaInscripcion: new Date('2030-01-03T10:00:00Z')
  });

  return { activity, ocupante, primera, segunda };
}

describe('Promoción automática de la lista de espera', () => {
  it('al cancelar el usuario, promueve al más antiguo de la espera (gratis → aceptada)', async () => {
    const { ocupante, primera, segunda } = await seedFullActivity();

    const res = await request(app)
      .put(`/api/inscriptions/${ocupante._id}/cancel`)
      .set('Authorization', bearerFor(titular));
    expect(res.status).toBe(200);

    const promovida = await Inscription.findById(primera._id);
    expect(promovida.estado).toBe('aceptada');
    expect(promovida.fechaAprobacion).toBeTruthy();

    const sigueEsperando = await Inscription.findById(segunda._id);
    expect(sigueEsperando.estado).toBe('en_espera');
  });

  it('en actividad paga la promoción deja al promovido pendiente (falta revisar el pago)', async () => {
    const { ocupante, primera } = await seedFullActivity({ esGratuita: false, precio: 5000 });

    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/cancel`)
      .set('Authorization', bearerFor(titular))
      .expect(200);

    const promovida = await Inscription.findById(primera._id);
    expect(promovida.estado).toBe('pendiente');
    expect(promovida.fechaAprobacion).toBeNull();
  });

  it('el rechazo del admin también libera el lugar y promueve', async () => {
    const { ocupante, primera } = await seedFullActivity();

    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/reject`)
      .set('Authorization', bearerFor(admin))
      .expect(200);

    const promovida = await Inscription.findById(primera._id);
    expect(promovida.estado).toBe('aceptada');
  });

  it('cancelar por cambio de estado (admin) promueve; cancelar a alguien en espera no', async () => {
    const { ocupante, primera, segunda } = await seedFullActivity();

    // Cancelar a alguien que estaba en espera no libera cupo: nadie se mueve.
    await request(app)
      .put(`/api/inscriptions/${segunda._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'cancelada' })
      .expect(200);
    expect((await Inscription.findById(primera._id)).estado).toBe('en_espera');

    // Cancelar al ocupante sí promueve.
    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'cancelada' })
      .expect(200);
    expect((await Inscription.findById(primera._id)).estado).toBe('aceptada');
  });

  it('no promueve si el lugar liberado es de otra fecha', async () => {
    const actA = await createActivity(admin._id, { cupo: 1, esGratuita: true });
    const fechaA = new Date(Date.UTC(2030, 5, 15, 12, 0, 0, 0));
    const fechaB = new Date(Date.UTC(2030, 5, 16, 12, 0, 0, 0));

    const ocupanteA = await createInscription(titular._id, actA._id, fechaA, {
      estado: 'aceptada',
      fechaInscripcion: new Date('2030-01-01T10:00:00Z')
    });
    const esperaB = await createInscription(esperaVieja._id, actA._id, fechaB, {
      estado: 'en_espera',
      fechaInscripcion: new Date('2030-01-02T10:00:00Z')
    });

    await request(app)
      .put(`/api/inscriptions/${ocupanteA._id}/cancel`)
      .set('Authorization', bearerFor(titular))
      .expect(200);

    expect((await Inscription.findById(esperaB._id)).estado).toBe('en_espera');
  });
});
