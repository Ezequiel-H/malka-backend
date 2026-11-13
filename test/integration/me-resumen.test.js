import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';
import Visita from '../../models/Visita.model.js';
import Contacto from '../../models/Contacto.model.js';

const URL = '/api/me/resumen';
const haceDias = (n) => new Date(Date.now() - n * 86_400_000);
let n = 0;
const persona = (datos) => {
  n += 1;
  return createUser({ estado: 'approved', dni: String(33_000_000 + n), telefono: `+54110066${String(n).padStart(4, '0')}`, email: `p${n}-res@test.local`, ...datos });
};

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(clearCollections);

describe('GET /api/me/resumen', () => {
  it('pide sesión de una cuenta aprobada', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
    const pendiente = await persona({ estado: 'pending' });
    expect((await request(app).get(URL).set('Authorization', bearerFor(pendiente))).status).toBe(403);
  });

  it('cuenta lo que vino este año: inscripciones pasadas que no faltó y visitas propias o de su contacto', async () => {
    const yo = await persona({});
    const otra = await persona({});
    const admin = await persona({ role: 'admin' });
    const act = await createActivity(admin._id, { titulo: 'Taller' });
    const enEsteAnio = (d) => (haceDias(d).getFullYear() === new Date().getFullYear() ? 1 : 0);
    await createInscription(yo._id, act._id, haceDias(1), { estado: 'aceptada' });
    await createInscription(yo._id, act._id, haceDias(2), { estado: 'aceptada', asistencia: 'falto' });
    await createInscription(yo._id, act._id, haceDias(3), { estado: 'cancelada' });
    await createInscription(yo._id, act._id, new Date(Date.now() + 5 * 86_400_000), { estado: 'aceptada' });
    await createInscription(otra._id, act._id, haceDias(1), { estado: 'aceptada' });
    const contacto = await Contacto.create({ nombre: 'Yo', apellido: 'Misma', usuarioId: yo._id });
    await Visita.create({ userId: yo._id, actividadId: act._id, fecha: haceDias(1), origen: 'sin_anotarse' });
    await Visita.create({ contactoId: contacto._id, evento: 'Fiesta', fecha: haceDias(1), origen: 'importado' });
    await Visita.create({ userId: otra._id, actividadId: act._id, fecha: haceDias(1), origen: 'manual' });

    const res = await request(app).get(URL).set('Authorization', bearerFor(yo));
    expect(res.status).toBe(200);
    expect(res.body.anio).toBe(new Date().getFullYear());
    expect(res.body.veces).toBe(enEsteAnio(1) * 3);
  });
});
