import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor } from '../helpers/factories.js';
import { CATALOGO, inicioDeSiempre, normalizarInicio } from '../../utils/inicioPanel.js';

const URL = '/api/admin/inicio';
let admin;
let otroAdmin;
let n = 0;
const persona = (datos) => {
  n += 1;
  return createUser({ estado: 'approved', dni: String(32_000_000 + n), telefono: `+54110099${String(n).padStart(4, '0')}`, email: `p${n}-ini@test.local`, ...datos });
};

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await persona({ role: 'admin' });
  otroAdmin = await persona({ role: 'admin' });
});

const como = (u) => ({ Authorization: bearerFor(u) });

describe('/api/admin/inicio', () => {
  it('es sólo para el equipo', async () => {
    const p = await persona({});
    expect((await request(app).get(URL)).status).toBe(401);
    expect((await request(app).get(URL).set(como(p))).status).toBe(403);
  });

  it('sin guardar devuelve el de siempre, con bloques extra ocultos para sumar', async () => {
    const res = await request(app).get(URL).set(como(admin));
    expect(res.status).toBe(200);
    expect(res.body.personalizado).toBe(false);
    expect(res.body.bloques).toEqual(inicioDeSiempre());
    expect(res.body.bloques.filter((b) => !b.visible).length).toBeGreaterThanOrEqual(3);
    expect(res.body.catalogo.map((b) => b.id)).toEqual(CATALOGO.map((b) => b.id));
  });

  it('guarda orden, ancho, visibilidad y opciones de cada persona, y no toca el de otra', async () => {
    const bloques = inicioDeSiempre().reverse();
    bloques[0] = { ...bloques[0], visible: true, ancho: 'entera', opciones: { comparar: false } }; // plata
    const res = await request(app).put(URL).set(como(admin)).send({ bloques });
    expect(res.status).toBe(200);
    expect(res.body.personalizado).toBe(true);
    expect(res.body.bloques[0]).toEqual({ id: 'plata', visible: true, ancho: 'entera', opciones: { comparar: false } });

    const otra = await request(app).get(URL).set(como(otroAdmin));
    expect(otra.body.personalizado).toBe(false);

    const vuelve = await request(app).get(URL).set(como(admin));
    expect(vuelve.body.bloques.map((b) => b.id)).toEqual(bloques.map((b) => b.id));
  });

  it('rechaza opciones que no son del bloque, valores fuera de lista y bloques faltantes', async () => {
    const base = inicioDeSiempre();
    const conOpcionAjena = base.map((b) => (b.id === 'semana' ? { ...b, opciones: { cuantos: 5 } } : b));
    expect((await request(app).put(URL).set(como(admin)).send({ bloques: conOpcionAjena })).status).toBe(400);
    const conValorMalo = base.map((b) => (b.id === 'numeros' ? { ...b, opciones: { meses: 7 } } : b));
    expect((await request(app).put(URL).set(como(admin)).send({ bloques: conValorMalo })).status).toBe(400);
    const sinNumeros = base.map((b) => (b.id === 'numeros' ? { ...b, opciones: { cuales: [] } } : b));
    expect((await request(app).put(URL).set(como(admin)).send({ bloques: sinNumeros })).status).toBe(400);
    expect((await request(app).put(URL).set(como(admin)).send({ bloques: base.slice(1) })).status).toBe(400);
    expect((await request(app).put(URL).set(como(admin)).send({ bloques: [...base, base[0]] })).status).toBe(400);
  });

  it('si queda igual al de siempre se borra, y DELETE vuelve al de siempre', async () => {
    const igual = await request(app).put(URL).set(como(admin)).send({ bloques: inicioDeSiempre() });
    expect(igual.body.personalizado).toBe(false);

    const cambiado = inicioDeSiempre().map((b) => (b.id === 'cumples' ? { ...b, visible: false } : b));
    await request(app).put(URL).set(como(admin)).send({ bloques: cambiado });
    const borrado = await request(app).delete(URL).set(como(admin));
    expect(borrado.body.personalizado).toBe(false);
    expect(borrado.body.bloques).toEqual(inicioDeSiempre());
  });

  it('el Panel guardado no viaja con los datos del usuario', async () => {
    await request(app).put(URL).set(como(admin)).send({ bloques: inicioDeSiempre().reverse() });
    const me = await request(app).get('/api/auth/me').set(como(admin));
    expect(me.body.user?.inicioPanel).toBeUndefined();
  });
});

describe('normalizarInicio', () => {
  it('suma al final los bloques nuevos y descarta lo que no entiende', () => {
    const viejo = { bloques: [{ id: 'semana', visible: true, ancho: 'media', opciones: { borradores: true, raro: 1 } }, { id: 'otro' }] };
    const res = normalizarInicio(viejo);
    expect(res[0]).toEqual({ id: 'semana', visible: true, ancho: 'media', opciones: { borradores: true } });
    expect(res.map((b) => b.id).sort()).toEqual(CATALOGO.map((b) => b.id).sort());
  });
});
