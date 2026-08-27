import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { __sentEmails } from '../../utils/mailer.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';

let admin;
let participante;
let enEspera;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  __sentEmails.length = 0;
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-mail@test.local',
    dni: '44441111',
    telefono: '+5411000555111'
  });
  participante = await createUser({
    estado: 'approved',
    email: 'parti-mail@test.local',
    dni: '44442222',
    telefono: '+5411000555222'
  });
  enEspera = await createUser({
    estado: 'approved',
    email: 'espera-mail@test.local',
    dni: '44443333',
    telefono: '+5411000555333'
  });
});

const mailsTo = (email) => __sentEmails.filter((m) => m.to === email);

describe('Notificaciones por email', () => {
  it('aprobar un usuario le manda el mail de cuenta aprobada', async () => {
    const nuevo = await createUser({
      estado: 'pending',
      email: 'nuevo-mail@test.local',
      dni: '44444444',
      telefono: '+5411000555444'
    });

    await request(app)
      .put(`/api/users/${nuevo._id}/approve`)
      .set('Authorization', bearerFor(admin))
      .expect(200);

    const mails = mailsTo('nuevo-mail@test.local');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/aprobada/i);
  });

  it('aprobar el comprobante manda "inscripción confirmada"', async () => {
    const activity = await createActivity(admin._id, { esGratuita: false, precio: 5000 });
    const ins = await createInscription(participante._id, activity._id, activity.fecha, {
      estado: 'pendiente',
      pago: {
        comprobante: { url: 'http://x/c.png', publicId: 'x' },
        estadoPago: 'pendiente',
        montoEsperado: 5000
      }
    });

    await request(app)
      .put(`/api/inscriptions/${ins._id}/payment/approve`)
      .set('Authorization', bearerFor(admin))
      .expect(200);

    const mails = mailsTo('parti-mail@test.local');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/confirmada/i);
    expect(mails[0].html).toContain(activity.titulo);
  });

  it('rechazar el comprobante manda el mail con el motivo', async () => {
    const activity = await createActivity(admin._id, { esGratuita: false, precio: 5000 });
    const ins = await createInscription(participante._id, activity._id, activity.fecha, {
      estado: 'pendiente',
      pago: {
        comprobante: { url: 'http://x/c.png', publicId: 'x' },
        estadoPago: 'pendiente',
        montoEsperado: 5000
      }
    });

    await request(app)
      .put(`/api/inscriptions/${ins._id}/payment/reject`)
      .set('Authorization', bearerFor(admin))
      .send({ motivoRechazo: 'el monto no coincide' })
      .expect(200);

    const mails = mailsTo('parti-mail@test.local');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/comprobante/i);
    expect(mails[0].html).toContain('el monto no coincide');
  });

  it('la promoción de la lista de espera notifica al promovido', async () => {
    const activity = await createActivity(admin._id, { cupo: 1, esGratuita: true });
    const ocupante = await createInscription(participante._id, activity._id, activity.fecha, {
      estado: 'aceptada',
      fechaInscripcion: new Date('2030-01-01T10:00:00Z')
    });
    await createInscription(enEspera._id, activity._id, activity.fecha, {
      estado: 'en_espera',
      fechaInscripcion: new Date('2030-01-02T10:00:00Z')
    });

    await request(app)
      .put(`/api/inscriptions/${ocupante._id}/cancel`)
      .set('Authorization', bearerFor(participante))
      .expect(200);

    const mails = mailsTo('espera-mail@test.local');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/se liberó un lugar/i);
    expect(mails[0].html).toMatch(/confirmado/i);
  });

  it('inscribirse a una actividad gratuita con lugar manda la confirmación', async () => {
    const activity = await createActivity(admin._id, { esGratuita: true });
    const d = new Date(activity.fecha);
    const fechaStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

    await request(app)
      .post('/api/inscriptions')
      .set('Authorization', bearerFor(participante))
      .send({ activityId: activity._id.toString(), fecha: fechaStr })
      .expect(201);

    const mails = mailsTo('parti-mail@test.local');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/confirmada/i);
  });
});
