/* רן פיננסים — עוזר AI ל-CRM (Gemini) */
(function () {
  if (window.__rmAI) return; window.__rmAI = 1;

  var KEY_LS = 'rm_gemini_key', MODEL_LS = 'rm_gemini_model';
  var DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
  var history = [];      // [{role:'user'|'model', text}]
  var pending = {};      // action cards waiting for approval
  var seq = 0;

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function getClients() { try { return clients; } catch (e) { return []; } }
  function today() { var d = new Date(); return d.toLocaleDateString('he-IL') + ' (' + d.toISOString().slice(0, 10) + ')'; }

  /* ---------- styles ---------- */
  var css = '' +
    '#rmai-fab{position:fixed;left:18px;bottom:24px;z-index:950;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;' +
    'background:linear-gradient(135deg,#14b8a6,#6366f1);color:#fff;font-size:26px;box-shadow:0 6px 22px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}' +
    '#rmai-fab:active{transform:scale(.94)}' +
    '@media (max-width:768px){#rmai-fab{bottom:calc(80px + env(safe-area-inset-bottom));left:14px;width:54px;height:54px}}' +
    '#rmai{position:fixed;z-index:10000;inset:0;background:rgba(0,0,0,.5);display:none;justify-content:flex-start;align-items:stretch}' +
    '#rmai.open{display:flex}' +
    '#rmai .p{background:var(--dark2,#0f2321);color:var(--txt,#e2e8f0);width:420px;max-width:100%;height:100%;display:flex;flex-direction:column;border-left:1px solid var(--brd2,#333);font-family:inherit}' +
    '@media (max-width:768px){#rmai .p{width:100%;border:0}}' +
    '#rmai .h{display:flex;align-items:center;gap:8px;padding:12px 14px;padding-top:calc(12px + env(safe-area-inset-top));border-bottom:1px solid var(--brd,#222);font-weight:700;font-size:16px}' +
    '#rmai .h .t{flex:1}' +
    '#rmai .h button{background:none;border:0;color:var(--txt2,#94a3b8);font-size:20px;cursor:pointer;padding:4px 6px}' +
    '#rmai .m{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}' +
    '#rmai .b{max-width:88%;padding:10px 12px;border-radius:14px;line-height:1.5;font-size:15px;white-space:pre-wrap;word-break:break-word}' +
    '#rmai .b.u{align-self:flex-start;background:var(--acc,#14b8a6);color:#04201d;border-bottom-right-radius:4px}' +
    '#rmai .b.a{align-self:flex-end;background:var(--dark3,#15302d);border-bottom-left-radius:4px}' +
    '#rmai .b.e{align-self:center;background:rgba(239,68,68,.15);color:#fca5a5;font-size:13px}' +
    '#rmai .card{align-self:flex-end;width:88%;background:var(--dark4,#1c3d39);border:1px solid var(--brd2,#333);border-radius:12px;padding:10px 12px;font-size:14px}' +
    '#rmai .card .ct{font-weight:700;margin-bottom:6px}' +
    '#rmai .card .row{color:var(--txt2,#94a3b8);font-size:13px;margin:2px 0}' +
    '#rmai .card .warn{color:#fbbf24;font-size:13px;margin-top:6px}' +
    '#rmai .card .bt{display:flex;gap:8px;margin-top:10px}' +
    '#rmai .card button{flex:1;border:0;border-radius:9px;padding:9px;font-family:inherit;font-size:14px;cursor:pointer}' +
    '#rmai .ok{background:#10b981;color:#fff}#rmai .no{background:var(--dark3,#15302d);color:var(--txt2,#94a3b8)}#rmai .go{background:var(--acc,#14b8a6);color:#04201d}' +
    '#rmai .card.done{opacity:.6}' +
    '#rmai .sug{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px}' +
    '#rmai .sug button{background:var(--dark3,#15302d);border:1px solid var(--brd2,#333);color:var(--txt,#e2e8f0);border-radius:16px;padding:6px 10px;font-size:13px;font-family:inherit;cursor:pointer}' +
    '#rmai .f{display:flex;gap:6px;align-items:flex-end;padding:10px 12px;padding-bottom:calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--brd,#222)}' +
    '#rmai textarea{flex:1;resize:none;max-height:120px;min-height:44px;border-radius:12px;border:1px solid var(--brd2,#333);background:var(--dark3,#15302d);color:var(--txt,#e2e8f0);padding:11px 12px;font-size:16px;font-family:inherit}' +
    '#rmai .ib{width:44px;height:44px;border-radius:50%;border:0;cursor:pointer;font-size:19px;flex:none;display:flex;align-items:center;justify-content:center}' +
    '#rmai .mic{background:var(--dark4,#1c3d39);color:#fff}#rmai .mic.rec{background:#ef4444;animation:rmaip 1s infinite}' +
    '#rmai .snd{background:var(--acc,#14b8a6);color:#04201d}' +
    '@keyframes rmaip{50%{box-shadow:0 0 0 8px rgba(239,68,68,.25)}}' +
    '#rmai .set{padding:16px;display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:1.6}' +
    '#rmai .set input{border-radius:10px;border:1px solid var(--brd2,#333);background:var(--dark3,#15302d);color:var(--txt,#e2e8f0);padding:11px;font-size:16px;font-family:inherit;direction:ltr}' +
    '#rmai .set a{color:var(--acc,#14b8a6)}' +
    '#rmai .set .sv{background:var(--acc,#14b8a6);color:#04201d;border:0;border-radius:10px;padding:12px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer}' +
    '#rmai .dots:after{content:"...";animation:rmaid 1s steps(3) infinite}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------- DOM ---------- */
  var fab = document.createElement('button'); fab.id = 'rmai-fab'; fab.title = 'עוזר AI'; fab.innerHTML = '✨';
  var root = document.createElement('div'); root.id = 'rmai';
  root.innerHTML =
    '<div class="p">' +
      '<div class="h"><span>✨</span><span class="t">העוזר של רן</span>' +
        '<button data-a="clear" title="שיחה חדשה">🗑️</button><button data-a="settings" title="הגדרות">⚙️</button><button data-a="close" title="סגור">✕</button></div>' +
      '<div class="m"></div>' +
      '<div class="sug"></div>' +
      '<div class="f"><button class="ib mic" data-a="cam" title="צילום ת.ז / מסמך">📷</button><button class="ib mic" data-a="mic" title="דבר">🎤</button>' +
        '<input type="file" accept="image/*" style="display:none" class="camin">' +
        '<textarea rows="1" placeholder="שאל או בקש... למשל: תוסיף לקוח חדש"></textarea>' +
        '<button class="ib snd" data-a="send" title="שלח">➤</button></div>' +
    '</div>';
  document.body.appendChild(fab); document.body.appendChild(root);
  var M = root.querySelector('.m'), TA = root.querySelector('textarea'), SUG = root.querySelector('.sug'), MIC = root.querySelector('.mic');

  var SUGGESTIONS = ['מה הטיפולים הפתוחים?', 'למי חסר טלפון?', 'תוסיף לקוח חדש', '📷 צלם ת.ז ללקוח'];
  function drawSug() {
    SUG.innerHTML = history.length ? '' : SUGGESTIONS.map(function (s) { return '<button>' + esc(s) + '</button>'; }).join('');
  }

  function add(cls, html) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; M.appendChild(d); M.scrollTop = M.scrollHeight; return d; }
  function bubble(role, text) { return add('b ' + role, esc(text)); }

  function open() { root.classList.add('open'); if (!ls(KEY_LS)) showSettings(); else { if (!M.children.length) welcome(); setTimeout(function () { TA.focus(); }, 50); } }
  function close() { root.classList.remove('open'); stopMic(); }
  function welcome() { bubble('a', 'היי רן 👋 אפשר לשאול אותי על הלקוחות, או לבקש להוסיף לקוח או טיפול. אפשר גם ללחוץ על 🎤 ולדבר.'); drawSug(); }

  function showSettings() {
    M.innerHTML = ''; SUG.innerHTML = '';
    var cur = ls(KEY_LS);
    var d = add('set', '' +
      '<b>חיבור ל-Gemini</b>' +
      '<div>כדי שהעוזר יעבוד צריך מפתח (API key) חינמי של גוגל:</div>' +
      '<div>1. היכנס ל-<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a><br>2. לחץ <b>Create API key</b> והעתק את המפתח<br>3. הדבק אותו כאן ולחץ שמור</div>' +
      '<input type="password" placeholder="הדבק כאן את המפתח (AIza...)" value="' + esc(cur) + '">' +
      '<button class="sv">שמור והתחל</button>' +
      '<div style="color:var(--txt3,#64748b);font-size:12px">המפתח נשמר רק במכשיר הזה. בכל שאלה נשלחים לגוגל פרטי הלקוחות כדי שהעוזר יוכל לענות.</div>' +
      (cur ? '<button class="no" style="border:0;border-radius:10px;padding:10px;font-family:inherit" data-x="del">מחק מפתח מהמכשיר</button>' : ''));
    d.querySelector('.sv').onclick = function () {
      var v = d.querySelector('input').value.trim();
      if (!v) return;
      ls(KEY_LS, v); M.innerHTML = ''; welcome();
    };
    var del = d.querySelector('[data-x=del]'); if (del) del.onclick = function () { ls(KEY_LS, null); ls(MODEL_LS, null); showSettings(); };
  }

  /* ---------- data for the model ---------- */
  function compactClients() {
    return getClients().map(function (c) {
      var o = { id: c.id, name: c.name };
      ['phone', 'email', 'idNum', 'birth', 'type', 'status', 'pension', 'premium', 'salary', 'source', 'renewal'].forEach(function (k) { if (c[k]) o[k] = c[k]; });
      if (c.notes) o.notes = String(c.notes).slice(0, 300);
      if (c.createdAt) o.created = String(c.createdAt).slice(0, 10);
      if (c.treatments && c.treatments.length) o.treatments = c.treatments.map(function (t) {
        var x = { id: t.id, type: t.type, detail: t.detail, stage: t.stage };
        if (t.createdAt) x.created = String(t.createdAt).slice(0, 10);
        if (t.doneAt) x.done = String(t.doneAt).slice(0, 10);
        return x;
      });
      return o;
    });
  }
  function systemPrompt() {
    return [
      'אתה העוזר האישי של רן מסיכה, סוכן פנסיה וביטוח בישראל, בתוך מערכת ה-CRM שלו. היום: ' + today() + '.',
      'ענה תמיד בעברית, קצר וענייני. השתמש רק בנתונים שלמטה. אם אין מידע — אמור זאת. אל תמציא.',
      'כשמזכירים לקוח בתשובה, כתוב את שמו המלא.',
      'החזר תמיד JSON בלבד במבנה: {"reply":"טקסט התשובה","actions":[...]}',
      'actions אפשריות (רק כשרן מבקש פעולה או כשזה עוזר):',
      '{"type":"add_client","client":{"name":"","phone":"","email":"","idNum":"","birth":"","type":"שכיר|עצמאי","status":"פעיל|ליד|לא פעיל","pension":"שם חברה","salary":"","premium":"","source":"","notes":""}}',
      '{"type":"update_client","id":<id>,"fields":{...רק שדות לשינוי}}',
      '{"type":"add_treatment","clientId":<id>,"treatType":"פנסיה|השתלמות|גמל|ריסק|בריאות|פוליסה|ניוד|אחר","detail":"מה צריך לעשות"}',
      '{"type":"complete_treatment","clientId":<id>,"treatmentId":<id>}',
      '{"type":"add_note","clientId":<id>,"text":"..."}',
      '{"type":"open_client","id":<id>}  — כדי להציג כפתור לפתיחת כרטיס לקוח',
      'כללים: לפני add_client בדוק אם כבר קיים לקוח בשם דומה וציין זאת ב-reply. אל תכלול שדות ריקים. טלפון בפורמט 05XXXXXXXX.',
      'אם חסר מידע חיוני (למשל שם) — שאל ב-reply ואל תחזיר action.',
      'כשמצורפת תמונה של תעודת זהות / ספח / רישיון נהיגה: חלץ שם פרטי ושם משפחה, מספר ת.ז (9 ספרות, השלם 0 בהתחלה אם צריך), תאריך לידה (DD/MM/YYYY), כתובת אם יש. ' +
      'בדוק אם הלקוח כבר קיים (לפי ת.ז או שם). אם קיים — החזר update_client עם idNum ו-birth בלבד, וכתובת (אם יש) כ-add_note. אם לא — החזר add_client (כתובת בתוך notes).' +
      'ב-reply סכם מה זיהית וציין אם משהו לא היה קריא. אם רן כתב הוראה נוספת עם התמונה — פעל לפיה.',
      'טיפול פתוח = stage שאינו "הושלם".',
      'שאלות כלליות על פנסיה/ביטוח מותר לענות מהידע שלך, בקצרה.',
      'נתוני הלקוחות (JSON):',
      JSON.stringify(compactClients())
    ].join('\n');
  }

  /* ---------- Gemini ---------- */
  function callGemini(model) {
    var key = ls(KEY_LS);
    var body = {
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents: history.slice(-12).map(function (h) {
        var parts = [{ text: h.text }];
        if (h.img) parts.unshift({ inlineData: { mimeType: 'image/jpeg', data: h.img } });
        return { role: h.role, parts: parts };
      }),
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
    };
    return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    });
  }
  function ask(text, img) {
    history.push(img ? { role: 'user', text: text, img: img } : { role: 'user', text: text });
    var wait = add('b a', '<span class="dots">חושב</span>');
    var models = ls(MODEL_LS) ? [ls(MODEL_LS)] : DEFAULT_MODELS.slice();
    function tryNext() {
      var model = models.shift();
      return callGemini(model).then(function (res) {
        if (!res.ok) {
          if ((res.status === 404 || res.status === 400 && /model/i.test(JSON.stringify(res.j))) && models.length) return tryNext();
          var msg = (res.j && res.j.error && res.j.error.message) || ('שגיאה ' + res.status);
          if (res.status === 400 && /API key/i.test(msg)) msg = 'המפתח לא תקין. לחץ ⚙️ והדבק מפתח חדש.';
          if (res.status === 429) msg = 'עברת את מכסת השימוש של גוגל לרגע. נסה שוב בעוד דקה.';
          throw new Error(msg);
        }
        if (!ls(MODEL_LS)) ls(MODEL_LS, model);
        var raw = ((((res.j.candidates || [])[0] || {}).content || {}).parts || []).map(function (p) { return p.text || ''; }).join('');
        return raw;
      });
    }
    tryNext().then(function (raw) {
      wait.remove();
      var data;
      try { data = JSON.parse(raw); } catch (e) { var m = raw.match(/\{[\s\S]*\}/); try { data = m ? JSON.parse(m[0]) : null; } catch (e2) { data = null; } }
      if (!data) data = { reply: raw || 'לא התקבלה תשובה', actions: [] };
      history.forEach(function (h) { if (h.img) delete h.img; }); // התמונה נשלחת פעם אחת בלבד
      history.push({ role: 'model', text: raw });
      bubble('a', data.reply || '✓');
      (data.actions || []).forEach(renderAction);
    }).catch(function (err) {
      wait.remove(); history.pop();
      add('b e', esc(err.message || 'שגיאת תקשורת'));
    });
  }

  /* ---------- actions ---------- */
  function findClient(id) { var n = Number(id); return getClients().filter(function (c) { return c.id == id || c.id === n; })[0]; }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  var LABELS = { name: 'שם', phone: 'טלפון', email: 'מייל', idNum: 'ת.ז', birth: 'ת. לידה', type: 'סוג', status: 'סטטוס', pension: 'חברה', salary: 'שכר', premium: 'פרמיה', source: 'מקור', notes: 'הערות', renewal: 'חידוש' };
  function rows(o) { return Object.keys(o || {}).filter(function (k) { return o[k] !== '' && o[k] != null; }).map(function (k) { return '<div class="row">' + esc(LABELS[k] || k) + ': ' + esc(o[k]) + '</div>'; }).join(''); }

  function renderAction(a) {
    if (!a || !a.type) return;
    var id = 'p' + (++seq), title = '', body = '', warn = '', c;
    if (a.type === 'open_client') {
      c = findClient(a.id); if (!c) return;
      var d = add('card', '<div class="ct">👤 ' + esc(c.name) + '</div><div class="bt"><button class="go">פתח כרטיס לקוח</button></div>');
      d.querySelector('.go').onclick = function () { close(); try { showProfile(c.id); } catch (e) { } };
      return;
    }
    if (a.type === 'add_client') {
      var cl = a.client || {}; if (!norm(cl.name)) return;
      title = '➕ הוספת לקוח חדש'; body = rows(cl);
      var dup = getClients().filter(function (x) { return norm(x.name) === norm(cl.name) || (cl.phone && String(x.phone || '').replace(/\D/g, '').slice(-9) === String(cl.phone).replace(/\D/g, '').slice(-9)); });
      if (dup.length) warn = '⚠️ כבר קיים לקוח דומה: ' + dup.map(function (x) { return x.name + (x.phone ? ' (' + x.phone + ')' : ''); }).join(', ');
    } else if (a.type === 'update_client') {
      c = findClient(a.id); if (!c) return; title = '✏️ עדכון ' + c.name; body = rows(a.fields);
    } else if (a.type === 'add_treatment') {
      c = findClient(a.clientId); if (!c) return; title = '🗂️ טיפול חדש ל' + c.name; body = rows({ type: a.treatType || 'אחר', notes: a.detail });
    } else if (a.type === 'complete_treatment') {
      c = findClient(a.clientId); if (!c) return;
      var t = (c.treatments || []).filter(function (x) { return x.id == a.treatmentId; })[0]; if (!t) return;
      title = '✓ סגירת טיפול של ' + c.name; body = '<div class="row">' + esc(t.type + ' · ' + t.detail) + '</div>';
    } else if (a.type === 'add_note') {
      c = findClient(a.clientId); if (!c) return; title = '📝 הערה ל' + c.name; body = '<div class="row">' + esc(a.text) + '</div>';
    } else return;
    pending[id] = a;
    var card = add('card', '<div class="ct">' + esc(title) + '</div>' + body + (warn ? '<div class="warn">' + esc(warn) + '</div>' : '') +
      '<div class="bt"><button class="ok">✅ אשר</button><button class="no">ביטול</button></div>');
    card.querySelector('.ok').onclick = function () { var r = execute(pending[id]); delete pending[id]; card.classList.add('done'); card.querySelector('.bt').innerHTML = '<div class="row">' + esc(r) + '</div>'; };
    card.querySelector('.no').onclick = function () { delete pending[id]; card.classList.add('done'); card.querySelector('.bt').innerHTML = '<div class="row">בוטל</div>'; };
  }

  function refresh() {
    ['updateCounts', 'renderDashboard', 'renderClients'].forEach(function (f) { try { if (typeof window[f] === 'function') window[f](); } catch (e) { } });
  }
  function execute(a) {
    var cs = getClients(), c, now = new Date().toISOString();
    try {
      if (a.type === 'add_client') {
        var n = { name: '', phone: '', email: '', type: 'שכיר', status: 'פעיל', pension: '', premium: '', salary: '', source: 'עוזר AI', renewal: '', notes: '', idNum: '', birth: '', products: [], treatments: [] };
        Object.keys(a.client || {}).forEach(function (k) { if (k in n && typeof n[k] === 'string') n[k] = String(a.client[k]); });
        n.name = norm(n.name); n.id = Date.now(); n.createdAt = now;
        cs.push(n); save(); refresh();
        history.push({ role: 'user', text: '[המערכת: הלקוח ' + n.name + ' נוסף עם id ' + n.id + ']' });
        return '✓ נוסף: ' + n.name;
      }
      if (a.type === 'update_client') {
        c = findClient(a.id); Object.keys(a.fields || {}).forEach(function (k) { if (LABELS[k]) c[k] = String(a.fields[k]); });
        save(); refresh(); return '✓ עודכן';
      }
      if (a.type === 'add_treatment') {
        c = findClient(a.clientId); if (!c.treatments) c.treatments = [];
        c.treatments.push({ id: (typeof _newTid === 'function' ? _newTid() : Date.now() * 1000), type: a.treatType || 'אחר', detail: a.detail || '', stage: 'בטיפול', createdAt: now });
        save(); refresh(); return '✓ הטיפול נוסף';
      }
      if (a.type === 'complete_treatment') {
        c = findClient(a.clientId); var t = (c.treatments || []).filter(function (x) { return x.id == a.treatmentId; })[0];
        t.stage = 'הושלם'; t.doneAt = now; save(); refresh(); return '✓ הטיפול נסגר';
      }
      if (a.type === 'add_note') {
        c = findClient(a.clientId); var stamp = new Date().toLocaleDateString('he-IL');
        c.notes = (c.notes ? c.notes + ' | ' : '') + stamp + ': ' + a.text; save(); refresh(); return '✓ ההערה נשמרה';
      }
    } catch (e) { return 'שגיאה: ' + e.message; }
    return '';
  }

  /* ---------- voice ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, recOn = false;
  function stopMic() { if (rec && recOn) { try { rec.stop(); } catch (e) { } } recOn = false; MIC.classList.remove('rec'); }
  function startMic() {
    if (!SR) { add('b e', 'הדפדפן הזה לא תומך בזיהוי דיבור. אפשר ללחוץ על 🎤 שבמקלדת של הטלפון ולהכתיב.'); TA.focus(); return; }
    rec = new SR(); rec.lang = 'he-IL'; rec.interimResults = true; rec.continuous = false;
    var finalText = '';
    rec.onresult = function (e) {
      var interim = ''; for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript; }
      TA.value = (finalText + interim).trim();
    };
    rec.onerror = function (e) { stopMic(); if (e.error === 'not-allowed') add('b e', 'צריך לאשר גישה למיקרופון בהגדרות הדפדפן.'); };
    rec.onend = function () { var was = recOn; stopMic(); if (was && TA.value.trim()) send(); };
    try { rec.start(); recOn = true; MIC.classList.add('rec'); } catch (e) { stopMic(); }
  }

  /* ---------- photo (ID card) ---------- */
  var CAM = root.querySelector('.camin');
  function shrink(file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var im = new Image();
      im.onload = function () {
        var max = 1600, w = im.width, h = im.height, s = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas'); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        cb(cv.toDataURL('image/jpeg', 0.85));
      };
      im.onerror = function () { add('b e', 'לא הצלחתי לקרוא את התמונה'); };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  }
  CAM.addEventListener('change', function () {
    var f = CAM.files && CAM.files[0]; CAM.value = ''; if (!f) return;
    if (!ls(KEY_LS)) { showSettings(); return; }
    shrink(f, function (dataUrl) {
      var note = TA.value.trim(); TA.value = ''; SUG.innerHTML = '';
      var b = add('b u', '<img src="' + dataUrl + '" style="max-width:100%;border-radius:10px;display:block">' + (note ? '<div style="margin-top:6px">' + esc(note) + '</div>' : ''));
      ask(note || 'זו תמונה של תעודת זהות או מסמך של לקוח. חלץ את הפרטים ועדכן את ה-CRM.', dataUrl.split(',')[1]);
    });
  });

  function send() {
    var v = TA.value.trim(); if (!v) return;
    if (!ls(KEY_LS)) { showSettings(); return; }
    TA.value = ''; TA.style.height = ''; SUG.innerHTML = '';
    bubble('u', v); ask(v);
  }

  /* ---------- events ---------- */
  fab.onclick = open;
  root.addEventListener('click', function (e) {
    if (e.target === root) { close(); return; }
    var b = e.target.closest('[data-a]'); if (b) {
      var a = b.getAttribute('data-a');
      if (a === 'close') close();
      else if (a === 'settings') showSettings();
      else if (a === 'clear') { history = []; pending = {}; M.innerHTML = ''; if (ls(KEY_LS)) welcome(); else showSettings(); }
      else if (a === 'send') send();
      else if (a === 'mic') { recOn ? stopMic() : startMic(); }
      else if (a === 'cam') { CAM.click(); }
      return;
    }
    var s = e.target.closest('.sug button'); if (s) { if (s.textContent.indexOf('📷') === 0) { CAM.click(); return; } TA.value = s.textContent; send(); }
  });
  TA.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  TA.addEventListener('input', function () { TA.style.height = 'auto'; TA.style.height = Math.min(TA.scrollHeight, 120) + 'px'; });
})();
