import { describe, it, expect } from 'vitest';
import {
  leerFecha,
  leerFilas,
  leerGastos,
  nombreBaseEvento,
  nombrePropio,
  planificarGastos,
  planificarImportacion,
  visitasComoInscripciones,
} from '../../utils/historial.js';

describe('leer la planilla', () => {
  it('entiende las fechas de la planilla', () => {
    expect(leerFecha('13/11/1992')).toBe('1992-11-13');
    expect(leerFecha('2/3/2024')).toBe('2024-03-02');
    expect(leerFecha(new Date(Date.UTC(2023, 8, 29)))).toBe('2023-09-29');
    expect(leerFecha(45198)).toBe('2023-09-29');
    expect(leerFecha('31/02/2024')).toBeNull();
    expect(leerFecha('')).toBeNull();
  });

  it('pone nombres en mayúscula inicial y saca la fecha del evento', () => {
    expect(nombrePropio('COHEN SABBAN')).toBe('Cohen Sabban');
    expect(nombreBaseEvento('Kabbalat Shabbat - 16/10/2026')).toBe('Kabbalat Shabbat');
    expect(nombreBaseEvento('Fiesta Purim- 2/3/2024')).toBe('Fiesta Purim');
    expect(nombreBaseEvento('Ieshiva')).toBe('Ieshiva');
  });

  it('lee las filas por el encabezado', () => {
    const filas = leerFilas(
      ['ID', 'Nombre', 'Apellido', 'Email', 'Fecha de Nacimiento', 'Edad', 'Evento', 'Fecha', 'Mes-Año', 'Categoria', 'Sub-Categoria'],
      [['ANA GOLD', 'ANA', 'GOLD', 'ANA@MAIL.COM', '13/11/1992', 30, 'Kabbalat Shabbat - 06/10/2023', '06/10/2023', '', 'Espiritual', 'Shabbat ']]
    );
    expect(filas[0]).toMatchObject({ nombre: 'Ana', apellido: 'Gold', email: 'ana@mail.com', fechaNacimiento: '1992-11-13', fecha: '2023-10-06', categoria: 'Espiritual', subcategoria: 'Shabbat' });
  });
});

describe('planificar la importación', () => {
  const fila = (extra) => ({ fila: 2, nombre: 'Ana', apellido: 'Gold', email: 'ana@mail.com', evento: 'Shabbat - 06/10/2023', fecha: '2023-10-06', ...extra });

  it('reconoce cuentas por mail, crea contactos nuevos una vez y no repite visitas', () => {
    const plan = planificarImportacion({
      filas: [
        fila(),
        fila({ fila: 3, evento: 'Purim - 23/03/2024', fecha: '2024-03-23' }),
        fila({ fila: 4, nombre: 'Beto', apellido: 'Katz', email: '' }),
        fila({ fila: 5, nombre: 'Beto', apellido: 'Katz', email: '' }),
        fila({ fila: 6, fecha: null }),
      ],
      usuarios: [{ _id: 'u1', nombre: 'Ana', apellido: 'Gold', email: 'ana@mail.com' }],
      contactos: [],
      visitas: [{ userId: 'u1', evento: 'Shabbat - 06/10/2023', fecha: new Date('2023-10-06T00:00:00Z') }],
    });
    expect(plan.reconocidas.usuarios).toBe(1);
    expect(plan.contactosNuevos).toHaveLength(1);
    expect(plan.visitasNuevas).toHaveLength(2); // Purim de Ana y el Shabbat de Beto
    expect(plan.salteadas.map((s) => s.motivo).sort()).toEqual(['Sin fecha del evento', 'Ya estaba cargada', 'Ya estaba cargada']);
  });

  it('lee gastos e ingresos y no los repite', () => {
    const filas = leerGastos(
      ['Concepto', 'Monto', 'Evento', 'Fecha', 'Mes-Año', 'Categoria'],
      [
        ['Gastos Totales', -488000, 'Kabbalat Shabbat - 08/03/2024', '08/03/2024', '', 'Espiritual'],
        ['Recaudacion', 100000, 'Kabbalat Shabbat - 08/03/2024', '08/03/2024', '', 'Cultural'],
        ['Gastos Totales', null, 'Seder de Pesaj', '22/04/2024', '', 'Espiritual'],
      ]
    );
    expect(filas[0]).toMatchObject({ tipo: 'gasto', monto: 488000 });
    expect(filas[1]).toMatchObject({ tipo: 'ingreso', monto: 100000, categoria: 'Cultura' });
    const plan = planificarGastos({ filas, existentes: [{ evento: 'Kabbalat Shabbat - 08/03/2024', fecha: new Date('2024-03-08T00:00:00Z'), tipo: 'gasto', monto: 488000 }] });
    expect(plan.nuevos).toHaveLength(1);
    expect(plan.salteados).toHaveLength(2);
  });
});

describe('el historial en las métricas', () => {
  it('convierte visitas en inscripciones y junta los eventos que se repiten', () => {
    const { inscripciones, eventos } = visitasComoInscripciones({
      visitas: [
        { _id: 'v1', contactoId: 'c1', evento: 'Kabbalat Shabbat - 06/10/2023', fecha: new Date('2023-10-06T00:00:00Z'), categoria: 'Espiritual', subcategoria: 'Shabbat', origen: 'importado' },
        { _id: 'v2', contactoId: 'c2', evento: 'Kabbalat Shabbat - 13/10/2023', fecha: new Date('2023-10-13T00:00:00Z'), origen: 'importado' },
        { _id: 'v3', userId: 'u1', actividadId: 'a1', fecha: new Date('2026-01-09T00:00:00Z'), origen: 'sin_anotarse' },
      ],
      actividadPorId: new Map([['a1', { _id: 'a1', titulo: 'Yoga' }]]),
      usuarioDeContacto: new Map([['c2', 'u2']]),
    });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ titulo: 'Kabbalat Shabbat', tipo: 'recurrente', categorias: ['espiritual', 'shabbat'] });
    expect(inscripciones.map((i) => i.userId)).toEqual(['c:c1', 'u2', 'u1']);
    expect(inscripciones[2]).toMatchObject({ sinAnotarse: true, asistencia: 'vino' });
  });
});
