/**
 * Prueba del envío de mails, para correr a mano después de configurar SMTP.
 *
 *   npm run email:test                          → sólo prueba conexión y login, no manda nada
 *   npm run email:test -- vos@casamalka.org     → además manda un mail de prueba a esa casilla
 *
 * Nunca imprime credenciales.
 */
import '../config/loadEnv.js';
import { sendEmail, verifySmtp } from '../utils/mailer.js';
import { buildTestEmail } from '../utils/notifications.js';

const to = process.argv[2];

const main = async () => {
  if (!process.env.SMTP_HOST) {
    console.error('Falta SMTP_HOST en el .env (ver .env.example).');
    process.exit(1);
  }

  console.log(`Probando ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}` +
    ` (${process.env.SMTP_USER ? 'con usuario' : 'sin usuario: autenticación por IP'})...`);
  try {
    await verifySmtp();
    console.log('✅ Conexión, TLS y login OK.');
  } catch (error) {
    console.error(`❌ No se pudo conectar o autenticar: ${error.code || ''} ${error.response || error.message}`);
    process.exit(1);
  }

  if (!to) {
    console.log('No se mandó nada. Para mandar una prueba: npm run email:test -- <casilla>');
    return;
  }

  const ok = await sendEmail(buildTestEmail(to));
  if (!ok) process.exit(1);
  console.log('✅ El servidor ACEPTÓ el mail. Falta confirmar que llegó (bandeja de entrada, no spam)');
  console.log('   y, en "Mostrar original", que SPF, DKIM y DMARC digan PASS.');
};

main();
