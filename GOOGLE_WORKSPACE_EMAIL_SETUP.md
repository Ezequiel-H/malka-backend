# Emails de Malka con Google Workspace (SMTP Relay)

Documento para la reunión con quien administra Google Workspace de
`casamalka.org`. Objetivo: que después de la reunión sólo falte cargar las
variables de entorno y correr una prueba.

> Acá no van contraseñas ni secretos. Lo que se obtenga en la reunión va
> directo al `.env` del servidor (o al gestor de secretos del hosting).

---

## 0. Lo que ya sabemos (verificado el 22/10/2026, sin acceso a la consola)

Consultando el DNS público de `casamalka.org`:

| Qué | Estado | Qué significa |
|---|---|---|
| MX | `aspmx.l.google.com` y alternativos | **Google Workspace está activo** para el dominio. |
| DNS | Cloudflare (`dexter/ruth.ns.cloudflare.com`) | Los registros nuevos se cargan en Cloudflare. |
| SPF | `v=spf1 include:_spf.google.com -all` | Ya autoriza a Google. **No hay que tocarlo** para el relay. |
| DMARC | `v=DMARC1; p=none;` | Existe, en modo sólo observación. Está bien para arrancar. |
| DKIM | **No hay registro** en `google._domainkey` | **Falta.** Sin DKIM los mails tienen más chances de ir a spam. Se activa en la reunión (paso B3). |

Lo que **no** sabemos todavía y define cómo se autentica el sistema:
**dónde va a correr el backend en producción** (ver A1).

## 1. Cómo queda el sistema (lo que ya está en el código)

- `utils/mailer.js` elige el proveedor por variables de entorno:
  1. `SMTP_HOST` → SMTP con nodemailer (Google Workspace u otro).
  2. `RESEND_API_KEY` → API de Resend (alternativa si el hosting bloquea SMTP).
  3. Ninguno → sólo deja un log; no se manda nada (así funciona hoy).
- Siempre STARTTLS en el 587 (`requireTLS`): las credenciales nunca viajan en claro.
- Manda HTML **y** texto plano, con remitente (`EMAIL_FROM`) y respuesta (`EMAIL_REPLY_TO`) configurables.
- Reintenta sólo fallas transitorias (conexión, códigos 4xx) hasta 2 veces. Un
  error de credenciales (5xx) no se reintenta.
- Los logs no muestran la casilla completa ni credenciales.
- `sendEmail` nunca rompe la operación que lo dispara (aprobar, rechazar…).
- Nadie puede disparar un mail desde afuera: no hay endpoint de envío; los
  mails salen sólo de acciones del sistema (admin aprueba una cuenta,
  confirma una inscripción, rechaza un comprobante, saca a alguien de la
  lista de espera y elige avisarle).
- Prueba manual: `npm run email:test` (conexión y login, no manda nada) y
  `npm run email:test -- casilla@casamalka.org` (manda un mail de prueba).

**«Aceptado» no es «entregado».** El sistema sabe si Google aceptó el mail
(y lo loguea con su `messageId`). Si después rebota o cae en spam, eso se ve
en la casilla de destino o en el registro de mensajes de la consola de
Google (Informes → Búsqueda de registros de correo electrónico).

---

## A. Información que necesitamos confirmar

- [ ] **A1. Dónde corre el backend en producción** (preguntarle también a Ezequiel).
  - ¿Servidor propio/VPS con **IP pública fija**? → se puede autorizar por IP (sin contraseña).
  - ¿Render, Railway, Heroku u otro con IP que cambia? → hay que usar **autenticación SMTP**.
  - ¿El hosting deja salir por el **puerto 587**? Railway lo bloquea en los
    planes Free/Hobby (sólo Pro). Render, en sus instancias gratis, también
    lo restringe (confirmarlo con el plan que usen). Si está bloqueado, SMTP no
    sirve y vamos por la alternativa por API (Resend).
- [ ] **A2.** Dominio principal de la cuenta de Workspace: ¿es `casamalka.org`? ¿Hay otros dominios?
- [ ] **A3.** ¿El servicio **SMTP relay** ya está configurado? ¿Con qué opciones?
- [ ] **A4.** ¿Qué edición de Workspace tienen y **cuántas licencias**? Define el
  tope diario (ver A8).
- [ ] **A5.** ¿Alguna política de la organización que lo impida? (por ejemplo,
  2FA obligatoria —la necesitamos para la contraseña de aplicación— o
  restricciones sobre contraseñas de aplicación).
- [ ] **A6.** ¿Qué casilla va a **autenticar** el envío (si no es por IP)? Tiene
  que ser un usuario **con licencia y Gmail habilitado**. Recomendado: una
  casilla de servicio (no la personal de alguien, para que no se corte si esa
  persona se va o cambia la contraseña). Ojo: una casilla nueva con licencia
  tiene costo mensual; si no se quiere pagar, se usa una existente.
- [ ] **A7.** ¿Desde qué dirección salen los mails? Propuesta:
  `notificaciones@casamalka.org`. **No necesita licencia propia** si en el
  relay se elige «Sólo direcciones de mis dominios». Para que las respuestas no
  reboten: que sea un **alias o grupo** (gratis) que llegue a alguien, o usar
  `EMAIL_REPLY_TO` con una casilla que se lea.
- [ ] **A8.** Límites de envío del relay: hasta **10.000 destinatarios por
  usuario cada 24 h** y, a nivel cuenta, **unas 130 por licencia cada 24 h**.
  Con 3 licencias son ~390 por día. Para menos de 1.000 por mes sobra, pero
  hay que confirmar la cantidad de licencias.

## B. Configuración que debemos realizar

### Lo hace el administrador de Workspace (en la reunión)

**B1. Abrir la configuración del relay**
1. Entrar a <https://admin.google.com> con una cuenta de superadministrador.
2. Menú → **Apps → Google Workspace → Gmail → Enrutamiento** (*Routing*).
3. Buscar **Servicio de retransmisión SMTP** (*SMTP relay service*) → **Configurar**
   (o **Agregar otra regla** si ya hay una).

**B2. Crear la regla** (nombre sugerido: `Sistema Malka`)
1. **Remitentes permitidos:** «**Sólo direcciones de mis dominios**» (permite
   `notificaciones@` sin licencia).
2. **Autenticación** (según A1):
   - IP fija → marcar «Sólo aceptar correo de las direcciones IP especificadas» y cargar la IP del servidor.
   - IP dinámica → marcar «**Requerir autenticación SMTP**».
   - Se pueden marcar las dos si la IP es fija y además se quiere usuario.
3. **Cifrado:** marcar «**Requerir cifrado TLS**».
4. Guardar. Los cambios pueden tardar hasta 24 h, aunque suelen ser minutos.

**B3. Activar DKIM** (hoy falta)
1. Menú → **Apps → Google Workspace → Gmail → Autenticar correo electrónico**.
2. Elegir `casamalka.org` → **Generar registro nuevo** (clave de 2048 bits, prefijo `google`).
3. Copiar el valor del registro TXT `google._domainkey`.
4. Cargarlo en **Cloudflare** (DNS → Agregar registro → TXT, nombre
   `google._domainkey`, el valor copiado; en Cloudflare el TXT no lleva proxy).
5. Volver a la consola y tocar **Iniciar autenticación**.

**B4. Si la autenticación es SMTP:** contraseña de aplicación
1. La casilla que va a autenticar (A6) tiene que tener **la verificación en 2 pasos** activa.
2. Desde esa cuenta: <https://myaccount.google.com/apppasswords> → crear una
   llamada `Sistema Malka`.
3. Copiar la contraseña de 16 letras **directo al gestor de secretos o al
   `.env` del servidor**. No por chat ni mail.

**B5. Remitente:** crear `notificaciones@casamalka.org` como **alias** de una
casilla existente o como **grupo** (gratis), para que las respuestas lleguen a alguien.

### Lo hace el desarrollador (después de la reunión)

**B6. Variables de entorno** del backend (ver `.env.example`):

```
SMTP_HOST=smtp-relay.gmail.com
SMTP_PORT=587
SMTP_USER=<casilla de A6>      # vacío si se autoriza por IP
SMTP_PASS=<contraseña de app>  # vacío si se autoriza por IP
SMTP_EHLO_NAME=casamalka.org
EMAIL_FROM="Malka <notificaciones@casamalka.org>"
EMAIL_REPLY_TO=<casilla que se lea>
```

**B7. Verificar**
1. `npm run email:test` → tiene que decir «Conexión, TLS y login OK».
2. `npm run email:test -- <casilla propia>` → «El servidor ACEPTÓ el mail».
3. En la casilla: que llegue a **Recibidos** (no spam) y, en «Mostrar
   original», que **SPF, DKIM y DMARC digan PASS**.
4. Probar uno real: aprobar un usuario de prueba y ver que llegue el aviso.

**B8. Más adelante (opcional):** cuando todo pase PASS un par de semanas,
subir DMARC de `p=none` a `p=quarantine`.

## C. Checklist para la reunión

- [ ] Confirmado dónde corre el backend y si tiene IP fija (A1)
- [ ] Confirmado que el hosting permite salir por el puerto 587 (A1)
- [ ] Confirmado dominio y cantidad de licencias (A2, A4)
- [ ] Regla de SMTP relay creada (B1–B2)
  - [ ] Remitentes: «Sólo direcciones de mis dominios»
  - [ ] Autenticación: IP ☐ / SMTP ☐
  - [ ] TLS obligatorio
- [ ] DKIM generado, cargado en Cloudflare y «Iniciar autenticación» hecho (B3)
- [ ] Casilla de autenticación definida, con 2 pasos y contraseña de app (B4) — o IP cargada
- [ ] `notificaciones@casamalka.org` creada como alias o grupo (B5)
- [ ] Casilla de respuesta (`EMAIL_REPLY_TO`) definida
- [ ] Si se puede en el momento: `npm run email:test` OK (B7)

## D. Información que me tengo que llevar

- [ ] Hosting del backend, plan, si la IP es fija y cuál es.
- [ ] Método de autenticación elegido (IP / SMTP / ambos).
- [ ] Usuario que autentica (sólo la dirección; la contraseña va directo al servidor).
- [ ] Dirección remitente (`EMAIL_FROM`) y de respuesta (`EMAIL_REPLY_TO`).
- [ ] Cantidad de licencias (para saber el tope diario).
- [ ] Confirmación de que el DKIM quedó «Autenticando correo».
- [ ] Quién del lado de Malka recibe los rebotes o respuestas.

---

## Pendientes

**Ya funciona** (sin depender de Google):
- Los 4 avisos por mail ya están armados y probados con tests; hoy se loguean sin enviarse.
- Las notificaciones push (no usan Google Workspace).

**Implementado, falta configuración:**
- Envío por SMTP: cargar las variables de B6 y verificar con B7.
- Push en producción: generar las claves con `npm run push:keys` y cargar
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` en el servidor.

**Se resuelve en la reunión:** A1–A8 y B1–B5.

**Después:**
- Si el hosting bloquea el 587: usar Resend (`RESEND_API_KEY`), que ya está
  soportado, y sumar su registro SPF/DKIM en Cloudflare.
- Subir DMARC a `quarantine` (B8).
