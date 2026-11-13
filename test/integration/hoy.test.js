import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';

const URL = '/api/admin/hoy';
const enDias = (n) => new Date(Date.now() + n * 86_400_000);

let admin;
let n = 0;
const persona = (datos) => {
  n += 1;
  return createUser({ estado: 'approved', dni: String(31_000_000 + n), telefono: `+54110088${String(n).padStart(4, '0')}`, email: `p${n}-hoy@test.local`, ...datos });
};

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await persona({ role: 'admin' });
});

describe('GET /api/admin/hoy', () => {
  it('es sólo para el admin', async () => {
    const p = await persona({});
    expect((await request(app).get(URL)).status).toBe(401);
    expect((await request(app).get(URL).set('Authorization', bearerFor(p))).status).toBe(403);
  });

  it('cuenta altas por aprobar, inscripciones por confirmar y comprobantes, sin lo de actividades borradas', async () => {
    await persona({ estado: 'pending', nombre: 'Noa', apellido: 'Feld' });
    await persona({ estado: 'pending', nombre: 'Uri', apellido: 'Kaplan' });
    const p1 = await persona({ nombre: 'Maia', apellido: 'Stern' });
    const p2 = await persona({ nombre: 'Dan', apellido: 'Weiss' });
    const taller = await createActivity(admin._id, { titulo: 'Taller', fecha: enDias(3) });
    const borrada = await createActivity(admin._id, { titulo: 'Borrada', estado: 'eliminada', fecha: enDias(3) });
    await createInscription(p1._id, taller._id, enDias(3), { estado: 'pendiente' });
    await createInscription(p2._id, taller._id, enDias(3), {
      estado: 'aceptada',
      pago: { comprobante: { url: 'https://x.test/c.jpg' }, estadoPago: 'pendiente' },
    });
    await createInscription(p2._id, borrada._id, enDias(3), { estado: 'pendiente' });

    const res = await request(app).get(URL).set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.personas.cantidad).toBe(2);
    expect(res.body.personas.nombres).toEqual(['Noa Feld', 'Uri Kaplan']);
    expect(res.body.inscripciones).toMatchObject({ cantidad: 1, actividades: ['Taller'], nombres: ['Maia Stern'] });
    expect(res.body.comprobantes).toMatchObject({ cantidad: 1, actividades: ['Taller'], nombres: ['Dan Weiss'] });
  });

  it('sin nada pendiente devuelve ceros', async () => {
    const res = await request(app).get(URL).set('Authorization', bearerFor(admin));
    expect(res.body.personas.cantidad).toBe(0);
    expect(res.body.inscripciones.cantidad).toBe(0);
    expect(res.body.comprobantes.cantidad).toBe(0);
  });
});
