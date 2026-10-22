import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import app from '../../app.js';
import PushSubscription from '../../models/PushSubscription.model.js';
import { __sentPushes } from '../../utils/push.js';
import { sendDailyReminders, runDailyRemindersIfDue } from '../../utils/activityPush.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import { createUser, bearerFor, createActivity, createInscription } from '../helpers/factories.js';

let admin;
let ana;
let beto;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  __sentPushes.length = 0;
  admin = await createUser({ role: 'admin', estado: 'approved' });
  ana = await createUser({ estado: 'approved' });
  beto = await createUser({ estado: 'approved' });
});

let subCounter = 0;
async function subscribe(user) {
  subCounter += 1;
  return request(app)
    .post('/api/push/subscribe')
    .set('Authorization', bearerFor(user))
    .send({
      endpoint: `https://push.example.test/sub/${subCounter}`,
      keys: { p256dh: 'clave-p256dh', auth: 'clave-auth' }
    });
}

const pushesTo = (user) => __sentPushes.filter((p) => p.userId === String(user._id));

describe('Suscripción a notificaciones', () => {
  it('pide sesión y valida la suscripción', async () => {
    await request(app).post('/api/push/subscribe').send({}).expect(401);
    await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', bearerFor(ana))
      .send({ endpoint: 'http://inseguro.test', keys: { p256dh: 'a', auth: 'b' } })
      .expect(400);
  });

  it('guarda el dispositivo y, si otra cuenta lo usa después, pasa a esa cuenta', async () => {
    const body = { endpoint: 'https://push.example.test/compartido', keys: { p256dh: 'a', auth: 'b' } };
    await request(app).post('/api/push/subscribe').set('Authorization', bearerFor(ana)).send(body).expect(201);
    await request(app).post('/api/push/subscribe').set('Authorization', bearerFor(beto)).send(body).expect(201);

    const subs = await PushSubscription.find({ endpoint: body.endpoint });
    expect(subs).toHaveLength(1);
    expect(String(subs[0].userId)).toBe(String(beto._id));
  });

  it('sólo el dueño puede dar de baja su dispositivo', async () => {
    const body = { endpoint: 'https://push.example.test/de-ana', keys: { p256dh: 'a', auth: 'b' } };
    await request(app).post('/api/push/subscribe').set('Authorization', bearerFor(ana)).send(body);

    await request(app).delete('/api/push/subscribe').set('Authorization', bearerFor(beto)).send(body).expect(200);
    expect(await PushSubscription.countDocuments()).toBe(1);

    await request(app).delete('/api/push/subscribe').set('Authorization', bearerFor(ana)).send(body).expect(200);
    expect(await PushSubscription.countDocuments()).toBe(0);
  });
});

describe('Lo que va por mail también va por push', () => {
  it('confirmar una inscripción avisa por los dos canales', async () => {
    await subscribe(ana);
    const activity = await createActivity(admin._id, { esGratuita: true });
    const ins = await createInscription(ana._id, activity._id, activity.fecha, { estado: 'pendiente' });

    await request(app)
      .put(`/api/inscriptions/${ins._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'aceptada' })
      .expect(200);

    const [push] = pushesTo(ana);
    expect(push.title).toMatch(/confirmado/i);
    expect(push.url).toBe('/my-inscriptions');
  });

  it('sacar de la espera sin avisar no manda push; avisando, sí', async () => {
    await subscribe(ana);
    const activity = await createActivity(admin._id, { cupo: 2, esGratuita: true });
    const ins = await createInscription(ana._id, activity._id, activity.fecha, { estado: 'en_espera' });

    await request(app)
      .put(`/api/inscriptions/${ins._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'aceptada' })
      .expect(200);
    expect(pushesTo(ana)).toHaveLength(0);

    await request(app)
      .put(`/api/inscriptions/${ins._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'en_espera' });
    await request(app)
      .put(`/api/inscriptions/${ins._id}/status`)
      .set('Authorization', bearerFor(admin))
      .send({ estado: 'aceptada', notificar: true })
      .expect(200);
    expect(pushesTo(ana)).toHaveLength(1);
    expect(pushesTo(ana)[0].title).toMatch(/se liberó un lugar/i);
  });
});

describe('Actividad nueva', () => {
  const payload = {
    titulo: 'Taller nuevo',
    descripcion: 'Algo lindo',
    tipo: 'unica',
    fecha: '2030-07-01',
    hora: '19:00'
  };

  it('publicarla avisa a los suscriptos; un borrador no', async () => {
    await subscribe(ana);

    await request(app)
      .post('/api/activities')
      .set('Authorization', bearerFor(admin))
      .send({ ...payload, estado: 'borrador' })
      .expect(201);
    expect(pushesTo(ana)).toHaveLength(0);

    const res = await request(app)
      .post('/api/activities')
      .set('Authorization', bearerFor(admin))
      .send({ ...payload, estado: 'publicada', notificarParticipantes: true })
      .expect(201);

    const [push] = pushesTo(ana);
    expect(push.body).toBe('Taller nuevo');
    expect(push.actions[0].url).toBe(`/activities/${res.body.activity._id}`);
  });

  it('pasar un borrador a publicada avisa una vez; editarla después no', async () => {
    await subscribe(ana);
    const res = await request(app)
      .post('/api/activities')
      .set('Authorization', bearerFor(admin))
      .send({ ...payload, estado: 'borrador' });
    const id = res.body.activity._id;

    await request(app).put(`/api/activities/${id}`).set('Authorization', bearerFor(admin)).send({ ...payload, estado: 'publicada', notificarParticipantes: true }).expect(200);
    await request(app).put(`/api/activities/${id}`).set('Authorization', bearerFor(admin)).send({ ...payload, estado: 'publicada', notificarParticipantes: true, titulo: 'Otro título' }).expect(200);

    expect(pushesTo(ana)).toHaveLength(1);
  });

  it('si el admin elige no avisar, no se manda nada', async () => {
    await subscribe(ana);
    const res = await request(app)
      .post('/api/activities')
      .set('Authorization', bearerFor(admin))
      .send({ ...payload, estado: 'publicada', notificarParticipantes: false })
      .expect(201);
    expect(res.body.activity.notificarParticipantes).toBeUndefined();

    const borrador = await request(app)
      .post('/api/activities')
      .set('Authorization', bearerFor(admin))
      .send({ ...payload, estado: 'borrador' });
    await request(app)
      .put(`/api/activities/${borrador.body.activity._id}`)
      .set('Authorization', bearerFor(admin))
      .send({ ...payload, estado: 'publicada' })
      .expect(200);

    expect(pushesTo(ana)).toHaveLength(0);
  });

  it('una actividad privada sólo le llega a quien tiene el tag', async () => {
    await subscribe(ana);
    const conTag = await createUser({ estado: 'approved', tagsPrivados: ['socios'] });
    await subscribe(conTag);

    await request(app)
      .post('/api/activities')
      .set('Authorization', bearerFor(admin))
      .send({ ...payload, estado: 'publicada', notificarParticipantes: true, visibilidad: 'privada', tagsPrivados: ['socios'] })
      .expect(201);

    expect(pushesTo(ana)).toHaveLength(0);
    expect(pushesTo(conTag)).toHaveLength(1);
  });

  it('no les llega a cuentas pendientes ni a admins', async () => {
    const pendiente = await createUser({ estado: 'pending' });
    await subscribe(pendiente);
    await subscribe(admin);

    await request(app)
      .post('/api/activities')
      .set('Authorization', bearerFor(admin))
      .send({ ...payload, estado: 'publicada', notificarParticipantes: true })
      .expect(201);

    expect(__sentPushes).toHaveLength(0);
  });
});

describe('Recordatorio del día', () => {
  const HOY = '2030-06-15';
  const fechaHoy = new Date(Date.UTC(2030, 5, 15, 0, 0, 0, 0));

  it('le avisa a quien no está anotado, con «Ir a anotarme»', async () => {
    await subscribe(ana);
    await subscribe(beto);
    const activity = await createActivity(admin._id, { fecha: fechaHoy, hora: '19:00', titulo: 'Yoga' });
    await createInscription(beto._id, activity._id, fechaHoy, { estado: 'aceptada' });

    expect(await sendDailyReminders(HOY)).toBe(1);
    const [push] = pushesTo(ana);
    expect(push.title).toBe('Hoy: Yoga');
    expect(push.body).toMatch(/19:00/);
    expect(push.actions[0]).toMatchObject({ title: 'Ir a anotarme', url: `/activities/${activity._id}` });
    expect(pushesTo(beto)).toHaveLength(0);
  });

  it('si canceló, se le recuerda igual', async () => {
    await subscribe(ana);
    const activity = await createActivity(admin._id, { fecha: fechaHoy });
    await createInscription(ana._id, activity._id, fechaHoy, { estado: 'cancelada' });
    expect(await sendDailyReminders(HOY)).toBe(1);
  });

  it('junta varias actividades del día en una sola notificación', async () => {
    await subscribe(ana);
    await createActivity(admin._id, { fecha: fechaHoy, titulo: 'Yoga' });
    await createActivity(admin._id, { fecha: fechaHoy, titulo: 'Cerámica' });

    await sendDailyReminders(HOY);
    const pushes = pushesTo(ana);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].title).toBe('Hoy hay 2 actividades en Malka');
    expect(pushes[0].actions[0]).toMatchObject({ title: 'Ver actividades', url: '/activities' });
  });

  it('saltea viajes, borradores, sin cupo, otros días y las que apagaron los recordatorios', async () => {
    await subscribe(ana);
    await createActivity(admin._id, { fecha: fechaHoy, tipo: 'viaje', fechaFin: fechaHoy });
    await createActivity(admin._id, { fecha: fechaHoy, estado: 'borrador' });
    await createActivity(admin._id, { fecha: fechaHoy, recordatoriosAutomaticos: false });
    await createActivity(admin._id, { fecha: new Date(Date.UTC(2030, 5, 16)) });
    const llena = await createActivity(admin._id, { fecha: fechaHoy, cupo: 1 });
    await createInscription(beto._id, llena._id, fechaHoy, { estado: 'aceptada' });

    expect(await sendDailyReminders(HOY)).toBe(0);
  });

  it('sale una sola vez por día y no antes de las 10', async () => {
    await subscribe(ana);
    await createActivity(admin._id, { fecha: fechaHoy });
    const zona = 'America/Argentina/Buenos_Aires';

    expect(await runDailyRemindersIfDue(DateTime.fromISO(`${HOY}T09:30`, { zone: zona }))).toBe(false);
    expect(await runDailyRemindersIfDue(DateTime.fromISO(`${HOY}T10:05`, { zone: zona }))).toBe(true);
    expect(await runDailyRemindersIfDue(DateTime.fromISO(`${HOY}T10:15`, { zone: zona }))).toBe(false);
    expect(pushesTo(ana)).toHaveLength(1);
  });
});
