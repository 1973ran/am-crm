/* רן פיננסים — סוכנת שירות לקוחות קולית
 * מתקשרת ללקוחות, קובעת פגישות חדשות ומאשרת פגישות קיימות בעברית טבעית.
 * השיחות עצמן רצות בשרת הסוכנת (voice-server/: Gemini Live + Twilio).
 * התוצאה של כל שיחה (נקבע / אושר / נדחה / לחזור אליו...) נכתבת אוטומטית ל-CRM.
 */
(function () {
  if (window.__rmVA) return; window.__rmVA = 1;

  var CFG_LS = 'rm_voice_cfg2', CALLS_LS = 'crm_calls';
  var DEF = {
    server: '', token: '',
    business: 'רן פיננסים', agentName: 'נועה', owner: 'רן',
    hours: '09:00-18:00', days: '0,1,2,3,4', slotMin: 60, location: 'במשרד או בזום — לבחירת הלקוח'
  };

  /* ---------- helpers ---------- */
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function cfg() { var c = {}; try { c = JSON.parse(ls(CFG_LS) || '{}'); } catch (e) {} for (var k in DEF) if (c[k] === undefined || c[k] === '') c[k] = DEF[k]; return c; }
  function setCfg(c) { ls(CFG_LS, JSON.stringify(c)); }
  function calls() { try { return JSON.parse(ls(CALLS_LS) || '[]'); } catch (e) { return []; } }
  function setCalls(a) { ls(CALLS_LS, JSON.stringify(a.slice(-500))); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function C() { try { return clients; } catch (e) { return []; } }
  function MT() { try { return meetings; } catch (e) { return []; } }
  function persist() { try { save(); } catch (e) {} try { renderMeetings(); } catch (e) {} try { updateCounts(); } catch (e) {} }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  var DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function heDate(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr + 'T12:00:00');
    return 'יום ' + DAYS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
  }
  // 050-1234567 / 501234567 / +972501234567 → +972501234567
  function e164(p) {
    var d = String(p || '').replace(/[^0-9+]/g, '');
    if (!d) return '';
    if (d[0] === '+') return d;
    if (d.indexOf('972') === 0) return '+' + d;
    if (d[0] === '0') d = d.slice(1);
    if (d.length < 8 || d.length > 9) return '';
    return '+972' + d;
  }

  /* ---------- free slots from CRM meetings ---------- */
  function freeSlots() {
    var c = cfg(), h = String(c.hours).split('-'), sH = parseInt(h[0], 10) || 9, eH = parseInt(h[1], 10) || 18;
    var step = parseInt(c.slotMin, 10) || 60, days = String(c.days).split(',').map(Number);
    var taken = {}; MT().forEach(function (m) { if (m.date && m.time && m.status !== 'cancelled') taken[m.date + ' ' + m.time] = 1; });
    var out = [], d = new Date(); d.setDate(d.getDate() + 1);
    for (var i = 0; i < 21 && out.length < 6; i++, d.setDate(d.getDate() + 1)) {
      if (days.indexOf(d.getDay()) < 0) continue;
      var dayIso = iso(d), list = [];
      for (var t = sH * 60; t + step <= eH * 60; t += step) {
        var hm = pad(Math.floor(t / 60)) + ':' + pad(t % 60);
        if (!taken[dayIso + ' ' + hm]) list.push(hm);
      }
      if (list.length) out.push({ date: dayIso, times: list });
    }
    return out;
  }

  /* ---------- server API ---------- */
  function api(path, opt) {
    var c = cfg(); opt = opt || {};
    var base = String(c.server || '').replace(/\/$/, '');
    if (!base) return Promise.reject(new Error('לא הוגדרה כתובת שרת הסוכנת'));
    return fetch(base + path, {
      method: opt.method || 'GET',
      headers: { 'Authorization': 'Bearer ' + c.token, 'Content-Type': 'application/json' },
      body: opt.body ? JSON.stringify(opt.body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var j; try { j = JSON.parse(t); } catch (e) { j = { error: t }; }
        if (!r.ok) throw new Error(j.error || ('שגיאת שרת ' + r.status));
        return j;
      });
    }, function () { throw new Error('אין חיבור לשרת הסוכנת (אם השרת בחינמי ב-Render — הוא מתעורר תוך דקה, נסו שוב)'); });
  }

  function startCall(client, mode, meeting) {
    var c = cfg();
    if (!c.server || !c.token) return Promise.reject(new Error('צריך להגדיר כתובת שרת וקוד גישה'));
    if (!e164(client.phone)) return Promise.reject(new Error('אין מספר טלפון תקין ל' + client.name));
    if (client.doNotCall) return Promise.reject(new Error(client.name + ' ביקש/ה לא להתקשר'));
    return api('/api/call', { method: 'POST', body: {
      mode: mode,
      client: { name: client.name, phone: client.phone, gender: client.gender || '' },
      meeting: meeting ? { date: meeting.date, time: meeting.time, subject: meeting.subject, location: meeting.location } : null,
      settings: { agentName: c.agentName, business: c.business, owner: c.owner, location: c.location },
      slots: freeSlots()
    } }).then(function (j) {
      var rec = { id: Date.now(), callId: j.id, clientId: client.id, mode: mode, meetingId: meeting ? meeting.id : null,
        to: e164(client.phone), at: new Date().toISOString(), status: 'calling' };
      var a = calls(); a.push(rec); setCalls(a); draw();
      poll(rec.id);
      return rec;
    });
  }

  /* ---------- polling & applying results ---------- */
  var polling = {};
  function poll(recId) {
    if (polling[recId]) return; polling[recId] = 1;
    var tries = 0;
    (function tick() {
      var rec = calls().filter(function (r) { return r.id === recId; })[0];
      if (!rec || !rec.callId || rec.status === 'done' || rec.status === 'failed') { delete polling[recId]; return; }
      api('/api/calls/' + rec.callId).then(function (j) {
        if (j.status === 'done') { applyResult(recId, j); delete polling[recId]; if (queueWaiting === recId) nextInQueue(); }
        else { updRec(recId, { status: j.status === 'talking' ? 'talking' : 'calling' }); again(); }
      }).catch(again);
      function again() { if (++tries > 150) { delete polling[recId]; updRec(recId, { status: 'failed', error: 'timeout' }); if (queueWaiting === recId) nextInQueue(); return; } setTimeout(tick, 4000); }
    })();
  }
  function updRec(id, patch) { var a = calls(); a.forEach(function (r) { if (r.id === id) for (var k in patch) r[k] = patch[k]; }); setCalls(a); draw(); }

  var OUT = {
    scheduled: ['✅ נקבעה פגישה', '#10b981'], confirmed: ['✅ אישר/ה פגישה', '#10b981'], rescheduled: ['🔄 הוזזה פגישה', '#14b8a6'],
    callback: ['⏰ לחזור אליו/ה', '#f59e0b'], declined: ['✋ לא מעוניין/ת', '#94a3b8'], do_not_call: ['⛔ לא להתקשר', '#ef4444'],
    voicemail: ['📭 תא קולי', '#94a3b8'], no_answer: ['📵 לא ענה/תה', '#94a3b8'], unknown: ['❔ ללא תוצאה', '#94a3b8'], failed: ['⚠️ נכשל', '#ef4444']
  };

  function applyResult(recId, j) {
    var rec = calls().filter(function (r) { return r.id === recId; })[0]; if (!rec) return;
    var outcome = String(j.outcome || 'no_answer');
    var date = j.date || '', time = j.time || '', notes = j.notes || '', cb = j.callback_when || '', modeSel = j.meeting_mode || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = ''; if (!/^\d{1,2}:\d{2}$/.test(time)) time = ''; else time = time.length === 4 ? '0' + time : time;
    var summary = j.error ? 'שגיאה: ' + j.error : '';
    var transcript = (j.transcript || []).map(function (t) { return (t.role === 'agent' ? cfg().agentName : 'לקוח') + ': ' + (t.text || '').trim(); }).join('\n');
    var cl = C().filter(function (x) { return x.id == rec.clientId; })[0];
    var loc = modeSel === 'zoom' ? 'זום' : modeSel === 'phone' ? 'טלפונית' : modeSel === 'office' ? 'במשרד' : '';
    var mt = rec.meetingId ? MT().filter(function (m) { return m.id == rec.meetingId; })[0] : null;

    if ((outcome === 'scheduled' || outcome === 'rescheduled' || outcome === 'confirmed') && (date || mt)) {
      if (mt) {
        if (outcome === 'rescheduled' && date) { mt.date = date; if (time) mt.time = time; mt.googleEventId = null; }
        else if (outcome === 'scheduled' && date) { mt.date = date; if (time) mt.time = time; }
        mt.confirmed = true; mt.confirmedAt = new Date().toISOString(); mt.confirmedBy = 'voice';
        if (loc) mt.location = loc;
      } else {
        mt = { id: Date.now(), clientId: rec.clientId, subject: 'סקירה שנתית (נקבע ע״י ' + cfg().agentName + ')', date: date, time: time,
          location: loc || '', googleEventId: null, confirmed: true, confirmedAt: new Date().toISOString(), confirmedBy: 'voice' };
        MT().push(mt);
      }
      rec.meetingId = mt.id;
      try { if (typeof gcalAccessToken !== 'undefined' && gcalAccessToken && typeof pushMeetingToGoogle === 'function') setTimeout(function () { pushMeetingToGoogle(mt.id); }, 300); } catch (e) {}
    } else if (mt && outcome === 'declined') {
      mt.status = 'cancelled';
    }
    if (cl) {
      if (outcome === 'do_not_call') cl.doNotCall = true;
      var line = '📞 ' + new Date().toLocaleDateString('he-IL') + ' ' + (OUT[outcome] ? OUT[outcome][0] : outcome) +
        (date ? ' ' + date + (time ? ' ' + time : '') : '') + (cb ? ' | לחזור: ' + cb : '') + (notes ? ' | ' + notes : '');
      cl.notes = cl.notes ? cl.notes + ' | ' + line : line;
      if (outcome === 'callback') {
        try { tasks.push({ id: Date.now() + 1, text: '📞 לחזור ל' + cl.name + (cb ? ' — ' + cb : ''), clientId: String(cl.id), priority: 'high', due: '', done: false }); } catch (e) {}
      }
    }
    persist();
    updRec(recId, { status: outcome === 'failed' ? 'failed' : 'done', outcome: outcome, date: date, time: time, notes: notes,
      callback: cb, summary: summary, transcript: transcript.slice(0, 6000), duration: j.duration, meetingId: rec.meetingId });
    toast((cl ? cl.name + ': ' : '') + (OUT[outcome] ? OUT[outcome][0] : 'השיחה הסתיימה'));
  }

  /* ---------- queue (bulk calls, one at a time) ---------- */
  var queue = [], queueWaiting = null;
  function enqueue(items) { queue = queue.concat(items); if (!queueWaiting) nextInQueue(); draw(); }
  function nextInQueue() {
    queueWaiting = null;
    var it = queue.shift(); draw();
    if (!it) return;
    startCall(it.client, it.mode, it.meeting).then(function (rec) { queueWaiting = rec.id; }).catch(function (e) { toast(e.message, 1); setTimeout(nextInQueue, 1500); });
  }

  /* ---------- UI ---------- */
  var css = '' +
    '#rmva{position:fixed;z-index:10001;inset:0;background:rgba(0,0,0,.55);display:none;justify-content:flex-end;align-items:stretch}#rmva.open{display:flex}' +
    '#rmva .p{background:var(--dark2,#0f2321);color:var(--txt,#e2e8f0);width:520px;max-width:100%;height:100%;display:flex;flex-direction:column;font-family:inherit;border-right:1px solid var(--brd2,#333)}' +
    '@media (max-width:768px){#rmva .p{width:100%}}' +
    '#rmva .h{display:flex;align-items:center;gap:8px;padding:12px 14px;padding-top:calc(12px + env(safe-area-inset-top));border-bottom:1px solid var(--brd,#222);font-weight:700;font-size:16px}' +
    '#rmva .h .t{flex:1}#rmva .h button{background:none;border:0;color:var(--txt2,#94a3b8);font-size:20px;cursor:pointer}' +
    '#rmva .tb{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--brd,#222);overflow-x:auto}' +
    '#rmva .tb button{background:var(--dark3,#15302d);border:1px solid var(--brd2,#333);color:var(--txt2,#94a3b8);border-radius:16px;padding:6px 12px;font-family:inherit;font-size:13px;cursor:pointer;white-space:nowrap}' +
    '#rmva .tb button.on{background:var(--acc,#14b8a6);color:#04201d;border-color:transparent;font-weight:700}' +
    '#rmva .bd{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:14px;display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:1.55}' +
    '#rmva .it{background:var(--dark3,#15302d);border:1px solid var(--brd2,#333);border-radius:12px;padding:10px 12px;display:flex;gap:10px;align-items:center}' +
    '#rmva .it .x{flex:1;min-width:0}#rmva .it .n{font-weight:700}#rmva .it .s{color:var(--txt2,#94a3b8);font-size:12px}' +
    '#rmva .btn2{border:0;border-radius:9px;padding:8px 12px;font-family:inherit;font-size:13px;cursor:pointer;background:var(--acc,#14b8a6);color:#04201d;font-weight:700;white-space:nowrap}' +
    '#rmva .btn2.g{background:var(--dark4,#1c3d39);color:var(--txt,#e2e8f0);font-weight:500}#rmva .btn2.r{background:#ef4444;color:#fff}' +
    '#rmva input,#rmva select,#rmva textarea{width:100%;box-sizing:border-box;border-radius:10px;border:1px solid var(--brd2,#333);background:var(--dark3,#15302d);color:var(--txt,#e2e8f0);padding:10px;font-size:16px;font-family:inherit}' +
    '#rmva .ltr{direction:ltr;text-align:left}#rmva label{font-size:12px;color:var(--txt2,#94a3b8);display:block;margin:6px 0 3px}' +
    '#rmva .bx{background:rgba(20,184,166,.08);border:1px solid rgba(20,184,166,.3);border-radius:12px;padding:10px 12px}' +
    '#rmva .wr{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.35);border-radius:12px;padding:10px 12px;font-size:13px}' +
    '#rmva .pl{display:inline-block;border-radius:10px;padding:2px 8px;font-size:12px;font-weight:700;color:#04201d}' +
    '#rmva details{font-size:13px;color:var(--txt2,#94a3b8)}#rmva pre{white-space:pre-wrap;font-family:inherit;margin:6px 0 0}' +
    '#rmva .row{display:flex;gap:8px;flex-wrap:wrap}#rmva .row>*{flex:1}' +
    '#rmva-toast{position:fixed;z-index:10002;bottom:calc(90px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);background:#0f2321;color:#e2e8f0;border:1px solid #14b8a6;border-radius:12px;padding:10px 16px;font-size:14px;box-shadow:0 6px 22px rgba(0,0,0,.5);display:none;max-width:90%}' +
    '#rmva-fab{position:fixed;left:18px;bottom:92px;z-index:950;width:52px;height:52px;border-radius:50%;border:0;cursor:pointer;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-size:22px;box-shadow:0 6px 22px rgba(0,0,0,.45)}' +
    '@media (max-width:768px){#rmva-fab{bottom:calc(146px + env(safe-area-inset-bottom));left:16px;width:50px;height:50px}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var fab = document.createElement('button'); fab.id = 'rmva-fab'; fab.title = 'סוכן שירות קולי'; fab.textContent = '📞';
  var root = document.createElement('div'); root.id = 'rmva';
  root.innerHTML = '<div class="p"><div class="h"><span>🎧</span><span class="t">סוכן שירות קולי</span><button data-a="close">✕</button></div>' +
    '<div class="tb"><button data-tab="confirm">אישור פגישות</button><button data-tab="schedule">קביעת פגישות</button><button data-tab="log">יומן שיחות</button><button data-tab="settings">⚙️ הגדרות</button></div>' +
    '<div class="bd"></div></div>';
  var toastEl = document.createElement('div'); toastEl.id = 'rmva-toast';
  function mount() { document.body.appendChild(fab); document.body.appendChild(root); document.body.appendChild(toastEl); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  var BD = root.querySelector('.bd'), tab = 'confirm', search = '';

  var tt; function toast(m, bad) { toastEl.textContent = m; toastEl.style.borderColor = bad ? '#ef4444' : '#14b8a6'; toastEl.style.display = 'block'; clearTimeout(tt); tt = setTimeout(function () { toastEl.style.display = 'none'; }, 4500); }

  function open(t) { if (t) tab = t; if (!ready()) tab = 'settings'; root.classList.add('open'); draw(); }
  function ready() { var c = cfg(); return c.server && c.token; }
  function lastCall(clientId) { var a = calls().filter(function (r) { return r.clientId == clientId; }); return a[a.length - 1]; }
  function pill(o) { var x = OUT[o]; return x ? '<span class="pl" style="background:' + x[1] + '">' + x[0] + '</span>' : ''; }
  function stLabel(r) { return r.status === 'calling' ? '<span class="pl" style="background:#f59e0b">📲 מחייג...</span>' : r.status === 'talking' ? '<span class="pl" style="background:#14b8a6">🗣️ בשיחה</span>' : pill(r.outcome || (r.status === 'failed' ? 'failed' : '')); }

  function draw() {
    if (!root.classList.contains('open')) return;
    [].forEach.call(root.querySelectorAll('.tb button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    var q = queue.length ? '<div class="bx">⏳ בתור: ' + queue.length + ' שיחות · ' + (queueWaiting ? 'שיחה פעילה כעת' : '') + ' <button class="btn2 r" data-a="stopq" style="float:left">עצור תור</button></div>' : '';
    if (tab === 'settings') return drawSettings();
    if (tab === 'log') return drawLog();
    if (tab === 'confirm') {
      var now = iso(new Date());
      var up = MT().filter(function (m) { return m.date >= now && m.status !== 'cancelled'; }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
      var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); var tIso = iso(tomorrow);
      var html = q + '<div class="bx">הסוכנת תתקשר ללקוח, תזכיר את מועד הפגישה ותבקש אישור. אם לא מתאים — תציע מועד חלופי מהשעות הפנויות ביומן ותעדכן את הפגישה.</div>' +
        '<div class="row"><button class="btn2" data-a="confirmTomorrow">📞 אשר את כל הפגישות של מחר</button></div>';
      if (!up.length) html += '<div class="it"><div class="x">אין פגישות קרובות ביומן</div></div>';
      up.forEach(function (m) {
        var cl = C().filter(function (x) { return x.id == m.clientId; })[0];
        var ok = cl && e164(cl.phone);
        html += '<div class="it"><div class="x"><div class="n">' + esc(cl ? cl.name : (m.subject || 'פגישה')) + (m.confirmed ? ' <span class="pl" style="background:#10b981">✓ מאושר</span>' : '') + (m.date === tIso ? ' <span class="pl" style="background:#f59e0b">מחר</span>' : '') + '</div>' +
          '<div class="s">' + esc(heDate(m.date)) + ' ' + esc(m.time || '') + (m.subject ? ' · ' + esc(m.subject) : '') + (ok ? '' : ' · ⚠️ אין טלפון') + '</div></div>' +
          (ok ? '<button class="btn2" data-a="confirm" data-id="' + m.id + '">📞 אשר</button>' : '') + '</div>';
      });
      BD.innerHTML = html; return;
    }
    // schedule
    var list = C().filter(function (c) { return e164(c.phone) && (!search || (c.name || '').indexOf(search) >= 0 || (c.phone || '').indexOf(search) >= 0); });
    var html2 = q + '<div class="bx">הסוכנת תתקשר, תציג את עצמה מטעם ' + esc(cfg().business) + ', תציע מועדים פנויים ותקבע פגישה. הפגישה תיכנס ליומן ב-CRM אוטומטית.</div>' +
      '<input placeholder="🔍 חיפוש לקוח..." data-a="search" value="' + esc(search) + '">' +
      '<div class="row"><button class="btn2 g" data-a="selAll">סמן הכל</button><button class="btn2" data-a="callSel">📞 התקשר למסומנים</button></div>' +
      '<div style="font-size:12px;color:var(--txt3,#64748b)">מוצגים רק לקוחות עם מספר טלפון תקין (' + list.length + ')</div>';
    list.slice(0, 300).forEach(function (c) {
      var lc = lastCall(c.id);
      html2 += '<div class="it"><input type="checkbox" class="sel" value="' + c.id + '" style="width:20px;height:20px;flex:none"' + (c.doNotCall ? ' disabled' : '') + '>' +
        '<div class="x"><div class="n">' + esc(c.name) + (c.doNotCall ? ' <span class="pl" style="background:#ef4444">⛔ לא להתקשר</span>' : '') + '</div>' +
        '<div class="s">' + esc(c.phone) + (lc ? ' · ' + new Date(lc.at).toLocaleDateString('he-IL') + ' ' + stLabel(lc) : '') + '</div></div>' +
        (c.doNotCall ? '' : '<button class="btn2" data-a="schedule" data-id="' + c.id + '">📞</button>') + '</div>';
    });
    BD.innerHTML = html2;
  }

  function drawLog() {
    var a = calls().slice().reverse(), html = '';
    if (!a.length) html = '<div class="it"><div class="x">עדיין לא בוצעו שיחות</div></div>';
    a.slice(0, 100).forEach(function (r) {
      var cl = C().filter(function (x) { return x.id == r.clientId; })[0];
      html += '<div class="it" style="display:block"><div style="display:flex;gap:8px;align-items:center"><div class="x"><div class="n">' + esc(cl ? cl.name : r.to) + ' ' + stLabel(r) + '</div>' +
        '<div class="s">' + new Date(r.at).toLocaleString('he-IL') + ' · ' + (r.mode === 'confirm' ? 'אישור פגישה' : 'קביעת פגישה') + (r.duration ? ' · ' + Math.round(r.duration) + ' שנ׳' : '') +
        (r.date ? ' · 📅 ' + esc(heDate(r.date)) + ' ' + esc(r.time || '') : '') + (r.callback ? ' · ⏰ ' + esc(r.callback) : '') + '</div></div>' +
        (r.status === 'calling' || r.status === 'talking' ? '<button class="btn2 g" data-a="refresh" data-id="' + r.id + '">🔄</button>' : '') + '</div>' +
        (r.notes || r.summary ? '<div class="s" style="margin-top:6px;color:var(--txt,#e2e8f0)">' + esc(r.notes || r.summary) + '</div>' : '') +
        (r.transcript ? '<details><summary>תמליל השיחה</summary><pre>' + esc(r.transcript) + '</pre></details>' : '') +
        (r.error ? '<div class="s" style="color:#fca5a5">' + esc(r.error) + '</div>' : '') + '</div>';
    });
    BD.innerHTML = html;
  }

  function drawSettings() {
    var c = cfg();
    function f(k, label, ph, ltr, type) { return '<label>' + label + '</label><input data-k="' + k + '" ' + (type ? 'type="' + type + '" ' : '') + 'class="' + (ltr ? 'ltr' : '') + '" placeholder="' + esc(ph || '') + '" value="' + esc(c[k]) + '">'; }
    BD.innerHTML =
      '<div class="bx"><b>איך זה עובד?</b><br>הסוכנת מדברת עם הלקוח דרך <b>Gemini Live</b> של גוגל — מודל שמדבר עברית בעצמו (לא מקריא טקסט), ולכן פונה נכון בזכר/נקבה. ' +
      'השיחות יוצאות דרך <b>Twilio</b> מ"שרת הסוכנת" — שרת קטן שמקימים פעם אחת (הוראות בקובץ voice-server/README.md). כל התוצאות נכתבות אוטומטית ל-CRM.</div>' +
      '<div class="bx"><b>חיבור לשרת הסוכנת</b></div>' +
      f('server', 'כתובת השרת', 'https://ran-voice-agent.onrender.com', 1) +
      f('token', 'קוד גישה (API_TOKEN)', '', 1, 'password') +
      '<div class="row"><button class="btn2 g" data-a="check">🔌 בדוק חיבור</button><button class="btn2 g" data-a="voiceTest">🎙️ דברו איתה בדפדפן</button></div>' +
      '<div class="bx"><b>פרטי הסוכנת והיומן</b></div>' +
      '<div class="row"><div>' + f('agentName', 'שם הנציגה', 'נועה') + '</div><div>' + f('business', 'שם העסק', 'רן פיננסים') + '</div><div>' + f('owner', 'שם הסוכן', 'רן') + '</div></div>' +
      '<div class="row"><div>' + f('hours', 'שעות פגישות', '09:00-18:00', 1) + '</div><div>' + f('slotMin', 'אורך פגישה (דק׳)', '60', 1) + '</div></div>' +
      f('days', 'ימי פגישות (0=ראשון ... 4=חמישי)', '0,1,2,3,4', 1) +
      f('location', 'אופן הפגישה', 'במשרד או בזום') +
      '<div class="row"><button class="btn2" data-a="saveCfg">💾 שמור</button><button class="btn2 g" data-a="test">📲 שיחת ניסיון לטלפון שלי</button></div>' +
      '<div class="wr">⚖️ <b>חשוב לדעת:</b> התקשרו רק ללקוחות קיימים. שיחות שיווקיות אוטומטיות ללא הסכמה אסורות לפי חוק התקשורת (סעיף 30א). הסוכנת לא מכחישה שהיא עוזרת דיגיטלית, ומסמנת "לא להתקשר" כשמבקשים. קוד הגישה נשמר רק במכשיר הזה.</div>';
  }

  function readCfgForm() { var c = cfg(); [].forEach.call(BD.querySelectorAll('[data-k]'), function (el) { c[el.getAttribute('data-k')] = el.value.trim(); }); setCfg(c); return c; }

  root.addEventListener('click', function (ev) {
    if (ev.target === root) return root.classList.remove('open');
    var t = ev.target.closest('[data-a],[data-tab]'); if (!t) return;
    var tb = t.getAttribute('data-tab'); if (tb) { tab = tb; return draw(); }
    var a = t.getAttribute('data-a'), id = t.getAttribute('data-id');
    if (a === 'close') root.classList.remove('open');
    else if (a === 'saveCfg') { readCfgForm(); toast('ההגדרות נשמרו'); }
    else if (a === 'check') {
      readCfgForm(); t.disabled = true;
      api('/api/check').then(function (j) {
        toast(j.model ? ('✓ מחובר · מודל: ' + j.model + (j.twilio ? ' · Twilio ✓' : ' · Twilio לא מוגדר')) : ('השרת עובד אבל Gemini לא: ' + j.modelError), !j.model);
      }).catch(function (e) { toast(e.message, 1); }).then(function () { t.disabled = false; });
    }
    else if (a === 'voiceTest') { var c0 = readCfgForm(); if (!c0.server) return toast('הזינו כתובת שרת', 1); window.open(c0.server.replace(/\/$/, '') + '/test', '_blank'); }
    else if (a === 'test') {
      readCfgForm(); var ph = window.prompt('לאיזה מספר להתקשר לניסיון?', ''); if (!ph) return;
      startCall({ id: 'test', name: cfg().owner, phone: ph, gender: 'male' }, 'schedule', null).then(function () { toast('מחייג... ענו לטלפון 📲'); tab = 'log'; draw(); }).catch(function (e) { toast(e.message, 1); });
    }
    else if (a === 'confirm') { var m = MT().filter(function (x) { return x.id == id; })[0]; var cl = m && C().filter(function (x) { return x.id == m.clientId; })[0]; if (cl) enqueue([{ client: cl, mode: 'confirm', meeting: m }]); toast('מחייג ל' + (cl ? cl.name : '') + '...'); }
    else if (a === 'confirmTomorrow') {
      var d = new Date(); d.setDate(d.getDate() + 1); var ti = iso(d);
      var items = MT().filter(function (m) { return m.date === ti && !m.confirmed && m.status !== 'cancelled'; }).map(function (m) { return { client: C().filter(function (x) { return x.id == m.clientId; })[0], mode: 'confirm', meeting: m }; }).filter(function (x) { return x.client && e164(x.client.phone) && !x.client.doNotCall; });
      if (!items.length) return toast('אין פגישות לא-מאושרות למחר');
      if (confirm('להתקשר ל-' + items.length + ' לקוחות לאישור פגישה של מחר?')) enqueue(items);
    }
    else if (a === 'schedule') { var c2 = C().filter(function (x) { return x.id == id; })[0]; if (c2) { enqueue([{ client: c2, mode: 'schedule', meeting: null }]); toast('מחייג ל' + c2.name + '...'); } }
    else if (a === 'selAll') { [].forEach.call(BD.querySelectorAll('.sel:not([disabled])'), function (x) { x.checked = true; }); }
    else if (a === 'callSel') {
      var ids = [].map.call(BD.querySelectorAll('.sel:checked'), function (x) { return x.value; });
      if (!ids.length) return toast('לא סומנו לקוחות');
      if (!confirm('להתקשר ל-' + ids.length + ' לקוחות לקביעת פגישה? (שיחה אחת בכל פעם)')) return;
      enqueue(ids.map(function (i) { return { client: C().filter(function (x) { return x.id == i; })[0], mode: 'schedule', meeting: null }; }).filter(function (x) { return x.client; }));
    }
    else if (a === 'stopq') { queue = []; draw(); toast('התור נעצר (השיחה הפעילה תסתיים כרגיל)'); }
    else if (a === 'refresh') { delete polling[+id]; poll(+id); }
  });
  root.addEventListener('input', function (ev) { if (ev.target.getAttribute('data-a') === 'search') { search = ev.target.value.trim(); var pos = ev.target.selectionStart; draw(); var s = BD.querySelector('[data-a=search]'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } } });
  fab.addEventListener('click', function () { open(); });

  // resume polling for calls that were in progress when the page was closed
  setTimeout(function () { calls().forEach(function (r) { if ((r.status === 'calling' || r.status === 'talking') && Date.now() - new Date(r.at) < 6 * 3600e3) poll(r.id); }); }, 1500);

  /* ---------- public API (used by buttons in the CRM) ---------- */
  window.rmVoice = {
    open: open,
    callClient: function (clientId) { var c = C().filter(function (x) { return x.id == clientId; })[0]; if (!c) return; if (!ready()) return open('settings'); enqueue([{ client: c, mode: 'schedule', meeting: null }]); toast('מחייג ל' + c.name + '...'); },
    confirmMeeting: function (meetingId) { var m = MT().filter(function (x) { return x.id == meetingId; })[0]; var c = m && C().filter(function (x) { return x.id == m.clientId; })[0]; if (!c) return toast('לפגישה אין לקוח משויך', 1); if (!ready()) return open('settings'); enqueue([{ client: c, mode: 'confirm', meeting: m }]); toast('מחייג ל' + c.name + ' לאישור...'); }
  };
})();
