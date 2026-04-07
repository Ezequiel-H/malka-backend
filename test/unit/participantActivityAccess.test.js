import { describe, it, expect } from 'vitest';
import {
  participantCanViewActivity,
  participantActivityAccessDenied
} from '../../utils/participantActivityAccess.js';

const participant = (tags) => ({ role: 'participant', tags });
const act = (overrides) => ({
  visibilidad: 'publica',
  tagsPrivados: [],
  ...overrides
});

describe('participantCanViewActivity', () => {
  it('public sin tags: todos los participantes', () => {
    expect(participantCanViewActivity(participant(['vip']), act({}))).toBe(true);
    expect(participantCanViewActivity(participant([]), act({}))).toBe(true);
  });

  it('public con tags: requiere coincidencia; otro tag no alcanza', () => {
    const a = act({ tagsPrivados: ['socio'] });
    expect(participantCanViewActivity(participant(['socio']), a)).toBe(true);
    expect(participantCanViewActivity(participant(['vip']), a)).toBe(false);
    expect(participantCanViewActivity(participant(['vip', 'música']), a)).toBe(false);
  });

  it('match case-insensitive', () => {
    const a = act({ tagsPrivados: ['Socio'] });
    expect(participantCanViewActivity(participant(['socio']), a)).toBe(true);
  });

  it('privada sin tags configurados: nadie', () => {
    const a = act({ visibilidad: 'privada', tagsPrivados: [] });
    expect(participantCanViewActivity(participant(['x']), a)).toBe(false);
  });

  it('privada con tags: misma regla que pública con tags', () => {
    const a = act({ visibilidad: 'privada', tagsPrivados: ['vip'] });
    expect(participantCanViewActivity(participant(['vip']), a)).toBe(true);
    expect(participantCanViewActivity(participant(['socio']), a)).toBe(false);
  });
});

describe('participantActivityAccessDenied', () => {
  it('admin no bloquea', () => {
    const req = { user: { role: 'admin', tags: [] } };
    expect(participantActivityAccessDenied(req, act({ tagsPrivados: ['x'] }))).toBeNull();
  });

  it('participante sin acceso devuelve 403', () => {
    const req = { user: participant(['vip']) };
    const denied = participantActivityAccessDenied(req, act({ tagsPrivados: ['socio'] }));
    expect(denied).toEqual({
      status: 403,
      body: { message: 'No tienes acceso a esta actividad' }
    });
  });
});
