require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const ADVISOR_PHONE = process.env.ADVISOR_PHONE || '972525949449';
const ADVISOR_NAME  = process.env.ADVISOR_NAME  || 'רן';
const DATA_FILE     = path.join(__dirname, 'clients.json');

// ── Bot enable/disable ────────────────────────────────────────────────────────

let botEnabled = true;

const ADMIN_COMMANDS = {
  '!bot off':    () => { botEnabled = false; return '🔴 הבוט *כובה*. לקוחות לא יקבלו מענה אוטומטי.'; },
  '!bot on':     () => { botEnabled = true;  return '🟢 הבוט *הופעל*. חוזר לענות ללקוחות.'; },
  '!bot status': () => `ℹ️ הבוט כרגע *${botEnabled ? 'פעיל 🟢' : 'כבוי 🔴'}*\n\n• \`!bot off\` — השבת\n• \`!bot on\` — הפעל`,
};

// ── Conversation state ────────────────────────────────────────────────────────

// step 0 = not started, 1 = waiting for topic, 2 = waiting for name, -1 = on hold
const chatState = new Map();

function getState(chatId) {
  if (!chatState.has(chatId)) chatState.set(chatId, { step: 0, topic: '' });
  return chatState.get(chatId);
}

function resetState(chatId) {
  chatState.set(chatId, { step: 0, topic: '' });
}

// ── Summary to advisor ────────────────────────────────────────────────────────

function buildSummary(phone, name, topic) {
  return `📩 *פנייה חדשה — א.מ פיננסים*

👤 *שם:* ${name}
📱 *טלפון:* ${phone}
💬 *נושא הפנייה:* ${topic}
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

// ── WhatsApp client ───────────────────────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

client.on('qr', qr => {
  console.log('\n📱 סרוק את ה-QR code בוואטסאפ (הגדרות ← מכשירים מקושרים):\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log(`✅ הבוט מחובר ומוכן! (${new Date().toLocaleString('he-IL')})`);
});

client.on('auth_failure', () => {
  console.error('❌ כשל באימות — מחק את תיקיית .wwebjs_auth ונסה שוב');
});

client.on('message', async msg => {
  if (msg.isGroupMsg || msg.from === 'status@broadcast') return;

  const chatId = msg.from;
  const text   = msg.body.trim();
  const phone  = chatId.replace('@c.us', '');

  // Advisor control commands (from advisor's own device to any chat)
  if (msg.fromMe) {
    const handler = ADMIN_COMMANDS[text.toLowerCase()];
    if (handler) {
      console.log(`[admin] ${text.toLowerCase()}`);
      await client.sendMessage(chatId, handler());
    }
    return;
  }

  const state = getState(chatId);

  // Bot is disabled
  if (!botEnabled) {
    if (state.step === 0) {
      await msg.reply(`שלום! 🙏\n${ADVISOR_NAME} יחזור אליך בהקדם.\n\n_א.מ פיננסים_`);
      state.step = -1;
    }
    return;
  }

  // Re-enable flow for clients that were on hold
  if (state.step === -1) resetState(chatId);

  // ── Flow ──

  // Step 0 → greet and ask topic
  if (state.step === 0) {
    await msg.reply(`שלום! אני העוזרת של ${ADVISOR_NAME} 😊\nבמה אפשר לעזור?`);
    state.step = 1;
    return;
  }

  // Step 1 → got topic, ask for name
  if (state.step === 1) {
    state.topic = text;
    await msg.reply(
      `תודה! אפשר להשאיר הודעה ו${ADVISOR_NAME} יחזור אליך בהקדם 🙏\n\nמה *שמך המלא*?`
    );
    state.step = 2;
    return;
  }

  // Step 2 → got name, done
  if (state.step === 2) {
    const name = text;
    await msg.reply(
      `תודה ${name}! ${ADVISOR_NAME} יחזור אליך בהקדם 📞\n\n_א.מ פיננסים_`
    );

    saveLead(phone, name, state.topic);

    const advisorChatId = `${ADVISOR_PHONE}@c.us`;
    try {
      await client.sendMessage(advisorChatId, buildSummary(phone, name, state.topic));
    } catch (err) {
      console.error('שגיאה בשליחה לסוכן:', err.message);
    }

    console.log(`📥 פנייה חדשה: ${phone} — ${name} — "${state.topic}"`);
    resetState(chatId);
  }
});

client.initialize();
