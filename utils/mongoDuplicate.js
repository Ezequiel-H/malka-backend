/**
 * Traduce errores de índice único de MongoDB (código 11000) a mensajes de usuario.
 */
export function messageFromMongoDuplicate(error) {
  if (error?.code !== 11000) return null;
  const key = error.keyPattern ? Object.keys(error.keyPattern)[0] : null;
  if (key === 'email') return 'El email ya está registrado.';
  if (key === 'dni') return 'Ya existe una cuenta con ese DNI.';
  if (key === 'telefono') return 'Ya existe una cuenta con ese teléfono.';
  return 'Ese dato ya está registrado.';
}
