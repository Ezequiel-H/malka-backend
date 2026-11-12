import { describe, it, expect } from 'vitest';
import { calcularMetricas, mesesEntre, limitesDias, personasDetalle, resumenPersona } from '../../utils/metricas.js';

const dia = (s) => new Date(`${s}T00:00:00.000Z`);
const shabat = { titulo: 'Cena de Shabat', categorias: ['espiritualidad', 'cocina'], precio: 5000, moneda: 'ARS', esGratuita: false };
const yoga = { titulo: 'Yoga', categorias: ['bienestar'], precio: 0, moneda: 'ARS', esGratuita: true };

const ins = (userId, fecha, actividad, extra = {}) => ({
  userId,
  activityId: actividad === shabat ? 'a-shabat' : 'a-yoga',
  fecha: dia(fecha),
  actividad,
  ...extra,
});

const base = {
  usuarios: [
    { _id: 'ana', createdAt: dia('2026-01-10'), fechaNacimiento: dia('2000-03-01') },
    { _id: 'beto', createdAt: dia('2026-02-05'), fechaNacimiento: dia('1995-12-31') },
    { _id: 'caro', createdAt: dia('2025-11-01') },
  ],
  categorias: [{ nombre: 'espiritualidad', color: '#b0567a' }],
  desde: '2026-01-01',
  hasta: '2026-06-30',
  hoy: dia('2026-06-30'),
};

describe('calcularMetricas', () => {
  const inscripciones = [
    ins('caro', '2025-12-05', yoga), // vino antes del rango: no es nueva
    ins('caro', '2026-01-09', shabat, { pago: { estadoPago: 'aprobado', montoEsperado: 5000 } }),
    ins('ana', '2026-01-16', shabat, { pago: { estadoPago: 'aprobado', montoEsperado: 5000 }, asistencia: 'vino' }),
    ins('ana', '2026-02-06', yoga),
    ins('ana', '2026-05-01', yoga),
    ins('beto', '2026-02-13', shabat, { asistencia: 'falto' }), // faltó: no participó
    ins('beto', '2026-03-13', shabat, { pago: { estadoPago: 'aprobado', montoEsperado: 8000 } }),
  ];
  const gastos = [
    { fecha: dia('2026-01-09'), monto: 12000, moneda: 'ARS', categoria: 'comida', actividadId: 'a-shabat', actividadTitulo: 'Cena de Shabat' },
    { fecha: dia('2026-01-16'), monto: 8000, moneda: 'ARS', categoria: 'bebida', actividadId: 'a-shabat', actividadTitulo: 'Cena de Shabat' },
    { fecha: dia('2026-04-01'), monto: 2000, moneda: 'ARS', categoria: 'casa' },
  ];
  const m = calcularMetricas({ ...base, inscripciones, gastos });

  it('cuenta personas, nuevas y participaciones sin las ausencias', () => {
    expect(m.personas.participantes).toBe(3);
    expect(m.personas.participaciones).toBe(5);
    expect(m.personas.nuevos).toBe(2); // ana y beto; caro ya venía
    expect(m.personas.registrosEnRango).toBe(2);
  });

  it('mide quién volvió en los primeros 60 días', () => {
    // ana vino el 16/1 y volvió el 6/2; beto vino por primera vez el 13/3 y no volvió
    expect(m.personas.vuelven).toEqual({ cohorte: 2, volvieron: 1, porcentaje: 50 });
  });

  it('reparte la frecuencia en tramos', () => {
    const tramo = (id) => m.personas.frecuencia.find((f) => f.id === id).personas;
    expect(tramo('1')).toBe(2);
    expect(tramo('2-4')).toBe(1);
  });

  it('compara inscriptos contra los que vinieron', () => {
    expect(m.personas.asistencia).toMatchObject({ inscriptos: 6, vinieron: 1, faltaron: 1, sinMarcar: 4, tasa: 50 });
  });

  it('cruza las propuestas por persona', () => {
    const nombres = m.personas.cruce.categorias.map((c) => c.nombre);
    const i = nombres.indexOf('espiritualidad');
    const j = nombres.indexOf('bienestar');
    expect(m.personas.cruce.matriz[i][j]).toBe(1); // sólo ana hizo las dos (caro hizo yoga antes del rango)
    expect(m.personas.cruce.categorias[i].color).toBe('#b0567a');
  });

  it('calcula edad promedio sobre quienes tienen el dato', () => {
    expect(m.personas.edad).toMatchObject({ promedio: 28, conDato: 2, sinDato: 1 });
  });

  it('suma la plata, los gastos y la cobertura', () => {
    expect(m.plata.recaudado).toBe(18000);
    expect(m.plata.pagantes).toBe(3);
    expect(m.plata.gastado).toBe(22000);
    expect(m.plata.cobertura).toBe(81.8);
    const cena = m.plata.costoPorEncuentro[0];
    expect(cena).toMatchObject({ titulo: 'Cena de Shabat', encuentros: 2, costoPromedio: 10000, recaudadoPromedio: 5000, cobertura: 50 });
  });

  it('no cuenta encuentros que todavía no pasaron', () => {
    const conFuturo = calcularMetricas({ ...base, inscripciones: [...inscripciones, ins('ana', '2026-07-03', yoga)], gastos, hasta: '2026-12-31' });
    expect(conFuturo.personas.participaciones).toBe(5);
  });
});

describe('ayudas de fechas', () => {
  it('lista los meses del rango, incluidos los vacíos', () => {
    expect(mesesEntre(dia('2026-01-20'), dia('2026-03-02'))).toEqual(['2026-01', '2026-02', '2026-03']);
  });
  it('toma los días enteros', () => {
    const { inicio, fin } = limitesDias('2026-01-01', '2026-01-31');
    expect(inicio.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(fin.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });
});

describe('resumenPersona', () => {
  const act = { titulo: 'Cena de Shabat', categorias: ['espiritualidad'], precio: 5000, moneda: 'ARS' };
  const i = (fecha, extra = {}) => ({ _id: fecha, activityId: 'a', fecha: dia(fecha), estado: 'aceptada', actividad: act, ...extra });
  const hoy = dia('2026-06-30');

  it('dice quién se está alejando y quién es frecuente', () => {
    const alejandose = resumenPersona({ inscripciones: [i('2026-01-02'), i('2026-04-10')], hoy });
    expect(alejandose.estado).toBe('alejandose');
    expect(alejandose.diasSinVenir).toBe(81);

    const frecuente = resumenPersona({
      inscripciones: ['2026-01-01', '2026-04-05', '2026-04-20', '2026-05-03', '2026-05-17', '2026-06-01', '2026-06-20'].map((f) => i(f)),
      hoy,
    });
    expect(frecuente.estado).toBe('frecuente');
    expect(frecuente.enUltimos90).toBe(6);
  });

  it('una persona nueva, sin participar o inactiva', () => {
    expect(resumenPersona({ inscripciones: [i('2026-06-10')], hoy }).estado).toBe('nueva');
    expect(resumenPersona({ inscripciones: [], hoy }).estado).toBe('sin_participar');
    expect(resumenPersona({ inscripciones: [i('2026-02-01')], hoy }).estado).toBe('inactiva');
  });

  it('cuenta asistencia, plata, próximas y arma el historial', () => {
    const r = resumenPersona({
      inscripciones: [
        i('2026-06-05', { asistencia: 'vino', pago: { estadoPago: 'aprobado', montoEsperado: 5000 } }),
        i('2026-06-12', { asistencia: 'falto' }),
        i('2026-07-03'),
        i('2026-06-19', { estado: 'cancelada' }),
      ],
      hoy,
    });
    expect(r.participaciones).toBe(1);
    expect(r.asistencia).toMatchObject({ vino: 1, falto: 1, tasa: 50 });
    expect(r.proximas).toBe(1);
    expect(r.plata.pagado).toBe(5000);
    expect(r.historial.map((h) => h.estado)).toEqual(['aceptada', 'cancelada', 'aceptada', 'aceptada']);
    expect(r.porMes).toHaveLength(12);
  });
});

describe('personasDetalle', () => {
  const act = (titulo, categorias) => ({ titulo, categorias, precio: 0, moneda: 'ARS' });
  const shabat = act('Cena de Shabat', ['espiritualidad']);
  const yoga = act('Yoga', ['bienestar']);
  const i = (userId, fecha, actividad, extra = {}) => ({
    userId, activityId: actividad.titulo, fecha: dia(fecha), estado: 'aceptada', actividad, ...extra,
  });
  const usuarios = [
    { _id: 'ana', nombre: 'Ana', apellido: 'G', fechaNacimiento: '2000-01-01', nacionalidad: 'IL', residencia: 'exterior', createdAt: dia('2026-01-01') },
    { _id: 'beto', nombre: 'Beto', apellido: 'K', createdAt: dia('2026-01-01') },
  ];
  const { personas, cohortes } = personasDetalle({
    usuarios,
    inscripciones: [
      i('ana', '2026-01-09', shabat),
      i('ana', '2026-02-13', shabat),
      i('ana', '2026-02-10', yoga, { asistencia: 'falto' }),
      i('beto', '2026-01-16', yoga),
    ],
    desde: '2026-01-01',
    hasta: '2026-06-30',
    hoy: dia('2026-06-30'),
  });

  it('arma una fila por persona con lo del período', () => {
    const ana = personas.find((p) => p.id === 'ana');
    expect(ana).toMatchObject({ nombre: 'Ana G', edad: 26, nacionalidad: 'IL', veces: 2, categorias: ['espiritualidad'] });
    expect(ana.nuevaEnRango).toBe(true);
  });

  it('calcula la retención por mes de primera visita', () => {
    const enero = cohortes.find((c) => c.mes === '2026-01');
    expect(enero.personas).toBe(2);
    expect(enero.despues[0]).toBe(50); // ana volvió en febrero, beto no
  });
});
