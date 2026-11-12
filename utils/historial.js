/**
 * El historial de quién vino a Malka, más allá de las inscripciones: la
 * planilla histórica, la gente que vino sin anotarse y lo que el equipo
 * carga a mano. Todo puro (sin base de datos) para poder testearlo.
 */

/* Para comparar nombres y eventos: sin tildes, sin mayúsculas, sin espacios de más. */
export const normalizar = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/* «AGOSTINA» → «Agostina», «COHEN SABBAN» → «Cohen Sabban». */
export const nombrePropio = (t) =>
  String(t ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep, letra) => sep + letra.toUpperCase());

/**
 * Una fecha de la planilla a YYYY-MM-DD. Acepta lo que devuelve exceljs
 * (Date), «13/11/1992», «13-11-1992», «1992-11-13» y números de serie de
 * Excel. Lo que no se entiende queda en null.
 */
export const leerFecha = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const valida = (y, m, d) => {
    const f = new Date(Date.UTC(y, m - 1, d));
    return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d && y > 1900 && y < 2100
      ? f.toISOString().slice(0, 10)
      : null;
  };
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valida(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate());
  }
  if (typeof valor === 'number') {
    // Serie de Excel: días desde el 30/12/1899.
    const f = new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 86400000);
    return valida(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  }
  const t = String(valor).trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valida(y, Number(m[2]), Number(m[1]));
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
};

/* Los encabezados que entiende la importación, con sus variantes. */
const COLUMNAS = {
  nombre: ['nombre', 'nombres', 'first name'],
  apellido: ['apellido', 'apellidos', 'last name'],
  nombreCompleto: ['id', 'nombre completo', 'persona'],
  email: ['email', 'mail', 'e-mail', 'correo'],
  telefono: ['telefono', 'celular', 'whatsapp', 'tel'],
  fechaNacimiento: ['fecha de nacimiento', 'nacimiento', 'fecha nacimiento', 'cumpleanos'],
  evento: ['evento', 'actividad', 'evento/actividad'],
  fecha: ['fecha', 'fecha del evento', 'dia'],
  categoria: ['categoria', 'tipo'],
  subcategoria: ['sub-categoria', 'subcategoria', 'sub categoria'],
};

/** Qué columna de la planilla corresponde a cada dato (por el encabezado). */
export const mapearColumnas = (encabezados) => {
  const normalizados = encabezados.map(normalizar);
  return Object.fromEntries(
    Object.entries(COLUMNAS).map(([campo, variantes]) => [campo, normalizados.findIndex((h) => variantes.includes(h))])
  );
};

/**
 * Las filas de la planilla, ya entendidas. Cada fila es una visita: una
 * persona que vino a un evento en una fecha.
 */
export const leerFilas = (encabezados, filas) => {
  const col = mapearColumnas(encabezados);
  const de = (fila, campo) => (col[campo] >= 0 ? fila[col[campo]] : undefined);
  const texto = (v) => (v === null || v === undefined ? '' : typeof v === 'object' && v.text ? String(v.text) : String(v)).trim();
  return filas.map((fila, i) => {
    let nombre = texto(de(fila, 'nombre'));
    let apellido = texto(de(fila, 'apellido'));
    if (!nombre && !apellido) {
      const completo = texto(de(fila, 'nombreCompleto')).split(' ');
      nombre = completo.shift() ?? '';
      apellido = completo.join(' ');
    }
    const email = texto(de(fila, 'email')).toLowerCase();
    return {
      fila: i + 2, // +1 por el encabezado, +1 porque Excel cuenta desde 1
      nombre: nombrePropio(nombre),
      apellido: nombrePropio(apellido),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
      telefono: texto(de(fila, 'telefono')),
      fechaNacimiento: leerFecha(de(fila, 'fechaNacimiento')),
      evento: texto(de(fila, 'evento')),
      fecha: leerFecha(de(fila, 'fecha')),
      categoria: nombrePropio(texto(de(fila, 'categoria'))),
      subcategoria: nombrePropio(texto(de(fila, 'subcategoria'))),
    };
  });
};

/* La misma persona: por mail si hay; si no, por nombre y apellido. */
export const clavePersona = (p) => (p.email ? `m:${p.email.toLowerCase()}` : `n:${normalizar(`${p.nombre} ${p.apellido}`)}`);

/**
 * Qué hace la importación antes de hacerlo: a quién reconoce (cuentas y
 * contactos que ya existen), qué contactos nuevos crea, qué visitas carga y
 * cuáles saltea porque ya están o porque les falta algo. Así la pantalla
 * muestra el resumen y el equipo confirma.
 *
 * @param filas      salida de leerFilas
 * @param usuarios   cuentas: { _id, nombre, apellido, email }
 * @param contactos  contactos: { _id, nombre, apellido, email, usuarioId }
 * @param visitas    visitas ya cargadas: { userId, contactoId, evento, actividadId, fecha }
 */
export function planificarImportacion({ filas, usuarios, contactos, visitas }) {
  const porClave = new Map();
  for (const u of usuarios) {
    porClave.set(clavePersona(u), { tipo: 'usuario', id: String(u._id) });
    porClave.set(`n:${normalizar(`${u.nombre} ${u.apellido}`)}`, porClave.get(`n:${normalizar(`${u.nombre} ${u.apellido}`)}`) ?? { tipo: 'usuario', id: String(u._id) });
  }
  for (const c of contactos) {
    const destino = c.usuarioId ? { tipo: 'usuario', id: String(c.usuarioId) } : { tipo: 'contacto', id: String(c._id) };
    if (!porClave.has(clavePersona(c))) porClave.set(clavePersona(c), destino);
    const n = `n:${normalizar(`${c.nombre} ${c.apellido}`)}`;
    if (!porClave.has(n)) porClave.set(n, destino);
  }

  const yaCargadas = new Set(
    visitas.map((v) => `${v.userId ? `u:${v.userId}` : `c:${v.contactoId}`}|${normalizar(v.evento ?? `act:${v.actividadId}`)}|${new Date(v.fecha).toISOString().slice(0, 10)}`)
  );

  const contactosNuevos = new Map();
  const visitasNuevas = [];
  const salteadas = [];
  const reconocidas = { usuarios: new Set(), contactos: new Set() };

  for (const f of filas) {
    if (!f.nombre && !f.apellido && !f.email) {
      salteadas.push({ fila: f.fila, motivo: 'Sin nombre ni mail' });
      continue;
    }
    if (!f.fecha) {
      salteadas.push({ fila: f.fila, motivo: 'Sin fecha del evento' });
      continue;
    }
    if (!f.evento) {
      salteadas.push({ fila: f.fila, motivo: 'Sin evento' });
      continue;
    }
    const clave = clavePersona(f);
    let persona = porClave.get(clave) ?? (f.email ? porClave.get(`n:${normalizar(`${f.nombre} ${f.apellido}`)}`) : null);
    if (persona) {
      reconocidas[persona.tipo === 'usuario' ? 'usuarios' : 'contactos'].add(persona.id);
    } else {
      const nuevo = contactosNuevos.get(clave) ?? {
        clave,
        nombre: f.nombre || f.email.split('@')[0],
        apellido: f.apellido,
        email: f.email || undefined,
        telefono: f.telefono || undefined,
        fechaNacimiento: f.fechaNacimiento || undefined,
      };
      if (!nuevo.fechaNacimiento && f.fechaNacimiento) nuevo.fechaNacimiento = f.fechaNacimiento;
      contactosNuevos.set(clave, nuevo);
      persona = { tipo: 'nuevo', id: clave };
    }
    const quien = persona.tipo === 'usuario' ? `u:${persona.id}` : persona.tipo === 'contacto' ? `c:${persona.id}` : `n:${persona.id}`;
    const claveVisita = `${quien}|${normalizar(f.evento)}|${f.fecha}`;
    if (yaCargadas.has(claveVisita)) {
      salteadas.push({ fila: f.fila, motivo: 'Ya estaba cargada' });
      continue;
    }
    yaCargadas.add(claveVisita);
    visitasNuevas.push({ persona, evento: f.evento, fecha: f.fecha, categoria: f.categoria || undefined, subcategoria: f.subcategoria || undefined });
  }

  return {
    filas: filas.length,
    contactosNuevos: [...contactosNuevos.values()],
    visitasNuevas,
    salteadas,
    reconocidas: { usuarios: reconocidas.usuarios.size, contactos: reconocidas.contactos.size },
  };
}

/* ---------------- Para las métricas ---------------- */

/** El id con que un contacto aparece entre las personas de las métricas. */
export const idContacto = (id) => `c:${id}`;
/**
 * El nombre del evento sin la fecha que la planilla le pega al final
 * («Kabbalat Shabbat - 16/10/2026» → «Kabbalat Shabbat»): así los encuentros
 * del mismo evento se juntan como una actividad recurrente.
 */
export const nombreBaseEvento = (evento) =>
  String(evento ?? '')
    .replace(/\s*-?\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/, '')
    .replace(/\s*-\s*$/, '')
    .trim() || String(evento ?? '').trim();

/** El id con que un evento sin actividad aparece entre las actividades. */
export const idEvento = (evento) => `ev:${normalizar(nombreBaseEvento(evento))}`;

/**
 * Las visitas como si fueran inscripciones aceptadas a las que la persona
 * vino, para que todas las métricas las cuenten sin cambiar sus cuentas.
 * Las de eventos sin actividad arman una actividad «de mentira» por evento.
 */
export function visitasComoInscripciones({ visitas, actividadPorId, usuarioDeContacto = new Map() }) {
  const eventos = new Map();
  const inscripciones = visitas.map((v) => {
    let activityId;
    let actividad;
    if (v.actividadId) {
      activityId = String(v.actividadId);
      actividad = actividadPorId.get(activityId);
    } else {
      activityId = idEvento(v.evento);
      if (!eventos.has(activityId)) {
        eventos.set(activityId, {
          _id: activityId,
          titulo: nombreBaseEvento(v.evento),
          tipo: 'unica',
          categorias: [v.categoria, v.subcategoria].filter(Boolean).map((c) => c.toLowerCase()),
          precio: 0,
          esGratuita: true,
          esEvento: true,
        });
      }
      actividad = eventos.get(activityId);
    }
    return {
      _id: `v:${v._id}`,
      // Un contacto que después se registró cuenta para su cuenta.
      userId: v.userId ? String(v.userId) : usuarioDeContacto.get(String(v.contactoId)) ?? idContacto(v.contactoId),
      activityId,
      fecha: v.fecha,
      estado: 'aceptada',
      asistencia: 'vino',
      sinAnotarse: v.origen === 'sin_anotarse',
      origen: v.origen,
      actividad,
    };
  });
  /* Un evento que se repite en varias fechas es una actividad recurrente. */
  const fechasPorEvento = new Map();
  for (const i of inscripciones) {
    if (!eventos.has(i.activityId)) continue;
    if (!fechasPorEvento.has(i.activityId)) fechasPorEvento.set(i.activityId, new Set());
    fechasPorEvento.get(i.activityId).add(new Date(i.fecha).toISOString().slice(0, 10));
  }
  for (const [id, fechas] of fechasPorEvento) if (fechas.size > 1) eventos.get(id).tipo = 'recurrente';
  return { inscripciones: inscripciones.filter((i) => i.actividad), eventos: [...eventos.values()] };
}

/** Los contactos (sin cuenta) como personas para las métricas. */
export const contactosComoUsuarios = (contactos) =>
  contactos
    .filter((c) => !c.usuarioId)
    .map((c) => ({
      _id: idContacto(c._id),
      nombre: c.nombre,
      apellido: c.apellido,
      email: c.email,
      telefono: c.telefono,
      fechaNacimiento: c.fechaNacimiento,
      createdAt: c.createdAt,
      estado: 'contacto',
      esContacto: true,
    }));

/* ---------------- Gastos de la planilla ---------------- */

const COLUMNAS_GASTO = {
  concepto: ['concepto'],
  monto: ['monto', 'importe'],
  evento: ['evento', 'actividad'],
  fecha: ['fecha'],
  categoria: ['categoria'],
};

/** Si la hoja parece un listado de gastos (Concepto, Monto, Evento, Fecha). */
export const esHojaDeGastos = (encabezados) => {
  const n = encabezados.map(normalizar);
  return n.includes('concepto') && n.includes('monto') && n.includes('fecha');
};

/**
 * Las filas de gastos de la planilla. «Recaudación» (o un monto positivo
 * que no dice «gasto») es un ingreso; el resto, un gasto. El monto se
 * guarda siempre en positivo con su tipo al lado.
 */
export const leerGastos = (encabezados, filas) => {
  const n = encabezados.map(normalizar);
  const col = Object.fromEntries(Object.entries(COLUMNAS_GASTO).map(([k, vs]) => [k, n.findIndex((h) => vs.includes(h))]));
  const de = (f, k) => (col[k] >= 0 ? f[col[k]] : undefined);
  return filas.map((f, i) => {
    const concepto = String(de(f, 'concepto') ?? '').trim();
    const crudo = de(f, 'monto');
    const monto = typeof crudo === 'number' ? crudo : Number(String(crudo ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    const esIngreso = /recaud|ingreso|cobr/i.test(concepto) || (!/gasto/i.test(concepto) && monto > 0);
    return {
      fila: i + 2,
      concepto: concepto || (esIngreso ? 'Recaudación' : 'Gasto'),
      tipo: esIngreso ? 'ingreso' : 'gasto',
      monto: Number.isFinite(monto) ? Math.abs(monto) : null,
      evento: String(de(f, 'evento') ?? '').trim(),
      fecha: leerFecha(de(f, 'fecha')),
      categoria: nombrePropio(String(de(f, 'categoria') ?? '')).replace(/^Cultural$/, 'Cultura'),
    };
  });
};

/** Qué gastos carga y cuáles saltea (sin monto, sin fecha o ya cargados). */
export function planificarGastos({ filas, existentes }) {
  const clave = (g) => `${normalizar(g.evento)}|${g.fecha}|${g.tipo}|${Math.round(g.monto)}`;
  const ya = new Set(existentes.map((g) => clave({ ...g, fecha: new Date(g.fecha).toISOString().slice(0, 10) })));
  const nuevos = [];
  const salteados = [];
  for (const f of filas) {
    if (!f.monto) salteados.push({ fila: f.fila, motivo: 'Gasto sin monto' });
    else if (!f.fecha) salteados.push({ fila: f.fila, motivo: 'Gasto sin fecha' });
    else if (ya.has(clave(f))) salteados.push({ fila: f.fila, motivo: 'Gasto ya cargado' });
    else {
      ya.add(clave(f));
      nuevos.push(f);
    }
  }
  return { nuevos, salteados };
}
