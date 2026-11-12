import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';

let admin;
let participant;
let activity;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({ role: 'admin', estado: 'approved', email: 'admin-met@test.local', dni: '66661111', telefono: '+5411000777111' });
  participant = await createUser({ estado: 'approved', email: 'part-met@test.local', dni: '66662222', telefono: '+5411000777222' });
  activity = await createActivity(admin._id, { titulo: 'Cena de Shabat', precio: 5000, esGratuita: false });
});

describe('Gastos', () => {
  it('sólo los ve y los carga el equipo', async () => {
    await request(app).get('/api/gastos').expect(401);
    await request(app).get('/api/gastos').set('Authorization', bearerFor(participant)).expect(403);
    await request(app)
      .post('/api/gastos')
      .set('Authorization', bearerFor(participant))
      .send({ fecha: '2026-01-09', concepto: 'Vino', monto: 100 })
      .expect(403);
  });

  it('se cargan, se listan por rango, se editan y se borran', async () => {
    const alta = await request(app)
      .post('/api/gastos')
      .set('Authorization', bearerFor(admin))
      .send({ fecha: '2026-01-09', concepto: 'Vino', categoria: 'bebida', monto: '12000', cantidad: '6', unidad: 'botellas', actividadId: String(activity._id) })
      .expect(201);
    const id = alta.body.gasto._id;
    expect(alta.body.gasto).toMatchObject({ monto: 12000, cantidad: 6, actividadId: { titulo: 'Cena de Shabat' } });

    const lista = await request(app)
      .get('/api/gastos?from=2026-01-01&to=2026-01-31')
      .set('Authorization', bearerFor(admin))
      .expect(200);
    expect(lista.body.gastos).toHaveLength(1);
    const fuera = await request(app).get('/api/gastos?from=2026-02-01&to=2026-02-28').set('Authorization', bearerFor(admin)).expect(200);
    expect(fuera.body.gastos).toHaveLength(0);

    const edit = await request(app).put(`/api/gastos/${id}`).set('Authorization', bearerFor(admin)).send({ monto: 15000 }).expect(200);
    expect(edit.body.gasto.monto).toBe(15000);

    await request(app).delete(`/api/gastos/${id}`).set('Authorization', bearerFor(admin)).expect(200);
    await request(app).get(`/api/gastos/${id}`).set('Authorization', bearerFor(admin)).expect(404);
  });

  it('rechaza datos inválidos', async () => {
    const res = await request(app)
      .post('/api/gastos')
      .set('Authorization', bearerFor(admin))
      .send({ fecha: '2026-01-09', concepto: '', monto: -1 })
      .expect(400);
    expect(res.body.message).toBeTruthy();
  });
});

describe('Asistencia', () => {
  it('el equipo marca y desmarca si vino; sólo en aceptadas', async () => {
    const aceptada = await createInscription(participant._id, activity._id, new Date('2026-01-09T00:00:00.000Z'), { estado: 'aceptada' });
    const pendiente = await createInscription(participant._id, activity._id, new Date('2026-01-16T00:00:00.000Z'));

    await request(app).put(`/api/inscriptions/${aceptada._id}/attendance`).set('Authorization', bearerFor(participant)).send({ asistencia: 'vino' }).expect(403);
    const marca = await request(app).put(`/api/inscriptions/${aceptada._id}/attendance`).set('Authorization', bearerFor(admin)).send({ asistencia: 'vino' }).expect(200);
    expect(marca.body.inscription.asistencia).toBe('vino');
    const borra = await request(app).put(`/api/inscriptions/${aceptada._id}/attendance`).set('Authorization', bearerFor(admin)).send({ asistencia: null }).expect(200);
    expect(borra.body.inscription.asistencia).toBeNull();

    await request(app).put(`/api/inscriptions/${pendiente._id}/attendance`).set('Authorization', bearerFor(admin)).send({ asistencia: 'vino' }).expect(400);
    await request(app).put(`/api/inscriptions/${aceptada._id}/attendance`).set('Authorization', bearerFor(admin)).send({ asistencia: 'quizas' }).expect(400);
  });
});

describe('GET /api/admin/metrics', () => {
  it('sólo para el equipo y con rango válido', async () => {
    await request(app).get('/api/admin/metrics?from=2026-01-01&to=2026-01-31').set('Authorization', bearerFor(participant)).expect(403);
    await request(app).get('/api/admin/metrics').set('Authorization', bearerFor(admin)).expect(400);
    await request(app).get('/api/admin/metrics?from=2026-02-01&to=2026-01-01').set('Authorization', bearerFor(admin)).expect(400);
  });

  it('devuelve personas y plata del rango', async () => {
    await createInscription(participant._id, activity._id, new Date('2026-01-09T00:00:00.000Z'), {
      estado: 'aceptada',
      pago: { estadoPago: 'aprobado', montoEsperado: 5000 }
    });
    await request(app)
      .post('/api/gastos')
      .set('Authorization', bearerFor(admin))
      .send({ fecha: '2026-01-09', concepto: 'Comida', categoria: 'comida', monto: 10000, actividadId: String(activity._id) })
      .expect(201);

    const res = await request(app).get('/api/admin/metrics?from=2026-01-01&to=2026-01-31').set('Authorization', bearerFor(admin)).expect(200);
    expect(res.body.personas).toMatchObject({ participantes: 1, nuevos: 1, participaciones: 1 });
    expect(res.body.plata).toMatchObject({ recaudado: 5000, gastado: 10000, cobertura: 50 });
    expect(res.body.plata.costoPorEncuentro[0]).toMatchObject({ titulo: 'Cena de Shabat', costoPromedio: 10000 });
  });
});

describe('GET /api/admin/users/:id/metrics', () => {
  it('sólo el equipo ve el resumen de una persona', async () => {
    await createInscription(participant._id, activity._id, new Date('2026-01-09T00:00:00.000Z'), { estado: 'aceptada', asistencia: 'vino' });
    await request(app).get(`/api/admin/users/${participant._id}/metrics`).set('Authorization', bearerFor(participant)).expect(403);
    const res = await request(app).get(`/api/admin/users/${participant._id}/metrics`).set('Authorization', bearerFor(admin)).expect(200);
    expect(res.body).toMatchObject({ participaciones: 1, asistencia: { vino: 1 } });
    expect(res.body.historial[0].titulo).toBe('Cena de Shabat');
    await request(app).get('/api/admin/users/000000000000000000000000/metrics').set('Authorization', bearerFor(admin)).expect(404);
  });
});
