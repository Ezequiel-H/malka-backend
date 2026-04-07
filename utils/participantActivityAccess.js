/**
 * Reglas para participantes aprobados y actividades publicadas:
 * - Pública sin tags de acceso → visible para todos.
 * - Con tagsVisibilidad → solo quien tenga al menos un tag (case-insensitive).
 * - Privada sin tags configurados → no visible (config inválida).
 */

export function participantCanViewActivity(user, activity) {
  if (!user || user.role !== 'participant') return true;

  const userTags = (user.tags || []).map((t) => String(t).toLowerCase());
  const required = (activity.tagsVisibilidad || []).map((t) => String(t).toLowerCase());

  if (activity.visibilidad === 'privada' && required.length === 0) {
    return false;
  }
  if (required.length > 0) {
    return required.some((t) => userTags.includes(t));
  }
  return true;
}

/** Para handlers HTTP: null si puede ver; si no, objeto con status y body. */
export function participantActivityAccessDenied(req, activity) {
  if (!req.user || req.user.role !== 'participant') return null;
  if (!participantCanViewActivity(req.user, activity)) {
    return { status: 403, body: { message: 'No tienes acceso a esta actividad' } };
  }
  return null;
}
