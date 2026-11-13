/**
 * El Panel a medida de cada persona del equipo: qué bloques ve, en qué orden,
 * de qué ancho y con qué opciones. Este catálogo es la única fuente: el front
 * lo pide con GET /api/admin/inicio y arma los controles con él.
 *
 * Tipos de opción:
 *   - `lista`: varios de `valores` (al menos uno).
 *   - `uno`:   uno de `valores`.
 *   - `si_no`: true o false.
 */
export const CATALOGO = [
  { id: 'pendientes', visible: true, ancho: 'entera', opciones: { mostrar: { tipo: 'lista', valores: ['personas', 'inscripciones', 'comprobantes'], defecto: ['personas', 'inscripciones', 'comprobantes'] } } },
  {
    id: 'numeros',
    visible: true,
    ancho: 'entera',
    opciones: {
      cuales: { tipo: 'lista', valores: ['vinieron', 'vuelven', 'veces', 'cubrio', 'nuevos', 'recaudado'], defecto: ['vinieron', 'vuelven', 'veces', 'cubrio'] },
      meses: { tipo: 'uno', valores: [3, 6, 12], defecto: 6 },
    },
  },
  { id: 'semana', visible: true, ancho: 'entera', opciones: { borradores: { tipo: 'si_no', defecto: false } } },
  {
    id: 'proximo',
    visible: true,
    ancho: 'media',
    opciones: {
      criterio: { tipo: 'uno', valores: ['mas_gente', 'mas_cercano'], defecto: 'mas_gente' },
      dias: { tipo: 'uno', valores: [3, 7, 14], defecto: 7 },
    },
  },
  { id: 'cumples', visible: true, ancho: 'media', opciones: { semanaQueViene: { tipo: 'si_no', defecto: true } } },
  // Los que arrancan en la bandeja «Para sumar».
  {
    id: 'sinAnotarse',
    visible: false,
    ancho: 'media',
    opciones: { cuantos: { tipo: 'uno', valores: [5, 10], defecto: 5 }, dias: { tipo: 'uno', valores: [30, 90], defecto: 30 } },
  },
  { id: 'alejandose', visible: false, ancho: 'media', opciones: { cuantos: { tipo: 'uno', valores: [5, 10], defecto: 5 } } },
  {
    id: 'ranking',
    visible: false,
    ancho: 'media',
    opciones: { cuantas: { tipo: 'uno', valores: [3, 5, 10], defecto: 5 }, periodo: { tipo: 'uno', valores: ['mes', '90d'], defecto: 'mes' } },
  },
  { id: 'plata', visible: false, ancho: 'media', opciones: { comparar: { tipo: 'si_no', defecto: true } } },
];

const ANCHOS = ['media', 'entera'];
const porId = new Map(CATALOGO.map((b) => [b.id, b]));

export const opcionesDeEntrada = (bloque) => Object.fromEntries(Object.entries(bloque.opciones).map(([k, o]) => [k, o.defecto]));

/** El Panel de siempre, completo. */
export const inicioDeSiempre = () => CATALOGO.map((b) => ({ id: b.id, visible: b.visible, ancho: b.ancho, opciones: opcionesDeEntrada(b) }));

const opcionValida = (o, v) => {
  if (o.tipo === 'si_no') return typeof v === 'boolean';
  if (o.tipo === 'uno') return o.valores.includes(v);
  return Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every((x) => o.valores.includes(x));
};

/**
 * Valida lo que manda el front. Devuelve { bloques } o { error } con un texto
 * que dice qué está mal. Todo bloque del catálogo tiene que estar una vez.
 */
export const validarInicio = (cuerpo) => {
  const lista = cuerpo?.bloques;
  if (!Array.isArray(lista)) return { error: 'Falta la lista de bloques' };
  const vistos = new Set();
  const bloques = [];
  for (const b of lista) {
    const def = porId.get(b?.id);
    if (!def) return { error: `Bloque desconocido: ${b?.id}` };
    if (vistos.has(b.id)) return { error: `Bloque repetido: ${b.id}` };
    vistos.add(b.id);
    if (typeof b.visible !== 'boolean') return { error: `«visible» tiene que ser sí o no en ${b.id}` };
    if (!ANCHOS.includes(b.ancho)) return { error: `Ancho inválido en ${b.id}` };
    const opciones = b.opciones ?? {};
    if (typeof opciones !== 'object' || Array.isArray(opciones)) return { error: `Opciones inválidas en ${b.id}` };
    for (const [k, v] of Object.entries(opciones)) {
      const o = def.opciones[k];
      if (!o) return { error: `La opción «${k}» no es de ${b.id}` };
      if (!opcionValida(o, v)) return { error: `Valor inválido para «${k}» en ${b.id}` };
    }
    bloques.push({ id: b.id, visible: b.visible, ancho: b.ancho, opciones: { ...opcionesDeEntrada(def), ...opciones } });
  }
  if (vistos.size !== CATALOGO.length) return { error: 'Faltan bloques del catálogo' };
  return { bloques };
};

/**
 * Lo guardado, puesto al día: se descarta lo que no se entiende, y los bloques
 * nuevos del catálogo se suman al final como vienen de entrada.
 */
export const normalizarInicio = (guardado) => {
  if (!Array.isArray(guardado?.bloques)) return inicioDeSiempre();
  const bloques = [];
  for (const b of guardado.bloques) {
    const def = porId.get(b?.id);
    if (!def || bloques.some((x) => x.id === b.id)) continue;
    const opciones = opcionesDeEntrada(def);
    for (const [k, v] of Object.entries(b.opciones ?? {})) if (def.opciones[k] && opcionValida(def.opciones[k], v)) opciones[k] = v;
    bloques.push({ id: def.id, visible: typeof b.visible === 'boolean' ? b.visible : def.visible, ancho: ANCHOS.includes(b.ancho) ? b.ancho : def.ancho, opciones });
  }
  for (const def of CATALOGO) if (!bloques.some((b) => b.id === def.id)) bloques.push({ id: def.id, visible: def.visible, ancho: def.ancho, opciones: opcionesDeEntrada(def) });
  return bloques;
};

export const esElDeSiempre = (bloques) => JSON.stringify(bloques) === JSON.stringify(inicioDeSiempre());
