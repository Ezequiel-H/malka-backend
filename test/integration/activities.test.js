import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import app from '../../app.js';
import { connectMemoryMongo, disconnectMemoryMongo, clearCollections } from '../helpers/mongo.js';
import {
  createUser,
  bearerFor,
  createActivity,
  createInscription
} from '../helpers/factories.js';

const futureDate = () => new Date(Date.now() + 86400000 * 14);

let admin;
let participantApproved;
let participantPending;

beforeAll(connectMemoryMongo);
afterAll(disconnectMemoryMongo);
beforeEach(async () => {
  await clearCollections();
  admin = await createUser({
    role: 'admin',
    estado: 'approved',
    email: 'admin-act@test.local',
    dni: '11112222',
    telefono: '+5411000222111'
  });
  participantApproved = await createUser({
    estado: 'approved',
    email: 'part-act@test.local',
    dni: '11113333',
    telefono: '+5411000222333'
  });
  participantPending = await createUser({
    estado: 'pending',
    email: 'pend-act@test.local',
    dni: '11114444',
    telefono: '+5411000222444'
  });
});

describe('GET /api/activities', () => {
  it('forbids pending participant', async () => {
    const res = await request(app)
      .get('/api/activities')
      .set('Authorization', bearerFor(participantPending));
    expect(res.status).toBe(403);
  });

  it('participant only sees publicadas', async () => {
    const draft = await createActivity(admin._id, { estado: 'borrador', titulo: 'Borrador' });
    const pub = await createActivity(admin._id, {
      estado: 'publicada',
      titulo: 'Publicada',
      fecha: new Date(Date.now() + 86400000 * 7)
    });
    const res = await request(app)
      .get('/api/activities')
      .set('Authorization', bearerFor(participantApproved));
    expect(res.status).toBe(200);
    const ids = res.body.activities.map((a) => String(a._id));
    expect(ids).toContain(String(pub._id));
    expect(ids).not.toContain(String(draft._id));
  });

  it('admin can filter by estado', async () => {
    await createActivity(admin._id, { estado: 'borrador', titulo: 'OnlyAdmin' });
    const res = await request(app)
      .get('/api/activities')
      .query({ estado: 'borrador' })
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    expect(res.body.activities.every((a) => a.estado === 'borrador')).toBe(true);
  });
});

describe('GET /api/activities/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/activities/507f1f77bcf86cd799439011')
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(404);
  });

  it('participant cannot load borrador', async () => {
    const draft = await createActivity(admin._id, { estado: 'borrador' });
    const res = await request(app)
      .get(`/api/activities/${draft._id}`)
      .set('Authorization', bearerFor(participantApproved));
    expect(res.status).toBe(404);
  });

  it('participant can load publicada', async () => {
    const pub = await createActivity(admin._id, {
      estado: 'publicada',
      fecha: new Date(Date.now() + 86400000 * 7)
    });
    const res = await request(app)
      .get(`/api/activities/${pub._id}`)
      .set('Authorization', bearerFor(participantApproved));
    expect(res.status).toBe(200);
    expect(res.body.activity.titulo).toBe(pub.titulo);
  });
});

describe('participant access: actividad privada + tagsPrivados', () => {
  it('no lista la actividad si el participante no tiene ningún tag requerido', async () => {
    await createActivity(admin._id, {
      titulo: 'Evento solo etiquetados',
      estado: 'publicada',
      visibilidad: 'privada',
      tagsPrivados: ['vip'],
      fecha: futureDate()
    });

    const sinTags = await createUser({
      estado: 'approved',
      email: 'sin-tags-act@test.local',
      dni: '88881111',
      telefono: '+5411888111111',
      tags: []
    });

    const res = await request(app)
      .get('/api/activities')
      .set('Authorization', bearerFor(sinTags));

    expect(res.status).toBe(200);
    expect(res.body.activities.some((a) => a.titulo === 'Evento solo etiquetados')).toBe(false);
  });

  it('lista la actividad si el participante tiene al menos un tag requerido (case-insensitive)', async () => {
    const act = await createActivity(admin._id, {
      titulo: 'Evento VIP',
      estado: 'publicada',
      visibilidad: 'privada',
      tagsPrivados: ['vip'],
      fecha: futureDate()
    });

    const conVip = await createUser({
      estado: 'approved',
      email: 'con-vip-act@test.local',
      dni: '88882222',
      telefono: '+5411888222222',
      tags: ['VIP']
    });

    const res = await request(app)
      .get('/api/activities')
      .set('Authorization', bearerFor(conVip));

    expect(res.status).toBe(200);
    expect(res.body.activities.some((a) => String(a._id) === String(act._id))).toBe(true);
  });

  it('GET detalle 403 si es privada y el usuario no califica', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      visibilidad: 'privada',
      tagsPrivados: ['vip'],
      fecha: futureDate()
    });

    const sinTags = await createUser({
      estado: 'approved',
      email: 'sin-tags-det@test.local',
      dni: '88883333',
      telefono: '+5411888333333',
      tags: []
    });

    const res = await request(app)
      .get(`/api/activities/${act._id}`)
      .set('Authorization', bearerFor(sinTags));

    expect(res.status).toBe(403);
  });

  it('GET detalle 200 si tiene el tag requerido', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      visibilidad: 'privada',
      tagsPrivados: ['vip'],
      fecha: futureDate()
    });

    const conVip = await createUser({
      estado: 'approved',
      email: 'con-vip-det@test.local',
      dni: '88884444',
      telefono: '+5411888444444',
      tags: ['vip']
    });

    const res = await request(app)
      .get(`/api/activities/${act._id}`)
      .set('Authorization', bearerFor(conVip));

    expect(res.status).toBe(200);
    expect(String(res.body.activity._id)).toBe(String(act._id));
  });

  it('actividad pública con tagsPrivados: otro tag no alcanza para verla en cartelera', async () => {
    await createActivity(admin._id, {
      titulo: 'Solo socios público',
      estado: 'publicada',
      visibilidad: 'publica',
      tagsPrivados: ['socio'],
      fecha: futureDate()
    });

    const soloVip = await createUser({
      estado: 'approved',
      email: 'pub-socio-wrongtag@test.local',
      dni: '88885555',
      telefono: '+5411888555555',
      tags: ['vip']
    });

    const res = await request(app)
      .get('/api/activities')
      .set('Authorization', bearerFor(soloVip));

    expect(res.status).toBe(200);
    expect(res.body.activities.some((a) => a.titulo === 'Solo socios público')).toBe(false);
  });

  it('actividad pública con tagsPrivados: con el tag correcto aparece en cartelera', async () => {
    const act = await createActivity(admin._id, {
      titulo: 'Solo socios público 2',
      estado: 'publicada',
      visibilidad: 'publica',
      tagsPrivados: ['socio'],
      fecha: futureDate()
    });

    const socio = await createUser({
      estado: 'approved',
      email: 'pub-socio-ok@test.local',
      dni: '88886666',
      telefono: '+5411888666666',
      tags: ['socio']
    });

    const res = await request(app)
      .get('/api/activities')
      .set('Authorization', bearerFor(socio));

    expect(res.status).toBe(200);
    expect(res.body.activities.some((a) => String(a._id) === String(act._id))).toBe(true);
  });

  it('GET detalle actividad pública con tags: 403 si el participante no tiene ningún tag requerido', async () => {
    const act = await createActivity(admin._id, {
      estado: 'publicada',
      visibilidad: 'publica',
      tagsPrivados: ['socio'],
      fecha: futureDate()
    });

    const soloVip = await createUser({
      estado: 'approved',
      email: 'pub-det-403@test.local',
      dni: '88887777',
      telefono: '+5411888777777',
      tags: ['vip']
    });

    const res = await request(app)
      .get(`/api/activities/${act._id}`)
      .set('Authorization', bearerFor(soloVip));

    expect(res.status).toBe(403);
  });
});

describe('admin activity CRUD', () => {
  it('POST creates activity', async () => {
    const res = await request(app)
      .post('/api/activities')
      .set('Authorization', bearerFor(admin))
      .send({
        titulo: 'Taller',
        descripcion: 'Desc',
        tipo: 'unica',
        fecha: '2030-06-15',
        estado: 'publicada'
      });
    expect(res.status).toBe(201);
    expect(res.body.activity.titulo).toBe('Taller');
  });

  it('PUT updates activity', async () => {
    const act = await createActivity(admin._id, { estado: 'publicada' });
    const res = await request(app)
      .put(`/api/activities/${act._id}`)
      .set('Authorization', bearerFor(admin))
      .send({
        titulo: 'Taller 2',
        descripcion: act.descripcion,
        tipo: 'unica'
      });
    expect(res.status).toBe(200);
    expect(res.body.activity.titulo).toBe('Taller 2');
  });

  it('DELETE soft-deletes activity', async () => {
    const act = await createActivity(admin._id, { estado: 'publicada' });
    const res = await request(app)
      .delete(`/api/activities/${act._id}`)
      .set('Authorization', bearerFor(admin));
    expect(res.status).toBe(200);
    const fresh = await request(app)
      .get(`/api/activities/${act._id}`)
      .set('Authorization', bearerFor(admin));
    expect(fresh.body.activity.estado).toBe('eliminada');
  });
});

describe('GET /api/activities/:id/export', () => {
  it('returns xlsx for admin', async () => {
    const act = await createActivity(admin._id, { estado: 'publicada' });
    await createInscription(participantApproved._id, act._id, act.fecha, { estado: 'aceptada' });

    const res = await request(app)
      .get(`/api/activities/${act._id}/export`)
      .set('Authorization', bearerFor(admin))
      .buffer()
      .parse((res2, callback) => {
        const data = [];
        res2.on('data', (chunk) => data.push(chunk));
        res2.on('end', () => callback(null, Buffer.concat(data)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheet/);
    expect(res.body.length).toBeGreaterThan(100);
  });
});
