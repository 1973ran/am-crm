require('dotenv').config();
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const ADVISOR_PHONE = process.env.ADVISOR_PHONE || '972525949449';
const ADVISOR_NAME  = process.env.ADVISOR_NAME  || 'רן';
const DATA_FILE     = path.join(__dirname, 'clients.json');
const AUTH_DIR      = path.join(__dirname, 'auth');

// ── Bot enable/disable ────────────────────────────────────────────────────────

let botEnabled = true;

const ADMIN_COMMANDS = {
  '!bot off':    () => { botEnabled = false; return '🔴 הבוט *כובה*. לקוחות לא יקבלו מענה אוטומטי.'; },
  '!bot on':     () => { botEnabled = true;  return '🟢 הבוט *הופעל*. חוזר לענות ללקוחות.'; },
  '!bot status': () => `ℹ️ הבוט כרגע *${botEnabled ? 'פעיל 🟢' : 'כבוי 🔴'}*\n\n• \`!bot off\` — השבת\n• \`!bot on\` — הפעל`,
};

// ── Conversation state ────────────────────────────────────────────────────────

const chatState = new Map();

function getState(jid) {
  if (!chatState.has(jid)) chatState.set(jid, { step: 0, topic: '' });
  return chatState.get(jid);
}

function resetState(jid) {
  chatState.set(jid, { step: 0, topic: '' });
}

// ── Summary to advisor ────────────────────────────────────────────────────────

function buildSummary(phone, name, topic) {
  return `📩 *פנייה חדשה — א.מ פיננסים*

👤 *שם:* ${name}
📱 *טלפון:* ${phone}
💬 *נושא:* ${topic}
⏰ *שעה:* ${new Date().toLocaleString('he-IL')}`;
}

// ── Persist lead ──────────────────────────────────────────────────────────────

function saveLead(phone, name, topic) {
  let leads = [];
  if (fs.existsSync(DATA_FILE)) {
    try { leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
  }
  leads.push({ id: Date.now(), phone, name, topic, createdAt: new Date().toISOString() });
  fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');
}

// ── Bot logic ─────────────────────────────────────────────────────────────────

async function handleMessage(sock, jid, text, fromMe) {
  const phone = jid.replace('@s.whatsapp.net', '');

  const send = async (txt) => {
    await sock.sendMessage(jid, { text: txt });
  };

  // Advisor control commands
  if (fromMe) {
    const handler = ADMIN_COMMANDS[text.toLowerCase()];
    if (handler) {
      console.log(`[admin] ${text.toLowerCase()}`);
      await send(handler());
    }
    return;
  }

  const state = getState(jid);

  // Bot disabled — send holding message once
  if (!botEnabled) {
    if (state.step === 0) {
      await send(`שלום! 🙏\n${ADVISOR_NAME} יחזור אליך בהקדם.\n\n_א.מ פיננסים_`);
      state.step = -1;
    }
    return;
  }

  if (state.step === -1) resetState(jid);

  const s = getState(jid);

  if (s.step === 0) {
    await send(`שלום! אני העוזרת של ${ADVISOR_NAME} 😊\nבמה אפשר לעזור?`);
    s.step = 1;
    return;
  }

  if (s.step === 1) {
    s.topic = text;
    await send(`תודה! אפשר להשאיר הודעה ו${ADVISOR_NAME} יחזור אליך בהקדם 🙏\n\nמה *שמך המלא*?`);
    s.step = 2;
    return;
  }

  if (s.step === 2) {
    const name = text;
    await send(`תודה ${name}! ${ADVISOR_NAME} יחזור אליך בהקדם 📞\n\n_א.מ פיננסים_`);

    saveLead(phone, name, s.topic);

    const advisorJid = `${ADVISOR_PHONE}@s.whatsapp.net`;
    try {
      await sock.sendMessage(advisorJid, { text: buildSummary(phone, name, s.topic) });
    } catch (err) {
      console.error('שגיאה בשליחה לסוכן:', err.message);
    }

    console.log(`📥 פנייה חדשה: ${phone} — ${name} — "${s.topic}"`);
    resetState(jid);
  }
}

// ── WhatsApp connection ───────────────────────────────────────────────────────

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('התנתקת — מחק את תיקיית auth והפעל מחדש');
      } else {
        console.log('התנתק, מתחבר מחדש...');
        startBot();
      }
    } else if (connection === 'open') {
      console.log(`✅ הבוט מחובר ומוכן! (${new Date().toLocaleString('he-IL')})`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const jid = msg.key.remoteJid;
      if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;

      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''
      ).trim();

      if (!text) continue;

      try {
        await handleMessage(sock, jid, text, msg.key.fromMe);
      } catch (err) {
        console.error('שגיאה בטיפול בהודעה:', err.message);
      }
    }
  });
}

startBot();
