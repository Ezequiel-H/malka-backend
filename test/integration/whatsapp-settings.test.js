import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity } from '../helpers/factories.js';

let admin;
let approved;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-wa@test.local',
    dni: '55551111',
    telefono: '+5411000666111'
  });
  approved = await createUser({
    estado: 'approved',
    email: 'parti-wa@test.local',
    dni: '55552222',
    telefono: '+5411000666222'
  });
});

describe('Ajustes de WhatsApp', () => {
  it('guarda número (sólo dígitos), mensaje de viaje y plantillas limpias', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', bearerFor(admin))
      .send({
        whatsappNumero: '+54 9 11 3440-5730',
        whatsappViajeMensaje: 'Hola, soy {nombre} y voy a {actividad}',
        plantillasWhatsApp: [
          { nombre: 'Recordatorio', mensaje: 'Hola {nombre}! Te esperamos en {actividad} el {fecha}.' },
          { nombre: '   ', mensaje: 'sin nombre, se descarta' },
          { nombre: 'vacía', mensaje: '' }
        ]
      })
      .expect(200);

    const s = res.body.settings;
    expect(s.whatsappNumero).toBe('5491134405730');
    expect(s.whatsappViajeMensaje).toContain('{nombre}');
    expect(s.plantillasWhatsApp).toHaveLength(1);
    expect(s.plantillasWhatsApp[0].nombre).toBe('Recordatorio');
  });

  it('el detalle de un viaje pago incluye el contacto de WhatsApp para el participante', async () => {
    const viaje = await createActivity(admin._id, {
      tipo: 'viaje',
      esGratuita: false,
      precio: 100000,
      fechaFin: new Date(Date.UTC(2030, 5, 18, 12, 0, 0, 0))
    });

    const res = await request(app)
      .get(`/api/activities/${viaje._id}`)
      .set('Authorization', bearerFor(approved))
      .expect(200);

    const act = res.body.activity;
    expect(act.whatsappViaje).toBeTruthy();
    expect(act.whatsappViaje.numero).toBe('5491134405730');
    expect(act.whatsappViaje.mensaje).toContain('{actividad}');
  });

  it('una actividad paga que no es viaje no expone contacto de WhatsApp', async () => {
    const act = await createActivity(admin._id, { esGratuita: false, precio: 5000 });

    const res = await request(app)
      .get(`/api/activities/${act._id}`)
      .set('Authorization', bearerFor(approved))
      .expect(200);

    expect(res.body.activity.whatsappViaje).toBeUndefined();
  });
});
