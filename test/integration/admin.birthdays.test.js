import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor } from '../helpers/factories.js';

// Viernes. Esta semana cierra el domingo 27/09; la siguiente, el 04/10.
const HOY = '2026-09-25';

let admin;
let participant;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-bdays@test.local',
    dni: '45551111',
    telefono: '+5411000455111'
  });
  participant = await createUser({
    estado: 'approved',
    email: 'part-bdays@test.local',
    dni: '45552222',
    telefono: '+5411000455222'
  });
});

const get = (token, hoy = HOY) =>
  request(app).get(`/api/admin/birthdays?hoy=${hoy}`).set('Authorization', token);

describe('GET /api/admin/birthdays', () => {
  it('403 para quien no es admin', async () => {
    expect((await get(bearerFor(participant))).status).toBe(403);
  });

  it('401 sin token', async () => {
    expect((await request(app).get('/api/admin/birthdays')).status).toBe(401);
  });

  it('devuelve la ventana vacía cuando nadie cumple', async () => {
    const res = await get(bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      desde: '2026-09-25',
      finDeEstaSemana: '2026-09-27',
      hasta: '2026-10-04',
      hoy: [],
      estaSemana: [],
      proximaSemana: [],
      total: 0
    });
  });

  it('separa hoy, esta semana y la siguiente, y deja afuera lo que no entra', async () => {
    await createUser({ estado: 'approved', nombre: 'Ana', apellido: 'Hoy', fechaNacimiento: '1992-09-25' });
    await createUser({ estado: 'approved', nombre: 'Iara', apellido: 'Domingo', fechaNacimiento: '1990-09-27' });
    await createUser({ estado: 'approved', nombre: 'David', apellido: 'Proxima', fechaNacimiento: '1985-10-01' });
    await createUser({ estado: 'approved', nombre: 'Ayer', apellido: 'Pasado', fechaNacimiento: '1980-09-24' });
    await createUser({ estado: 'approved', nombre: 'Lejos', apellido: 'Futuro', fechaNacimiento: '1980-10-05' });

    const res = await get(bearerFor(admin));

    expect(res.body.hoy).toHaveLength(1);
    expect(res.body.hoy[0]).toMatchObject({ nombre: 'Ana', edad: 34, esHoy: true, diasFaltan: 0 });
    expect(res.body.estaSemana.map((c) => c.nombre)).toEqual(['Iara']);
    expect(res.body.proximaSemana.map((c) => c.nombre)).toEqual(['David']);
    expect(res.body.total).toBe(3);
  });

  it('ordena por fecha y trae el contacto para poder saludar', async () => {
    await createUser({ estado: 'approved', nombre: 'Tercero', fechaNacimiento: '1990-10-03' });
    await createUser({
      estado: 'approved',
      nombre: 'Primero',
      fechaNacimiento: '1990-09-28',
      email: 'primero@test.local',
      dni: '45553333',
      telefono: '+5491133334444'
    });

    const res = await get(bearerFor(admin));
    expect(res.body.proximaSemana.map((c) => c.nombre)).toEqual(['Primero', 'Tercero']);
    expect(res.body.proximaSemana[0]).toMatchObject({
      email: 'primero@test.local',
      telefono: '+5491133334444'
    });
    // La contraseña no se filtra ni por accidente.
    expect(res.body.proximaSemana[0].password).toBeUndefined();
  });

  it('sólo mira participantes aprobados', async () => {
    await createUser({ estado: 'pending', nombre: 'Pendiente', fechaNacimiento: '1990-09-26' });
    await createUser({ estado: 'rejected', nombre: 'Rechazado', fechaNacimiento: '1990-09-26' });
    await createUser({
      role: 'admin',
      estado: 'approved',
      nombre: 'OtroAdmin',
      fechaNacimiento: '1990-09-26',
      email: 'otro-admin@test.local',
      dni: '45554444',
      telefono: '+5411000455444'
    });

    const res = await get(bearerFor(admin));
    expect(res.body.total).toBe(0);
  });

  it('cuenta aparte a los aprobados que todavía no cargaron la fecha', async () => {
    await createUser({ estado: 'approved', nombre: 'SinFecha' });
    await createUser({ estado: 'approved', nombre: 'ConFecha', fechaNacimiento: '1990-09-26' });

    const res = await get(bearerFor(admin));
    // El participant del beforeEach tampoco tiene fecha.
    expect(res.body.sinFecha).toBe(2);
    expect(res.body.total).toBe(1);
  });

  it('cruza el fin de año', async () => {
    await createUser({ estado: 'approved', nombre: 'Enero', fechaNacimiento: '1995-01-02' });

    const res = await get(bearerFor(admin), '2026-12-28');
    expect(res.body.hasta).toBe('2027-01-10');
    expect([...res.body.estaSemana, ...res.body.proximaSemana].map((c) => c.fecha)).toContain(
      '2027-01-02'
    );
  });

  it('sin el parámetro hoy usa la fecha real y responde igual', async () => {
    const res = await request(app)
      .get('/api/admin/birthdays')
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.hasta > res.body.desde).toBe(true);
  });
});
