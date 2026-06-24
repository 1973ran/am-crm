require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const ADVISOR_PHONE = process.env.ADVISOR_PHONE || '972525949449';
const ADVISOR_NAME  = process.env.ADVISOR_NAME  || 'רן';
const DATA_FILE     = path.join(__dirname, 'clients.json');

// ── Conversation flow ─────────────────────────────────────────────────────────

const FLOW = [
  {
    key: 'name',
    ask: `שלום! 👋 אני הבוט של א.מ פיננסים.\n\nאני אאסוף כמה פרטים כדי שרן ${ADVISOR_NAME} יוכל לחזור אליך עם ייעוץ מותאם.\n\n*מה שמך המלא?*`,
  },
  {
    key: 'type',
    ask: 'תודה! מה *סוג העסקתך*?\n\nענה במספר:\n1️⃣ שכיר\n2️⃣ עצמאי\n3️⃣ פנסיונר\n4️⃣ לא עובד',
    map: { '1': 'שכיר', '2': 'עצמאי', '3': 'פנסיונר', '4': 'לא עובד' },
    validate(v) { return Object.keys(this.map).includes(v.trim()); },
    invalidMsg: 'בבקשה ענה 1, 2, 3 או 4',
  },
  {
    key: 'salary',
    ask: 'מה *שכרך הברוטו החודשי* בקירוב (בשקלים)?\n\nלדוגמה: 15000\nאם לא רלוונטי ענה 0',
    transform(v) { return v.replace(/[^\d]/g, '') || '0'; },
  },
  {
    key: 'products',
    ask: 'אילו *מוצרים פיננסיים* יש לך כרגע?\n\nענה במספרים מופרדים בפסיקים:\n1️⃣ קרן פנסיה\n2️⃣ קופת גמל\n3️⃣ קרן השתלמות\n4️⃣ ביטוח חיים\n5️⃣ ביטוח אובדן כושר\n6️⃣ ביטוח מנהלים\n0️⃣ אין לי',
    map: { '1': 'קרן פנסיה', '2': 'קופת גמל', '3': 'קרן השתלמות', '4': 'ביטוח חיים', '5': 'אובדן כושר', '6': 'ביטוח מנהלים' },
    multi: true,
  },
  {
    key: 'needs',
    ask: 'במה תרצה *לקבל ייעוץ*?\n\nענה במספרים מופרדים בפסיקים:\n1️⃣ תכנון פנסיה ופרישה\n2️⃣ חיסכון לטווח ארוך\n3️⃣ ביטוחי חיים ובריאות\n4️⃣ הפחתת דמי ניהול\n5️⃣ סקירת תיק קיים',
    map: { '1': 'תכנון פנסיה', '2': 'חיסכון לטווח ארוך', '3': 'ביטוחים', '4': 'הפחתת דמי ניהול', '5': 'סקירת תיק' },
    multi: true,
  },
  {
    key: 'notes',
    ask: 'האם יש *הערות נוספות*?\n(ענה "לא" אם אין)',
    transform(v) { return v.trim().toLowerCase() === 'לא' ? '' : v.trim(); },
  },
];

// ── Bot enable/disable toggle ─────────────────────────────────────────────────

let botEnabled = true;

const ADMIN_COMMANDS = {
  '!bot off':    () => { botEnabled = false; return '🔴 הבוט *כובה*. לקוחות לא יקבלו מענה אוטומטי.'; },
  '!bot on':     () => { botEnabled = true;  return '🟢 הבוט *הופעל*. חוזר לענות ללקוחות.'; },
  '!bot status': () => `ℹ️ הבוט כרגע *${botEnabled ? 'פעיל 🟢' : 'כבוי 🔴'}*.\n\nפקודות:\n• \`!bot off\` — השבת\n• \`!bot on\` — הפעל`,
};

// ── State per chat ────────────────────────────────────────────────────────────

const chatState = new Map(); // chatId → { step, data }

function getState(chatId) {
  if (!chatState.has(chatId)) {
    chatState.set(chatId, { step: 0, data: {} });
  }
  return chatState.get(chatId);
}

function resetState(chatId) {
  chatState.set(chatId, { step: 0, data: {} });
}

// ── Value parsing ─────────────────────────────────────────────────────────────

function parseValue(step, rawText) {
  const text = rawText.trim();

  if (step.validate && !step.validate(text)) {
    return { error: step.invalidMsg || 'קלט לא תקין, נסה שוב' };
  }

  if (step.multi) {
    if (text === '0' || text === '') return { value: [] };
    const parts = text.split(/[,،\s]+/).map(s => s.trim()).filter(Boolean);
    const values = parts.map(p => step.map[p]).filter(Boolean);
    return { value: values };
  }

  if (step.map) {
    return { value: step.map[text] || text };
  }

  if (step.transform) {
    return { value: step.transform(text) };
  }

  return { value: text };
}

// ── Summary sent to advisor ───────────────────────────────────────────────────

function buildSummary(phone, data) {
  const fmt = v => Array.isArray(v) ? (v.length ? v.join(', ') : 'אין') : (v || '—');
  const salary = parseInt(data.salary || '0');

  return `✅ *ליד חדש — א.מ פיננסים*

👤 *שם:* ${fmt(data.name)}
📱 *טלפון:* ${phone}
💼 *סוג עובד:* ${fmt(data.type)}
${salary > 0 ? `💰 *שכר ברוטו:* ₪${salary.toLocaleString('he-IL')}\n` : ''
}📋 *מוצרים קיימים:* ${fmt(data.products)}
🎯 *צרכים:* ${fmt(data.needs)}
${data.notes ? `📝 *הערות:* ${data.notes}\n` : ''
}⏰ *נשלח:* ${new Date().toLocaleString('he-IL')}`;
}

// ── Persist client ────────────────────────────────────────────────────────────

function saveClient(phone, data) {
  let clients = [];
  if (fs.existsSync(DATA_FILE)) {
    try { clients = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
  }
  clients.push({ id: Date.now(), phone, ...data, createdAt: new Date().toISOString() });
  fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2), 'utf8');
}

// ── WhatsApp client ───────────────────────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', qr => {
  console.log('\n📱 סרוק את ה-QR code בוואטסאפ (הגדרות → מכשירים מקושרים):\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log(`✅ הבוט מחובר ומוכן! (${new Date().toLocaleString('he-IL')})`);
});

client.on('auth_failure', () => {
  console.error('❌ כשל באימות — מחק את תיקיית .wwebjs_auth ונסה שוב');
});

client.on('message', async msg => {
  // Ignore group messages and status updates
  if (msg.isGroupMsg || msg.from === 'status@broadcast') return;

  const chatId = msg.from;
  const text = msg.body.trim();
  const phone = chatId.replace('@c.us', '');

  // Handle advisor control commands (sent from advisor's own device)
  if (msg.fromMe) {
    const cmd = text.toLowerCase();
    const handler = ADMIN_COMMANDS[cmd];
    if (handler) {
      const reply = handler();
      console.log(`[admin] ${cmd} → ${botEnabled ? 'on' : 'off'}`);
      await client.sendMessage(chatId, reply);
    }
    return;
  }

  // When bot is disabled, send a brief holding message only on first contact
  if (!botEnabled) {
    const state = getState(chatId);
    if (state.step === 0) {
      await msg.reply(`שלום! 🙏\n${ADVISOR_NAME} יחזור אליך בהקדם.\n\n_א.מ פיננסים_`);
      state.step = -1; // mark as "holding message sent"
    }
    return;
  }

  const state = getState(chatId);

  // Resume clients who were put on hold while bot was disabled
  if (state.step === -1) resetState(chatId);

  // Restart trigger
  if (/^(שלום|היי|hello|hi|בוקר|ערב|צהריים|start|התחל)/i.test(text) && state.step === 0) {
    const step = FLOW[0];
    await msg.reply(step.ask);
    state.step = 1;
    return;
  }

  // Mid-flow
  if (state.step === 0) {
    // First contact — start the flow
    await msg.reply(FLOW[0].ask);
    state.step = 1;
    return;
  }

  const currentStep = FLOW[state.step - 1];
  const { value, error } = parseValue(currentStep, text);

  if (error) {
    await msg.reply(`⚠️ ${error}`);
    return;
  }

  state.data[currentStep.key] = value;

  if (state.step < FLOW.length) {
    const nextStep = FLOW[state.step];
    await msg.reply(nextStep.ask);
    state.step += 1;
  } else {
    // Flow complete
    await msg.reply(
      `✅ תודה רבה!\n\nהפרטים שלך נשלחו ל${ADVISOR_NAME}.\nהוא יחזור אליך בהקדם האפשרי 🙏\n\n_א.מ פיננסים_`
    );

    saveClient(phone, state.data);

    // Forward summary to advisor
    const advisorChatId = `${ADVISOR_PHONE}@c.us`;
    try {
      await client.sendMessage(advisorChatId, buildSummary(phone, state.data));
    } catch (err) {
      console.error('שגיאה בשליחה לסוכן:', err.message);
    }

    console.log(`📥 ליד חדש נשמר: ${phone} — ${state.data.name}`);
    resetState(chatId);
  }
});

client.initialize();
