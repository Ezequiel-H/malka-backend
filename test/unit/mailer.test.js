import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail, verify: vi.fn() })) }
}));

const { sendEmail, htmlToText } = await import('../../utils/mailer.js');

const ENV = { ...process.env };

describe('mailer por SMTP', () => {
  beforeEach(() => {
    sendMail.mockReset();
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp-relay.example.test';
    process.env.SMTP_RETRY_DELAY_MS = '0';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...ENV };
    vi.restoreAllMocks();
  });

  it('manda HTML + texto plano con el remitente configurado y devuelve «aceptado»', async () => {
    process.env.EMAIL_FROM = 'Malka <notificaciones@casamalka.org>';
    process.env.EMAIL_REPLY_TO = 'hola@casamalka.org';
    sendMail.mockResolvedValue({ messageId: '<abc@casamalka.org>' });

    const ok = await sendEmail({ to: 'ana@demo.malka', subject: 'Hola', html: '<p>Hola <strong>Ana</strong></p>' });

    expect(ok).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Malka <notificaciones@casamalka.org>',
        replyTo: 'hola@casamalka.org',
        to: 'ana@demo.malka',
        text: 'Hola Ana'
      })
    );
  });

  it('los logs no muestran la casilla completa', async () => {
    sendMail.mockResolvedValue({ messageId: '<x>' });
    await sendEmail({ to: 'gabriela@demo.malka', subject: 'Hola', html: '<p>x</p>' });
    const log = console.log.mock.calls.flat().join(' ');
    expect(log).not.toContain('gabriela@');
    expect(log).toContain('ga***@demo.malka');
  });

  it('reintenta las fallas de conexión y termina mandando', async () => {
    sendMail
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
      .mockResolvedValueOnce({ messageId: '<ok>' });

    expect(await sendEmail({ to: 'a@b.test', subject: 's', html: 'x' })).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('un error de autenticación (5xx) no se reintenta ni lanza', async () => {
    sendMail.mockRejectedValue(
      Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535, response: '535 5.7.8 BadCredentials' })
    );

    expect(await sendEmail({ to: 'a@b.test', subject: 's', html: 'x' })).toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('se rinde después de los reintentos', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('down'), { code: 'ECONNECTION' }));
    expect(await sendEmail({ to: 'a@b.test', subject: 's', html: 'x' })).toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('sin SMTP ni Resend no manda nada', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    expect(await sendEmail({ to: 'a@b.test', subject: 's', html: 'x' })).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('htmlToText', () => {
  it('deja los links como «texto: url» y separa párrafos', () => {
    const text = htmlToText('<p>Hola</p><p><a href="https://casamalka.org/x" style="a">Ver</a></p>');
    expect(text).toBe('Hola\n\nVer: https://casamalka.org/x');
  });
});
