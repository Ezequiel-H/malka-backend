import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import Inscription from '../../models/Inscription.model.js';
import { __sentEmails } from '../../utils/mailer.js';
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
  __sentEmails.length = 0;
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

const estadoDe = async (inscription) => (await Inscription.findById(inscription._id)).estado;

describe('Lista de espera: la maneja el admin a mano', () => {
  it('liberar un lugar (cancela, rechazo o cambio de estado) no mueve a nadie de la espera', async () => {
    const { ocupante, primera, segunda } = await seedFullActivity();

    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/cancel`)
      .set('Authorization', bearerFor(titular))
      .expect(200);

    expect(await estadoDe(primera)).toBe('en_espera');
    expect(await estadoDe(segunda)).toBe('en_espera');
    expect(__sentEmails).toHaveLength(0);
  });

  it('el rechazo del admin tampoco promueve', async () => {
    const { ocupante, primera } = await seedFullActivity();
    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/reject`)
      .set('Authorization', bearerFor(admin))
      .expect(200);
    expect(await estadoDe(primera)).toBe('en_espera');
  });

  it('cancelar desde el cambio de estado tampoco promueve', async () => {
    const { ocupante, primera } = await seedFullActivity();
    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'cancelada' })
      .expect(200);
    expect(await estadoDe(primera)).toBe('en_espera');
  });

  it('el admin elige a quién sacar, aunque no sea el más antiguo', async () => {
    const { ocupante, primera, segunda } = await seedFullActivity();
    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/cancel`)
      .set('Authorization', bearerFor(titular))
      .expect(200);

    await request(app)
      .put(`/api/inscriptions/${segunda._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'aceptada' })
      .expect(200);

    expect(await estadoDe(segunda)).toBe('aceptada');
    expect(await estadoDe(primera)).toBe('en_espera');
  });

  it('sin `notificar` no sale ningún mail, ni siquiera el de confirmación', async () => {
    const { ocupante, primera } = await seedFullActivity();
    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/cancel`)
      .set('Authorization', bearerFor(titular))
      .expect(200);

    await request(app)
      .put(`/api/inscriptions/${primera._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'aceptada' })
      .expect(200);

    expect(__sentEmails).toHaveLength(0);
  });

  it('con `notificar` sale un solo mail: el de «se liberó un lugar»', async () => {
    const { ocupante, primera } = await seedFullActivity();
    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/cancel`)
      .set('Authorization', bearerFor(titular))
      .expect(200);

    await request(app)
      .put(`/api/inscriptions/${primera._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'aceptada', notificar: true })
      .expect(200);

    expect(__sentEmails).toHaveLength(1);
    expect(__sentEmails[0].to).toBe('espera1-wl@test.local');
    expect(__sentEmails[0].subject).toMatch(/se liberó un lugar/i);
    expect(__sentEmails[0].html).toMatch(/confirmado/i);
  });
});

describe('Vista previa del mail de la lista de espera', () => {
  it('devuelve el mail según el estado elegido, sin mandarlo ni cambiar nada', async () => {
    const { primera } = await seedFullActivity({ esGratuita: false, precio: 5000 });

    const res = await request(app)
      .get(`/api/inscriptions/${primera._id}/waitlist-email-preview?estado=pendiente`)
      .set('Authorization', bearerFor(admin))
      .expect(200);

    expect(res.body.email.to).toBe('espera1-wl@test.local');
    expect(res.body.email.subject).toMatch(/se liberó un lugar/i);
    expect(res.body.email.html).toMatch(/pendiente/i);
    expect(__sentEmails).toHaveLength(0);
    expect(await estadoDe(primera)).toBe('en_espera');
  });

  it('rechaza estados que no son salidas de la espera y a quien no está esperando', async () => {
    const { ocupante, primera } = await seedFullActivity();

    await request(app)
      .get(`/api/inscriptions/${primera._id}/waitlist-email-preview?estado=cancelada`)
      .set('Authorization', bearerFor(admin))
      .expect(400);

    await request(app)
      .get(`/api/inscriptions/${ocupante._id}/waitlist-email-preview?estado=aceptada`)
      .set('Authorization', bearerFor(admin))
      .expect(400);
  });

  it('es sólo para admins', async () => {
    const { primera } = await seedFullActivity();
    await request(app)
      .get(`/api/inscriptions/${primera._id}/waitlist-email-preview?estado=aceptada`)
      .set('Authorization', bearerFor(titular))
      .expect(403);
  });
});
