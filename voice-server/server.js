// רן פיננסים — שרת הסוכנת הקולית
// CRM → POST /api/call → Twilio dials the client → Twilio streams audio over WebSocket (/media)
// ↔ Gemini Live (native audio, Hebrew) → results available at GET /api/calls/:id for the CRM.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { startSession, pickModel } = require('./agent');
const { mulaw8kToPcm16k, pcm24kToMulaw8k } = require('./audio');

const PORT = process.env.PORT || 8080;
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.API_TOKEN || '';
const MAX_CALL_SEC = parseInt(process.env.MAX_CALL_SECONDS || '300', 10);
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '3', 10);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'calls.json');

if (!process.env.GEMINI_API_KEY) console.warn('⚠️  GEMINI_API_KEY is missing');
if (!API_TOKEN) console.warn('⚠️  API_TOKEN is missing — the API is locked until you set it');

let twilio = null;
function tw() {
  if (!twilio && /^AC\w{32}$/.test(process.env.TWILIO_ACCOUNT_SID || '') && process.env.TWILIO_AUTH_TOKEN) twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return twilio;
}

/* ---------- call records ---------- */
const calls = new Map();
try { JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).forEach(r => calls.set(r.id, r)); } catch (e) {}
let saveT;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const cutoff = Date.now() - 14 * 864e5;
    for (const [id, r] of calls) if (new Date(r.createdAt) < cutoff) calls.delete(id);
    try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify([...calls.values()])); } catch (e) {}
  }, 500);
}
function publicRecord(r) { const { ctx, streamKey, ...rest } = r; return rest; }
const active = () => [...calls.values()].filter(r => ['calling', 'ringing', 'talking'].includes(r.status)).length;

function finish(r, patch = {}) {
  Object.assign(r, patch);
  if (r.status !== 'done') {
    r.status = 'done';
    r.endedAt = new Date().toISOString();
    if (!r.outcome) r.outcome = r.transcript.some(t => t.role === 'client') ? 'unknown' : 'no_answer';
  }
  persist();
}

/* ---------- helpers ---------- */
function e164(p) {
  let d = String(p || '').replace(/[^0-9+]/g, '');
  if (!d) return '';
  if (d[0] === '+') return /^\+\d{8,15}$/.test(d) ? d : '';
  if (d.startsWith('972')) return '+' + d;
  if (d[0] === '0') d = d.slice(1);
  return d.length >= 8 && d.length <= 9 ? '+972' + d : '';
}
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function authed(req) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : new URL(req.url, 'http://x').searchParams.get('token') || '';
  return API_TOKEN && tok.length === API_TOKEN.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(API_TOKEN));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b)); req.on('error', reject);
  });
}
const xmlEsc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/* ---------- HTTP ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');

    if (url.pathname === '/' && req.method === 'GET')
      return send(res, 200, { ok: true, service: 'voice-agent', publicUrl: PUBLIC_URL || null, twilio: !!tw(), gemini: !!process.env.GEMINI_API_KEY });

    if (url.pathname === '/test' && req.method === 'GET')
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'test.html'), 'utf8'), 'text/html');

    if (url.pathname === '/api/check' && req.method === 'GET') {
      if (!authed(req)) return send(res, 401, { error: 'קוד גישה שגוי' });
      let model = null, modelError = null;
      try { model = await pickModel(); } catch (e) { modelError = e.message; }
      return send(res, 200, { ok: true, model, modelError, twilio: !!tw(), from: process.env.TWILIO_FROM || null, publicUrl: PUBLIC_URL || null });
    }

    if (url.pathname === '/api/call' && req.method === 'POST') {
      if (!authed(req)) return send(res, 401, { error: 'קוד גישה שגוי' });
      if (!tw() || !process.env.TWILIO_FROM) return send(res, 400, { error: 'Twilio לא מוגדר בשרת (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)' });
      if (!PUBLIC_URL) return send(res, 400, { error: 'PUBLIC_URL לא מוגדר בשרת' });
      if (active() >= MAX_CONCURRENT) return send(res, 429, { error: 'יותר מדי שיחות פעילות במקביל' });
      const ctx = JSON.parse(await readBody(req) || '{}');
      const to = e164(ctx.client && ctx.client.phone);
      if (!to) return send(res, 400, { error: 'מספר טלפון לא תקין' });
      const id = crypto.randomUUID();
      const r = { id, status: 'calling', to, mode: ctx.mode === 'confirm' ? 'confirm' : 'schedule', createdAt: new Date().toISOString(),
        outcome: '', date: '', time: '', meeting_mode: '', callback_when: '', notes: '', transcript: [], duration: 0, error: '',
        ctx, streamKey: crypto.randomBytes(16).toString('hex') };
      calls.set(id, r);
      const wss = PUBLIC_URL.replace(/^http/, 'ws') + '/media';
      const twiml = `<Response><Connect><Stream url="${xmlEsc(wss)}"><Parameter name="callId" value="${id}"/><Parameter name="key" value="${r.streamKey}"/></Stream></Connect></Response>`;
      try {
        const call = await tw().calls.create({
          to, from: process.env.TWILIO_FROM, twiml, timeout: 30,
          statusCallback: `${PUBLIC_URL}/twilio/status?callId=${id}`,
          statusCallbackEvent: ['ringing', 'answered', 'completed'], statusCallbackMethod: 'POST'
        });
        r.callSid = call.sid; persist();
        return send(res, 200, { id, status: r.status });
      } catch (e) {
        finish(r, { outcome: 'failed', error: 'twilio: ' + e.message });
        return send(res, 502, { error: 'Twilio: ' + e.message, id });
      }
    }

    const m = url.pathname.match(/^\/api\/calls\/([\w-]+)$/);
    if (m && req.method === 'GET') {
      if (!authed(req)) return send(res, 401, { error: 'קוד גישה שגוי' });
      const r = calls.get(m[1]);
      return r ? send(res, 200, publicRecord(r)) : send(res, 404, { error: 'not found' });
    }

    if (url.pathname === '/twilio/status' && req.method === 'POST') {
      const params = Object.fromEntries(new URLSearchParams(await readBody(req)));
      const sig = req.headers['x-twilio-signature'] || '';
      if (!require('twilio').validateRequest(process.env.TWILIO_AUTH_TOKEN || '', sig, PUBLIC_URL + req.url, params)) return send(res, 403, 'bad signature', 'text/plain');
      const r = calls.get(url.searchParams.get('callId'));
      if (r) {
        const st = params.CallStatus;
        if (params.CallDuration) r.duration = parseInt(params.CallDuration, 10);
        if (st === 'ringing' && r.status === 'calling') r.status = 'ringing';
        else if (st === 'in-progress' && r.status !== 'done') r.status = 'talking';
        else if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(st)) finish(r, st === 'completed' ? {} : { outcome: r.outcome || 'no_answer' });
        persist();
      }
      return send(res, 200, '<Response/>', 'text/xml');
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

/* ---------- WebSockets: Twilio media stream + browser test ---------- */
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/media') wss.handleUpgrade(req, socket, head, ws => twilioStream(ws));
  else if (p === '/browser') {
    if (!authed(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, ws => browserStream(ws, new URL(req.url, 'http://x').searchParams));
  } else socket.destroy();
});

function twilioStream(ws) {
  let streamSid, r, agent, inState = {}, outState = {}, marks = 0, played = 0, hangingUp = false, maxT, hangT;
  const sendJ = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const endCall = () => {
    clearTimeout(hangT); clearTimeout(maxT);
    if (r && r.callSid && tw()) tw().calls(r.callSid).update({ status: 'completed' }).catch(() => {});
    try { ws.close(); } catch (e) {}
  };
  const transport = {
    play(pcm24) {
      const mu = pcm24kToMulaw8k(pcm24, outState);
      if (!mu.length || !streamSid) return;
      sendJ({ event: 'media', streamSid, media: { payload: mu.toString('base64') } });
      sendJ({ event: 'mark', streamSid, mark: { name: String(++marks) } });
    },
    clear() { if (streamSid) sendJ({ event: 'clear', streamSid }); played = marks; },
    hangup() {
      if (hangingUp) return; hangingUp = true;
      if (played >= marks) return setTimeout(endCall, 400);
      hangT = setTimeout(endCall, 12000); // safety net
    }
  };

  ws.on('message', async data => {
    let msg; try { msg = JSON.parse(data); } catch (e) { return; }
    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      const cp = msg.start.customParameters || {};
      r = calls.get(cp.callId);
      if (!r || !cp.key || cp.key !== r.streamKey || r.connected) { console.warn('[media] rejected stream'); return ws.close(); }
      r.connected = true; r.status = 'talking'; r.answeredAt = new Date().toISOString(); persist();
      maxT = setTimeout(() => transport.hangup(), MAX_CALL_SEC * 1000);
      try {
        agent = await startSession({ ctx: r.ctx, record: r, transport, onUpdate: persist });
        r.model = agent.model;
      } catch (e) {
        console.error('[media] gemini start failed', e); r.error = 'gemini: ' + e.message; endCall();
      }
    } else if (msg.event === 'media' && agent) {
      agent.sendAudio(mulaw8kToPcm16k(Buffer.from(msg.media.payload, 'base64'), inState));
    } else if (msg.event === 'mark') {
      played = Math.max(played, parseInt(msg.mark.name, 10) || 0);
      if (hangingUp && played >= marks) setTimeout(endCall, 400);
    } else if (msg.event === 'stop') {
      try { ws.close(); } catch (e) {}
    }
  });
  ws.on('close', () => {
    clearTimeout(maxT); clearTimeout(hangT);
    if (agent) agent.close();
    if (r) { r.transcriptDone = true; if (r.status !== 'done' && r.outcome) finish(r); persist(); }
  });
}

// Browser test page: same agent, mic instead of phone. Binary frames = PCM16 audio, text frames = control.
async function browserStream(ws, q) {
  const r = { id: 'test', transcript: [], outcome: '', notes: '' };
  const ctx = {
    mode: q.get('mode') === 'confirm' ? 'confirm' : 'schedule',
    client: { name: q.get('name') || 'רן', gender: q.get('gender') || '' },
    settings: { agentName: q.get('agent') || 'שושנה', business: q.get('business') || 'רן פיננסים', owner: q.get('owner') || 'רן' },
    meeting: q.get('mode') === 'confirm' ? { date: q.get('date') || '', time: q.get('time') || '10:00', subject: 'סקירה שנתית' } : {},
    slots: JSON.parse(q.get('slots') || '[]')
  };
  let lastSig = '';
  const transport = {
    play: pcm => ws.readyState === 1 && ws.send(pcm),
    clear: () => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'clear' })),
    hangup: () => ws.readyState === 1 && ws.send(JSON.stringify(r.error && !r.outcome ? { type: 'error', error: r.error } : { type: 'hangup', result: r }))
  };
  let agent;
  try { agent = await startSession({ ctx, record: r, transport, onUpdate: () => ws.send(JSON.stringify({ type: 'result', result: r })), onProgress: t => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'status', text: t })) }); }
  catch (e) { ws.send(JSON.stringify({ type: 'error', error: e.message })); return ws.close(); }
  ws.send(JSON.stringify({ type: 'ready', model: agent.model }));
  const tick = setInterval(() => {
    const sig = r.transcript.length + ':' + (r.transcript.length ? r.transcript[r.transcript.length - 1].text.length : 0);
    if (sig !== lastSig && ws.readyState === 1) ws.send(JSON.stringify({ type: 'transcript', transcript: r.transcript }));
    lastSig = sig;
  }, 700);
  let inBytes = 0;
  const diag = setInterval(() => {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'diag', sec: +(inBytes / 32000).toFixed(1), heard: r.transcript.filter(t => t.role === 'client').length, model: agent.model }));
  }, 2000);
  ws.on('message', (data, isBinary) => { if (isBinary) { inBytes += data.length; agent.sendAudio(Buffer.from(data)); } });
  ws.on('close', () => clearInterval(diag));
  ws.on('close', () => { clearInterval(tick); agent.close(); });
}

server.listen(PORT, () => console.log(`voice-agent listening on :${PORT} public=${PUBLIC_URL || '(not set)'}`));
module.exports = { server, e164 };
