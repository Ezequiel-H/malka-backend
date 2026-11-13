import request from 'supertest';
import { DateTime } from 'luxon';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';
import { cuandoEs } from '../../controllers/actividadesResumen.controller.js';
import { ARGENTINA_TZ } from '../../utils/argentinaTime.js';

const URL = '/api/admin/actividades-resumen';
const hoy = () => DateTime.now().setZone(ARGENTINA_TZ).toISODate();
const diaUtc = (iso) => new Date(`${iso}T00:00:00.000Z`);
const enDias = (n) => DateTime.fromISO(hoy(), { zone: 'utc' }).plus({ days: n }).toISODate();

let admin;
let participante;
// La fábrica no varía dni ni teléfono cuando se le pasa el email: van a mano.
let n = 0;
const persona = (datos) => {
  n += 1;
  return createUser({ estado: 'approved', dni: String(30_000_000 + n), telefono: `+54110077${String(n).padStart(4, '0')}`, ...datos });
};

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await persona({ role: 'admin', email: 'admin-res@test.local' });
  participante = await persona({ email: 'part-res@test.local', nombre: 'Maia', apellido: 'Stern' });
});

describe('GET /api/admin/actividades-resumen', () => {
  it('es sólo para el admin', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
    expect((await request(app).get(URL).set('Authorization', bearerFor(participante))).status).toBe(403);
  });

  it('rechaza un estado inválido', async () => {
    const res = await request(app).get(URL).query({ estado: 'otra' }).set('Authorization', bearerFor(admin));
    expect(res.status).toBe(400);
  });

  it('deja afuera las eliminadas salvo que se pidan', async () => {
    await createActivity(admin._id, { titulo: 'Viva', fecha: diaUtc(enDias(3)) });
    await createActivity(admin._id, { titulo: 'Borrada', estado: 'eliminada', fecha: diaUtc(enDias(3)) });
    await createActivity(admin._id, { titulo: 'Borrador', estado: 'borrador', fecha: diaUtc(enDias(3)) });

    const todas = await request(app).get(URL).set('Authorization', bearerFor(admin));
    expect(todas.status).toBe(200);
    expect(todas.body.actividades.map((a) => a.titulo).sort()).toEqual(['Borrador', 'Viva']);

    const borradas = await request(app).get(URL).query({ estado: 'eliminada' }).set('Authorization', bearerFor(admin));
    expect(borradas.body.actividades.map((a) => a.titulo)).toEqual(['Borrada']);

    const conTodo = await request(app).get(URL).query({ estado: 'todas' }).set('Authorization', bearerFor(admin));
    expect(conTodo.body.actividades).toHaveLength(3);
  });

  it('cuenta el próximo encuentro: anotados, espera, por aprobar, comprobantes y nombres', async () => {
    const dia = enDias(2);
    const act = await createActivity(admin._id, { titulo: 'Taller', fecha: diaUtc(dia), hora: '19:00', cupo: 20, precio: 5000, esGratuita: false });
    const otro = await persona({ email: 'otro-res@test.local', nombre: 'Tomás', apellido: 'Levy' });
    const tercero = await persona({ email: 'ter-res@test.local' });
    const cuarto = await persona({ email: 'cua-res@test.local' });
    await createInscription(participante._id, act._id, diaUtc(dia), { estado: 'aceptada' });
    await createInscription(otro._id, act._id, diaUtc(dia), { estado: 'aceptada' });
    await createInscription(tercero._id, act._id, diaUtc(dia), { estado: 'en_espera' });
    await createInscription(cuarto._id, act._id, diaUtc(dia), {
      estado: 'pendiente',
      pago: { comprobante: { url: 'https://x.test/c.jpg' }, estadoPago: 'pendiente' },
    });

    const res = await request(app).get(URL).set('Authorization', bearerFor(admin));
    const [a] = res.body.actividades;
    expect(a.cupo).toBe(20);
    expect(a.esGratuita).toBe(false);
    expect(a.proximo).toMatchObject({ fecha: dia, hora: '19:00', aceptadas: 2, enEspera: 1, pendientes: 1, comprobantes: 1 });
    expect(a.proximo.nombres.sort()).toEqual(['Maia Stern', 'Tomás Levy']);
  });

  it('una actividad pasada no tiene próximo encuentro', async () => {
    await createActivity(admin._id, { titulo: 'Vieja', fecha: diaUtc(enDias(-10)) });
    const res = await request(app).get(URL).set('Authorization', bearerFor(admin));
    expect(res.body.actividades[0].proximo).toBeNull();
  });

  it('una recurrente diaria tiene encuentro hoy y los siete días de la semana', async () => {
    const act = await createActivity(admin._id, {
      titulo: 'Todos los días',
      tipo: 'recurrente',
      fecha: undefined,
      hora: undefined,
      recurrence: { frequency: 'daily', hora: '08:00' },
    });
    await createInscription(participante._id, act._id, diaUtc(hoy()), { estado: 'aceptada' });

    const res = await request(app).get(URL).set('Authorization', bearerFor(admin));
    const { semana, actividades } = res.body;
    const [a] = actividades;
    expect(a.cuando).toBe('Todos los días · 08:00');
    expect(a.proximo).toMatchObject({ fecha: hoy(), aceptadas: 1 });
    // Desde hoy hasta el domingo: el lunes pasado ya no se genera.
    expect(a.semana.every((e) => e.fecha >= semana.desde && e.fecha <= semana.hasta)).toBe(true);
    expect(a.semana.find((e) => e.fecha === hoy())).toMatchObject({ hora: '08:00', aceptadas: 1 });
    const dias = a.semana.map((e) => e.dia);
    expect(dias).toEqual([...dias].sort((x, y) => x - y));
  });
});

describe('semana de una recurrente con varios días', () => {
  it('trae todos los días que tocan, no sólo el primero', async () => {
    await createActivity(admin._id, {
      titulo: 'Toda la semana',
      tipo: 'recurrente',
      fecha: undefined,
      hora: undefined,
      recurrence: { frequency: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], hora: '19:00' },
    });
    await createActivity(admin._id, {
      titulo: 'Martes y jueves',
      tipo: 'recurrente',
      fecha: undefined,
      hora: undefined,
      recurrence: { frequency: 'weekly', daysOfWeek: [2, 4], hora: '19:00' },
    });
    const res = await request(app).get(URL).set('Authorization', bearerFor(admin));
    const de = (t) => res.body.actividades.find((a) => a.titulo === t);
    expect(de('Toda la semana').semana.map((e) => e.dia)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(de('Toda la semana').proximo.fecha).toBe(hoy());
    expect(de('Martes y jueves').semana.map((e) => e.dia)).toEqual([1, 3]);
    expect(de('Martes y jueves').cuando).toBe('Todos los martes y jueves · 19:00');
  });
});

describe('cuandoEs', () => {
  it('dice los días de la semana en orden, empezando por el lunes', () => {
    expect(cuandoEs({ tipo: 'recurrente', recurrence: { frequency: 'weekly', daysOfWeek: [5], hora: '20:30' } })).toBe('Todos los viernes · 20:30');
    expect(cuandoEs({ tipo: 'recurrente', recurrence: { frequency: 'weekly', daysOfWeek: [0, 3, 1], hora: '19:00' } })).toBe(
      'Todos los lunes, miércoles y domingos · 19:00'
    );
  });

  it('dice la fecha de una única y el rango de un viaje', () => {
    expect(cuandoEs({ tipo: 'unica', fecha: '2026-11-21T00:00:00.000Z', hora: '11:00' })).toBe('Sáb 21 nov · 11:00');
    expect(cuandoEs({ tipo: 'viaje', fecha: '2026-12-06T00:00:00.000Z', fechaFin: '2026-12-08T00:00:00.000Z' })).toBe('Del 6 al 8 de dic');
    expect(cuandoEs({ tipo: 'recurrente', recurrence: { frequency: 'monthly', dayOfMonth: [15, 1] } })).toBe('Todos los meses, el 1 y 15');
  });
});

describe('filtros acumulables', () => {
  it('suma texto y tags (con uno de los tags alcanza)', async () => {
    await createActivity(admin._id, { titulo: 'Shabbat en la casa', categorias: ['Shabbat'] });
    await createActivity(admin._id, { titulo: 'Cocina (israelí)', categorias: ['Cocina'] });
    await createActivity(admin._id, { titulo: 'Shabbat de viaje', categorias: ['Viajes'] });
    const pedir = (query) => request(app).get(URL).query(query).set('Authorization', bearerFor(admin));

    expect((await pedir({ q: 'shabbat' })).body.actividades).toHaveLength(2);
    expect((await pedir({ tags: 'Cocina,Viajes' })).body.actividades).toHaveLength(2);
    expect((await pedir({ q: 'shabbat', tags: 'Viajes' })).body.actividades.map((a) => a.titulo)).toEqual(['Shabbat de viaje']);
    // Los caracteres especiales se buscan como texto.
    expect((await pedir({ q: '(israelí)' })).body.actividades).toHaveLength(1);
  });
});
