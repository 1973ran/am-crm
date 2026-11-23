/* רן פיננסים — סוכן שירות לקוחות קולי (ElevenLabs Agents + טלפוניה)
 * מתקשר ללקוחות, קובע פגישות חדשות ומאשר פגישות קיימות בקול טבעי בעברית.
 * התוצאה של כל שיחה (נקבע / אושר / נדחה / לחזור אליו...) נכתבת אוטומטית ל-CRM.
 */
(function () {
  if (window.__rmVA) return; window.__rmVA = 1;

  var API = 'https://api.elevenlabs.io/v1';
  var CFG_LS = 'rm_voice_cfg', CALLS_LS = 'crm_calls';
  var DEF = {
    apiKey: '', agentId: '', phoneId: '', trunk: 'twilio',
    business: 'רן פיננסים', agentName: 'נועה', owner: 'רן',
    hours: '09:00-18:00', days: '0,1,2,3,4', slotMin: 60, location: 'במשרד או בזום — לבחירת הלקוח',
    voiceId: ''
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
  function freeSlots(maxSlots) {
    var c = cfg(), h = String(c.hours).split('-'), sH = parseInt(h[0], 10) || 9, eH = parseInt(h[1], 10) || 18;
    var step = parseInt(c.slotMin, 10) || 60, days = String(c.days).split(',').map(Number);
    var taken = {}; MT().forEach(function (m) { if (m.date && m.time && m.status !== 'cancelled') taken[m.date + ' ' + m.time] = 1; });
    var out = [], d = new Date(); d.setDate(d.getDate() + 1);
    for (var i = 0; i < 21 && out.length < (maxSlots || 12); i++, d.setDate(d.getDate() + 1)) {
      if (days.indexOf(d.getDay()) < 0) continue;
      var dayIso = iso(d), list = [];
      for (var t = sH * 60; t + step <= eH * 60; t += step) {
        var hm = pad(Math.floor(t / 60)) + ':' + pad(t % 60);
        if (!taken[dayIso + ' ' + hm]) list.push(hm);
      }
      if (list.length) out.push(heDate(dayIso) + ' (' + dayIso + '): ' + list.join(', '));
      if (out.length >= 7) break;
    }
    return out.join('\n');
  }

  /* ---------- agent prompt ---------- */
  function buildPrompt() {
    return [
      '# מי את',
      'את {{agent_name}}, נציגת שירות לקוחות של {{business_name}} — סוכנות ביטוח ופנסיה בניהולו של {{owner_name}}.',
      'את חמה, אדיבה, מקצועית וקלילה — בדיוק כמו נציגת שירות ישראלית מעולה. מדברת עברית טבעית ויומיומית, משפטים קצרים, בלי שפה רובוטית ובלי רשימות.',
      '',
      '# מטרת השיחה',
      'מטרת השיחה הנוכחית: {{call_purpose}}',
      '- אם המטרה היא "קביעת פגישה": הסבירי בקצרה שרן רוצה לקבוע פגישת סקירה/שירות קצרה ({{meeting_subject}}), והציעי שני מועדים מתוך הרשימה הפנויה. אם אף אחד לא מתאים — שאלי מה נוח ללקוח ובחרי מהרשימה את הקרוב ביותר.',
      '- אם המטרה היא "אישור פגישה": הזכירי שקבועה פגישה ב-{{meeting_date_he}} בשעה {{meeting_time}} ({{meeting_location}}) ובקשי אישור. אם הלקוח לא יכול — הציעי מועד חלופי מהרשימה הפנויה.',
      '',
      '# מועדים פנויים (אסור להציע מועד שלא מופיע כאן)',
      '{{available_slots}}',
      'היום: {{today}}.',
      '',
      '# כללי שיחה',
      '- פני ללקוח בשמו הפרטי. אם אינך יודעת את המין — נסחי בלשון ניטרלית ("יהיה נוח?", "מתאים מבחינתך?").',
      '- שאלה אחת בכל פעם. הקשיבי, אל תקטעי.',
      '- אמרי תאריכים בצורה טבעית ("ביום שלישי הקרוב, עשרים וחמישה בנובמבר, בעשר בבוקר").',
      '- לפני סיום — חזרי על המועד שסוכם וקבלי "כן" מפורש.',
      '- שאלות מקצועיות (תשואות, כיסויים, כספים, המלצות): "זו שאלה מצוינת, רן יעבור על זה איתך בפגישה עצמה." אל תמציאי מידע ואל תיתני ייעוץ.',
      '- אל תבקשי ואל תקבלי מספר תעודת זהות, כרטיס אשראי או סיסמאות.',
      '- אם שואלים אם את בוט/מחשב — עני בכנות שאת עוזרת דיגיטלית של המשרד, והמשיכי בנעימות. אף פעם אל תכחישי.',
      '- אם הלקוח מבקש לא להתקשר אליו יותר — התנצלי, אשרי שזה נרשם וסיימי.',
      '- אם הלקוח עסוק — שאלי מתי נוח לחזור אליו, וסיימי.',
      '- אם הגעת לתא קולי — השאירי הודעה קצרה: מי את, שרן ביקש לתאם פגישה ושתחזרו שוב, וסיימי.',
      '- שיחה קצרה: עד 3 דקות. בסיום — הודי, אחלי יום טוב וסיימי את השיחה.'
    ].join('\n');
  }

  var DATA_COLLECTION = {
    outcome: { type: 'string', description: 'תוצאת השיחה. ערך אחד בלבד באנגלית: scheduled (נקבעה פגישה חדשה), confirmed (הלקוח אישר את הפגישה הקיימת), rescheduled (הפגישה הוזזה למועד חדש), callback (ביקש שנחזור אליו), declined (לא מעוניין בפגישה), do_not_call (ביקש שלא יתקשרו אליו), voicemail (תא קולי), no_answer (לא נענה/נותק לפני שיחה).' },
    meeting_date: { type: 'string', description: 'תאריך הפגישה שסוכם בפורמט YYYY-MM-DD. ריק אם לא סוכם מועד.' },
    meeting_time: { type: 'string', description: 'שעת הפגישה שסוכמה בפורמט HH:MM (24 שעות). ריק אם לא סוכם.' },
    meeting_mode: { type: 'string', description: 'אופן הפגישה שהלקוח בחר: office / zoom / phone / ריק.' },
    callback_when: { type: 'string', description: 'אם ביקש שנחזור — מתי (טקסט חופשי). אחרת ריק.' },
    notes: { type: 'string', description: 'סיכום קצר בעברית של בקשות או מידע חשוב שהלקוח אמר (עד 2 משפטים).' }
  };

  /* ---------- API ---------- */
  function api(path, opt) {
    var c = cfg(); opt = opt || {};
    return fetch(API + path, {
      method: opt.method || 'GET',
      headers: { 'xi-api-key': c.apiKey, 'Content-Type': 'application/json' },
      body: opt.body ? JSON.stringify(opt.body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var j; try { j = JSON.parse(t); } catch (e) { j = { raw: t }; }
        if (!r.ok) { var msg = (j.detail && (j.detail.message || (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)))) || t || r.status; throw new Error('ElevenLabs ' + r.status + ': ' + msg); }
        return j;
      });
    }, function (e) { throw new Error('אין חיבור ל-ElevenLabs (' + e.message + ')'); });
  }

  function placeholders() {
    return { agent_name: 'נועה', business_name: 'רן פיננסים', owner_name: 'רן', client_name: 'לקוח', call_purpose: 'קביעת פגישה',
      meeting_subject: 'סקירה שנתית', meeting_date_he: '', meeting_date: '', meeting_time: '', meeting_location: '',
      available_slots: '', today: '', first_message: 'שלום, מדברת נועה מרן פיננסים.' };
  }

  function createAgent() {
    var c = cfg();
    var body = {
      name: c.business + ' — שירות לקוחות קולי',
      conversation_config: {
        agent: {
          first_message: '{{first_message}}',
          language: 'he',
          dynamic_variables: { dynamic_variable_placeholders: placeholders() },
          prompt: {
            prompt: buildPrompt(), llm: 'gemini-2.5-flash', temperature: 0.4,
            built_in_tools: {
              end_call: { name: 'end_call', description: 'סיום השיחה אחרי פרידה, בקשה לא להתקשר, או השארת הודעה בתא קולי.', params: { system_tool_type: 'end_call' } },
              voicemail_detection: { name: 'voicemail_detection', description: 'זיהוי תא קולי והשארת הודעה קצרה.', params: { system_tool_type: 'voicemail_detection' } }
            }
          }
        },
        tts: c.voiceId ? { voice_id: c.voiceId, model_id: 'eleven_v3_conversational' } : { model_id: 'eleven_v3_conversational' },
        conversation: { max_duration_seconds: 300 }
      },
      platform_settings: { data_collection: DATA_COLLECTION }
    };
    function tryCreate(b) { return api('/convai/agents/create', { method: 'POST', body: b }); }
    return tryCreate(body).catch(function (e) {
      // fallback: older schemas / models — drop optional parts and retry once
      delete body.conversation_config.agent.prompt.built_in_tools;
      body.conversation_config.tts = c.voiceId ? { voice_id: c.voiceId, model_id: 'eleven_flash_v2_5' } : { model_id: 'eleven_flash_v2_5' };
      return tryCreate(body).catch(function () { throw e; });
    }).then(function (j) { var cc = cfg(); cc.agentId = j.agent_id; setCfg(cc); return j.agent_id; });
  }

  function vars(client, mode, meeting) {
    var c = cfg(), first = (client.name || '').trim().split(/\s+/)[0] || '';
    var d = new Date();
    var v = {
      agent_name: c.agentName, business_name: c.business, owner_name: c.owner, client_name: first,
      call_purpose: mode === 'confirm' ? 'אישור פגישה' : 'קביעת פגישה',
      meeting_subject: (meeting && meeting.subject) || 'סקירה שנתית של הפנסיה והביטוחים',
      meeting_date: (meeting && meeting.date) || '', meeting_date_he: meeting ? heDate(meeting.date) : '',
      meeting_time: (meeting && meeting.time) || '', meeting_location: (meeting && meeting.location) || c.location,
      available_slots: freeSlots() || 'אין מועדים פנויים — בקשי מהלקוח מועד נוח ואמרי שרן יחזור לאשר.',
      today: 'יום ' + DAYS[d.getDay()] + ' ' + iso(d)
    };
    v.first_message = mode === 'confirm'
      ? 'שלום ' + first + ', מדברת ' + c.agentName + ' מ' + c.business + '. אני מתקשרת לגבי הפגישה שלך עם ' + c.owner + ' ב' + v.meeting_date_he + ' — יש לך רגע?'
      : 'שלום ' + first + ', מדברת ' + c.agentName + ' מ' + c.business + ', המשרד של ' + c.owner + '. יש לך דקה?';
    return v;
  }

  function startCall(client, mode, meeting) {
    var c = cfg(), to = e164(client.phone);
    if (!c.apiKey || !c.agentId || !c.phoneId) return Promise.reject(new Error('צריך להשלים הגדרות: מפתח API, מזהה סוכן ומזהה מספר טלפון'));
    if (!to) return Promise.reject(new Error('אין מספר טלפון תקין ל' + client.name));
    if (client.doNotCall) return Promise.reject(new Error(client.name + ' ביקש/ה לא להתקשר אליו/ה'));
    var path = c.trunk === 'sip' ? '/convai/sip-trunk/outbound-call' : '/convai/twilio/outbound-call';
    return api(path, { method: 'POST', body: {
      agent_id: c.agentId, agent_phone_number_id: c.phoneId, to_number: to,
      conversation_initiation_client_data: { dynamic_variables: vars(client, mode, meeting) }
    } }).then(function (j) {
      if (j.success === false) throw new Error(j.message || 'השיחה לא יצאה');
      var rec = { id: Date.now(), convId: j.conversation_id, clientId: client.id, mode: mode, meetingId: meeting ? meeting.id : null,
        to: to, at: new Date().toISOString(), status: 'calling' };
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
      if (!rec || !rec.convId || rec.status === 'done' || rec.status === 'failed') { delete polling[recId]; return; }
      api('/convai/conversations/' + rec.convId).then(function (j) {
        if (j.status === 'done' || j.status === 'failed') { applyResult(recId, j); delete polling[recId]; if (queueWaiting === recId) nextInQueue(); }
        else { updRec(recId, { status: j.status === 'in-progress' ? 'talking' : 'calling' }); again(); }
      }).catch(again);
      function again() { if (++tries > 120) { delete polling[recId]; updRec(recId, { status: 'failed', error: 'timeout' }); if (queueWaiting === recId) nextInQueue(); return; } setTimeout(tick, 6000); }
    })();
  }
  function updRec(id, patch) { var a = calls(); a.forEach(function (r) { if (r.id === id) for (var k in patch) r[k] = patch[k]; }); setCalls(a); draw(); }

  function dc(j, k) { var r = j.analysis && j.analysis.data_collection_results && j.analysis.data_collection_results[k]; var v = r && (r.value != null ? r.value : r); return v == null || typeof v === 'object' ? '' : String(v).trim(); }

  var OUT = {
    scheduled: ['✅ נקבעה פגישה', '#10b981'], confirmed: ['✅ אישר/ה פגישה', '#10b981'], rescheduled: ['🔄 הוזזה פגישה', '#14b8a6'],
    callback: ['⏰ לחזור אליו/ה', '#f59e0b'], declined: ['✋ לא מעוניין/ת', '#94a3b8'], do_not_call: ['⛔ לא להתקשר', '#ef4444'],
    voicemail: ['📭 תא קולי', '#94a3b8'], no_answer: ['📵 לא ענה/תה', '#94a3b8'], failed: ['⚠️ נכשל', '#ef4444']
  };

  function applyResult(recId, j) {
    var rec = calls().filter(function (r) { return r.id === recId; })[0]; if (!rec) return;
    var outcome = (dc(j, 'outcome') || (j.status === 'failed' ? 'no_answer' : '')).toLowerCase().replace(/[^a-z_]/g, '');
    var date = dc(j, 'meeting_date'), time = dc(j, 'meeting_time'), notes = dc(j, 'notes'), cb = dc(j, 'callback_when'), modeSel = dc(j, 'meeting_mode');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = ''; if (!/^\d{1,2}:\d{2}$/.test(time)) time = ''; else time = time.length === 4 ? '0' + time : time;
    var summary = (j.analysis && j.analysis.transcript_summary) || '';
    var transcript = (j.transcript || []).map(function (t) { return (t.role === 'agent' ? cfg().agentName : 'לקוח') + ': ' + (t.message || ''); }).filter(function (s) { return !/: $/.test(s); }).join('\n');
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
    updRec(recId, { status: j.status === 'failed' ? 'failed' : 'done', outcome: outcome || 'unknown', date: date, time: time, notes: notes,
      callback: cb, summary: summary, transcript: transcript.slice(0, 6000), duration: j.metadata && j.metadata.call_duration_secs, meetingId: rec.meetingId });
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
  function ready() { var c = cfg(); return c.apiKey && c.agentId && c.phoneId; }
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
      '<div class="bx"><b>איך זה עובד?</b><br>הסוכנת הקולית רצה על <b>ElevenLabs Agents</b> — קול עברי טבעי ושיחה בזמן אמת. השיחות יוצאות דרך מספר טלפון שמחובר ל-ElevenLabs (Twilio או SIP של ספק ישראלי). ' +
      'כל התוצאות (פגישה שנקבעה/אושרה, בקשה לחזור, "לא להתקשר") נכתבות אוטומטית ל-CRM.</div>' +
      '<div class="bx"><b>שלב 1 — חשבון ומפתח</b><br>1. פתחו חשבון ב-<a href="https://elevenlabs.io/app/agents" target="_blank" style="color:var(--acc,#14b8a6)">elevenlabs.io</a> (מומלץ מנוי Creator ומעלה).<br>2. Profile → API Keys → צרו מפתח עם הרשאות ElevenAgents.</div>' +
      f('apiKey', 'מפתח API של ElevenLabs', 'sk_...', 1, 'password') +
      '<div class="bx"><b>שלב 2 — פרטי הסוכנת</b></div>' +
      '<div class="row"><div>' + f('agentName', 'שם הנציגה', 'נועה') + '</div><div>' + f('business', 'שם העסק', 'רן פיננסים') + '</div><div>' + f('owner', 'שם הסוכן', 'רן') + '</div></div>' +
      '<div class="row"><div>' + f('hours', 'שעות פגישות', '09:00-18:00', 1) + '</div><div>' + f('slotMin', 'אורך פגישה (דק׳)', '60', 1) + '</div></div>' +
      f('days', 'ימי פגישות (0=ראשון ... 4=חמישי)', '0,1,2,3,4', 1) +
      f('location', 'מיקום ברירת מחדל', 'במשרד או בזום') +
      f('voiceId', 'Voice ID (אופציונלי — קול עברי מספריית הקולות)', 'ריק = ברירת מחדל', 1) +
      '<div class="row"><button class="btn2" data-a="create">✨ צור את הסוכנת אוטומטית</button><button class="btn2 g" data-a="copyPrompt">📋 העתק פרומפט</button></div>' +
      f('agentId', 'Agent ID (נמלא אוטומטית, או הדביקו מהדשבורד)', 'agent_...', 1) +
      '<div class="bx"><b>שלב 3 — מספר טלפון</b><br>ב-ElevenLabs: Agents → Phone Numbers → Import. <br>• <b>Twilio</b> — מהיר להתחלה. <br>• <b>SIP Trunk</b> — מומלץ לישראל: מספר ישראלי (03/072) מספק כמו 019 / Voicenter / Cellcom Business, כך שהלקוח רואה מספר מקומי ועונה יותר.<br>שייכו את המספר לסוכנת והעתיקו את ה-Phone Number ID.</div>' +
      '<label>סוג חיבור</label><select data-k="trunk"><option value="twilio"' + (c.trunk === 'twilio' ? ' selected' : '') + '>Twilio</option><option value="sip"' + (c.trunk === 'sip' ? ' selected' : '') + '>SIP Trunk (ספק ישראלי)</option></select>' +
      f('phoneId', 'Phone Number ID', 'phnum_...', 1) +
      '<div class="row"><button class="btn2" data-a="saveCfg">💾 שמור</button><button class="btn2 g" data-a="test">🧪 שיחת ניסיון אליי</button></div>' +
      '<div class="wr">⚖️ <b>חשוב לדעת:</b> התקשרו רק ללקוחות קיימים שנתנו את מספרם. שיחות שיווקיות אוטומטיות ללא הסכמה אסורות לפי חוק התקשורת (סעיף 30א). הסוכנת מוגדרת לא להכחיש שהיא עוזרת דיגיטלית, ולסמן "לא להתקשר" כשמבקשים. המפתח נשמר רק במכשיר הזה.</div>';
  }

  function readCfgForm() { var c = cfg(); [].forEach.call(BD.querySelectorAll('[data-k]'), function (el) { c[el.getAttribute('data-k')] = el.value.trim(); }); setCfg(c); return c; }

  root.addEventListener('click', function (ev) {
    if (ev.target === root) return root.classList.remove('open');
    var t = ev.target.closest('[data-a],[data-tab]'); if (!t) return;
    var tb = t.getAttribute('data-tab'); if (tb) { tab = tb; return draw(); }
    var a = t.getAttribute('data-a'), id = t.getAttribute('data-id');
    if (a === 'close') root.classList.remove('open');
    else if (a === 'saveCfg') { readCfgForm(); toast('ההגדרות נשמרו'); }
    else if (a === 'create') {
      var c = readCfgForm(); if (!c.apiKey) return toast('הזינו קודם מפתח API', 1);
      t.disabled = true; t.textContent = 'יוצר...';
      createAgent().then(function (aid) { toast('הסוכנת נוצרה ✓ ' + aid); draw(); }).catch(function (e) { toast(e.message, 1); t.disabled = false; t.textContent = '✨ צור את הסוכנת אוטומטית'; });
    }
    else if (a === 'copyPrompt') {
      var txt = buildPrompt() + '\n\n---\nהודעת פתיחה: {{first_message}}\nData collection: ' + JSON.stringify(DATA_COLLECTION, null, 1);
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('הפרומפט הועתק'); }, function () { prompt('העתיקו:', txt); });
    }
    else if (a === 'test') {
      readCfgForm(); var ph = window.prompt('לאיזה מספר להתקשר לניסיון?', ''); if (!ph) return;
      startCall({ id: 'test', name: cfg().owner, phone: ph }, 'schedule', null).then(function () { toast('מחייג... ענו לטלפון 📲'); tab = 'log'; draw(); }).catch(function (e) { toast(e.message, 1); });
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
