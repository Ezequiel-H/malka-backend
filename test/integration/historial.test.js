import request from 'supertest';
import ExcelJS from 'exceljs';
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
  admin = await createUser({ role: 'admin', estado: 'approved', email: 'admin-hist@test.local', dni: '77771111', telefono: '+5411000888111' });
  participant = await createUser({ estado: 'approved', nombre: 'Ana', apellido: 'Gold', email: 'ana@test.local', dni: '77772222', telefono: '+5411000888222' });
  activity = await createActivity(admin._id, { titulo: 'Cena de Shabat' });
});

const planilla = async (filas) => {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Anotados');
  hoja.addRow(['ID', 'Nombre', 'Apellido', 'Email', 'Fecha de Nacimiento', 'Edad', 'Evento', 'Fecha', 'Mes-Año', 'Categoria', 'Sub-Categoria']);
  for (const f of filas) hoja.addRow(f);
  const gastos = libro.addWorksheet('Gastos');
  gastos.addRow(['Concepto', 'Monto', 'Evento', 'Fecha', 'Mes-Año', 'Categoria']);
  gastos.addRow(['Gastos Totales', -50000, 'Kabbalat Shabbat - 06/10/2023', '06/10/2023', '', 'Espiritual']);
  gastos.addRow(['Recaudacion', 20000, 'Kabbalat Shabbat - 06/10/2023', '06/10/2023', '', 'Espiritual']);
  return Buffer.from(await libro.xlsx.writeBuffer());
};

describe('Historial', () => {
  it('es sólo del equipo', async () => {
    await request(app).get('/api/historial').set('Authorization', bearerFor(participant)).expect(403);
    await request(app).get('/api/historial/personas?q=an').set('Authorization', bearerFor(participant)).expect(403);
  });

  it('suma a alguien que vino sin anotarse, como contacto nuevo o como cuenta', async () => {
    const nuevo = await request(app)
      .post('/api/historial/contactos')
      .set('Authorization', bearerFor(admin))
      .send({ nombre: 'Beto', apellido: 'Katz', telefono: '+54911' })
      .expect(201);
    expect(nuevo.body.persona.tipo).toBe('contacto');

    const busqueda = await request(app).get('/api/historial/personas?q=beto').set('Authorization', bearerFor(admin)).expect(200);
    expect(busqueda.body.personas[0]).toMatchObject({ tipo: 'contacto', nombre: 'Beto Katz' });

    // Con un mail de una cuenta, no duplica: devuelve la cuenta.
    const existente = await request(app).post('/api/historial/contactos').set('Authorization', bearerFor(admin)).send({ nombre: 'Ana', email: 'ana@test.local' }).expect(200);
    expect(existente.body.persona).toMatchObject({ tipo: 'usuario', id: String(participant._id) });

    const visita = { persona: nuevo.body.persona, actividadId: String(activity._id), fecha: '2026-01-09' };
    const creada = await request(app).post('/api/historial').set('Authorization', bearerFor(admin)).send(visita).expect(201);
    expect(creada.body.visita.origen).toBe('sin_anotarse');
    await request(app).post('/api/historial').set('Authorization', bearerFor(admin)).send(visita).expect(409);

    // Quien ya estaba inscripta se marca en la lista, no se suma de nuevo.
    await createInscription(participant._id, activity._id, new Date('2026-01-09T00:00:00.000Z'), { estado: 'aceptada' });
    await request(app)
      .post('/api/historial')
      .set('Authorization', bearerFor(admin))
      .send({ persona: { tipo: 'usuario', id: String(participant._id) }, actividadId: String(activity._id), fecha: '2026-01-09' })
      .expect(409);

    const lista = await request(app).get('/api/historial?from=2026-01-01&to=2026-01-31').set('Authorization', bearerFor(admin)).expect(200);
    expect(lista.body.total).toBe(2);
    expect(lista.body.porOrigen).toMatchObject({ inscripcion: 1, sin_anotarse: 1 });

    const metricas = await request(app).get('/api/admin/metrics?from=2026-01-01&to=2026-01-31').set('Authorization', bearerFor(admin)).expect(200);
    expect(metricas.body.personas).toMatchObject({ participantes: 2, sinAnotarse: { veces: 1, personas: 1 } });

    await request(app).delete(`/api/historial/${creada.body.visita._id}`).set('Authorization', bearerFor(admin)).expect(200);
  });

  it('importa la planilla, reconoce cuentas, carga gastos y no duplica al reimportar', async () => {
    const archivo = await planilla([
      ['ANA GOLD', 'ANA', 'GOLD', 'ANA@TEST.LOCAL', '13/11/1992', 30, 'Kabbalat Shabbat - 06/10/2023', '06/10/2023', '', 'Espiritual', 'Shabbat'],
      ['BETO KATZ', 'BETO', 'KATZ', 'BETO@MAIL.COM', '02/02/1995', 28, 'Kabbalat Shabbat - 06/10/2023', '06/10/2023', '', 'Espiritual', 'Shabbat'],
      ['BETO KATZ', 'BETO', 'KATZ', 'BETO@MAIL.COM', '02/02/1995', 28, 'Fiesta Purim - 23/03/2024', '23/03/2024', '', 'Cultura', ''],
    ]);
    const previa = await request(app)
      .post('/api/historial/importar')
      .set('Authorization', bearerFor(admin))
      .attach('archivo', archivo, 'base.xlsx')
      .expect(200);
    expect(previa.body).toMatchObject({ confirmado: false, resumen: { visitasNuevas: 3, contactosNuevos: 1, gastosNuevos: 1, ingresosNuevos: 1 } });
    expect(previa.body.resumen.reconocidas.usuarios).toBe(1);

    await request(app).post('/api/historial/importar').set('Authorization', bearerFor(admin)).field('confirmar', 'si').attach('archivo', archivo, 'base.xlsx').expect(200);
    const otra = await request(app).post('/api/historial/importar').set('Authorization', bearerFor(admin)).attach('archivo', archivo, 'base.xlsx').expect(200);
    expect(otra.body.resumen).toMatchObject({ visitasNuevas: 0, contactosNuevos: 0, gastosNuevos: 0 });

    const actividades = await request(app).get('/api/admin/metrics/activities?from=2023-01-01&to=2024-12-31').set('Authorization', bearerFor(admin)).expect(200);
    const shabbat = actividades.body.actividades.find((a) => a.titulo === 'Kabbalat Shabbat');
    expect(shabbat).toMatchObject({ personas: 2, costo: 50000, recaudado: 20000, esEvento: true });
    const ficha = await request(app).get(`/api/admin/metrics/activities/${encodeURIComponent(shabbat.id)}?from=2023-01-01&to=2024-12-31`).set('Authorization', bearerFor(admin)).expect(200);
    expect(ficha.body.encuentros).toHaveLength(1);
  });
});
