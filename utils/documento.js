/**
 * El documento de una persona: DNI argentino o pasaporte. Se guarda en el
 * mismo campo (`dni`) con su tipo al lado, así la búsqueda y el chequeo de
 * duplicados siguen andando igual.
 */
export const TIPOS_DOCUMENTO = ['dni', 'pasaporte'];

const DNI_RE = /^\d{7,10}$/;
const PASAPORTE_RE = /^[A-Z0-9]{5,20}$/;

/* Sin espacios y en mayúsculas (los pasaportes llevan letras). */
export const normalizarDocumento = (valor) => String(valor ?? '').replace(/\s/g, '').trim().toUpperCase();

/**
 * Si el número sirve para ese tipo de documento. Sin tipo (una edición que no
 * lo manda) se acepta cualquiera de los dos formatos.
 */
export const documentoValido = (valor, tipo) => {
  const v = normalizarDocumento(valor);
  if (tipo === 'pasaporte') return PASAPORTE_RE.test(v);
  if (tipo === 'dni') return DNI_RE.test(v);
  return DNI_RE.test(v) || PASAPORTE_RE.test(v);
};

/* Para express-validator: el mensaje dice qué formato se esperaba. */
export const validarDocumento = (valor, { req }) => {
  if (!documentoValido(valor, req.body.tipoDocumento)) {
    throw new Error(
      req.body.tipoDocumento === 'pasaporte'
        ? 'El pasaporte debe tener entre 5 y 20 letras o números'
        : 'El DNI debe tener entre 7 y 10 dígitos'
    );
  }
  return true;
};

/* En el alta, sin tipo es DNI: el pasaporte se elige a propósito. */
export const validarDocumentoAlta = (valor, { req }) =>
  validarDocumento(valor, { req: { body: { ...req.body, tipoDocumento: req.body.tipoDocumento ?? 'dni' } } });
