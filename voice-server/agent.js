// The voice agent itself: prompt, tools and a Gemini Live session that is independent of the audio transport
// (Twilio phone call or browser test page).
const { GoogleGenAI, Modality } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const VOICE = process.env.GEMINI_VOICE || 'Aoede';
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/* ---------- model auto-detect (model names change often) ---------- */
let modelPromise;
function pickModel() {
  if (process.env.GEMINI_MODEL) return Promise.resolve(process.env.GEMINI_MODEL);
  if (modelPromise) return modelPromise;
  modelPromise = fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=' + process.env.GEMINI_API_KEY)
    .then(r => r.json())
    .then(j => {
      const live = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('bidiGenerateContent'));
      const score = m => {
        const n = m.name;
        const v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
        return (n.includes('native-audio') ? 1000 : 0) + (n.includes('live') ? 500 : 0) + v * 10 + (n.includes('preview') ? 0 : 1) - (n.includes('exp') ? 5 : 0);
      };
      live.sort((a, b) => score(b) - score(a));
      if (!live.length) throw new Error('No Live (bidiGenerateContent) model available for this API key');
      const name = live[0].name.replace(/^models\//, '');
      console.log('[agent] using model', name, '| candidates:', live.map(m => m.name).join(', '));
      return name;
    })
    .catch(e => { modelPromise = null; throw e; });
  return modelPromise;
}

/* ---------- prompt ---------- */
function heDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return `יום ${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

function todayIL() {
  const s = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Jerusalem', hour12: false });
  const [date, time] = s.split(', ');
  return { date, time: time.slice(0, 5), label: `${heDate(date)} (${date}), השעה ${time.slice(0, 5)}` };
}

function buildPrompt(ctx) {
  const s = ctx.settings || {}, c = ctx.client || {}, m = ctx.meeting || {};
  const agent = s.agentName || 'נועה', business = s.business || 'רן פיננסים', owner = s.owner || 'רן';
  const first = (c.name || '').trim().split(/\s+/)[0] || '';
  const gender = c.gender === 'male' ? 'זכר — פני אליו בלשון זכר' : c.gender === 'female' ? 'נקבה — פני אליה בלשון נקבה'
    : 'לא ידוע. הסיקי מהשם הפרטי ומהאופן שבו הלקוח מדבר על עצמו ("אני יכול" / "אני יכולה"). עד שברור — נסחי בלשון ניטרלית.';
  const slots = (ctx.slots || []).map(d => `${heDate(d.date)} (${d.date}): ${d.times.join(', ')}`).join('\n') || 'אין מועדים פנויים במערכת — שאלי מה נוח ללקוח, השתמשי ב-request_callback ואמרי ש' + owner + ' יחזור לאשר.';
  const purpose = ctx.mode === 'confirm'
    ? `אישור פגישה קיימת: ${heDate(m.date)} (${m.date}) בשעה ${m.time || '?'}${m.location ? ', ' + m.location : ''}${m.subject ? ', נושא: ' + m.subject : ''}.
אחרי ברכה קצרה הזכירי את הפגישה ובקשי אישור. אם מאשר — confirm_meeting. אם לא מתאים — הציעי מועד חלופי מהרשימה וקבעי עם book_meeting.`
    : `קביעת פגישה חדשה עם ${owner}${m.subject ? ' בנושא ' + m.subject : ' — סקירה תקופתית של הפנסיה, החיסכון והביטוחים'}.
אחרי ברכה קצרה הסבירי במשפט אחד למה את מתקשרת, והציעי שני מועדים קרובים מהרשימה. כשהלקוח בוחר — book_meeting.`;

  return `את ${agent}, נציגת שירות לקוחות במשרד "${business}" — סוכנות ביטוח ופנסיה בניהולו של ${owner}. את מדברת עכשיו בטלפון עם לקוח קיים של המשרד.

# הקול והסגנון
- את אישה ישראלית: מדברת עברית ישראלית טבעית, חמה, אדיבה וקלילה, בקצב שיחה רגיל. כמו נציגת שירות מעולה — לא כמו רובוט.
- על עצמך — תמיד בלשון נקבה ("אני מתקשרת", "רציתי לבדוק", "אשמח").
- משפטים קצרים. שאלה אחת בכל פעם. בלי רשימות ובלי הסברים ארוכים.
- דברי רק עברית (אלא אם הלקוח מבקש שפה אחרת).

# הלקוח
- שם: ${c.name || 'לא ידוע'} (פני אליו בשם הפרטי: ${first || '—'})
- מין: ${gender}
- הקפידי על התאמה מלאה של לשון זכר/נקבה בכל מילה שאת פונה בה ללקוח ("לך/לָךְ", "תרצה/תרצי", "נוח לך", "אתה/את").

# מטרת השיחה
${purpose}

# מועדים פנויים — מותר להציע רק מכאן
${slots}
היום: ${todayIL().label}. אמרי תאריכים בצורה טבעית: "ביום שלישי הקרוב, עשרים וחמישה בנובמבר, בעשר בבוקר".
אופן הפגישה: ${s.location || 'במשרד או בזום'} — שאלי מה מעדיפים.

# כללים
- לפני שמירת פגישה — חזרי על היום והשעה וקבלי "כן" מפורש. ואז הפעילי את הכלי.
- שאלות מקצועיות (תשואות, כיסויים, סכומים, המלצות): "שאלה מצוינת, ${owner} יעבור על זה איתך בפגישה." אל תמציאי מידע ואל תיתני ייעוץ.
- אל תבקשי ואל תקבלי תעודת זהות, פרטי אשראי או סיסמאות.
- אם שואלים אם את בוט/מחשב — עני בכנות שאת עוזרת דיגיטלית של המשרד, והמשיכי בנעימות.
- הלקוח עסוק → שאלי מתי נוח לחזור → request_callback.
- לא מעוניין בפגישה → decline. מבקש שלא יתקשרו אליו → התנצלי, אשרי שזה נרשם → do_not_call.
- תא קולי / מענה אוטומטי → השאירי הודעה של משפט-שניים (מי את ושתחזרו שוב) → voicemail.
- אחרי שהמטרה הושגה (או שברור שלא תושג): משפט פרידה קצר וחם ("תודה רבה, יום מקסים!") ואז end_call.
- השיחה קצרה — עד שלוש דקות.

פתחי עכשיו: "שלום ${first}, מדברת ${agent} מ${business}${ctx.mode === 'confirm' ? `. אני מתקשרת לגבי הפגישה שלך עם ${owner}` : `, המשרד של ${owner}`}. יש לך רגע?" (התאימי "לך" למין הלקוח).`;
}

/* ---------- tools ---------- */
const S = (props, required = []) => ({ type: 'OBJECT', properties: props, required });
const STR = d => ({ type: 'STRING', description: d });
const TOOLS = [{
  functionDeclarations: [
    { name: 'book_meeting', description: 'שמירת פגישה שהלקוח הסכים לה (חדשה או במקום הקיימת). רק אחרי "כן" מפורש.',
      parameters: S({ date: STR('YYYY-MM-DD'), time: STR('HH:MM, 24h'), meeting_mode: STR('office / zoom / phone'), notes: STR('הערות קצרות בעברית') }, ['date', 'time']) },
    { name: 'confirm_meeting', description: 'הלקוח אישר שהפגישה הקיימת במועדה.', parameters: S({ notes: STR('הערות קצרות') }) },
    { name: 'request_callback', description: 'הלקוח ביקש שנחזור אליו בזמן אחר.', parameters: S({ when: STR('מתי לחזור, טקסט חופשי'), notes: STR('הערות') }, ['when']) },
    { name: 'decline', description: 'הלקוח לא מעוניין בפגישה (או מבטל את הקיימת).', parameters: S({ reason: STR('סיבה אם נאמרה') }) },
    { name: 'do_not_call', description: 'הלקוח ביקש שלא יתקשרו אליו יותר.', parameters: S({}) },
    { name: 'voicemail', description: 'הגעת לתא קולי/מענה אוטומטי (אחרי השארת הודעה).', parameters: S({}) },
    { name: 'end_call', description: 'ניתוק השיחה — רק אחרי משפט הפרידה.', parameters: S({}) }
  ]
}];

/* ---------- session ---------- */
/**
 * transport: { play(pcm24kBuffer), clear(), hangup() }  — hangup must wait for queued audio to finish.
 * returns { sendAudio(pcm16kBuffer), close() }
 */
async function startSession({ ctx, record, transport, onUpdate }) {
  const model = await pickModel();
  const slotOk = (date, time) => !(ctx.slots || []).length || (ctx.slots || []).some(d => d.date === date && d.times.includes(time));
  let closed = false, hangupRequested = false, lastRole = null;
  const say = (role, text) => {
    if (!text) return;
    const t = record.transcript;
    if (lastRole === role && t.length) t[t.length - 1].text += text; else t.push({ role, text });
    lastRole = role;
  };

  function handleTool(fc) {
    const a = fc.args || {};
    let response = { ok: true };
    switch (fc.name) {
      case 'book_meeting': {
        const time = String(a.time || '').padStart(5, '0');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '') || !/^\d{2}:\d{2}$/.test(time)) { response = { ok: false, error: 'פורמט לא תקין' }; break; }
        if (!slotOk(a.date, time)) { response = { ok: false, error: 'המועד לא פנוי. הציעי מועד אחר מהרשימה.' }; break; }
        Object.assign(record, { outcome: ctx.mode === 'confirm' ? 'rescheduled' : 'scheduled', date: a.date, time, meeting_mode: a.meeting_mode || '', notes: a.notes || record.notes });
        response = { ok: true, message: 'הפגישה נשמרה. סכמי ללקוח בקצרה, היפרדי ו-end_call.' };
        break;
      }
      case 'confirm_meeting': Object.assign(record, { outcome: 'confirmed', notes: a.notes || record.notes }); break;
      case 'request_callback': Object.assign(record, { outcome: 'callback', callback_when: a.when || '', notes: a.notes || record.notes }); break;
      case 'decline': Object.assign(record, { outcome: 'declined', notes: a.reason || record.notes }); break;
      case 'do_not_call': record.outcome = 'do_not_call'; break;
      case 'voicemail': record.outcome = 'voicemail'; hangupRequested = true; break;
      case 'end_call': hangupRequested = true; break;
      default: response = { ok: false, error: 'unknown tool' };
    }
    console.log('[agent] tool', fc.name, JSON.stringify(a), '→', JSON.stringify(response));
    onUpdate && onUpdate();
    return { id: fc.id, name: fc.name, response };
  }

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
      systemInstruction: buildPrompt(ctx),
      tools: TOOLS,
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    },
    callbacks: {
      onmessage: msg => {
        const sc = msg.serverContent;
        if (sc) {
          if (sc.interrupted) transport.clear();
          for (const p of (sc.modelTurn && sc.modelTurn.parts) || []) {
            if (p.inlineData && p.inlineData.data) transport.play(Buffer.from(p.inlineData.data, 'base64'));
          }
          if (sc.inputTranscription && sc.inputTranscription.text) say('client', sc.inputTranscription.text);
          if (sc.outputTranscription && sc.outputTranscription.text) say('agent', sc.outputTranscription.text);
          if (sc.turnComplete && hangupRequested) transport.hangup();
        }
        if (msg.toolCall && msg.toolCall.functionCalls) {
          const responses = msg.toolCall.functionCalls.map(handleTool);
          session.sendToolResponse({ functionResponses: responses });
          if (hangupRequested && msg.toolCall.functionCalls.some(f => f.name === 'end_call')) setTimeout(() => transport.hangup(), 600);
        }
      },
      onerror: e => { console.error('[agent] gemini error', e && e.message); record.error = 'gemini: ' + (e && e.message); },
      onclose: e => { if (!closed) { console.log('[agent] gemini closed', e && e.reason); record.error = record.error || (e && e.reason) || ''; transport.hangup(); } }
    }
  });

  // kick off: the model speaks first
  session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: '[השיחה התחברה — הלקוח ענה. פתחי עכשיו בברכה.]' }] }], turnComplete: true });

  return {
    model,
    sendAudio(pcm16k) { if (!closed) session.sendRealtimeInput({ audio: { data: pcm16k.toString('base64'), mimeType: 'audio/pcm;rate=16000' } }); },
    close() { if (closed) return; closed = true; try { session.close(); } catch (e) {} }
  };
}

module.exports = { startSession, pickModel, buildPrompt, todayIL };
