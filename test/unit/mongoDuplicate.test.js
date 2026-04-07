import { describe, it, expect } from 'vitest';
import { messageFromMongoDuplicate } from '../../utils/mongoDuplicate.js';

describe('messageFromMongoDuplicate', () => {
  it('returns null when code is not 11000', () => {
    expect(messageFromMongoDuplicate({ code: 1 })).toBeNull();
    expect(messageFromMongoDuplicate(null)).toBeNull();
  });

  it('maps email key', () => {
    expect(
      messageFromMongoDuplicate({ code: 11000, keyPattern: { email: 1 } })
    ).toBe('El email ya está registrado.');
  });

  it('maps dni key', () => {
    expect(messageFromMongoDuplicate({ code: 11000, keyPattern: { dni: 1 } })).toBe(
      'Ya existe una cuenta con ese DNI.'
    );
  });

  it('maps telefono key', () => {
    expect(messageFromMongoDuplicate({ code: 11000, keyPattern: { telefono: 1 } })).toBe(
      'Ya existe una cuenta con ese teléfono.'
    );
  });

  it('maps unknown unique key to generic message', () => {
    expect(messageFromMongoDuplicate({ code: 11000, keyPattern: { foo: 1 } })).toBe(
      'Ese dato ya está registrado.'
    );
  });
});
