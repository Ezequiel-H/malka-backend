import request from 'supertest';
import ExcelJS from 'exceljs';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';
import { ageOnDate, todayCalendarDateInZone } from '../../utils/calendarDate.js';

let admin;
let ana;
let beto;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-exp@test.local',
    dni: '66661111',
    telefono: '+5411000777111'
  });
  ana = await createUser({
    estado: 'approved',
    email: 'ana-exp@test.local',
    nombre: 'Ana',
    apellido: 'Prueba',
    dni: '66662222',
    telefono: '+5411000777222'
  });
  beto = await createUser({
    estado: 'approved',
    email: 'beto-exp@test.local',
    nombre: 'Beto',
    apellido: 'Cancelado',
    dni: '66663333',
    telefono: '+5411000777333'
  });
});

const downloadWorkbook = async (url) => {
  const res = await request(app)
    .get(url)
    .set('Authorization', bearerFor(admin))
    .buffer(true)
    .parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  return wb.getWorksheet('Inscriptos');
};

describe('Exportación personalizada de inscriptos', () => {
  it('filtra por estados y exporta sólo las columnas pedidas', async () => {
    const act = await createActivity(admin._id);
    await createInscription(ana._id, act._id, act.fecha, { estado: 'aceptada' });
    await createInscription(beto._id, act._id, act.fecha, { estado: 'cancelada' });

    const ws = await downloadWorkbook(
      `/api/activities/${act._id}/export?estados=aceptada&columnas=nombre,email,estado`
    );

    expect(ws.getRow(1).values.slice(1)).toEqual(['Nombre', 'Email', 'Estado']);
    expect(ws.rowCount).toBe(2); // header + Ana
    expect(ws.getRow(2).values.slice(1)).toEqual(['Ana', 'ana-exp@test.local', 'Aceptada']);
  });

  it('sin params conserva el comportamiento histórico (todas las inscripciones, 6 columnas)', async () => {
    const act = await createActivity(admin._id);
    await createInscription(ana._id, act._id, act.fecha, { estado: 'aceptada' });
    await createInscription(beto._id, act._id, act.fecha, { estado: 'cancelada' });

    const ws = await downloadWorkbook(`/api/activities/${act._id}/export`);

    expect(ws.getRow(1).values.slice(1)).toEqual([
      'Nombre',
      'Apellido',
      'Email',
      'Teléfono',
      'Restricciones Alimenticias',
      'Tags'
    ]);
    expect(ws.rowCount).toBe(3); // header + 2 inscripciones
  });

  it('ignora columnas desconocidas sin romper', async () => {
    const act = await createActivity(admin._id);
    await createInscription(ana._id, act._id, act.fecha, { estado: 'aceptada' });

    const ws = await downloadWorkbook(
      `/api/activities/${act._id}/export?columnas=nombre,columnaFalsa,dni`
    );

    expect(ws.getRow(1).values.slice(1)).toEqual(['Nombre', 'DNI']);
  });

  it('exporta la edad (no la fecha de nacimiento) y deja vacío a quien no la cargó', async () => {
    const act = await createActivity(admin._id);
    ana.fechaNacimiento = '1990-06-15';
    await ana.save();
    await createInscription(ana._id, act._id, act.fecha, { estado: 'aceptada' });
    await createInscription(beto._id, act._id, act.fecha, { estado: 'aceptada' });

    const ws = await downloadWorkbook(`/api/activities/${act._id}/export?columnas=nombre,edad`);

    expect(ws.getRow(1).values.slice(1)).toEqual(['Nombre', 'Edad']);
    const filas = [ws.getRow(2), ws.getRow(3)].map((r) => [r.getCell(1).value, r.getCell(2).value]);
    expect(filas).toContainEqual(['Ana', ageOnDate('1990-06-15', todayCalendarDateInZone())]);
    expect(filas).toContainEqual(['Beto', '']);
  });
});

describe('ageOnDate', () => {
  it('cuenta los años cumplidos al día dado', () => {
    expect(ageOnDate('1990-06-15', '2026-06-14')).toBe(35);
    expect(ageOnDate('1990-06-15', '2026-06-15')).toBe(36);
    expect(ageOnDate('2000-02-29', '2026-02-28')).toBe(25);
    expect(ageOnDate('2000-02-29', '2026-03-01')).toBe(26);
  });

  it('devuelve null sin fecha válida', () => {
    expect(ageOnDate('', '2026-01-01')).toBeNull();
    expect(ageOnDate(undefined, '2026-01-01')).toBeNull();
    expect(ageOnDate('1990-02-30', '2026-01-01')).toBeNull();
  });
});
