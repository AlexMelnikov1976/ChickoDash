// ═══ API CONFIG v6.1 (Phase 2.4d: cookie-based auth, JWT не хранится в JS) ═══
const API_BASE = location.origin;

// Phase 2.4d: email залогиненного пользователя. Заполняется в bootAuth из
// ответов /api/auth/verify или /api/auth/me. Заменяет старый JWT-decode
// в fbGetEmail — JWT теперь в HttpOnly cookie и недоступен из JS.
let USER_EMAIL = '';

// Phase 2.4d (2026-04-21): session теперь в HttpOnly cookie chicko_session,
// JavaScript её не видит — XSS не сможет украсть токен. Одноразовая уборка
// legacy-ключа из localStorage (безопасная: в худшем случае ключ не существует).
try { localStorage.removeItem('chicko_jwt'); } catch (e) {}

function showLogin() {
  const scr = document.getElementById('login-screen');
  if (scr) scr.classList.remove('hidden');
}
function hideLogin() {
  const scr = document.getElementById('login-screen');
  if (scr) scr.classList.add('hidden');
}

// Global logout helper — доступен из консоли и для будущей UI-кнопки.
// Отправляет POST /api/auth/logout (сервер вернёт Set-Cookie с Max-Age=0),
// после чего перезагружает страницу → bootAuth увидит 401 → покажет login.
window.logout = async function() {
  try {
    await fetch(API_BASE + '/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
  } catch (e) { /* продолжаем перезагрузку в любом случае */ }
  location.reload();
};

// Низкоуровневый GET. Cookie прикладывается автоматически (credentials:'include').
// 401 → сессия истекла или её нет → показываем login-экран.
async function apiGet(path) {
  const r = await fetch(API_BASE + path, {
    credentials: 'include'
  });
  if (r.status === 401) {
    showLogin();
    throw new Error('Session expired');
  }
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.message || j.error || ('HTTP ' + r.status));
  return j;
}

// GET /api/restaurants?full_history=0|1 — список ресторанов + ts
async function apiRestaurants(fullHistory) {
  const j = await apiGet('/api/restaurants?full_history=' + (fullHistory ? '1' : '0'));
  return j.data || [];
}

// GET /api/benchmarks?start=...&end=... — медианы сети и топ-10% за период
async function apiBenchmarks(startDate, endDate) {
  return await apiGet('/api/benchmarks?start=' + encodeURIComponent(startDate) + '&end=' + encodeURIComponent(endDate));
}

// GET /api/restaurant-meta?restaurant_id=N — score и рекомендации по точке
async function apiRestaurantMeta(restId) {
  return await apiGet('/api/restaurant-meta?restaurant_id=' + restId);
}

// ═══ Login form handler (Phase 2.4d fix #77) ═══
function handleLoginSubmit(e) {
  e.preventDefault();
  var email = document.getElementById('loginEmail').value.trim().toLowerCase();
  var btn = document.getElementById('loginBtn');
  var msg = document.getElementById('loginMsg');
  if (!email || !email.includes('@')) {
    msg.textContent = 'Введите корректный email';
    msg.className = 'login-msg error';
    return false;
  }
  btn.disabled = true;
  btn.textContent = 'Отправляем...';
  msg.textContent = '';
  fetch(API_BASE + '/api/auth/request-link', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email })
  }).then(function(r) {
    if (r.status === 429) {
      msg.textContent = 'Слишком часто. Попробуйте через минуту.';
      msg.className = 'login-msg error';
    } else {
      msg.textContent = 'Если email зарегистрирован — ссылка отправлена. Проверьте почту.';
      msg.className = 'login-msg success';
    }
  }).catch(function(err) {
    msg.textContent = 'Ошибка: ' + err.message;
    msg.className = 'login-msg error';
  }).finally(function() {
    btn.disabled = false;
    btn.textContent = 'Получить ссылку';
  });
  return false;
}

// ═══ AI Insight (Phase 2.6) ═══
function requestAiInsight() {
  var btn = document.getElementById('aiBtn');
  var box = document.getElementById('aiResult');
  if (!btn || !box || !R) return;
  btn.disabled = true;
  btn.textContent = 'Анализирую...';
  box.innerHTML = '<div class="ai-loading"><div class="ai-spinner"></div>AI анализирует KPI — 5-10 секунд...</div>';
  trackUI('ai_insight', { restaurant_id: R.id });

  var ts = getGlobalTs();
  var rev = safeAvg(ts,'revenue') || 0;
  var fc = safeAvg(ts,'foodcost') || 0;
  var cnt = safeAvg(ts,'checks') || 0;
  var chk = safeAvg(ts,'avgCheck') || 0;
  var disc = safeAvg(ts,'discount') || 0;
  var dp = safeAvg(ts,'deliveryPct') || 0;

  // YoY growth
  var yoyStart = (parseInt(S.globalStart.slice(0,4))-1) + S.globalStart.slice(4);
  var yoyEnd = (parseInt(S.globalEnd.slice(0,4))-1) + S.globalEnd.slice(4);
  var tsYoy = R.ts.filter(function(t){ return t.date>=yoyStart && t.date<=yoyEnd && t.revenue>0; });
  var yoyRev = tsYoy.length>=7 ? safeAvg(tsYoy,'revenue') : rev;
  var yoyCnt = tsYoy.length>=7 ? safeAvg(tsYoy,'checks') : cnt;
  var yoyChk = tsYoy.length>=7 ? safeAvg(tsYoy,'avgCheck') : chk;

  var detail = _calcRestScoreDetail(R);
  var allScores = RESTS.map(function(r2){ return _calcRestScore(r2); }).filter(function(s){ return s>0; }).sort(function(a,b){ return b-a; });
  var myScore = detail ? detail.score : 0;
  var myRank = allScores.indexOf(myScore) + 1 || 1;

  var payload = {
    restaurant: R.name,
    city: R.city || '',
    period: S.globalStart + ' — ' + S.globalEnd,
    kpi: {
      revenue: rev, avgCheck: chk, checks: cnt,
      foodcost: fc, discount: disc, deliveryPct: dp,
      score: myScore, rank: myRank, rankTotal: allScores.length
    },
    growth: {
      revVsYoy: yoyRev > 0 ? (rev/yoyRev - 1) * 100 : 0,
      checksVsYoy: yoyCnt > 0 ? (cnt/yoyCnt - 1) * 100 : 0,
      checkVsYoy: yoyChk > 0 ? (chk/yoyChk - 1) * 100 : 0
    },
    net: {
      revenue: NET.revenue || 0, avgCheck: NET.avgCheck || 0,
      checks: NET.checks || 0, foodcost: NET.foodcost || 0,
      discount: NET.discount || 0
    }
  };

  fetch(API_BASE + '/api/ai-insight', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(data) {
    if (data.error) {
      box.innerHTML = '<span style="color:var(--red)">Ошибка: ' + data.error + '</span>';
      return;
    }
    var html = '';
    if (data.operations) html += '<div class="ai-block"><div class="ai-block-title">' + (data.operations.emoji||'') + ' ' + (data.operations.title||'') + '</div><div class="ai-block-text">' + data.operations.text + '</div></div>';
    if (data.finance) html += '<div class="ai-block"><div class="ai-block-title">' + (data.finance.emoji||'') + ' ' + (data.finance.title||'') + '</div><div class="ai-block-text">' + data.finance.text + '</div></div>';
    if (data.commercial) html += '<div class="ai-block"><div class="ai-block-title">' + (data.commercial.emoji||'') + ' ' + (data.commercial.title||'') + '</div><div class="ai-block-text">' + data.commercial.text + '</div></div>';
    if (data.actions && data.actions.length) {
      html += '<div class="ai-actions"><div class="ai-actions-title">\u{1F3AF} Действия на неделю</div>';
      data.actions.forEach(function(a) { html += '<div class="ai-action-item">' + a + '</div>'; });
      html += '</div>';
    }
    box.innerHTML = html || '<span style="color:var(--text3)">AI не вернул структурированный ответ</span>';
  }).catch(function(err) {
    box.innerHTML = '<span style="color:var(--red)">Ошибка: ' + err.message + '</span>';
  }).finally(function() {
    btn.disabled = false;
    btn.textContent = 'Запросить анализ';
  });
}

// ═══ UI Activity tracker (Phase 2.5) ═══
function trackUI(action, extra) {
  try {
    fetch(API_BASE + '/api/activity', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, extra || {}))
    }).catch(function(){});
  } catch(_e) {}
}

// ═══ Auth flow on page load (Phase 2.4d: cookie-based) ═══
(async function bootAuth() {
  const url = new URL(location.href);
  const loginToken = url.searchParams.get('login_token');

  // Пришли из magic-link callback — обмениваем login_token на session cookie.
  if (loginToken) {
    try {
      const r = await fetch(API_BASE + '/api/auth/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: loginToken })
      });
      const j = await r.json();
      if (!j.success) {
        showLogin();
        return;
      }
      if (j.email) USER_EMAIL = j.email;
      // Cookie установился через Set-Cookie. Убираем login_token из URL.
      trackUI('login');
      url.searchParams.delete('login_token');
      history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch (e) {
      showLogin();
      return;
    }
  }

  // HttpOnly cookie не виден из JS, поэтому спрашиваем у сервера.
  // /api/auth/me → 200 = залогинен, 401 = нет.
  try {
    const r = await fetch(API_BASE + '/api/auth/me', {
      credentials: 'include'
    });
    if (r.ok) {
      try {
        const data = await r.json();
        if (data && data.email) USER_EMAIL = data.email;
      } catch (e) { /* non-JSON 200 не ожидается, но не падаем */ }
      hideLogin();
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
})();

let RESTS = [];
// NET и TOP10 — значения по сети. Заполняются динамически через loadNetworkBenchmarks()
// за тот же период что выбран пользователем (см. решение паспорта 5.25).
// Начальные дефолты — только на случай если запрос не вернёт данных.
let NET   = { revenue: 0, avgCheck: 0, checks: 0, foodcost: 0, discount: 0, deliveryPct: 0, restCount: 0 };
let TOP10 = { revenue: 0, avgCheck: 0, foodcost: 0, discount: 0, deliveryPct: 0 };

// DOW-профили: like-for-like сравнения. Загружаются один раз при старте
// и при смене выбранного ресторана. Окно — 90 дней.
// NET_DOW[1..7] — профиль сети по дням недели (1=Пн..7=Вс, ISO).
// MY_DOW[1..7]  — профиль текущего ресторана по дням недели.
// В каждом элементе: {rev_p50, rev_p75, chk_p50, chk_p75, cnt_p50, fc_p50, fc_p25, disc_p50, disc_p25, del_p50, del_p75, n}
// n — число точек данных (дней) в расчёте, для fallback'а.
let NET_DOW = {};
let MY_DOW  = {};
let MY_DOW_DAYS = 0; // всего дней истории у текущего ресторана (для фоллбэка <14 → скрываем "вашу норму")
let ALL_DATES = [];
let MIN_DATE = '';
let MAX_DATE = '';
let RESTAURANT_SCORE = null;
let RESTAURANT_RECS  = [];

// ═══ STATE ═══
const S = {
  restIdx: 0,
  globalStart: '', globalEnd: '',
  dynStart: '',    dynEnd: '',
  cmpStart: '',    cmpEnd: '',
  dynGroup: 'day',
  cmpGroup: 'day',
  revMetric: 'revenue', dowMetric: 'revenue', dowFilter: 'all', compMetric: 'revenue',
  // #76 v4 (21.04.2026): calc фокусируется только на выручке. Фудкост ушёл
  // в отдельную P&L-вкладку (после 1С-интеграции). Остались chk / cnt / disc
  // для каждого из сценариев (будни / выходные).
  plWdChk: 0, plWdCnt: 0, plWdDisc: 0,
  plWeChk: 0, plWeCnt: 0, plWeDisc: 0,
};
let R = null;
const CHS = {};
const COMP_COLORS=['#D4A84B','#1ABC9C','#9B59B6','#F39C12','#E74C3C'];
const N_COMP=5;
const DOW_NAMES=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const DOW_EN=['sun','mon','tue','wed','thu','fri','sat'];
const CHART_OPTS={responsive:true,maintainAspectRatio:false,
  plugins:{legend:{labels:{color:'#8AAACE',font:{size:9},boxWidth:10}}},
  scales:{
    x:{grid:{color:'rgba(46,64,104,.4)'},ticks:{color:'#4E6A90',font:{size:9}}},
    y:{grid:{color:'rgba(46,64,104,.4)'},ticks:{color:'#4E6A90',font:{size:9}}}
  }
};
const CAL_STATE = {};


// ═══ SEARCHABLE SELECTOR ═══
let _selOpen = false;
function buildSelList(list, query='') {
  const ul = document.getElementById('selList');
  const cnt = document.getElementById('selCount');
  if (!ul) return;
  const q = query.toLowerCase();
  const filtered = q ? list.filter(r => (r.name+r.city).toLowerCase().includes(q)) : list;
  ul.innerHTML = filtered.map((r,i) => {
    const idx = RESTS.indexOf(r);
    const isActive = R && r.name === R.name;
    return `<div class="sel-item${isActive?' active':''}" onclick="pickRest(${idx})">
      <span style="font-weight:500;color:var(--text)">${r.city}</span>
      <span class="sel-city" style="flex:1;text-align:right">${r.name.replace('Чико (','').replace(')','').replace('Чико Рико ','Рико ').slice(0,24)}</span>
    </div>`;
  }).join('');
  if (cnt) cnt.textContent = filtered.length + ' из ' + RESTS.length + ' ресторанов';
}
function toggleSelDropdown() {
  const dd = document.getElementById('selDropdown');
  _selOpen = !_selOpen;
  dd.classList.toggle('open', _selOpen);
  if (_selOpen) {
    setTimeout(()=>document.getElementById('selFilter')?.focus(), 50);
  }
}
function filterSel(q) {
  buildSelList(RESTS, q);
}
function pickRest(idx) {
  const dd = document.getElementById('selDropdown');
  _selOpen = false;
  dd.classList.remove('open');
  const inp = document.getElementById('selSearch');
  if (inp) {
    const r = RESTS[idx];
    inp.value = r.city;
  }
  document.getElementById('selFilter').value = '';
  buildSelList(RESTS);
  selectRest(idx);
}
document.addEventListener('click', e => {
  if (!e.target.closest('#selWrap')) {
    const dd = document.getElementById('selDropdown');
    if (dd) { dd.classList.remove('open'); _selOpen = false; }
  }
});


// ═══ INIT (async) ═══
function showLoader(msg) {
  let el = document.getElementById('ck-loader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ck-loader';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(7,9,14,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;gap:14px;font-family:Inter,sans-serif';
    el.innerHTML = '<div style="width:40px;height:40px;border:3px solid #2E4068;border-top-color:#D4A84B;border-radius:50%;animation:spin .8s linear infinite"></div><div id="ck-msg" style="color:#8AAACE;font-size:13px"></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);
  }
  document.getElementById('ck-msg').textContent = msg || '';
}
function hideLoader() { const el=document.getElementById('ck-loader'); if(el) el.remove(); }

async function init() {
  // Phase 2.4d: guard !getJWT() убран — HttpOnly cookie невидима для JS.
  // bootAuth уже показал login-экран если сессии нет. Если всё же сюда
  // попали без сессии, первый apiGet вернёт 401 → showLogin → throw.
  showLoader('Подключение к данным...');
  try {
    showLoader('Загрузка истории с 2024 года...');
    const rows = await apiRestaurants(false);
    const restMap = {};
    for (const row of rows) {
      const id = row.dept_id;
      if (!restMap[id]) restMap[id] = { id:+id, name:row.restaurant_name, city:row.city, ts:[] };
      if(+row.is_anomaly_day!==1) restMap[id].ts.push({ date:row.report_date_str, revenue:+row.revenue_total_rub||0, bar:+row.revenue_bar_rub||0, kitchen:+row.revenue_kitchen_rub||0, delivery:+row.revenue_delivery_rub||0, avgCheck:+row.avg_check_total_rub||0, checks:+row.checks_total||0, itemsPerCheck:0, foodcost:+row.foodcost_total_pct||0, discount:+row.discount_total_pct||0, deliveryPct:+row.delivery_share_pct||0 });
    }
    RESTS = Object.values(restMap).filter(r=>r.ts.length>0).sort((a,b)=>a.city.localeCompare(b.city,'ru')||a.name.localeCompare(b.name,'ru'));
    for (const r of RESTS) {
      const last=r.ts[r.ts.length-1];
      r.revenue=last.revenue; r.bar=last.bar; r.kitchen=last.kitchen; r.delivery=last.delivery;
      r.avgCheck=last.avgCheck; r.checks=last.checks; r.itemsPerCheck=0;
      r.foodcost=last.foodcost; r.discount=last.discount;
      const revs=r.ts.map(t=>t.revenue).filter(v=>v>0);
      r.avgRevenue=revs.length?revs.reduce((a,b)=>a+b,0)/revs.length:0;
      r.avgRevenue7=revs.slice(-7).length?revs.slice(-7).reduce((a,b)=>a+b,0)/revs.slice(-7).length:0;
    }
    // Сетевые бенчмарки грузятся отдельной функцией чуть ниже, после установки
    // глобального периода из ALL_DATES. Оставляем NET/TOP10 нулевыми до того момента.
    ALL_DATES=[...new Set(RESTS.flatMap(r=>r.ts.map(t=>t.date)))].sort();
    MIN_DATE=ALL_DATES[0]||''; MAX_DATE=ALL_DATES[ALL_DATES.length-1]||'';
    S.globalStart=S.dynStart=S.cmpStart=MIN_DATE;
    S.globalEnd=S.dynEnd=S.cmpEnd=MAX_DATE;
    // Загружаем бенчмарки сети за тот же период что у точки (решение паспорта 5.25)
    showLoader('Расчёт показателей по сети...');
    await loadNetworkBenchmarks(S.globalStart, S.globalEnd);
    // Populate hidden select for compat
    const sel=document.getElementById('mainSel');
    sel.innerHTML='';
    RESTS.forEach((r,i)=>sel.add(new Option(r.name+' ('+r.city+')',i)));
    // Build searchable list
    buildSelList(RESTS);
    buildCompSlots(); buildCalendars();
    hideLoader();
    selectRest(0);
    // Тихая фоновая загрузка истории с 2024 через 2 сек после старта
    setTimeout(()=>loadFullHistory(true), 2000);
  } catch(e) {
    hideLoader();
    document.body.innerHTML+='<div style="position:fixed;inset:0;background:#0D1420;display:flex;align-items:center;justify-content:center;color:#E74C3C;font-size:14px;font-family:Inter,sans-serif;z-index:9999">Ошибка: '+e.message+'</div>';
    console.error(e);
  }
}


async function loadFullHistory(silent=false) {
  const btn = document.getElementById('loadHistBtn');
  if (btn) { btn.textContent = '⏳ Загрузка...'; btn.disabled = true; }
  try {
    if(!silent) showLoader('Загрузка истории с 2024 года...');
    const rows = await apiRestaurants(true);
    const restMap = {};
    for (const row of rows) {
      const id = row.dept_id;
      if (!restMap[id]) restMap[id] = { id:+id, name:row.restaurant_name, city:row.city, ts:[] };
      if(+row.is_anomaly_day!==1) restMap[id].ts.push({ date:row.report_date_str, revenue:+row.revenue_total_rub||0, bar:+row.revenue_bar_rub||0, kitchen:+row.revenue_kitchen_rub||0, delivery:+row.revenue_delivery_rub||0, avgCheck:+row.avg_check_total_rub||0, checks:+row.checks_total||0, itemsPerCheck:0, foodcost:+row.foodcost_total_pct||0, discount:+row.discount_total_pct||0, deliveryPct:+row.delivery_share_pct||0 });
    }
    // Merge into existing RESTS (update ts for each)
    for (const id in restMap) {
      const existing = RESTS.find(r => r.id === +id);
      if (existing) existing.ts = restMap[id].ts;
    }
    ALL_DATES = [...new Set(RESTS.flatMap(r => r.ts.map(t => t.date)))].sort();
    MIN_DATE = ALL_DATES[0] || '';
    buildCalendars();
    if(!silent) hideLoader();
    if (btn) { btn.textContent = '✅ История загружена (2024–)'; btn.disabled = true; btn.style.color='var(--green)'; }
    const tsEl=document.getElementById('dataTsVal');
    if(tsEl&&MIN_DATE) {
      const d=new Date(MIN_DATE);
      tsEl.title='Данные с '+d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
    }
    renderAll();
  } catch(e) {
    if(!silent) hideLoader();
    if (btn) { btn.textContent = '❌ Ошибка загрузки'; btn.disabled = false; }
  }
}

async function selectRest(idx) {
  // Сбрасываем режим «Вся сеть» при выборе ресторана
  if (NETWORK_MODE) {
    NETWORK_MODE = false;
    const cb = document.getElementById('netCb'); if (cb) cb.checked = false;
    const sw = document.getElementById('selWrap'); if (sw) { sw.style.opacity='1'; sw.style.pointerEvents='auto'; }
  }
  R = RESTS[parseInt(idx)];
  S.restIdx = parseInt(idx);
  document.getElementById('mainSel').value = idx;
  // Синхронизируем первый слот Сравнения с выбранным рестораном
  const cs0 = document.getElementById('cs0'); if (cs0) cs0.value = idx;
  const inp = document.getElementById('selSearch');
  if (inp && R) inp.value = R.city;
  buildSelList(RESTS);
  RESTAURANT_SCORE = null; RESTAURANT_RECS = [];
  if (typeof invalidateMenuCache === 'function') invalidateMenuCache();
  renderAll();
  // Загружаем DOW-профили для like-for-like сравнений (сеть + мой ресторан, 90 дней).
  // Делаем это в фоне — первый renderAll уже прошёл с NET/TOP10 из loadNetworkBenchmarks,
  // а после загрузки DOW просто перерисуем заново.
  if (R && R.id) {
    loadDowProfiles(R.id).then(()=>{ try { renderAll(); } catch(e) { console.error('[dow-rerender]', e); }});
  }
  if (R && R.id) {
    try {
      const meta = await apiRestaurantMeta(R.id);
      if (meta.score) RESTAURANT_SCORE = meta.score;
      RESTAURANT_RECS = meta.recommendations || [];
      renderScore(); renderInsights();
    } catch(e) { console.warn('Score/recs:', e.message); }
  }
}

// ═══ NETWORK VIEW (Вся сеть) ═══
let NETWORK_MODE = false;
let SAVED_R = null; // сохраняем выбранный ресторан при переключении

function buildNetworkR() {
  // Агрегируем все рестораны в виртуальный R
  const dateMap = {};
  for (const rest of RESTS) {
    for (const t of rest.ts) {
      if (!dateMap[t.date]) dateMap[t.date] = { date:t.date, revenue:0, bar:0, kitchen:0, delivery:0, checks:0, avgCheck:0, foodcost_w:0, discount_w:0, deliveryPct:0, itemsPerCheck:0 };
      const d = dateMap[t.date];
      d.revenue += t.revenue;
      d.bar += t.bar||0;
      d.kitchen += t.kitchen||0;
      d.delivery += t.delivery||0;
      d.checks += t.checks||0;
      d.foodcost_w += (t.foodcost||0) * t.revenue; // взвешиваем по выручке
      d.discount_w += (t.discount||0) * t.revenue;
    }
  }
  const ts = Object.values(dateMap).map(d => ({
    date: d.date,
    revenue: d.revenue,
    bar: d.bar,
    kitchen: d.kitchen,
    delivery: d.delivery,
    checks: d.checks,
    avgCheck: d.checks > 0 ? d.revenue / d.checks : 0,
    foodcost: d.revenue > 0 ? d.foodcost_w / d.revenue : 0,
    discount: d.revenue > 0 ? d.discount_w / d.revenue : 0,
    deliveryPct: d.revenue > 0 ? d.delivery / d.revenue * 100 : 0,
    itemsPerCheck: 0,
  })).sort((a,b) => a.date.localeCompare(b.date));

  const last = ts[ts.length-1] || {};
  return {
    id: 0,
    name: 'Вся сеть',
    city: RESTS.length + ' ресторанов',
    ts,
    revenue: last.revenue||0,
    bar: last.bar||0,
    kitchen: last.kitchen||0,
    delivery: last.delivery||0,
    avgCheck: last.avgCheck||0,
    checks: last.checks||0,
    foodcost: last.foodcost||0,
    discount: last.discount||0,
    itemsPerCheck: 0,
  };
}

function toggleNetworkView(on) {
  NETWORK_MODE = on;
  const selWrap = document.getElementById('selWrap');
  const inp = document.getElementById('selSearch');

  if (on) {
    SAVED_R = R;
    R = buildNetworkR();
    if (selWrap) selWrap.style.opacity = '0.35';
    if (selWrap) selWrap.style.pointerEvents = 'none';
    if (inp) inp.value = 'Вся сеть';
    // Для сети используем NET_DOW, MY_DOW обнуляем
    MY_DOW = {}; MY_DOW_DAYS = 0;
    RESTAURANT_SCORE = null; RESTAURANT_RECS = [];
  } else {
    if (SAVED_R) R = SAVED_R;
    SAVED_R = null;
    if (selWrap) selWrap.style.opacity = '1';
    if (selWrap) selWrap.style.pointerEvents = 'auto';
    if (inp && R) inp.value = R.city;
    // Перезагружаем DOW-профили для ресторана
    if (R && R.id) {
      loadDowProfiles(R.id).then(()=>{ try { renderAll(); } catch(e) { console.error(e); }});
    }
  }
  renderAll();
}


// ═══ Сетевые бенчмарки (динамические перцентили за текущий период) ═══
//
// Phase 2.3 (2026-04-21): SQL-агрегация перенесена на сервер (/api/benchmarks).
// Клиент передаёт только даты периода, сервер возвращает готовые NET и TOP10.
//
// В TOP10 сервер отдаёт p90 (выручка, avgCheck) и p25 (foodcost, discount —
// там "меньше = лучше"), чтобы семантика "лидеры" / "среднее" сохранилась.
async function loadNetworkBenchmarks(startDate, endDate) {
  try {
    const r = await apiBenchmarks(startDate, endDate);
    if (r.insufficient_data) {
      if (r.net && r.net.restCount !== undefined) NET.restCount = r.net.restCount;
      console.warn('[benchmarks] недостаточно ресторанов за период', startDate, endDate, '— показываем прочерки');
      return;
    }
    if (r.net) {
      NET.revenue     = r.net.revenue;
      NET.avgCheck    = r.net.avgCheck;
      NET.checks      = r.net.checks;
      NET.foodcost    = r.net.foodcost;
      NET.discount    = r.net.discount;
      NET.deliveryPct = r.net.deliveryPct;
      NET.restCount   = r.net.restCount;
    }
    if (r.top10) {
      TOP10.revenue     = r.top10.revenue;
      TOP10.avgCheck    = r.top10.avgCheck;
      TOP10.foodcost    = r.top10.foodcost;
      TOP10.discount    = r.top10.discount;
      TOP10.deliveryPct = r.top10.deliveryPct;
    }
  } catch(e) {
    console.error('[benchmarks] ошибка загрузки:', e.message);
  }
}

// ═══ Like-for-like профили по дням недели ═══
// Загружают за последние 90 дней:
//  • профиль сети: "типичный понедельник / вторник / ... в сети"
//  • профиль выбранного ресторана: "наша норма понедельника / вторника / ..."
// ClickHouse toDayOfWeek() возвращает 1..7 (1=Пн..7=Вс, ISO).
//
// Phase 2.1 (2026-04-21): SQL-логика перенесена на сервер (/api/dow-profiles).
// Клиент теперь просто забирает готовые агрегированные профили.
async function loadDowProfiles(restaurantId) {
  try {
    const qs = restaurantId ? ('?restaurant_id=' + restaurantId) : '';
    const r = await fetch(API_BASE + '/api/dow-profiles' + qs, {
      credentials: 'include'
    });
    if (r.status === 401) { showLogin(); return; }
    if (!r.ok) { console.error('[dow-profiles] HTTP ' + r.status); NET_DOW = {}; MY_DOW = {}; MY_DOW_DAYS = 0; return; }
    const j = await r.json();
    // Нормализация: ключи приходят строками, приводим профили к нужному виду.
    NET_DOW = {};
    for (const k of Object.keys(j.net || {})) NET_DOW[+k] = j.net[k];
    MY_DOW = {};
    for (const k of Object.keys(j.my || {})) MY_DOW[+k] = j.my[k];
    MY_DOW_DAYS = +j.my_days || 0;
  } catch(e) {
    console.error('[dow-profiles] error:', e.message);
    NET_DOW = {}; MY_DOW = {}; MY_DOW_DAYS = 0;
  }
}

// ═══ Like-for-like вычисления ═══
// Для массива точек ts (дни текущего периода) возвращает like-for-like
// бенчмарки: усреднение профилей сети и личных по dow, попадающим в этот период.
// Результат: { my: {rev,chk,cnt,fc,disc,del}, net_p50: {...}, net_p75: {...},
//              haveMy: bool, haveNet: bool, n_dow: Set }
function dowBenchmarks(ts) {
  const myAgg  = { rev:[], chk:[], cnt:[], fc:[], disc:[], del:[] };
  const netAgg = { rev:[], chk:[], cnt:[], fc:[], disc:[], del:[],
                   rev75:[], chk75:[], cnt75:[], fc25:[], disc25:[], del75:[] };
  const dowSet = new Set();
  for (const t of ts) {
    const jsDow = new Date(t.date).getDay(); // 0..6, 0=Sun
    const chDow = jsDow===0 ? 7 : jsDow;     // 1..7, ISO
    dowSet.add(chDow);
    const mp = MY_DOW[chDow];
    if (mp) {
      myAgg.rev.push(mp.rev_p50); myAgg.chk.push(mp.chk_p50); myAgg.cnt.push(mp.cnt_p50);
      myAgg.fc.push(mp.fc_p50);   myAgg.disc.push(mp.disc_p50); myAgg.del.push(mp.del_p50);
    }
    const np = NET_DOW[chDow];
    if (np) {
      netAgg.rev.push(np.rev_p50);   netAgg.chk.push(np.chk_p50); netAgg.cnt.push(np.cnt_p50);
      netAgg.fc.push(np.fc_p50);     netAgg.disc.push(np.disc_p50); netAgg.del.push(np.del_p50);
      netAgg.rev75.push(np.rev_p75); netAgg.chk75.push(np.chk_p75); netAgg.cnt75.push(np.cnt_p75);
      netAgg.fc25.push(np.fc_p25);   netAgg.disc25.push(np.disc_p25); netAgg.del75.push(np.del_p75);
    }
  }
  const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  return {
    my: {
      rev:mean(myAgg.rev), chk:mean(myAgg.chk), cnt:mean(myAgg.cnt),
      fc:mean(myAgg.fc),   disc:mean(myAgg.disc), del:mean(myAgg.del),
    },
    net_p50: {
      rev:mean(netAgg.rev), chk:mean(netAgg.chk), cnt:mean(netAgg.cnt),
      fc:mean(netAgg.fc),   disc:mean(netAgg.disc), del:mean(netAgg.del),
    },
    net_p75: {
      rev:mean(netAgg.rev75), chk:mean(netAgg.chk75), cnt:mean(netAgg.cnt75),
      fc:mean(netAgg.fc25),   disc:mean(netAgg.disc25), del:mean(netAgg.del75),
    },
    haveMy: MY_DOW_DAYS >= 14,      // требование "нормы": ≥14 дней истории
    haveNet: Object.keys(NET_DOW).length > 0,
    dowCount: dowSet.size,
  };
}

function goTab(el) {
  trackUI('tab', { tab: el.dataset.tab });
  document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  const tab = el.dataset.tab;
  document.getElementById('p-'+tab).classList.add('active');
  if(tab==='dynamics') renderDynamics();
  if(tab==='compare') renderCompare();
  if(tab==='analysis') renderAnalysis();
  if(tab==='menu') renderMenu();
}

// ═══ FORECAST BLOCK (Phase 1.4 #71, Phase 2.2 2026-04-21) ═══
// Алгоритм Г (текущий месяц / прошлый год × k / 90-дневный DOW fallback)
// полностью перенесён на сервер. Клиент делает fetch и отрисовывает результат.

function jsToChDow(jsDow) { return jsDow === 0 ? 7 : jsDow; }

// Кэш прогнозов: ключ — restaurant_id или '__network__'.
// При смене ресторана / режима сеть — ищем в кэше; если нет — fetch.
const FORECAST_CACHE = {};
let FORECAST_INFLIGHT = null; // для отмены устаревших запросов

async function fetchForecast(restOrNull, networkMode) {
  const key = networkMode ? '__network__' : (restOrNull && restOrNull.id ? String(restOrNull.id) : null);
  if (!key) return null;
  if (FORECAST_CACHE[key]) return FORECAST_CACHE[key];

  const qs = networkMode ? '?network=1' : ('?restaurant_id=' + restOrNull.id);
  try {
    const r = await fetch(API_BASE + '/api/forecast' + qs, {
      credentials: 'include'
    });
    if (r.status === 401) { showLogin(); return null; }
    if (!r.ok) { console.error('[forecast] HTTP ' + r.status); return null; }
    const j = await r.json();
    FORECAST_CACHE[key] = j;
    return j;
  } catch (e) {
    console.error('[forecast] error:', e.message);
    return null;
  }
}

function invalidateForecastCache() {
  for (const k of Object.keys(FORECAST_CACHE)) delete FORECAST_CACHE[k];
}

async function renderForecast() {
  const box = document.getElementById('forecastBox');
  if (!box || !R) { if(box) box.innerHTML = ''; return; }

  // Skeleton пока идёт запрос (первая отрисовка).
  // #dup-city fix: если R.name уже содержит R.city (напр. "Чико (Калининград-1)"),
  // то не клеим город вторым разом. Защита от пустого city тоже есть — пустая строка
  // всегда содержится в name, так что в этом случае city не добавляем.
  const cityInName = R.city && R.name.includes(R.city);
  const label = NETWORK_MODE ? `Вся сеть (${RESTS.length} ресторанов)` : (cityInName ? R.name : R.name + ' (' + R.city + ')');
  const haveCache = FORECAST_CACHE[NETWORK_MODE ? '__network__' : String(R.id)];
  if (!haveCache) {
    box.innerHTML = `<div class="fc-block"><div class="fc-hdr"><div class="fc-hdr-left"><span class="fc-lbl">Прогноз</span><span class="fc-sub">${label}</span></div></div><div style="padding:24px;text-align:center;color:var(--text3);font-size:12px">Расчёт прогноза…</div></div>`;
  }

  // Capture R/NETWORK_MODE для защиты от race condition
  const reqR = R, reqNet = NETWORK_MODE;
  const fc = await fetchForecast(reqR, reqNet);

  // Если за время запроса пользователь успел переключить ресторан — не перезатираем актуальное
  if (reqR !== R || reqNet !== NETWORK_MODE) return;
  if (!fc) {
    box.innerHTML = `<div class="fc-block" style="padding:20px;color:var(--text3);font-size:12px">Не удалось загрузить прогноз</div>`;
    return;
  }

  const pct = fc.total > 0 ? Math.round(fc.actual / fc.total * 100) : 0;
  const vsPrev = fc.prevMonthTotal > 0 ? ((fc.total - fc.prevMonthTotal) / fc.prevMonthTotal * 100) : null;
  const maxBar = Math.max(...fc.dailyBars.map(b => b.rev), 1);

  // Имя предыдущего месяца — берём из maxDate, пришедшего с сервера
  const fcMaxDate = fc.maxDate ? new Date(fc.maxDate) : new Date();
  const prevMonthIdx = (fcMaxDate.getMonth() - 1 + 12) % 12;
  const prevMonthName = MNAMES_FULL[prevMonthIdx] || '';

  // --- Precomputed for chart tooltips + x-axis labels (Обзор-polish 21.04) ---
  const fcYear = fcMaxDate.getFullYear();
  const fcMonthIdx = fcMaxDate.getMonth();
  const mon = fc.monthLabel.toLowerCase().slice(0,3);
  // Tooltip на каждый столбик: "15 апр (Пн) · 86 532 ₽ · факт"
  const barTip = (b) => {
    const dt = new Date(fcYear, fcMonthIdx, b.day);
    const dowLbl = DOW_NAMES[dt.getDay()];
    const typeLbl = b.type === 'actual' ? 'факт' : 'прогноз';
    return `${b.day} ${mon} (${dowLbl}) · ${fmtR(b.rev, true)} · ${typeLbl}`;
  };
  // Метки оси X: 1, 5, 10, 15, 20, 25, последний день. Для коротких месяцев
  // автоматически дедуплицируется (в феврале 28 не совпадает с 25, норм).
  const xLabels = [1, 5, 10, 15, 20, 25, fc.daysInMonth]
    .filter((d, i, arr) => d <= fc.daysInMonth && arr.indexOf(d) === i);
  // Tooltip на большое число «Итого»
  const bigTip = `Итого за ${fc.monthLabel.toLowerCase()}: факт ${fmtR(fc.actual, true)} + прогноз ${fmtR(fc.remaining, true)}`;
  // Tooltip на плашку «Выполнение»
  const donePctDays = Math.round(fc.daysElapsed / fc.daysInMonth * 100);
  const doneTip = `Прошло ${fc.daysElapsed} из ${fc.daysInMonth} дней (${donePctDays}% месяца). Выручка: ${pct}% от прогноза.`;
  // Tooltip на плашку vs предыдущий месяц
  const vsTip = vsPrev !== null
    ? `${prevMonthName} завершён суммой ${fmtR(fc.prevMonthTotal, true)}. ${vsPrev >= 0 ? 'Текущий месяц идёт впереди' : 'Текущий месяц отстаёт'} на ${Math.abs(vsPrev).toFixed(1)}%.`
    : 'Данных за прошлый месяц нет';

  box.innerHTML = `<div class="fc-block">
    <div class="fc-hdr">
      <div class="fc-hdr-left">
        <span class="fc-lbl">Прогноз на ${fc.monthLabel}</span>
        <span class="fc-sub">${label}</span>
      </div>
    </div>
    <div class="fc-row">
      <div>
        <div class="fc-big" title="${bigTip}">${fmtR(fc.total, true)}</div>
        <div class="fc-pair">
          <div class="fc-pair-item" title="Фактическая выручка с 1 по ${fc.daysElapsed} ${mon}, без прогноза">
            <div class="fc-pair-lbl">Факт (1–${fc.daysElapsed} ${mon})</div>
            <div class="fc-pair-val" style="color:var(--text)">${fmtR(fc.actual)}</div>
          </div>
          <div class="fc-pair-item" title="Прогнозная выручка с ${fc.daysElapsed+1} по ${fc.daysInMonth} ${mon} — метод: ${fc.method}">
            <div class="fc-pair-lbl">Прогноз (${fc.daysElapsed+1}–${fc.daysInMonth} ${mon})</div>
            <div class="fc-pair-val" style="color:var(--text2)">${fmtR(fc.remaining)}</div>
          </div>
        </div>
      </div>
      <div class="fc-side">
        <div class="fc-side-card" title="${doneTip}">
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Выполнение</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:${pct >= 50 ? 'var(--green)' : 'var(--amber)'}">${pct}%</div>
          <div class="fc-pbar"><div class="fc-pbar-fill" style="width:${Math.min(pct,100)}%;background:${pct >= 50 ? 'var(--green)' : 'var(--amber)'}"></div></div>
        </div>
        <div class="fc-side-card" title="${vsTip}">
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">vs ${prevMonthName}</div>
          ${vsPrev !== null
            ? `<div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:${vsPrev >= 0 ? 'var(--green)' : 'var(--red)'}">${vsPrev >= 0 ? '+' : ''}${vsPrev.toFixed(1)}%</div>
               <div style="font-size:10px;color:var(--text3)">${prevMonthName}: ${fmtR(fc.prevMonthTotal)}</div>`
            : '<div style="font-size:12px;color:var(--text3)">нет данных</div>'
          }
        </div>
      </div>
    </div>
    <div class="fc-chart">${fc.dailyBars.map(b =>
      `<div class="fc-chart-bar" title="${barTip(b)}" style="height:${Math.max(b.rev / maxBar * 100, 2)}%;background:${b.type === 'actual' ? 'var(--blue)' : 'rgba(212,168,75,.35)'};border:${b.type === 'forecast' ? '1px dashed var(--gold)' : 'none'}"></div>`
    ).join('')}</div>
    <div style="position:relative;height:14px;margin-top:2px">${xLabels.map(d =>
      `<span style="position:absolute;left:${((d - 0.5) / fc.daysInMonth * 100).toFixed(2)}%;transform:translateX(-50%);font-size:10px;color:var(--text3);white-space:nowrap">${d} ${mon}</span>`
    ).join('')}</div>
    <div style="text-align:center;font-size:10px;color:var(--text2);margin-top:2px">← факт · прогноз →</div>
    <div class="fc-method">Метод: ${fc.method}</div>
  </div>`;
}

function renderAll() {
  renderForecast();
  renderKPIs();
  renderMiniTrend();
  renderScore();
  renderInsights();
  renderAlerts();
  // Пересчитываем все вкладки при смене ресторана / «Вся сеть»
  if (typeof renderDynamics === 'function') try { renderDynamics(); } catch(e) { console.warn('[renderAll] dynamics:', e.message); }
  if (typeof renderCompare === 'function') try { renderCompare(); } catch(e) { console.warn('[renderAll] compare:', e.message); }
  // #76 B: Analysis тоже должен обновляться при смене города (иначе
  // калькулятор показывает baseline предыдущего ресторана). Вкладка
  // всегда в DOM (скрыта через CSS), так что рендер безопасен.
  if (typeof renderAnalysis === 'function') try { renderAnalysis(); } catch(e) { console.warn('[renderAll] analysis:', e.message); }
}

// ═══ UTILS ═══
function fmtR(v,full) {
  if(v===null||v===undefined) return '—';
  const n=Math.abs(v);
  if(!full) {
    if(n>=1e6) return (v/1e6).toFixed(1)+'М₽';
    if(n>=100e3) return Math.round(v/1000)+'К₽';
    if(n>=10e3) return (v/1000).toFixed(1)+'К₽';
    if(n>=1e3) return (v/1000).toFixed(1)+'К₽';
  }
  // #48: в длинном формате неразрывный пробел перед ₽ — стандарт русской
  // типографики. Короткий формат (154К₽, 1.5М₽) оставляем плотным — он
  // используется в компактных местах (KPI-карточки, подписи графиков).
  // toLocaleString('ru') уже вставляет NBSP как разделитель тысяч,
  // поэтому итог: "153 124 ₽" (все пробелы неразрывные).
  return Math.round(v).toLocaleString('ru')+'\u00A0₽';
}
function fmtN(v,d=1){return v===null||v===undefined?'—':Number(v).toFixed(d)}
function fmtD(dateStr){if(!dateStr||dateStr.length<10)return dateStr||'';return dateStr.slice(8,10)+'.'+dateStr.slice(5,7)}
function pctD(a,b){if(!b) return 0; return (a-b)/Math.abs(b)*100}
function dHtml(d,lb){
  if(isNaN(d)||Math.abs(d)<0.05) return '';
  const good=lb?d<0:d>0;
  return `<span class="${good?'up':'dn'}">${good?'▲':'▼'} ${Math.abs(d).toFixed(1)}%</span>`;
}
function getDOW(dateStr){return new Date(dateStr).getDay()} // 0=Sun
function isWeekend(dateStr){const d=getDOW(dateStr); return d===0||d===6}
function calcScore(r){
  const fc=r.foodcost!==null?r.foodcost:NET.foodcost;
  const dp=r.revenue>0?(r.delivery/r.revenue*100):0;
  return Math.round(
    Math.min(100,r.revenue/TOP10.revenue*100)*0.30+
    Math.max(0,100-(fc-19)*4)*0.25+
    Math.max(0,100-r.discount*5)*0.20+
    Math.min(100,dp/30*100)*0.15+
    Math.min(100,r.avgCheck/1800*100)*0.10
  );
}
function gradeInfo(s){
  if(s>=80) return{lbl:'Отличный результат',c:'#2ECC71'};
  if(s>=65) return{lbl:'Хороший уровень',c:'#D4A84B'};
  if(s>=50) return{lbl:'Средний уровень',c:'#F39C12'};
  return{lbl:'Требует внимания',c:'#E74C3C'};
}
function getTsRange(r,start,end){
  return r.ts.filter(t=>t.date>=start&&t.date<=end&&t.revenue>0);
}
function avgArr(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0}
function safeAvg(ts,key){
  const vals=ts.map(t=>t[key]).filter(v=>v!==null&&v!==undefined&&!isNaN(v));
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
}
function mkChart(id,cfg){
  const el=document.getElementById(id);
  if(!el) return;
  if(CHS[id]) CHS[id].destroy();
  CHS[id]=new Chart(el.getContext('2d'),cfg);
}
function deepClone(obj){return JSON.parse(JSON.stringify(obj))}
function chartOpts(yCb){
  const o=deepClone(CHART_OPTS);
  if(yCb) o.scales.y.ticks.callback=yCb;
  return o;
}

// ═══ CALENDAR PICKER ═══
const CAL_MODES = {}; // 'day' | 'month' | 'quarter' | 'year'
const MNAMES_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const MNAMES_FULL = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function buildCalendars(){
  const maxD=new Date(MAX_DATE||'2026-04-30');
  ['global'].forEach(key=>{ // Фаза 1.2: остался только глобальный календарь
    CAL_STATE[key]={start:MIN_DATE,end:MAX_DATE,picking:0,year:maxD.getFullYear(),month:maxD.getMonth()};
    CAL_MODES[key]='day';
    renderCal(key);
    updateCalLabel(key);
  });
}

function renderCal(key){
  const drop=document.getElementById(key+'CalDrop');
  if(!drop) return;
  const mode=CAL_MODES[key]||'day';
  const st=CAL_STATE[key];

  // — Mode tabs —
  const tabs=['day','month','quarter','year'];
  const tabLabels=['День','Месяц','Квартал','Год'];
  let html=`<div style="display:flex;gap:2px;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:8px">`;
  tabs.forEach((t,i)=>{
    const active=mode===t;
    html+=`<button onclick="setCalMode('${key}','${t}',event)" style="flex:1;padding:5px 4px;border:none;border-radius:6px;font-size:11px;font-family:Inter,sans-serif;cursor:pointer;transition:all .15s;background:${active?'var(--gold)':'transparent'};color:${active?'#000':'var(--text2)'};font-weight:${active?'600':'400'}">${tabLabels[i]}</button>`;
  });
  html+=`</div>`;

  if(mode==='day'){
    html+=renderDayGrid(key);
    html+=`<div class="cal-presets" style="margin-top:8px">
      <button class="cal-preset" onclick="calPreset('${key}','last7',event)">7 дней</button>
      <button class="cal-preset" onclick="calPreset('${key}','last14',event)">14 дней</button>
      <button class="cal-preset" onclick="calPreset('${key}','last30',event)">30 дней</button>
      <button class="cal-preset" onclick="calPreset('${key}','all',event)">Весь период</button>
    </div>`;
  } else if(mode==='month'){
    html+=renderMonthGrid(key);
  } else if(mode==='quarter'){
    html+=renderQuarterGrid(key);
  } else if(mode==='year'){
    html+=renderYearGrid(key);
  }

  html+=`<button class="cal-apply" onclick="calApply('${key}',event)">Применить</button>`;
  drop.innerHTML=html;
}

function setCalMode(key,mode,ev){
  if(ev) ev.stopPropagation();
  CAL_MODES[key]=mode;
  renderCal(key);
}

function renderDayGrid(key){
  const st=CAL_STATE[key];
  const year=st.year, month=st.month;
  const firstDay=new Date(year,month,1).getDay();
  const dim=new Date(year,month+1,0).getDate();
  const dow=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  let h=`<div class="cal-hdr">
    <button class="cal-nav" onclick="calNav('${key}',-1,event)">&#8249;</button>
    <span class="cal-month-lbl">${MNAMES_FULL[month]} ${year}</span>
    <button class="cal-nav" onclick="calNav('${key}',1,event)">&#8250;</button>
  </div>
  <div class="cal-dow-row">${dow.map(d=>`<div class="cal-dow">${d}</div>`).join('')}</div>
  <div class="cal-grid">`;
  const off=(firstDay+6)%7;
  for(let i=0;i<off;i++) h+=`<div class="cal-day empty"></div>`;
  for(let d=1;d<=dim;d++){
    const ds=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const has=ALL_DATES.includes(ds);
    const inR=st.start&&st.end&&ds>=st.start&&ds<=st.end;
    const isEnd=ds===st.start||ds===st.end;
    let cls='cal-day'+((!has)?' no-data':isEnd?' range-start':inR?' in-range':' has-data');
    h+=`<div class="${cls}" onclick="calClick('${key}','${ds}',event)">${d}</div>`;
  }
  h+=`</div>`;
  return h;
}

function renderMonthGrid(key){
  const st=CAL_STATE[key];
  const years=[...new Set(ALL_DATES.map(d=>+d.slice(0,4)))].sort().reverse();
  if(!years.length) return '<div style="color:var(--text3);font-size:11px;padding:8px">Нет данных</div>';
  let h=`<div style="overflow-y:auto;max-height:220px">`;
  years.forEach(y=>{
    h+=`<div style="display:flex;align-items:center;gap:4px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:600;color:var(--text);width:36px">${y}</div>`;
    MNAMES_SHORT.forEach((mn,mi)=>{
      const first=`${y}-${String(mi+1).padStart(2,'0')}-01`;
      const last=`${y}-${String(mi+1).padStart(2,'0')}-${new Date(y,mi+1,0).getDate()}`;
      const hasData=ALL_DATES.some(d=>d.startsWith(`${y}-${String(mi+1).padStart(2,'0')}`));
      const selected=st.start<=last&&st.end>=first&&hasData;
      h+=`<button onclick="calPickMonth('${key}',${y},${mi},event)" style="flex:1;padding:4px 2px;border:1px solid ${selected?'var(--gold)':'var(--border)'};border-radius:5px;font-size:10px;font-family:Inter,sans-serif;cursor:${hasData?'pointer':'default'};background:${selected?'var(--gold)':hasData?'transparent':'rgba(0,0,0,0.2)'};color:${selected?'#000':hasData?'var(--text)':'var(--text3)'}">${mn}</button>`;
    });
    h+=`</div>`;
  });
  h+=`</div>`;
  return h;
}

function renderQuarterGrid(key){
  const st=CAL_STATE[key];
  const years=[...new Set(ALL_DATES.map(d=>+d.slice(0,4)))].sort().reverse();
  let h=`<div style="overflow-y:auto;max-height:220px">`;
  years.forEach(y=>{
    h+=`<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:600;color:var(--text);width:36px">${y}</div>`;
    [0,1,2,3].forEach(q=>{
      const qStart=`${y}-${String(q*3+1).padStart(2,'0')}-01`;
      const qEnd=`${y}-${String(q*3+3).padStart(2,'0')}-${new Date(y,q*3+3,0).getDate()}`;
      const hasData=ALL_DATES.some(d=>d>=qStart&&d<=qEnd);
      const selected=st.start<=qEnd&&st.end>=qStart&&hasData;
      h+=`<button onclick="calPickQuarter('${key}',${y},${q},event)" style="flex:1;padding:5px 4px;border:1px solid ${selected?'var(--gold)':'var(--border)'};border-radius:6px;font-size:11px;font-family:Inter,sans-serif;cursor:${hasData?'pointer':'default'};background:${selected?'var(--gold)':hasData?'transparent':'rgba(0,0,0,0.15)'};color:${selected?'#000':hasData?'var(--text)':'var(--text3)'};font-weight:${selected?'600':'400'}">Q${q+1}</button>`;
    });
    h+=`</div>`;
  });
  h+=`</div>`;
  return h;
}

function renderYearGrid(key){
  const st=CAL_STATE[key];
  const years=[...new Set(ALL_DATES.map(d=>+d.slice(0,4)))].sort().reverse();
  let h=`<div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">`;
  years.forEach(y=>{
    const first=`${y}-01-01`, last=`${y}-12-31`;
    const selected=st.start<=last&&st.end>=first;
    h+=`<button onclick="calPickYear('${key}',${y},event)" style="padding:7px 14px;border:1px solid ${selected?'var(--gold)':'var(--border)'};border-radius:7px;font-size:12px;font-family:Inter,sans-serif;cursor:pointer;background:${selected?'var(--gold)':'transparent'};color:${selected?'#000':'var(--text)'};font-weight:${selected?'600':'400'}">${y}</button>`;
  });
  h+=`</div>`;
  return h;
}

function calPickMonth(key,y,m,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  const first=`${y}-${String(m+1).padStart(2,'0')}-01`;
  const last=`${y}-${String(m+1).padStart(2,'0')}-${new Date(y,m+1,0).getDate()}`;
  if(st.picking===0){st.start=first;st.end=last;st.picking=1;renderCal(key);}
  else{
    if(first<st.start){st.end=st.end;st.start=first;}
    else{st.end=last;}
    st.picking=0;
    calApply(key,ev); // auto-apply
  }
}
function calPickQuarter(key,y,q,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  const first=`${y}-${String(q*3+1).padStart(2,'0')}-01`;
  const last=`${y}-${String(q*3+3).padStart(2,'0')}-${new Date(y,q*3+3,0).getDate()}`;
  st.start=first; st.end=last; st.picking=0;
  calApply(key,ev); // auto-apply
}
function calPickYear(key,y,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  st.start=`${y}-01-01`; st.end=`${y}-12-31`; st.picking=0;
  calApply(key,ev); // auto-apply
}

function calNav(key,dir,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  st.month+=dir;
  if(st.month>11){st.month=0;st.year++;}
  if(st.month<0){st.month=11;st.year--;}
  renderCal(key);
}
function toggleCal(key,ev){
  if(ev) ev.stopPropagation();
  const drop=document.getElementById(key+'CalDrop');
  const isOpen=drop.classList.contains('open');
  document.querySelectorAll('.cal-dropdown').forEach(d=>d.classList.remove('open'));
  if(!isOpen){drop.classList.add('open');renderCal(key);}
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.cal-picker-wrap')) document.querySelectorAll('.cal-dropdown').forEach(d=>d.classList.remove('open'));
});
function calClick(key,ds,ev){
  if(ev) ev.stopPropagation();
  if(!ALL_DATES.includes(ds)) return;
  const st=CAL_STATE[key];
  if(st.picking===0){
    // Dblclick on same day = single-day select + apply
    if(st.start===ds && st.end===ds){calApply(key,ev);return;}
    st.start=ds;st.end=ds;st.picking=1;
    renderCal(key);
  } else {
    if(ds<st.start){st.end=st.start;st.start=ds;}
    else st.end=ds;
    st.picking=0;
    calApply(key,ev); // #69: auto-apply when range complete
  }
}
function calPreset(key,preset,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  if(preset==='all'){st.start=MIN_DATE;st.end=MAX_DATE;}
  else if(preset==='last7'){st.start=ALL_DATES[Math.max(0,ALL_DATES.length-7)];st.end=MAX_DATE;}
  else if(preset==='last14'){st.start=ALL_DATES[Math.max(0,ALL_DATES.length-14)];st.end=MAX_DATE;}
  else if(preset==='last30'){st.start=ALL_DATES[Math.max(0,ALL_DATES.length-30)];st.end=MAX_DATE;}
  st.picking=0;
  calApply(key,ev); // #72: presets auto-apply
}
function fillCalPresets(){}

function calApply(key,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  if(key==='global'){S.globalStart=st.start;S.globalEnd=st.end;}
  else if(key==='dyn'){S.dynStart=st.start;S.dynEnd=st.end;}
  else if(key==='cmp'){S.cmpStart=st.start;S.cmpEnd=st.end;}
  updateCalLabel(key);
  document.getElementById(key+'CalDrop').classList.remove('open');
  if(key==='global'){
    // При изменении глобального календаря синкаем периоды всех вкладок
    // (Фаза 1.2: один календарь на 4 вкладки, см. паспорт 5.28)
    S.dynStart = S.cmpStart = S.globalStart;
    S.dynEnd   = S.cmpEnd   = S.globalEnd;
    loadNetworkBenchmarks(S.globalStart, S.globalEnd).then(()=>{
      try {
        if (typeof invalidateMenuCache === 'function') invalidateMenuCache();
        renderAll();
        // Перерисовываем всё, даже если сейчас видна другая вкладка
        if (typeof renderDynamics === 'function') renderDynamics();
        if (typeof renderCompare === 'function') renderCompare();
      } catch(e) {
        alert('Ошибка при применении дат:\n'+e.message);
        console.error(e);
      }
    });
  }
}
function updateCalLabel(key){
  const st=CAL_STATE[key];
  const fmt=d=>{if(!d) return '';const dt=new Date(d);return dt.getDate()+' '+'янвфевмарапрмайиюниюлавгсеноктноядек'.match(/.{3}/g)[dt.getMonth()]};
  const lbl=document.getElementById(key+'CalLbl');
  if(lbl) lbl.textContent=fmt(st.start)+' — '+fmt(st.end);
  const gLbl=document.getElementById('globalCalLbl');
  if(key==='global'&&gLbl) gLbl.textContent=fmt(st.start)+' — '+fmt(st.end);
}
function getGlobalTs(){return getTsRange(R,S.globalStart,S.globalEnd)}

// ═══ ALERTS ═══
function renderAlerts(){
  const ts = getGlobalTs();
  if(!ts.length) return;

  const cur = {
    revenue:  safeAvg(ts,'revenue')||0,
    avgCheck: safeAvg(ts,'avgCheck')||0,
    checks:   safeAvg(ts,'checks')||0,
    foodcost: safeAvg(ts,'foodcost'),
    discount: safeAvg(ts,'discount')||0,
    delivery: safeAvg(ts,'delivery')||0,
  };
  const dp = cur.revenue>0 ? cur.delivery/cur.revenue*100 : 0;

  // Like-for-like бенчмарки
  const bm = dowBenchmarks(ts);
  const daysN = ts.length;
  const periodTxt = `за ${daysN} ${daysN===1?'день':daysN<5?'дня':'дней'}`;

  // Выбор базы для сравнения:
  // 1) если у точки есть "моя норма" — она. Это основная база.
  // 2) fallback: медиана сети.
  const cmpBase = bm.haveMy ? 'my' : (bm.haveNet ? 'net_p50' : null);
  const cmpLabel = bm.haveMy ? 'вашей нормы' : 'медианы сети';

  // Trend analysis: DOW-normalized (like-for-like)
  // Сравниваем не сырые Чт<Пт<Сб (бессмысленно), а отклонение от DOW-нормы
  let declining3 = false, growing3 = false;
  const last3 = ts.slice(-3);
  let devs = [null, null, null];
  if (daysN >= 7 && last3.length >= 3 && cmpBase) {
    devs = last3.map(t => {
      const jsDow = new Date(t.date).getDay();
      const chDow = jsDow === 0 ? 7 : jsDow;
      const norm = (bm.haveMy && MY_DOW[chDow]) ? MY_DOW[chDow].rev_p50
                 : (NET_DOW[chDow] ? NET_DOW[chDow].rev_p50 : null);
      return norm && norm > 0 ? (t.revenue - norm) / norm : null;
    });
    if (devs.every(d => d !== null)) {
      declining3 = devs[0] > devs[1] && devs[1] > devs[2] && devs[2] < -0.05;
      growing3   = devs[0] < devs[1] && devs[1] < devs[2] && devs[2] > 0.05;
    }
  }

  const msgs = [];

  // ФУДКОСТ — без изменений по порогам (22% норма / 26% критично для Chicko),
  // но с добавлением периода и like-for-like сравнением
  if (cur.foodcost!==null && cur.foodcost>26) {
    msgs.push({c:'a-red', t:`🔴 <b>Критический фудкост: ${fmtN(cur.foodcost)}%</b> — превышает норму 22% на ${fmtN(cur.foodcost-22)} п.п. (среднее ${periodTxt}). Потери ~${fmtR((cur.foodcost-22)/100*cur.revenue)}/день.`});
  } else if (cur.foodcost!==null && cur.foodcost>22) {
    msgs.push({c:'a-amber', t:`⚠️ <b>Фудкост ${fmtN(cur.foodcost)}% выше нормы</b> (норма до 22%), среднее ${periodTxt}. Снижение до 22% высвободит ~${fmtR((cur.foodcost-22)/100*cur.revenue)}/день.`});
  }

  // Тренд (DOW-normalized)
  if (declining3) {
    const dowNames = ['','Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const detail = last3.map((t,i) => {
      const chDow = jsToChDow(new Date(t.date).getDay());
      return dowNames[chDow]+': '+(devs[i]*100).toFixed(0)+'%';
    }).join(', ');
    msgs.push({c:'a-red', t:`📉 <b>Выручка ниже DOW-нормы 3 дня подряд</b> (${detail}). Это не сезонный спад — ресторан недорабатывает относительно своих же показателей.`});
  } else if (growing3) {
    const dowNames = ['','Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const detail = last3.map((t,i) => {
      const chDow = jsToChDow(new Date(t.date).getDay());
      return dowNames[chDow]+': +'+(devs[i]*100).toFixed(0)+'%';
    }).join(', ');
    msgs.push({c:'a-green', t:`📈 <b>Выручка выше DOW-нормы 3 дня подряд</b> (${detail}). Реальный рост — зафиксируйте что сработало.`});
  }

  // Скидки — like-for-like
  if (cmpBase && cur.discount > bm[cmpBase].disc*1.4) {
    const base = bm[cmpBase].disc;
    const extraPct = cur.discount - base;
    msgs.push({c:'a-amber', t:`🏷️ <b>Скидки ${fmtN(cur.discount,1)}% — в 1.4× выше ${cmpLabel} (${fmtN(base,1)}%)</b>, ${periodTxt}. Потеря ~${fmtR(cur.revenue*extraPct/100)}/день. Проверьте: акции возвращают гостей или просто режут маржу?`});
  }

  // Доставка — like-for-like (если есть доставка у ресторана)
  if (cmpBase && bm[cmpBase].del>5 && dp < bm[cmpBase].del*0.6) {
    const base = bm[cmpBase].del;
    msgs.push({c:'a-amber', t:`🛵 <b>Доставка ${fmtN(dp,1)}% выручки — в 2× ниже ${cmpLabel} (${fmtN(base,1)}%)</b>, ${periodTxt}. Если догнать: ~${fmtR((base-dp)/100*cur.revenue)}/день выручки от доставки.`});
  }

  // Средний чек — like-for-like
  if (cmpBase && cur.avgCheck < bm[cmpBase].chk*0.85) {
    const base = bm[cmpBase].chk;
    msgs.push({c:'a-amber', t:`🧾 <b>Средний чек ${fmtR(cur.avgCheck)} на ${fmtN(Math.abs(pctD(cur.avgCheck,base)))}% ниже ${cmpLabel} (${fmtR(base)})</b>, ${periodTxt}. Работайте с допродажами и комбо-наборами.`});
  }

  // Выручка — сравнение с топ-25% сети (если она выше) или с медианой
  if (bm.haveNet && cur.revenue > bm.net_p75.rev*0.95 && bm.net_p75.rev>0) {
    msgs.push({c:'a-green', t:`🏆 <b>Выручка на уровне топ-25% сети!</b> ${fmtR(cur.revenue)}/день против ${fmtR(bm.net_p75.rev)}/день у лидеров (${periodTxt}).`});
  } else if (cmpBase && cur.revenue < bm[cmpBase].rev*0.7) {
    const base = bm[cmpBase].rev;
    msgs.push({c:'a-red', t:`⬇️ <b>Выручка ${fmtR(cur.revenue)} — на ${fmtN(Math.abs(pctD(cur.revenue,base)))}% ниже ${cmpLabel} (${fmtR(base)})</b>, ${periodTxt}. Это системный разрыв — нужен план действий.`});
  }

  // Сортировка
  const order = {'a-red':0,'a-amber':1,'a-green':2,'a-blue':3};
  msgs.sort((a,b)=>(order[a.c]||9)-(order[b.c]||9));
  document.getElementById('alertsBox').innerHTML=msgs.slice(0,3).map(m=>`<div class="alert ${m.c}">${m.t}</div>`).join('');
}


function setPeriod(p, btn) {
  S.analysisPeriod = p;
  document.querySelectorAll('#periodBtns .pbtn2').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updatePeriodDesc();
  renderKPIs();
}
function setCompareTo(c, btn) {
  S.compareTo = c;
  document.querySelectorAll('#compareBtns .pbtn2').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updatePeriodDesc();
  renderKPIs();
}
function updatePeriodDesc() {
  const pLabels = { day: 'день', week: 'неделю', month: 'месяц', quarter: 'квартал', year: 'год' };
  const prevLabels = { day: 'пред. день', week: 'пред. неделю', month: 'пред. месяц', quarter: 'пред. квартал', year: 'пред. год' };
  const cLabels = { prev: prevLabels[S.analysisPeriod]||'пред. период', network: 'средняя по сети', top10: 'лидеры сети' };
  const el = document.getElementById('periodDesc');
  if (el) el.textContent = 'Среднее за ' + pLabels[S.analysisPeriod] + ' / ' + cLabels[S.compareTo];
}
function getPeriodTs() {
  const all = getGlobalTs();
  if (!all.length) return { cur: [], prev: [] };
  const n = S.analysisPeriod === 'day' ? 1 : S.analysisPeriod === 'week' ? 7 : S.analysisPeriod === 'month' ? 30 : S.analysisPeriod === 'quarter' ? 90 : 365;
  const cur = all.slice(-n);
  const prev = all.slice(-n*2, -n);
  return { cur, prev };
}
function getCompareValue(curVal, prevTs, field, isInverse) {
  if (S.compareTo === 'prev') {
    if (!prevTs.length) return null;
    return safeAvg(prevTs, field);
  }
  if (S.compareTo === 'network') return field === 'revenue' ? NET.revenue : field === 'avgCheck' ? NET.avgCheck : field === 'checks' ? NET.checks : null;
  if (S.compareTo === 'top10') return field === 'revenue' ? TOP10.revenue : field === 'avgCheck' ? TOP10.avgCheck : null;
  return null;
}
function getCompareLabel() {
  if (S.compareTo === 'prev') return S.analysisPeriod === 'day' ? 'пред. день' : S.analysisPeriod === 'week' ? 'пред. неделя' : 'пред. месяц';
  if (S.compareTo === 'network') return 'vs сеть';
  return 'vs лидеры';
}

// ═══ KPIs ═══
function renderKPIs(){
  const ts = getGlobalTs();
  if(!ts.length) return;

  // Реальные средние за выбранный период
  const cur={
    revenue:  safeAvg(ts,'revenue')||0,
    avgCheck: safeAvg(ts,'avgCheck')||0,
    checks:   safeAvg(ts,'checks')||0,
    foodcost: safeAvg(ts,'foodcost'),
    discount: safeAvg(ts,'discount')||0,
    delivery: safeAvg(ts,'delivery')||0,
  };
  const dp = cur.revenue>0 ? cur.delivery/cur.revenue*100 : 0;

  // Like-for-like бенчмарки (моя норма + медиана сети + топ-25% сети) по dow
  const bm = dowBenchmarks(ts);

  // Главное сравнение — "vs моя норма" (если истории достаточно),
  // иначе fallback на "vs медиану сети".
  // Мелкая подпись показывает оба сетевых бенчмарка.
  //
  // Для foodcost/скидок: "меньше=лучше", поэтому в dHtml делаем lb=true (перевёртываем цвета).
  function renderCard(id, value, fmtFn, myVal, netP50, netP75, lessIsBetter, barFn) {
    const valEl = document.getElementById('kv-'+id);
    const delEl = document.getElementById('kd-'+id);
    const benEl = document.getElementById('kb-'+id);
    const barEl = document.getElementById('kr-'+id);
    if (!valEl) return;

    // Главное число
    valEl.innerHTML = fmtFn(value, true);

    // Главное сравнение: если есть "моя норма" — сравнение с ней,
    // иначе с медианой сети. Если и сети нет — прочерк.
    let mainCmp = '';
    if (bm.haveMy && myVal && myVal>0) {
      mainCmp = dHtml(pctD(value, myVal), lessIsBetter) + ' <span class="nt">vs моя норма</span>';
    } else if (bm.haveNet && netP50 && netP50>0) {
      mainCmp = dHtml(pctD(value, netP50), lessIsBetter) + ' <span class="nt">vs медиана сети</span>';
    }
    if (delEl) delEl.innerHTML = mainCmp;

    // Фоновый контекст: медиана сети + топ-25% сети
    // Если есть "моя норма" — показываем её отдельной строкой в первой позиции
    const parts = [];
    if (bm.haveMy && myVal && myVal>0)   parts.push('моя норма ' + fmtFn(myVal));
    if (bm.haveNet && netP50 && netP50>0) parts.push('сеть ' + fmtFn(netP50));
    if (bm.haveNet && netP75 && netP75>0) {
      const label = lessIsBetter ? 'топ-25% ≤ ' : 'топ-25% ≥ ';
      parts.push(label + fmtFn(netP75));
    }
    if (benEl) benEl.innerHTML = parts.join(' · ');

    // Прогресс-бар — относительно топ-25% (если есть)
    if (barEl && barFn) {
      const pct = barFn(value, netP75, netP50);
      barEl.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
  }

  // Helpers
  const fmtR_short = (v) => fmtR(v);
  const fmtR_full  = (v) => fmtR(v, true);
  const fmtPct1 = (v) => v==null ? '—' : fmtN(v, 1) + '%';
  const fmtInt  = (v) => v==null ? '—' : Math.round(v) + ' чек';

  renderCard('rev', cur.revenue,  fmtR_short, bm.my.rev,  bm.net_p50.rev,  bm.net_p75.rev,  false,
             (v,p75,p50) => p75 ? (v/p75)*100 : (p50 ? (v/p50)*60 : 0));
  renderCard('chk', cur.avgCheck, fmtR_full,  bm.my.chk,  bm.net_p50.chk,  bm.net_p75.chk,  false,
             (v,p75,p50) => p75 ? (v/p75)*100 : (p50 ? (v/p50)*60 : 0));
  renderCard('cnt', cur.checks,   fmtInt,     bm.my.cnt,  bm.net_p50.cnt,  bm.net_p75.cnt,  false,
             (v,p75,p50) => p75 ? (v/p75)*100 : (p50 ? (v/p50)*60 : 0));

  // Foodcost — цвет по порогам (22% / 26%)
  if (cur.foodcost !== null) {
    const fc = cur.foodcost;
    const fcColor = fc>26 ? 'var(--red)' : fc>22 ? 'var(--amber)' : 'var(--green)';
    const fcBarCls = fc>26 ? 'br' : fc>22 ? 'ba' : 'bg';
    const el = document.getElementById('kv-fc');
    if (el) el.style.color = fcColor;
    const barEl = document.getElementById('kr-fc');
    if (barEl) barEl.className = 'kbar ' + fcBarCls;
    renderCard('fc', fc, fmtPct1, bm.my.fc, bm.net_p50.fc, bm.net_p75.fc, true,
               (v) => Math.min(100, v/35*100));
  }

  renderCard('disc', cur.discount, fmtPct1, bm.my.disc, bm.net_p50.disc, bm.net_p75.disc, true,
             (v) => Math.min(100, v*5));
  const discColor = cur.discount > (bm.net_p50.disc||3.3)*1.4 ? 'var(--red)' :
                    cur.discount > (bm.net_p50.disc||3.3)     ? 'var(--amber)' : 'var(--text)';
  const discEl = document.getElementById('kv-disc');
  if (discEl) discEl.style.color = discColor;

  renderCard('del', dp, fmtPct1, bm.my.del, bm.net_p50.del, bm.net_p75.del, false,
             (v) => Math.min(100, v/40*100));

  // #43: скрыть доставку если у ресторана нет доставки
  const delCard = document.getElementById('kcard-del');
  if (delCard) {
    const hasDelivery = ts.some(t => t.delivery > 0 || t.deliveryPct > 1);
    delCard.style.display = hasDelivery ? '' : 'none';
  }
}
function setKPI(id,raw,fmt,unit,prevRaw,netBench,lb,benchLbl,barPct,barCls){
  document.getElementById('kv-'+id).innerHTML=fmt+(unit?`<span class="u">${unit}</span>`:'');
  if(prevRaw!==null&&prevRaw!==undefined) document.getElementById('kd-'+id).innerHTML=dHtml(pctD(raw,prevRaw),lb)+' <span class="nt">'+(typeof getCompareLabel==='function'?getCompareLabel():'пред. день')+'</span>';
  if(benchLbl) document.getElementById('kb-'+id).textContent='Сеть: '+benchLbl;
  document.getElementById('kr-'+id).className='kbar '+(barCls||'bgo');
  document.getElementById('kr-'+id).style.width=Math.min(100,barPct||0)+'%';
}

// ═══ SCORE ═══
// ═══ Score v2 — Methodology 2.0 (22.04.2026) ═══
// Performance (40%) + Efficiency (60%). All components capped 0-100.
// See docs/SCORE_METHODOLOGY_v2.md for rationale.
function _clamp(v){ return Math.max(0, Math.min(100, v)); }

function _fcScore(fc) {
  // Piecewise-linear: norm corridor 18-21%, progressive penalty above
  if (fc <= 18) return 100;
  if (fc <= 21) return _clamp(100 - (fc - 18) * 5);
  if (fc <= 25) return _clamp(85 - (fc - 21) * 10);
  return _clamp(45 - (fc - 25) * 15);
}

// YoY date helper: shift YYYY-MM-DD by -1 year
function _yoyDate(d) {
  return (parseInt(d.slice(0,4)) - 1) + d.slice(4);
}

function _calcRestScoreDetail(r2) {
  var ts2 = r2.ts.filter(function(t){ return t.date>=S.globalStart && t.date<=S.globalEnd && t.revenue>0; });
  if (!ts2.length) return null;
  var rev = safeAvg(ts2,'revenue') || 0;
  var fc  = safeAvg(ts2,'foodcost') || NET.foodcost;
  var cnt = safeAvg(ts2,'checks') || 0;
  var chk = safeAvg(ts2,'avgCheck') || 0;
  var disc = safeAvg(ts2,'discount') || 0;
  var dp  = safeAvg(ts2,'deliveryPct') || (rev>0 ? (safeAvg(ts2,'delivery')||0)/rev*100 : 0) || 0;

  // --- Growth block (40%) — YoY comparison ---
  // Base: same period last year. Fallback: 90-day median if <7 YoY days.
  var yoyStart = _yoyDate(S.globalStart);
  var yoyEnd = _yoyDate(S.globalEnd);
  var tsYoy = r2.ts.filter(function(t){ return t.date>=yoyStart && t.date<=yoyEnd && t.revenue>0; });
  var useYoy = tsYoy.length >= 7;
  // Fallback: 90-day median for this restaurant
  var ts90 = useYoy ? null : r2.ts.filter(function(t){
    var d90 = new Date(); d90.setDate(d90.getDate()-90);
    var d90s = d90.toISOString().slice(0,10);
    return t.date >= d90s && t.revenue > 0;
  });
  var baseRev = useYoy ? (safeAvg(tsYoy,'revenue')||1) : (ts90 && ts90.length>=7 ? (safeAvg(ts90,'revenue')||1) : (NET.revenue||1));
  var baseCnt = useYoy ? (safeAvg(tsYoy,'checks')||1) : (ts90 && ts90.length>=7 ? (safeAvg(ts90,'checks')||1) : (NET.checks||1));
  var baseChk = useYoy ? (safeAvg(tsYoy,'avgCheck')||1) : (ts90 && ts90.length>=7 ? (safeAvg(ts90,'avgCheck')||1) : (NET.avgCheck||1));

  // score = current/base * 80 → at base level = 80 (good), +25% = 100, -20% = 64
  var sRev  = _clamp(rev / baseRev * 80);
  var sCnt  = _clamp(cnt / baseCnt * 80);
  var sChk  = _clamp(chk / baseChk * 80);

  // --- Health block (60%) — absolute KPIs ---
  var sFc   = _fcScore(fc);
  var sDisc = _clamp(100 - disc * 5);
  var sDel  = _clamp(100 - Math.abs(dp - 20) * 3);

  var total = Math.round(
    sRev * 0.20 + sCnt * 0.10 + sChk * 0.10 +
    sFc * 0.25 + sDisc * 0.20 + sDel * 0.15
  );
  return {
    score: _clamp(total),
    growth: { rev: Math.round(sRev), cnt: Math.round(sCnt), chk: Math.round(sChk), yoy: useYoy },
    health: { fc: Math.round(sFc), disc: Math.round(sDisc), del: Math.round(sDel) }
  };
}

function _calcRestScore(r2) {
  var d = _calcRestScoreDetail(r2);
  return d ? d.score : 0;
}

function renderScore(){
  if (!document.getElementById('scoreRing')) return;
  var allScores = RESTS.map(function(r2,idx){
    var d = _calcRestScoreDetail(r2);
    return { name:r2.name, city:r2.city||'', score:d?d.score:0, detail:d, idx:idx };
  }).filter(function(x){ return x.score>0; }).sort(function(a,b){ return b.score-a.score; });

  var myName = R ? R.name : '';
  var myEntry = allScores.find(function(x){ return x.name===myName; });
  var score = myEntry ? myEntry.score : 0;
  var detail = myEntry ? myEntry.detail : null;
  var dispRank = myEntry ? (allScores.indexOf(myEntry)+1) : 1;
  var rankN = allScores.length;
  var g = gradeInfo(score);

  document.getElementById('scoreN').textContent = score;
  document.getElementById('scoreN').style.color = g.c;
  document.getElementById('scoreG').textContent = g.lbl;
  document.getElementById('scoreG').style.color = g.c;
  document.getElementById('scoreP').textContent = '#' + dispRank + ' из ' + rankN;

  var c = document.getElementById('scoreRing').getContext('2d');
  c.clearRect(0,0,144,144);
  var cx=72,cy=72,rad=60,lw=9;
  c.beginPath(); c.arc(cx,cy,rad,-Math.PI*.8,Math.PI*.8); c.strokeStyle='#2E4068'; c.lineWidth=lw; c.lineCap='round'; c.stroke();
  var endA = -Math.PI*.8 + (score/100)*Math.PI*1.6;
  var grd = c.createLinearGradient(0,0,144,144); grd.addColorStop(0,g.c); grd.addColorStop(1,'#F0C96A');
  c.beginPath(); c.arc(cx,cy,rad,-Math.PI*.8,endA); c.strokeStyle=grd; c.lineWidth=lw; c.lineCap='round'; c.stroke();

  var brHtml = '';
  if (detail) {
    var yoyLabel = detail.growth.yoy ? ' (vs прошлый год)' : ' (vs 90д)';
    brHtml += '<div class="sbr-group">Рост' + yoyLabel + ' (40%)</div>';
    [{l:'Выручка',v:detail.growth.rev,c:'#D4A84B'},
     {l:'Чеки',v:detail.growth.cnt,c:'#4A9EF5'},
     {l:'Ср. чек',v:detail.growth.chk,c:'#9B59B6'}].forEach(function(p){
      brHtml += '<div class="sbr-row"><span class="sbr-lbl">'+p.l+'</span><div class="sbr-t"><div class="sbr-f" style="width:'+p.v+'%;background:'+p.c+'"></div></div><span class="sbr-v" style="color:var(--text2);font-size:10px">'+p.v+'%</span></div>';
    });
    brHtml += '<div class="sbr-group">Здоровье (60%)</div>';
    [{l:'Фудкост',v:detail.health.fc,c:'#2ECC71'},
     {l:'Скидки',v:detail.health.disc,c:'#F39C12'},
     {l:'Доставка',v:detail.health.del,c:'#E67E22'}].forEach(function(p){
      brHtml += '<div class="sbr-row"><span class="sbr-lbl">'+p.l+'</span><div class="sbr-t"><div class="sbr-f" style="width:'+p.v+'%;background:'+p.c+'"></div></div><span class="sbr-v" style="color:var(--text2);font-size:10px">'+p.v+'%</span></div>';
    });
  }
  document.getElementById('scoreBr').innerHTML = brHtml;

  var tbody = document.getElementById('rankBody');
  if (!tbody) return;
  var html = '<tr><th class="rank-n">#</th><th>Ресторан</th><th class="rank-score">Балл</th><th class="rank-bar"></th></tr>';
  allScores.forEach(function(item, i){
    var gi = gradeInfo(item.score);
    var isMe = item.name === myName;
    var label = item.city || item.name;
    html += '<tr class="' + (isMe?'rank-me':'') + '" style="cursor:pointer" onclick="selectRest('+item.idx+')">'
      + '<td class="rank-n">' + (i+1) + '</td>'
      + '<td style="color:' + (isMe?'var(--gold)':'var(--text)') + '">' + label + '</td>'
      + '<td class="rank-score" style="color:'+gi.c+'">' + item.score + '</td>'
      + '<td class="rank-bar"><div class="rank-bar-fill" style="width:'+item.score+'%;background:'+gi.c+'"></div></td>'
      + '</tr>';
  });
  tbody.innerHTML = html;
}


// ═══ MINI TREND ═══
function renderMiniTrend(){
  // For "day" period show last 7 days for context, else use selected period
  const ts = S.analysisPeriod==='day' ? getGlobalTs().slice(-7) : getGlobalTs();
  mkChart('miniC',{type:'line',data:{labels:ts.map(t=>fmtD(t.date)),datasets:[{label:'Ваша выручка',data:ts.map(t=>t.revenue),borderColor:'#D4A84B',backgroundColor:'rgba(212,168,75,.07)',borderWidth:2,pointRadius:2,fill:true,tension:.3},{data:ts.map(()=>NET.revenue),borderColor:'rgba(142,170,206,.3)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false,label:'Медиана сети'}]},options:{...chartOpts(v=>fmtR(v)),plugins:{legend:{display:true,position:'top',align:'end',labels:{boxWidth:10,boxHeight:2,font:{size:10},color:'rgba(212,222,235,.6)',padding:6}}}}});
}

// ═══ DONUT ═══
function renderDonut(){
  if (!document.getElementById('donutC')) return;
  const ts=getGlobalTs();
  const bar=safeAvg(ts,'bar')||0,kit=safeAvg(ts,'kitchen')||0,del=safeAvg(ts,'delivery')||0;
  const rev=safeAvg(ts,'revenue')||R.revenue||1;
  const vals=[],lbls=[],cols=[];
  if(bar>0){vals.push(bar);lbls.push('Бар');cols.push('#D4A84B')}
  if(kit>0){vals.push(kit);lbls.push('Кухня');cols.push('#4A9EF5')}
  if(del>0){vals.push(del);lbls.push('Доставка');cols.push('#2ECC71')}
  if(!vals.length){vals.push(rev);lbls.push('Выручка');cols.push('#D4A84B')}
  mkChart('donutC',{type:'doughnut',data:{labels:lbls,datasets:[{data:vals,backgroundColor:cols,borderColor:'#1E2D47',borderWidth:3}]},options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.label}: ${fmtR(c.raw)} (${(c.raw/rev*100).toFixed(1)}%)`}}}}});
  document.getElementById('donutLeg').innerHTML=lbls.map((l,i)=>`<div class="dl-row"><div class="dl-dot" style="background:${cols[i]}"></div><span class="dl-name">${l}</span><span class="dl-pct">${(vals[i]/rev*100).toFixed(1)}%</span><span class="dl-val">${fmtR(vals[i])}</span></div>`).join('');
}

// ═══ GAUGE ═══
function renderGauge(){
  if (!document.getElementById('gaugeC')) return;
  const ts=getGlobalTs();
  const fc=safeAvg(ts,'foodcost');
  if(fc===null){const gv=document.getElementById('gaugeVal');if(gv)gv.textContent='—';return}
  const cv=document.getElementById('gaugeC').getContext('2d');
  const W=200,H=110;
  cv.clearRect(0,0,W,H);
  const cx=100,cy=98,rad=82,lw=14;
  // Zones
  [{f:0,t:22/40,c:'#27AE60'},{f:22/40,t:26/40,c:'#F39C12'},{f:26/40,t:1,c:'#E74C3C'}].forEach(z=>{
    cv.beginPath();cv.arc(cx,cy,rad,Math.PI+z.f*Math.PI,Math.PI+z.t*Math.PI);cv.strokeStyle=z.c;cv.lineWidth=lw;cv.lineCap='butt';cv.stroke();
  });
  // Tick marks
  [19,22,26,35].forEach(v=>{
    const a=Math.PI+Math.min(1,v/40)*Math.PI;
    const x1=cx+Math.cos(a)*(rad-lw/2-2),y1=cy+Math.sin(a)*(rad-lw/2-2);
    const x2=cx+Math.cos(a)*(rad+lw/2+2),y2=cy+Math.sin(a)*(rad+lw/2+2);
    cv.beginPath();cv.moveTo(x1,y1);cv.lineTo(x2,y2);cv.strokeStyle='rgba(0,0,0,0.4)';cv.lineWidth=1.5;cv.stroke();
  });
  // Needle — shorter so it doesn't reach center text
  const na=Math.PI+Math.min(1,Math.max(0,fc/40))*Math.PI;
  const needleLen=rad-lw-6;
  cv.beginPath();cv.moveTo(cx,cy);cv.lineTo(cx+Math.cos(na)*needleLen,cy+Math.sin(na)*needleLen);
  cv.strokeStyle='#fff';cv.lineWidth=2;cv.lineCap='round';cv.stroke();
  // Center dot
  cv.beginPath();cv.arc(cx,cy,6,0,Math.PI*2);cv.fillStyle='#fff';cv.fill();
  cv.beginPath();cv.arc(cx,cy,3,0,Math.PI*2);cv.fillStyle='#1C2742';cv.fill();
  // NO text on canvas — displayed in HTML below gauge to avoid needle overlap
  const col=fc>26?'#E74C3C':fc>22?'#F39C12':'#27AE60';
  const gaugeVal=document.getElementById('gaugeVal');
  if(gaugeVal){gaugeVal.textContent=fmtN(fc)+'%';gaugeVal.style.color=col;}
  // gaugeN removed from DOM
  document.getElementById('gaugeZ').textContent=fc<=22?'✅ Норма':fc<=26?'⚠️ Умеренный — есть резервы':'🔴 Высокий — нужны меры!';
  document.getElementById('gaugeZ').style.color=col;
}

// ═══ RANK BARS ═══
function renderRankBars(){
  if (!document.getElementById('rankBars')) return;
  // Calculate period avg revenue for each restaurant
  const withRev = RESTS.map(r2=>{
    const ts2 = r2.ts.filter(t=>t.date>=S.globalStart&&t.date<=S.globalEnd&&t.revenue>0);
    const avgRev = ts2.length ? ts2.reduce((s,t)=>s+t.revenue,0)/ts2.length : 0;
    return {r:r2, avgRev};
  }).filter(x=>x.avgRev>0).sort((a,b)=>b.avgRev-a.avgRev);
  const max = withRev[0]?.avgRev||1;
  document.getElementById('rankBars').innerHTML=withRev.map(({r:r2,avgRev},i)=>{
    const me=r2.name===R.name;
    const ridx=RESTS.findIndex(r=>r.name===r2.name);
    return `<div class="rbar-row ${me?'me':''}" style="cursor:${me?'default':'pointer'};transition:opacity .15s" ${me?'':'onclick="selectRest('+ridx+')"'}>
      <div class="rbar-name ${me?'me':''}" title="${r2.name}">${i+1}. ${r2.name.replace('Чико (','').replace(')','').replace('Чико Рико ','Рико ').slice(0,22)}</div>
      <div class="rbar-t"><div class="rbar-f" style="width:${avgRev/max*100}%;background:${me?'var(--gold)':'var(--border2)'}"></div></div>
      <div class="rbar-v">${fmtR(avgRev)}</div>
    </div>`;
  }).join('');
}

// ═══ INSIGHTS ═══
function renderInsights(){
  const ts = getGlobalTs();
  if (!ts.length) return;
  const box = document.getElementById('insBox');
  if (!box) return;

  const cur = {
    revenue:  safeAvg(ts,'revenue')||0,
    avgCheck: safeAvg(ts,'avgCheck')||0,
    checks:   safeAvg(ts,'checks')||0,
    foodcost: safeAvg(ts,'foodcost'),
    discount: safeAvg(ts,'discount')||0,
    delivery: safeAvg(ts,'delivery')||0,
  };
  const dp = cur.revenue>0 ? cur.delivery/cur.revenue*100 : 0;

  const bm = dowBenchmarks(ts);
  const daysN = ts.length;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();

  // Умная логика карточек:
  // - если у нас есть "моя норма" — сравниваем с ней (главное сравнение)
  // - дополнительно показываем где мы относительно сети (p50 и p75)
  // - цвет: red / amber / green в зависимости от отклонения
  // - денежная оценка — диапазон (60-100%) с контекстом
  const ins = [];

  // Helper: умная карточка для одной метрики
  // kind='revenue'|'avgCheck'|'foodcost'|'discount'|'delivery'
  // higherIsBetter: true для выручки, чека, доставки; false для foodcost, discount
  function buildCard(cfg) {
    const { icon, name, value, myNorm, netP50, netP75,
            higherIsBetter, unit, fmt, monthImpactFn } = cfg;
    if (value == null) return null;

    // Определяем "здоровье" метрики
    let tone = 'blue'; // neutral default
    let headline = '';
    let body = '';
    let action = null;

    if (bm.haveMy && myNorm && myNorm > 0) {
      const diffPct = (value - myNorm) / myNorm * 100;
      const better = higherIsBetter ? diffPct > 0 : diffPct < 0;
      const magnitude = Math.abs(diffPct);

      if (magnitude < 5) {
        tone = 'green';
        headline = `${name} ${fmt(value)} — в вашей норме`;
        body = `Ваша норма по таким дням: ${fmt(myNorm)}${unit||''}. Разница ${fmtN(diffPct,1)}%.`;
      } else if (better) {
        tone = 'green';
        headline = `${name} ${fmt(value)} — лучше вашей нормы на ${fmtN(magnitude,1)}%`;
        body = `Ваша норма ${fmt(myNorm)}${unit||''}. Зафиксируйте что сработало.`;
      } else {
        tone = magnitude > 15 ? 'red' : 'amber';
        headline = `${name} ${fmt(value)} — хуже вашей нормы на ${fmtN(magnitude,1)}%`;
        body = `Ваша норма по таким дням: ${fmt(myNorm)}${unit||''}.`;
        // Контекст сети
        if (bm.haveNet && netP50) {
          const vsNet = (value - netP50)/netP50*100;
          const vsNetBetter = higherIsBetter ? vsNet > 0 : vsNet < 0;
          if (vsNetBetter) {
            body += ` При этом по сети вы всё ещё ${higherIsBetter?'выше':'лучше'} медианы (${fmt(netP50)}).`;
          } else {
            body += ` И ниже медианы сети (${fmt(netP50)}).`;
          }
        }
        // Денежный эффект при возврате к норме
        if (monthImpactFn) {
          const impactMax = monthImpactFn(value, myNorm);
          if (impactMax > 0) {
            const impactMin = Math.round(impactMax * 0.6);
            action = `≈ ${fmtR(impactMin)}–${fmtR(impactMax)}/мес, если вернётесь к своей норме`;
          }
        }
      }
    } else if (bm.haveNet && netP50 && netP50 > 0) {
      // Fallback: нет своей нормы, сравниваем с сетью
      const diffPct = (value - netP50) / netP50 * 100;
      const better = higherIsBetter ? diffPct > 0 : diffPct < 0;
      const magnitude = Math.abs(diffPct);

      if (better) {
        tone = 'green';
        headline = `${name} ${fmt(value)} — выше медианы сети на ${fmtN(magnitude,1)}%`;
        body = `Медиана сети ${fmt(netP50)}${unit||''} за такие же дни недели.`;
        if (netP75 && (higherIsBetter ? value < netP75 : value > netP75)) {
          const gap = higherIsBetter ? netP75 - value : value - netP75;
          body += ` До топ-25% сети: ${fmt(Math.abs(gap))}${unit||''}.`;
        }
      } else {
        tone = magnitude > 15 ? 'red' : 'amber';
        headline = `${name} ${fmt(value)} — ниже медианы сети на ${fmtN(magnitude,1)}%`;
        body = `Медиана сети ${fmt(netP50)}${unit||''} за такие же дни недели.`;
        if (monthImpactFn) {
          const impactMax = monthImpactFn(value, netP50);
          if (impactMax > 0) {
            const impactMin = Math.round(impactMax * 0.6);
            action = `≈ ${fmtR(impactMin)}–${fmtR(impactMax)}/мес, если догоните медиану сети`;
          }
        }
      }
    } else {
      return null; // нет данных для сравнения
    }

    return { t:tone, i:icon, h:headline, b:body, a:action };
  }

  // Выручка
  ins.push(buildCard({
    icon:'💰', name:'Выручка', value:cur.revenue,
    myNorm:bm.my.rev, netP50:bm.net_p50.rev, netP75:bm.net_p75.rev,
    higherIsBetter:true, unit:'', fmt:v=>fmtR(v),
    monthImpactFn: (val, target) => Math.round((target-val)*daysInMonth)
  }));

  // Средний чек
  ins.push(buildCard({
    icon:'🧾', name:'Средний чек', value:cur.avgCheck,
    myNorm:bm.my.chk, netP50:bm.net_p50.chk, netP75:bm.net_p75.chk,
    higherIsBetter:true, unit:'', fmt:v=>fmtR(v,true),
    monthImpactFn: (val, target) => Math.round((target-val)*cur.checks*daysInMonth)
  }));

  // Foodcost
  if (cur.foodcost !== null) {
    ins.push(buildCard({
      icon:'🥩', name:'Фудкост', value:cur.foodcost,
      myNorm:bm.my.fc, netP50:bm.net_p50.fc, netP75:bm.net_p75.fc,
      higherIsBetter:false, unit:'%', fmt:v=>fmtN(v,1),
      monthImpactFn: (val, target) => {
        // Снижение фудкоста с val до target экономит (val-target)% от выручки
        const net_rub = cur.revenue * (1 - cur.discount/100);
        return Math.round(net_rub * (val-target)/100 * daysInMonth);
      }
    }));
  }

  // Скидки
  ins.push(buildCard({
    icon:'🏷️', name:'Скидки', value:cur.discount,
    myNorm:bm.my.disc, netP50:bm.net_p50.disc, netP75:bm.net_p75.disc,
    higherIsBetter:false, unit:'%', fmt:v=>fmtN(v,1),
    monthImpactFn: (val, target) => Math.round(cur.revenue*(val-target)/100*daysInMonth)
  }));

  // Доставка — показываем только если у ресторана есть доставка (>1%)
  if (dp > 1) {
    ins.push(buildCard({
      icon:'🛵', name:'Доставка', value:dp,
      myNorm:bm.my.del, netP50:bm.net_p50.del, netP75:bm.net_p75.del,
      higherIsBetter:true, unit:'%', fmt:v=>fmtN(v,1),
      monthImpactFn: (val, target) => Math.round(cur.revenue*(target-val)/100*daysInMonth)
    }));
  }

  // DOW-анализ: показываем только если период ≥ 14 дней и каждый день ≥ 2 точек
  if (daysN >= 14) {
    const byDow = {};
    ts.forEach(t => {
      const d = getDOW(t.date);
      if (!byDow[d]) byDow[d] = [];
      byDow[d].push(t.revenue);
    });
    const dowEntries = Object.entries(byDow)
      .map(([d,v]) => ({d:+d, avg:avgArr(v), n:v.length}))
      .filter(x => x.n >= 2)
      .sort((a,b) => b.avg - a.avg);
    if (dowEntries.length >= 2) {
      const best = dowEntries[0], worst = dowEntries[dowEntries.length-1];
      if (best.d !== worst.d && best.avg > worst.avg * 1.15) {
        ins.push({ t:'blue', i:'📅',
          h:`${DOW_NAMES[best.d]} — лучший день (${fmtR(best.avg)})`,
          b:`Разрыв с ${DOW_NAMES[worst.d]} (${fmtR(worst.avg)}) — ×${(best.avg/worst.avg).toFixed(1)}. За ${daysN} дней.`,
          a:null });
      }
    }
  }

  // Рендер: фильтруем null карточки, сортируем (red → amber → green → blue), берём до 6
  const validIns = ins.filter(x => x);
  const order = { red:0, amber:1, green:2, blue:3 };
  validIns.sort((a,b) => (order[a.t]||9) - (order[b.t]||9));
  box.innerHTML = validIns.slice(0,6).map(i =>
    `<div class="ins-card ${i.t}"><div class="ins-t">${i.i} ${i.h}</div><div class="ins-b">${i.b}</div>${i.a?`<div class="ins-a">💡 ${i.a}</div>`:''}</div>`
  ).join('');
}

// ═══ DYNAMICS ═══
// ═══ DYNAMICS (Фаза 1.5) ═══

function setDynGroup(mode,btn){
  S.dynGroup=mode;
  document.querySelectorAll('#dynGroupBtns .pbtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderDynamics();
}
function setRevM(m,btn){S.revMetric=m;document.querySelectorAll('#revMBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderRevChart()}
function setDOWMet(m,btn){S.dowMetric=m;document.querySelectorAll('#dowMetBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderDOW()}
function setDowFilter(f,btn){S.dowFilter=f;document.querySelectorAll('#dowFilterBtns .pbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderDowFilter()}

function groupTs(ts, mode) {
  if (mode === 'day' || !mode) return ts;
  const groups = {};
  for (const t of ts) {
    let key;
    if (mode === 'week') {
      const d = new Date(t.date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const mon = new Date(d.getFullYear(), d.getMonth(), diff);
      key = mon.toISOString().slice(0,10);
    } else if (mode === 'month') {
      key = t.date.slice(0,7);
    } else if (mode === 'quarter') {
      const m = parseInt(t.date.slice(5,7));
      key = t.date.slice(0,4) + '-Q' + Math.ceil(m/3);
    } else if (mode === 'year') {
      key = t.date.slice(0,4);
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  const MLBL = ['','Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  return Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([key, items]) => {
    const totalRev = items.reduce((s,t) => s + t.revenue, 0);
    const totalChecks = items.reduce((s,t) => s + t.checks, 0);
    let label = key;
    if (mode === 'week') { const d=new Date(key); label=d.getDate()+' '+MLBL[d.getMonth()+1]; }
    else if (mode === 'month') { const m=parseInt(key.slice(5,7)); label=MLBL[m]+' '+key.slice(2,4); }
    else if (mode === 'quarter') { label=key.replace('-',' '); }
    return {
      date: key,
      label,
      revenue: totalRev,
      bar: items.reduce((s,t) => s + (t.bar||0), 0),
      kitchen: items.reduce((s,t) => s + (t.kitchen||0), 0),
      delivery: items.reduce((s,t) => s + (t.delivery||0), 0),
      avgCheck: totalChecks > 0 ? totalRev / totalChecks : 0,
      checks: totalChecks,
      foodcost: totalRev > 0 ? items.reduce((s,t) => s + (t.foodcost||0) * t.revenue, 0) / totalRev : 0,
      discount: totalRev > 0 ? items.reduce((s,t) => s + (t.discount||0) * t.revenue, 0) / totalRev : 0,
      deliveryPct: totalRev > 0 ? items.reduce((s,t) => s + (t.delivery||0), 0) / totalRev * 100 : 0,
      itemsPerCheck: 0,
      _days: items.length,
    };
  });
}

function getDynTs(){
  const ts = getTsRange(R, S.dynStart, S.dynEnd);
  return groupTs(ts, S.dynGroup);
}
function getDynTsRaw(){
  return getTsRange(R, S.dynStart, S.dynEnd);
}

function getNetGroupedTs(){
  // Build real network ts grouped the same way as current view
  // Normalized to per-restaurant average (for fair comparison with single restaurant)
  if (NETWORK_MODE) return null; // уже смотрим сеть — линия сети не нужна
  const netR = buildNetworkR();
  const netRaw = getTsRange(netR, S.dynStart, S.dynEnd);
  const grouped = groupTs(netRaw, S.dynGroup);
  const nRest = RESTS.length || 1;
  // Для суммируемых метрик делим на кол-во ресторанов, для % оставляем как есть
  return grouped.map(t => ({
    ...t,
    revenue: t.revenue / nRest,
    bar: t.bar / nRest,
    kitchen: t.kitchen / nRest,
    delivery: t.delivery / nRest,
    checks: t.checks / nRest,
    // avgCheck, foodcost, discount — уже средние, не делим
  }));
}

function renderDynamics(){
  const netTs = getNetGroupedTs();
  renderRevChart(netTs);
  renderLineChart2('chkC','avgCheck','#4A9EF5','Средний чек',netTs,v=>fmtR(v));
  renderLineChart2('cntC','checks','#9B59B6','Чеков',netTs,null);
  renderLineChart2('fcC','foodcost','#F39C12','Фудкост %',netTs,null);
  renderLineChart2('discC','discount','#E74C3C','Скидки %',netTs,null);
  renderDOW();
  renderDowFilter();
  renderDynStats();
}
function renderRevChart(netTs){
  const groupLabels={day:'дням',week:'неделям',month:'месяцам',quarter:'кварталам',year:'годам'};
  const ttl=document.getElementById('revChartTitle');
  if(ttl) ttl.innerHTML='💰 Выручка по '+(groupLabels[S.dynGroup]||'дням');
  const ts=getDynTs();
  const mc={revenue:'#D4A84B',kitchen:'#4A9EF5',bar:'#9B59B6',delivery:'#2ECC71'};
  const ml={revenue:'Общая',kitchen:'Кухня',bar:'Бар',delivery:'Доставка'};
  const lbls = ts.map(t => t.label || fmtD(t.date));
  const metric = S.revMetric;
  const datasets = [{label:ml[metric],data:ts.map(t=>t[metric]||0),backgroundColor:mc[metric]+'99',borderColor:mc[metric],borderWidth:1,borderRadius:4}];
  // Линия сети — реальные данные за тот же период
  if (netTs && netTs.length) {
    const netMap = {};
    netTs.forEach(t => { netMap[t.date] = t; });
    datasets.push({label:'Сеть',data:ts.map(t=> { const n=netMap[t.date]; return n ? (n[metric]||0) : 0; }),type:'line',borderColor:'rgba(142,170,206,.5)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false});
  }
  const opts = chartOpts(v=>fmtR(v));
  // Tooltip: доля от выручки для Кухня/Бар/Доставка
  if (metric !== 'revenue') {
    opts.plugins.tooltip = {callbacks:{label:function(ctx){
      const val = ctx.raw || 0;
      const idx = ctx.dataIndex;
      const total = ts[idx] ? ts[idx].revenue : 0;
      const pct = total > 0 ? (val/total*100).toFixed(1) : '0';
      return ctx.dataset.label+': '+fmtR(val)+' ('+pct+'% выручки)';
    }}};
  }
  mkChart('revC',{type:'bar',data:{labels:lbls,datasets},options:opts});
}
function renderLineChart2(id,key,color,label,netTs,yCb){
  const ts=getDynTs().filter(t=>t[key]!==null&&t[key]!==undefined);
  const lbls = ts.map(t => t.label || fmtD(t.date));
  const ds=[{label,data:ts.map(t=>t[key]||0),borderColor:color,backgroundColor:color+'22',borderWidth:2,pointRadius:ts.length>50?0:3,pointBackgroundColor:color,fill:true,tension:.3}];
  // Линия сети — реальные данные
  if (netTs && netTs.length) {
    const netMap = {};
    netTs.forEach(t => { netMap[t.date] = t; });
    ds.push({label:'Сеть',data:ts.map(t=> { const n=netMap[t.date]; return n ? (n[key]||0) : 0; }),borderColor:'rgba(142,170,206,.5)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false});
  }
  mkChart(id,{type:'line',data:{labels:lbls,datasets:ds},options:chartOpts(yCb||null)});
}

function renderDOW(){
  const ts=getDynTsRaw();
  const byDow={};
  ts.forEach(t=>{const d=getDOW(t.date);if(!byDow[d])byDow[d]=[];byDow[d].push({v:t[S.dowMetric]||0,date:t.date})});
  const order=[1,2,3,4,5,6,0]; // Mon..Sun
  const avgs=order.map(d=>({d,avg:byDow[d]?avgArr(byDow[d].map(x=>x.v)):null,count:byDow[d]?.length||0}));
  const validAvgs=avgs.filter(a=>a.avg!==null);
  const maxAvg=Math.max(...validAvgs.map(a=>a.avg));
  const minAvg=Math.min(...validAvgs.map(a=>a.avg));

  document.getElementById('dowCards').innerHTML=avgs.map(a=>{
    const isWE=a.d===0||a.d===6;
    const isBest=a.avg===maxAvg&&a.avg!==null;
    const isWorst=a.avg===minAvg&&a.avg!==null&&validAvgs.length>1;
    let cls='dow-card';
    if(isWE) cls+=' weekend';
    if(isBest) cls+=' best';
    else if(isWorst) cls+=' worst';
    const val=a.avg!==null?(S.dowMetric==='revenue'||S.dowMetric==='avgCheck'?fmtR(a.avg):fmtN(a.avg,1)):'-';
    return `<div class="${cls}"><div class="dow-name">${DOW_NAMES[a.d]}</div><div class="dow-rev" style="font-size:16px">${val}</div><div class="dow-chk">${a.count} дней</div><div class="dow-badge ${isWE?'badge-we':'badge-wd'}">${isWE?'выходной':'будни'}</div></div>`;
  }).join('');

  // DOW bar chart
  mkChart('dowC',{type:'bar',data:{labels:avgs.map(a=>DOW_NAMES[a.d]),datasets:[{label:S.dowMetric,data:avgs.map(a=>a.avg||0),backgroundColor:avgs.map(a=>(a.d===0||a.d===6)?'rgba(212,168,75,.7)':'rgba(74,158,245,.7)'),borderColor:avgs.map(a=>(a.d===0||a.d===6)?'#D4A84B':'#4A9EF5'),borderWidth:1,borderRadius:5}]},options:{...chartOpts(S.dowMetric==='revenue'||S.dowMetric==='avgCheck'?v=>fmtR(v):null)}});
}

function renderDowFilter(){
  const ts=getDynTsRaw();
  const f=S.dowFilter;
  const DOW_MAP={all:null,weekday:[1,2,3,4,5],weekend:[0,6],mon:[1],tue:[2],wed:[3],thu:[4],fri:[5],sat:[6],sun:[0]};
  const allowed=DOW_MAP[f];
  const filtered=allowed?ts.filter(t=>allowed.includes(getDOW(t.date))):ts;
  if(!filtered.length){document.getElementById('dowStats').textContent='Нет данных для выбранного фильтра';return;}

  const avgR=avgArr(filtered.map(t=>t.revenue));
  const avgC=avgArr(filtered.map(t=>t.avgCheck));
  const avgCnt=avgArr(filtered.map(t=>t.checks));
  document.getElementById('dowStats').innerHTML=`<span style="color:var(--text2)">Среднее за выбранный фильтр:</span> выручка <b style="color:var(--gold)">${fmtR(avgR)}</b> · чек <b style="color:var(--gold)">${fmtR(avgC)}</b> · чеков <b style="color:var(--gold)">${Math.round(avgCnt)}</b> · дней: ${filtered.length}`;

  mkChart('dowFilterC',{type:'line',data:{labels:filtered.map(t=>fmtD(t.date)+' ('+DOW_NAMES[getDOW(t.date)]+')'),datasets:[{label:'Выручка',data:filtered.map(t=>t.revenue),borderColor:'#D4A84B',backgroundColor:'rgba(212,168,75,.1)',borderWidth:2,pointRadius:4,fill:true,tension:.2}]},options:{...chartOpts(v=>fmtR(v)),plugins:{legend:{display:false}}}});
}

function renderDynStats(){
  const ts=getDynTs();
  const metrics=[{k:'revenue',l:'Выручка',f:fmtR,lb:false},{k:'avgCheck',l:'Ср. чек',f:fmtR,lb:false},{k:'checks',l:'Чеков',f:v=>Math.round(v),lb:false},{k:'foodcost',l:'Фудкост %',f:v=>v!==null?fmtN(v)+'%':'—',lb:true},{k:'discount',l:'Скидки %',f:v=>fmtN(v)+'%',lb:true}];
  document.getElementById('dynStatB').innerHTML=metrics.map(m=>{
    const vals=ts.map(t=>t[m.k]).filter(v=>v!==null&&v!==undefined&&v>0);
    if(!vals.length) return '';
    const mn=Math.min(...vals),mx=Math.max(...vals),avg=avgArr(vals),last=vals[vals.length-1],prev2=vals.length>=2?vals[vals.length-2]:null;
    let trend='';
    if(prev2!==null){
      const went_up=last>prev2, went_dn=last<prev2;
      if(went_up||went_dn){
        const good=m.lb?went_dn:went_up;
        trend=`<span class="${good?'up':'dn'}">${good?'▲':'▼'} ${Math.abs(((last-prev2)/prev2)*100).toFixed(1)}%</span>`;
      } else { trend='<span class="nt">→</span>'; }
    }
    return `<tr><td class="c-m">${m.l}</td><td>${m.f(mn)}</td><td>${m.f(mx)}</td><td>${m.f(avg)}</td><td class="c-s">${m.f(last)}</td><td>${trend}</td></tr>`;
  }).join('');
}

// ═══ COMPARE ═══
function buildCompSlots(){
  const area=document.getElementById('compSlots');
  const lblColors=['var(--gold)','var(--teal)','var(--purple)','var(--amber)','var(--red)'];
  area.innerHTML=Array.from({length:N_COMP},(_,i)=>`
    <div class="comp-slot">
      <div class="comp-lbl" style="color:${lblColors[i]}">Точка ${i+1}</div>
      <select class="comp-sel" id="cs${i}" onchange="renderCompare()">
        ${i===0?'':'<option value="">— не выбрана —</option>'}
        ${RESTS.map((r,j)=>`<option value="${j}" ${i===0&&j===S.restIdx?'selected':''}>${r.city}</option>`).join('')}
      </select>
    </div>`).join('');
}
function getCompRests(){
  return Array.from({length:N_COMP},(_,i)=>{
    const el=document.getElementById('cs'+i);
    if(!el||el.value==='') return null;
    return RESTS[parseInt(el.value)];
  }).filter(Boolean);
}
function getCmpTs(r){return groupTs(getTsRange(r,S.cmpStart,S.cmpEnd), S.cmpGroup)}
function getCompMetVal(r2,m){
  const ts=getCmpTs(r2);
  if(!ts.length) return 0;
  if(m==='delivPct'){const r=safeAvg(ts,'revenue')||1,d=safeAvg(ts,'delivery')||0;return d/r*100;}
  return safeAvg(ts,m)||0;
}

function setCmpGroup(mode,btn){S.cmpGroup=mode;document.querySelectorAll('#cmpGroupBtns .pbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderCompare()}
function setCmpM(m,btn){S.compMetric=m;document.querySelectorAll('#compMBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderCompare()}
function renderCompare(){
  const comps=getCompRests();
  if(!comps.length) return;
  const groupLabels={day:'дням',week:'неделям',month:'месяцам',quarter:'кварталам',year:'годам'};
  const trTitle=document.getElementById('cmpTrTitle');
  if(trTitle) trTitle.innerHTML='📈 Тренд выручки по '+(groupLabels[S.cmpGroup]||'дням');
  const isRub=['revenue','avgCheck'].includes(S.compMetric);
  const netVals={revenue:NET.revenue,avgCheck:NET.avgCheck,checks:NET.checks,foodcost:NET.foodcost,discount:NET.discount,delivPct:NET.deliveryPct};

  mkChart('cmpBarC',{type:'bar',data:{
    labels:comps.map(r2=>r2.city),
    datasets:[
      {data:comps.map(r2=>getCompMetVal(r2,S.compMetric)),backgroundColor:comps.map((_,i)=>COMP_COLORS[i]+'99'),borderColor:comps.map((_,i)=>COMP_COLORS[i]),borderWidth:1,borderRadius:4},
      {label:'Сеть',data:comps.map(()=>netVals[S.compMetric]),type:'line',borderColor:'rgba(142,170,206,.4)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false}
    ]
  },options:{...chartOpts(v=>isRub?fmtR(v):v),plugins:{legend:{display:false}}}});

  const baseDates=getCmpTs(comps[0]).map(t=>t.label||fmtD(t.date));
  mkChart('cmpTrC',{type:'line',data:{labels:baseDates,datasets:comps.map((r2,i)=>({label:r2.city,data:getCmpTs(r2).map(t=>t.revenue),borderColor:COMP_COLORS[i],backgroundColor:COMP_COLORS[i]+'15',borderWidth:i===0?2.5:1.5,pointRadius:i===0?3:2,fill:false,tension:.3}))},options:chartOpts(v=>fmtR(v))});

  const metrics=[{k:'revenue',l:'Выручка',f:fmtR,lb:false},{k:'avgCheck',l:'Ср. чек',f:fmtR,lb:false},{k:'checks',l:'Чеков/день',f:v=>Math.round(v),lb:false},{k:'foodcost',l:'Фудкост %',f:v=>v!==null?fmtN(v)+'%':'—',lb:true},{k:'discount',l:'Скидки %',f:v=>fmtN(v)+'%',lb:true},{k:'delivPct',l:'Доставка %',f:v=>fmtN(v,1)+'%',lb:false}];
  document.getElementById('cmpTH').innerHTML=`<tr><th>Метрика</th>${comps.map((r2,i)=>`<th style="color:${COMP_COLORS[i]}">${r2.city}</th>`).join('')}</tr>`;
  document.getElementById('cmpTB').innerHTML=metrics.map(m=>{
    const vals=comps.map(r2=>getCompMetVal(r2,m.k));
    const validVals=vals.filter(v=>v!==null&&v!==undefined&&v>0);
    const best=validVals.length?(m.lb?Math.min(...validVals):Math.max(...validVals)):null;
    return `<tr><td class="c-m">${m.l}</td>${comps.map((r2,i)=>{
      const v=vals[i];
      const isLeader=best!==null&&v===best&&validVals.length>1;
      return `<td style="color:${COMP_COLORS[i]};font-weight:${i===0?600:400};${isLeader?'background:rgba(46,204,113,.12);border-radius:4px':''}"><span>${isLeader?'🏆 ':''}${m.f(v)}</span></td>`;
    }).join('')}</tr>`;
  }).join('');

  const r=comps[0],dp=r.revenue>0?r.delivery/r.revenue*100:0;
  // #43 extension: если у ресторана доставки нет (≤1%) — не показываем строку
  // в таблице vs Сеть/ТОП-10. KPI-карточка скрывается отдельно (см. выше).
  const hasDelivery = dp > 1;
  const rows=[{l:'Выручка/день',s:r.revenue,n:NET.revenue,t:TOP10.revenue,f:fmtR,lb:false},{l:'Ср. чек',s:r.avgCheck,n:NET.avgCheck,t:TOP10.avgCheck,f:fmtR,lb:false},{l:'Чеков/день',s:r.checks,n:NET.checks,t:null,f:v=>Math.round(v),lb:false},{l:'Фудкост %',s:r.foodcost,n:NET.foodcost,t:TOP10.foodcost,f:v=>v!==null?fmtN(v)+'%':'—',lb:true},{l:'Скидки %',s:r.discount,n:NET.discount,t:TOP10.discount,f:v=>fmtN(v,1)+'%',lb:true}];
  if (hasDelivery) rows.push({l:'Доставка %',s:dp,n:NET.deliveryPct,t:TOP10.deliveryPct,f:v=>fmtN(v,1)+'%',lb:false});
  // Update "ваша точка" header with city name
  const ownHdr=document.getElementById('netTH_own');
  if(ownHdr) ownHdr.textContent=comps[0]?comps[0].city:'Точка 1';
  document.getElementById('netTB').innerHTML=rows.map(row=>{
    if(row.s===null) return '';
    const vn=pctD(row.s,row.n),vt=row.t!==null?pctD(row.s,row.t):null;
    const on=row.lb?vn<0:vn>0,ot=vt!==null?(row.lb?vt<0:vt>0):null;
    return `<tr><td class="c-m">${row.l}</td><td class="c-s">${row.f(row.s)}</td><td class="c-n">${row.f(row.n)}</td><td class="c-t">${row.t!==null?row.f(row.t):'—'}</td><td class="${on?'tag-u':'tag-d'}">${on?'▲':'▼'} ${Math.abs(vn).toFixed(1)}%</td><td>${vt!==null?`<span class="${ot?'tag-u':'tag-d'}">${ot?'▲':'▼'} ${Math.abs(vt).toFixed(1)}%</span>`:'—'}</td></tr>`;
  }).join('');
}

// ═══ ANALYSIS ═══
// #76 B v2 (21.04.2026): три связанных фикса.
//
// ФИКС A (baseline из 90 дней): ползунки инициализируются из последних 90
//   дней истории ресторана, не из выбранного фильтром периода. Бейзлайн
//   стабильный — не прыгает когда пользователь меняет даты сверху.
//
// ФИКС B (точная синхронизация): после установки ползунков — читаем их
//   .value обратно в S.plWd*. Так как ползунок имеет step=10 (для чека)
//   и step=0.1 (для %), точные значения из safeAvg() округляются к
//   ближайшему шагу. Без этого фикс «сброс → эффект != 0».
//
// ФИКС C (остаток месяца): итог месяца = фактическая маржа прошедших
//   дней + (оставшиеся будн × маржа_будни) + (оставшиеся вых × маржа_вых).
//   Сценарные изменения применяются только к оставшейся части — это
//   честно: что прошло, то прошло.

function computePlContext() {
  const maxStr = MAX_DATE || '2026-04-30';
  const [year, month1, todayDay] = maxStr.split('-').map(Number);
  const month0 = month1 - 1;
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();

  // Оставшиеся дни текущего месяца (от today+1 до последнего дня)
  let remWd = 0, remWe = 0;
  for (let d = todayDay + 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (isWeekend(dateStr)) remWe++; else remWd++;
  }

  // Прошедшие дни текущего месяца: считаем фактическую маржу и выручку из R.ts.
  // t.revenue — это NETTO-выручка из iiko (уже за вычетом скидок), поэтому
  // вычитаем только фудкост. Повторно вычитать disc — двойной счёт (см. plCalc).
  const monthPrefix = `${year}-${String(month1).padStart(2,'0')}-`;
  let pastActualMargin = 0;
  let pastActualRev = 0;
  let pastWd = 0, pastWe = 0;
  for (const t of R.ts) {
    if (t.date && t.date.indexOf(monthPrefix) === 0 && t.revenue > 0) {
      const fc = +t.foodcost || 0;
      const fcAmt = t.revenue * fc / 100; // фудкост применяется к netto-выручке
      pastActualMargin += t.revenue - fcAmt;
      pastActualRev += t.revenue;
      if (isWeekend(t.date)) pastWe++; else pastWd++;
    }
  }

  // Baseline: последние 90 дней истории ресторана (не выбранный период)
  const todayDt = new Date(year, month0, todayDay);
  const ninetyAgo = new Date(todayDt);
  ninetyAgo.setDate(ninetyAgo.getDate() - 90);
  const cutoffStr = `${ninetyAgo.getFullYear()}-${String(ninetyAgo.getMonth()+1).padStart(2,'0')}-${String(ninetyAgo.getDate()).padStart(2,'0')}`;
  const base90 = R.ts.filter(t => t.date && t.date >= cutoffStr && t.revenue > 0);
  const wd90 = base90.filter(t => !isWeekend(t.date));
  const we90 = base90.filter(t => isWeekend(t.date));

  const wdBase = {
    chk:  safeAvg(wd90, 'avgCheck') || R.avgCheck || 1400,
    cnt:  safeAvg(wd90, 'checks')   || R.checks   || 80,
    fc:   safeAvg(wd90, 'foodcost') || NET.foodcost || 23,
    disc: safeAvg(wd90, 'discount') || R.discount || 7,
  };
  const weBase = {
    chk:  safeAvg(we90, 'avgCheck') || R.avgCheck || 1400,
    cnt:  safeAvg(we90, 'checks')   || R.checks   || 80,
    fc:   safeAvg(we90, 'foodcost') || NET.foodcost || 23,
    disc: safeAvg(we90, 'discount') || R.discount || 7,
  };

  return {
    wdBase, weBase,
    remWd, remWe,
    pastWd, pastWe, pastActualMargin, pastActualRev,
    todayStr: maxStr, daysInMonth, base90Days: base90.length,
  };
}

function renderAnalysis(){
  renderWDB();
  const ctx = computePlContext();
  S._plCtx = ctx; // кэшируем для calcPL

  // Устанавливаем ползунки в значения из 90-дневного baseline (без фудкоста —
  // он в P&L вкладке).
  document.getElementById('sl-wd-chk').value  = Math.round(ctx.wdBase.chk);
  document.getElementById('sl-wd-cnt').value  = Math.round(ctx.wdBase.cnt);
  document.getElementById('sl-wd-disc').value = ctx.wdBase.disc.toFixed(1);
  document.getElementById('sl-we-chk').value  = Math.round(ctx.weBase.chk);
  document.getElementById('sl-we-cnt').value  = Math.round(ctx.weBase.cnt);
  document.getElementById('sl-we-disc').value = ctx.weBase.disc.toFixed(1);

  // ФИКС B: читаем ползунки ОБРАТНО — так как ползунок округляет к своему step.
  // Без этого S.plWd* != то что в ползунке → при сбросе эффект ≠ 0.
  S.plWdChk  = +document.getElementById('sl-wd-chk').value;
  S.plWdCnt  = +document.getElementById('sl-wd-cnt').value;
  S.plWdDisc = +document.getElementById('sl-wd-disc').value;
  S.plWeChk  = +document.getElementById('sl-we-chk').value;
  S.plWeCnt  = +document.getElementById('sl-we-cnt').value;
  S.plWeDisc = +document.getElementById('sl-we-disc').value;

  calcPL();
}
function resetPL(){renderAnalysis()}

function renderWDB(){
  const ts=getGlobalTs();
  const wdTs=ts.filter(t=>!isWeekend(t.date));
  const weTs=ts.filter(t=>isWeekend(t.date));
  const wdR=safeAvg(wdTs,'revenue')||0,weR=safeAvg(weTs,'revenue')||0;
  const wdC=safeAvg(wdTs,'avgCheck')||0,weC=safeAvg(weTs,'avgCheck')||0;
  const wdCnt=safeAvg(wdTs,'checks')||0,weCnt=safeAvg(weTs,'checks')||0;
  const wdFc=safeAvg(wdTs,'foodcost'),weFc=safeAvg(weTs,'foodcost');
  const wdDisc=safeAvg(wdTs,'discount')||0,weDisc=safeAvg(weTs,'discount')||0;

  document.getElementById('wdbGrid').innerHTML=`
    <div class="wdb-box wd">
      <div class="wdb-t" style="color:var(--blue)">📅 Будни (Пн–Пт) · ${wdTs.length} дней</div>
      <div class="wdb-rev" style="color:var(--blue)">${fmtR(wdR)}</div>
      <div style="font-size:9px;color:var(--text3);margin-bottom:8px">средняя выручка/день</div>
      <div class="wdb-row"><span>Средний чек</span><span style="color:var(--text)">${fmtR(wdC)}</span></div>
      <div class="wdb-row"><span>Чеков/день</span><span style="color:var(--text)">${Math.round(wdCnt)}</span></div>
      <div class="wdb-row"><span>Фудкост</span><span style="color:var(--text)">${wdFc!==null?fmtN(wdFc)+'%':'—'}</span></div>
      <div class="wdb-row"><span>Скидки</span><span style="color:var(--text)">${fmtN(wdDisc,1)}%</span></div>
    </div>
    <div class="wdb-box we">
      <div class="wdb-t" style="color:var(--gold)">🎉 Выходные (Сб–Вс) · ${weTs.length} дней</div>
      <div class="wdb-rev" style="color:var(--gold)">${fmtR(weR)}</div>
      <div style="font-size:9px;color:var(--text3);margin-bottom:8px">средняя выручка/день</div>
      <div class="wdb-row"><span>Средний чек</span><span style="color:var(--text)">${fmtR(weC)}</span></div>
      <div class="wdb-row"><span>Чеков/день</span><span style="color:var(--text)">${Math.round(weCnt)}</span></div>
      <div class="wdb-row"><span>Фудкост</span><span style="color:var(--text)">${weFc!==null?fmtN(weFc)+'%':'—'}</span></div>
      <div class="wdb-row"><span>Скидки</span><span style="color:var(--text)">${fmtN(weDisc,1)}%</span></div>
    </div>`;

  // Chart showing WD vs WE by day
  // Chart showing revenue by day with weekday/weekend color coding
  mkChart('wdC',{type:'bar',data:{
    labels:ts.map(t=>fmtD(t.date)+' '+DOW_NAMES[getDOW(t.date)]),
    datasets:[
      {label:'Выручка',data:ts.map(t=>t.revenue),backgroundColor:ts.map(t=>isWeekend(t.date)?'rgba(212,168,75,.7)':'rgba(74,158,245,.7)'),borderColor:ts.map(t=>isWeekend(t.date)?'#D4A84B':'#4A9EF5'),borderWidth:1,borderRadius:3},
      {label:'Будни (среднее)',data:ts.map(()=>wdR),type:'line',borderColor:'rgba(74,158,245,.5)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false},
      {label:'Выходные (среднее)',data:ts.map(()=>weR),type:'line',borderColor:'rgba(212,168,75,.5)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false}
    ]
  },options:chartOpts(v=>fmtR(v))});

  // WDB insights
  const ins=[];
  if(weR>0&&wdR>0){
    const ratio=(weR/wdR).toFixed(1);
    if(weR/wdR>1.8) ins.push({t:'blue',txt:`Выходные приносят в <b>${ratio}×</b> больше чем будни. Оптимизируйте загрузку будних смен — это ${fmtR((weR-wdR)*10)}/месяц недополученной выручки.`});
    if(Math.abs(wdC-weC)/weC>0.1) ins.push({t:'amber',txt:`Средний чек в будни <b>${fmtR(wdC)}</b> vs выходные <b>${fmtR(weC)}</b>. Разрыв ${fmtN(Math.abs(pctD(wdC,weC)),0)}%. Введите будничные combo-предложения.`});
    if(wdFc!==null&&weFc!==null&&wdFc>weFc+1) ins.push({t:'amber',txt:`Фудкост в будни <b>${fmtN(wdFc)}%</b> выше чем в выходные <b>${fmtN(weFc)}%</b>. Причина: меньше трафика при тех же нормах закупок. Оптимизируйте заготовки.`});
  }
  document.getElementById('wdbInsights').innerHTML=ins.map(i=>`<div class="ins-card ${i.t}" style="margin:0"><div class="ins-b" style="font-size:11px">${i.txt}</div></div>`).join('');
}

// #76 B v3 (21.04.2026): chk из iiko — это NETTO-чек (уже за вычетом скидок).
// Прежний plCalc вычитал скидки повторно — это был двойной счёт и занижал
// маржу на ~5-7% (фактически на величину скидок × фудкост).
//
// Вариант C: если пользователь двигает ползунок скидок, предполагаем что
// клиентское поведение и гросс-чек (до скидки) остаются теми же, значит
// netto-чек пересчитывается:
//   effective_netto = baseline_netto × (1 − new_disc/100) / (1 − baseline_disc/100)
// Когда disc == baseline_disc (не трогали) — netFactor = 1, нейтрально.
// Когда disc < baseline (меньше скидок) — netto-чек растёт, маржа растёт.
function plCalc(chk, cnt, fc, disc, baselineDisc) {
  const baseDisc = (baselineDisc !== undefined) ? baselineDisc : disc;
  // Защита от >99% скидки (не делим на около-ноль)
  const safeBase = Math.max(0, Math.min(99, baseDisc));
  const safeDisc = Math.max(0, Math.min(99, disc));
  const netFactor = (1 - safeDisc/100) / (1 - safeBase/100);
  const effectiveChk = chk * netFactor;
  const rev = effectiveChk * cnt;                    // это netto (как в iiko)
  const grossRev = rev / Math.max(0.01, 1 - safeDisc/100);
  const discAmt = grossRev - rev;                    // для структуры нетто-выручки (бар-чарт)
  const fcAmt = rev * fc/100;
  const margin = rev - fcAmt;                        // Маржа до прочих расходов
  return { rev, discAmt, grossRev, fcAmt, margin, effectiveChk };
}
function plHtml_DEPRECATED_REMOVED_v76b(){ /* удалено в #76 B */ }

// #76 B v2: константы удалены — теперь считаем через контекст остатка месяца
// (pastActualMargin + remWd × wd_margin + remWe × we_margin). См. computePlContext.

function calcPL(){
  const slWdChk = document.getElementById('sl-wd-chk');
  if(!slWdChk) return; // Analysis tab not rendered yet
  const ctx = S._plCtx;
  if(!ctx) return;

  // Читаем 6 ползунков (без фудкоста — он в P&L вкладке)
  const wdChk = +slWdChk.value;
  const wdCnt = +document.getElementById('sl-wd-cnt').value;
  const wdDisc= +document.getElementById('sl-wd-disc').value;
  const weChk = +document.getElementById('sl-we-chk').value;
  const weCnt = +document.getElementById('sl-we-cnt').value;
  const weDisc= +document.getElementById('sl-we-disc').value;

  // Подписи. Средний чек — полный формат «1 897 ₽», остальные — как есть.
  document.getElementById('sl-wd-chk-v').textContent = fmtR(wdChk, true);
  document.getElementById('sl-wd-cnt-v').textContent = wdCnt;
  document.getElementById('sl-wd-disc-v').textContent= fmtN(wdDisc,1);
  document.getElementById('sl-we-chk-v').textContent = fmtR(weChk, true);
  document.getElementById('sl-we-cnt-v').textContent = weCnt;
  document.getElementById('sl-we-disc-v').textContent= fmtN(weDisc,1);

  // plCalc с фудкостом=0 — в revenue-калькуляторе фудкост не важен, margin
  // не используется. Оставляем 0 чтобы не плодить новую функцию для revenue-only.
  const FC_STUB = 0;
  const wdScen = plCalc(wdChk, wdCnt, FC_STUB, wdDisc, S.plWdDisc);
  const weScen = plCalc(weChk, weCnt, FC_STUB, weDisc, S.plWeDisc);
  const wdFact = plCalc(S.plWdChk, S.plWdCnt, FC_STUB, S.plWdDisc, S.plWdDisc);
  const weFact = plCalc(S.plWeChk, S.plWeCnt, FC_STUB, S.plWeDisc, S.plWeDisc);

  // Выручка/день для каждого сценария (под ползунками)
  document.getElementById('pl-wd-rev').textContent = fmtR(wdScen.rev);
  document.getElementById('pl-we-rev').textContent = fmtR(weScen.rev);

  // Подписи «осталось»
  document.getElementById('pl-wd-days').textContent = `осталось ${ctx.remWd} будн`;
  document.getElementById('pl-we-days').textContent = `осталось ${ctx.remWe} вых`;

  // Месячные итоги ВЫРУЧКИ = прошлое + остаток
  const factRem = wdFact.rev * ctx.remWd + weFact.rev * ctx.remWe;
  const scenRem = wdScen.rev * ctx.remWd + weScen.rev * ctx.remWe;
  const factMonth = ctx.pastActualRev + factRem;
  const scenMonth = ctx.pastActualRev + scenRem;
  const deltaMonth = scenRem - factRem;
  const deltaYear  = deltaMonth * 12;

  // Дельты по строкам для сценарной колонки
  const wdDeltaLine = (wdScen.rev - wdFact.rev) * ctx.remWd;
  const weDeltaLine = (weScen.rev - weFact.rev) * ctx.remWe;

  const fmtDelta = (v) => {
    if (Math.abs(v) < 1) return '';
    const color = v >= 0 ? 'var(--green)' : 'var(--red)';
    const sign = v >= 0 ? '+' : '';
    return ` <span style="color:${color};font-weight:600;font-size:11px;margin-left:6px">${sign}${fmtR(v)}</span>`;
  };

  // Факт-колонка: прошло + остаток по baseline = итог
  document.getElementById('plMonthFactual').innerHTML = `
    <div class="pl-r" title="Фактическая netto-выручка за прошедшие дни текущего месяца (из iiko)"><span class="pl-lbl">📆 Прошло: ${ctx.pastWd} будн + ${ctx.pastWe} вых</span><span class="pl-amt">${fmtR(ctx.pastActualRev)}</span></div>
    <div class="pl-r"><span class="pl-lbl">📅 Остаток будней: ${ctx.remWd} × ${fmtR(wdFact.rev)}</span><span class="pl-amt" style="color:var(--blue)">${fmtR(wdFact.rev * ctx.remWd)}</span></div>
    <div class="pl-r"><span class="pl-lbl">🎉 Остаток вых: ${ctx.remWe} × ${fmtR(weFact.rev)}</span><span class="pl-amt" style="color:var(--gold)">${fmtR(weFact.rev * ctx.remWe)}</span></div>
    <div class="pl-tot"><span class="pl-tot-lbl">Прогноз выручки/мес</span><span class="pl-tot-amt" style="color:var(--blue)">${fmtR(factMonth)}</span></div>
    <div style="font-size:10px;color:var(--text3);text-align:right;margin-top:4px">Год (при повторе): ${fmtR(factMonth*12)}</div>`;

  // Сценарий-колонка: прошло + остаток по ползункам = итог, с дельтами
  document.getElementById('plMonthScenario').innerHTML = `
    <div class="pl-r"><span class="pl-lbl">📆 Прошло: ${ctx.pastWd} будн + ${ctx.pastWe} вых <span style="color:var(--text3);font-size:9px">(не изменится)</span></span><span class="pl-amt">${fmtR(ctx.pastActualRev)}</span></div>
    <div class="pl-r"><span class="pl-lbl">📅 Остаток будней: ${ctx.remWd} × ${fmtR(wdScen.rev)}</span><span class="pl-amt" style="color:var(--blue)">${fmtR(wdScen.rev * ctx.remWd)}${fmtDelta(wdDeltaLine)}</span></div>
    <div class="pl-r"><span class="pl-lbl">🎉 Остаток вых: ${ctx.remWe} × ${fmtR(weScen.rev)}</span><span class="pl-amt" style="color:var(--gold)">${fmtR(weScen.rev * ctx.remWe)}${fmtDelta(weDeltaLine)}</span></div>
    <div class="pl-tot" title="Главное число — прирост выручки за остаток месяца"><span class="pl-tot-lbl">Прогноз выручки/мес</span><span class="pl-tot-amt" style="color:var(--gold)">${fmtR(scenMonth)}${fmtDelta(deltaMonth)}</span></div>
    <div style="font-size:10px;color:var(--text3);text-align:right;margin-top:4px">Год (при повторе): ${fmtR(scenMonth*12)}</div>`;

  // Плашки эффекта: прирост выручки
  const deltaColor = deltaMonth >= 0 ? 'var(--green)' : 'var(--red)';
  const deltaSign = deltaMonth >= 0 ? '+' : '';
  document.getElementById('plMonthEffect').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      <div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center" title="Прирост выручки за оставшиеся ${ctx.remWd}+${ctx.remWe} дней месяца">
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Прирост выручки на остаток месяца (${ctx.remWd+ctx.remWe} дн)</div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:${deltaColor}">${deltaSign}${fmtR(deltaMonth)}</div>
      </div>
      <div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center" title="Если сценарий повторять каждый месяц — эффект за 12 месяцев">
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Прирост выручки за год (при повторе)</div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:${deltaColor}">${deltaSign}${fmtR(deltaYear)}</div>
      </div>
    </div>`;

  // Разбор сценария (waterfall): вклад каждого ползунка в общий прирост.
  // Аддитивно применяем изменения ползунков по одному, от baseline к сценарию.
  // Порядок: будни (чек → чеки → скидки) → выходные (чек → чеки → скидки).
  // Каждый шаг показывает сколько ₽ добавилось именно за счёт этого изменения.
  const steps = [];
  // Текущее состояние — baseline, пересчитываем по мере применения изменений
  let curWdChk = S.plWdChk, curWdCnt = S.plWdCnt, curWdDisc = S.plWdDisc;
  let curWeChk = S.plWeChk, curWeCnt = S.plWeCnt, curWeDisc = S.plWeDisc;
  const curRev = () => {
    const wd = plCalc(curWdChk, curWdCnt, 0, curWdDisc, S.plWdDisc);
    const we = plCalc(curWeChk, curWeCnt, 0, curWeDisc, S.plWeDisc);
    return wd.rev * ctx.remWd + we.rev * ctx.remWe;
  };
  let prevRev = curRev();

  const applyStep = (emoji, label, changeDesc, updateFn) => {
    updateFn();
    const newRev = curRev();
    const delta = newRev - prevRev;
    if (Math.abs(delta) >= 1 || changeDesc) {
      steps.push({ emoji, label, changeDesc, delta });
    }
    prevRev = newRev;
  };

  // Будни
  if (wdChk !== S.plWdChk) {
    applyStep('📅', 'Будни — средний чек',
      `${fmtR(S.plWdChk, true)} → ${fmtR(wdChk, true)} (${wdChk >= S.plWdChk ? '+' : ''}${fmtR(wdChk - S.plWdChk, true)})`,
      () => { curWdChk = wdChk; });
  }
  if (wdCnt !== S.plWdCnt) {
    applyStep('📅', 'Будни — чеков в день',
      `${S.plWdCnt} → ${wdCnt} (${wdCnt >= S.plWdCnt ? '+' : ''}${wdCnt - S.plWdCnt})`,
      () => { curWdCnt = wdCnt; });
  }
  if (wdDisc !== S.plWdDisc) {
    applyStep('📅', 'Будни — скидки',
      `${fmtN(S.plWdDisc,1)}% → ${fmtN(wdDisc,1)}% (${wdDisc >= S.plWdDisc ? '+' : ''}${fmtN(wdDisc - S.plWdDisc, 1)}%)`,
      () => { curWdDisc = wdDisc; });
  }
  // Выходные
  if (weChk !== S.plWeChk) {
    applyStep('🎉', 'Выходные — средний чек',
      `${fmtR(S.plWeChk, true)} → ${fmtR(weChk, true)} (${weChk >= S.plWeChk ? '+' : ''}${fmtR(weChk - S.plWeChk, true)})`,
      () => { curWeChk = weChk; });
  }
  if (weCnt !== S.plWeCnt) {
    applyStep('🎉', 'Выходные — чеков в день',
      `${S.plWeCnt} → ${weCnt} (${weCnt >= S.plWeCnt ? '+' : ''}${weCnt - S.plWeCnt})`,
      () => { curWeCnt = weCnt; });
  }
  if (weDisc !== S.plWeDisc) {
    applyStep('🎉', 'Выходные — скидки',
      `${fmtN(S.plWeDisc,1)}% → ${fmtN(weDisc,1)}% (${weDisc >= S.plWeDisc ? '+' : ''}${fmtN(weDisc - S.plWeDisc, 1)}%)`,
      () => { curWeDisc = weDisc; });
  }

  if (steps.length === 0) {
    document.getElementById('scenBox').innerHTML = `
      <div style="text-align:center;padding:18px 12px;color:var(--text3);font-size:12px;line-height:1.6">
        <div style="font-size:24px;margin-bottom:4px">👆</div>
        <div>Подвигайте ползунки сверху, чтобы увидеть вклад каждого изменения в итоговую выручку.</div>
      </div>`;
  } else {
    const rows = steps.map(s => {
      const color = s.delta >= 0 ? 'var(--green)' : 'var(--red)';
      const sign = s.delta >= 0 ? '+' : '';
      return `<div style="display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;padding:8px 0;border-bottom:1px solid rgba(46,64,104,.3);align-items:baseline">
        <span style="font-size:14px">${s.emoji}</span>
        <span style="font-size:11px;color:var(--text)">${s.label}</span>
        <span style="font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace">${s.changeDesc}</span>
        <span style="color:${color};font-weight:700;font-family:'Cormorant Garamond',serif;font-size:16px;min-width:90px;text-align:right">${sign}${fmtR(s.delta)}</span>
      </div>`;
    }).join('');
    const totalColor = deltaMonth >= 0 ? 'var(--green)' : 'var(--red)';
    const totalSign = deltaMonth >= 0 ? '+' : '';
    document.getElementById('scenBox').innerHTML = rows + `
      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;padding:10px 0 4px;margin-top:4px;border-top:2px solid var(--border);align-items:baseline">
        <span style="font-size:14px">Σ</span>
        <span style="font-size:12px;color:var(--text);font-weight:600">Итого прирост выручки/остаток месяца</span>
        <span style="color:${totalColor};font-weight:700;font-family:'Cormorant Garamond',serif;font-size:22px;min-width:90px;text-align:right">${totalSign}${fmtR(deltaMonth)}</span>
      </div>`;
  }
}

// ═══ FEEDBACK WIDGET ═══
function fbGetEmail(){ return USER_EMAIL; }
let fbCat='';
function fbOpen(){
  document.getElementById('fbOverlay').classList.add('open');
  document.getElementById('fbText').value='';
  document.getElementById('fbOk').style.display='none';
  document.getElementById('fbSend').disabled=false;
  fbCat='';
  document.querySelectorAll('.fb-cat').forEach(b=>b.classList.remove('sel'));
  const rest=R?R.name:'—';
  document.getElementById('fbMeta').textContent='Ресторан: '+rest+' · '+fbGetEmail();
}
function fbClose(){document.getElementById('fbOverlay').classList.remove('open');}
function fbPickCat(el,cat){
  fbCat=cat;
  document.querySelectorAll('.fb-cat').forEach(b=>b.classList.remove('sel'));
  el.classList.add('sel');
}
async function fbSend(){
  const text=document.getElementById('fbText').value.trim();
  if(!fbCat||!text){alert('Выберите категорию и напишите текст');return;}
  const btn=document.getElementById('fbSend');
  btn.disabled=true;btn.textContent='Отправка…';
  try{
    const r=await fetch(API_BASE+'/api/feedback',{
      method:'POST',
      credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({category:fbCat,text:text,restaurant:R?R.name:'—'})
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    document.getElementById('fbOk').style.display='block';
    document.getElementById('fbOk').textContent='✓ Спасибо! Обратная связь отправлена.';
    setTimeout(fbClose,1800);
  }catch(e){
    alert('Ошибка отправки: '+e.message);
    btn.disabled=false;btn.textContent='Отправить';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MENU ANALYSIS (Phase 2.8.2) — Kasavana-Smith menu engineering UI
// ═══════════════════════════════════════════════════════════════════════
//
// Backend: GET /api/menu-analysis?restaurant_id=N&start=YYYY-MM-DD&end=...
// Возвращает { dishes[], summary, filters, thresholds }.
// Полная спецификация в src/menu_analysis.ts и Приложении А паспорта.
//
// UI строится в 4 этапа (commits 5a..5d):
//   5a — scaffold: кнопка вкладки, fetch, лог в консоль (этот этап)
//   5b — KPI-ряд сверху
//   5c — 2×2 KS-матрица + action sidebar
//   5d — таблица блюд с фильтрами + drawer с деталями

const MENU_STATE = {
  raw: null,           // последний ответ API
  loading: false,      // идёт ли запрос
  loadedFor: null,     // ключ "restId|start|end" последней успешной загрузки
  filters: {
    classes: new Set(),       // пустой = показываем всё
    groups: new Set(),
    dormantReasons: new Set(),
    search: '',
    withNetworkOnly: false,
  },
  sortBy: 'rank',
  sortDir: 'asc',
  selectedDishCode: null,     // для drawer (фаза 5d)
};

// Ключ кэша: restId + период. Если ресторан или период сменились —
// сбросим MENU_STATE.raw и перезагрузим.
function menuCacheKey() {
  if (!R || !R.id) return null;
  const st = CAL_STATE && CAL_STATE.global;
  if (!st || !st.start || !st.end) return null;
  return R.id + '|' + st.start + '|' + st.end;
}

async function loadMenuAnalysis() {
  const key = menuCacheKey();
  if (!key) {
    console.warn('[menu] cannot load: no restaurant or date range');
    return null;
  }
  if (MENU_STATE.loadedFor === key && MENU_STATE.raw) {
    return MENU_STATE.raw; // используем кэш
  }
  if (MENU_STATE.loading) return null; // защита от двойных запросов

  MENU_STATE.loading = true;
  try {
    const st = CAL_STATE.global;
    const qs = '?restaurant_id=' + R.id +
               '&start=' + encodeURIComponent(st.start) +
               '&end=' + encodeURIComponent(st.end);
    const data = await apiGet('/api/menu-analysis' + qs);
    MENU_STATE.raw = data;
    MENU_STATE.loadedFor = key;
    return data;
  } catch (e) {
    console.error('[menu] load failed:', e.message);
    return null;
  } finally {
    MENU_STATE.loading = false;
  }
}

async function renderMenu() {
  trackUI('menu_open', { restaurant_id: R && R.id });
  const root = document.getElementById('menuRoot');
  if (!root) return;

  // Если кликнули на вкладку без выбранного ресторана — сообщение
  if (!R || !R.id) {
    root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:12px">Выберите ресторан для анализа меню.</div>';
    return;
  }
  if (NETWORK_MODE) {
    root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:12px">Анализ меню доступен только для конкретного ресторана. Снимите галку «Вся сеть».</div>';
    return;
  }

  root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:12px">Загрузка анализа меню…</div>';

  const data = await loadMenuAnalysis();
  if (!data) {
    root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--red);font-size:12px">Не удалось загрузить данные. Попробуйте обновить страницу.</div>';
    return;
  }

  // Phase 5b: KPI-ряд + breakdown классов + rotation baner.
  // Таблица блюд, KS-матрица, drawer — в 5c и 5d.
  console.log('[menu] data loaded:', {
    restaurant: R.name,
    period: CAL_STATE.global.start + '..' + CAL_STATE.global.end,
    total_dishes: data.summary.total_dishes,
    ks_counts: data.summary.ks_counts,
    dormant_reasons: data.summary.dormant_reasons,
    network_covered: data.summary.network_covered,
  });

  const html = [];
  html.push(renderRotationBanner(CAL_STATE.global.start, CAL_STATE.global.end));
  html.push(renderMenuKPIs(data.summary));
  html.push(renderClassesBreakdown(data.summary.ks_counts, data.summary.dormant_reasons));
  html.push(
    '<div style="padding:30px 20px;text-align:center;color:var(--text3);font-size:11px;font-style:italic;' +
    'background:var(--card);border:1px dashed var(--border);border-radius:10px">' +
      'KS-матрица (5c) и таблица блюд с фильтрами (5d) появятся в следующих деплоях. ' +
      'KPI-ряд выше уже работает на реальных данных.' +
    '</div>'
  );
  root.innerHTML = html.join('');
}

// --- Banner о ротации меню 1 сентября 2025 --------------------------------

function renderRotationBanner(start, end) {
  // Если выбранный период пересекает 2025-09-01 — это системная ротация
  // меню Chicko: часть блюд старого меню прекратила продаваться, новое
  // меню стартовало. Франчайзи надо об этом знать, чтобы не пугаться
  // высокого процента dormant.
  const ROTATION = '2025-09-01';
  if (!start || !end) return '';
  if (start > ROTATION || end < ROTATION) return '';
  return (
    '<div class="menu-rotation-banner">' +
      '<span class="icon">⚠</span>' +
      '<div>' +
        'Выбранный период охватывает <b>сетевую ротацию меню 1 сентября 2025</b>. ' +
        'Вы видите смешанное меню (старое + новое) — это естественно объясняет ' +
        'высокий процент класса <b>dormant</b>. Для более чистой KS-аналитики ' +
        'выберите период только до или только после 1 сентября 2025.' +
      '</div>' +
    '</div>'
  );
}

// --- KPI-ряд: 5 карточек сверху -------------------------------------------

function renderMenuKPIs(summary) {
  if (!summary) return '';
  const ks = summary.ks_counts || {};
  const leaders = (ks.star || 0) + (ks.plowhorse || 0);
  // "Требуют внимания" = блюда, где у франчайзи есть рычаг воздействия:
  // puzzle (надо продвигать), dog (возможно убрать), dormant (надо разобраться).
  // too_small/event/new сюда не входим — это либо методологические ограничения,
  // либо временные промо, либо слишком молодые для выводов.
  const focus = (ks.puzzle || 0) + (ks.dog || 0) + (ks.dormant || 0);

  const revM = (summary.total_revenue || 0) / 1e6;
  const revFmt = revM >= 10
    ? revM.toFixed(1) + ' M ₽'
    : (revM >= 1 ? revM.toFixed(2) + ' M ₽' : Math.round(summary.total_revenue).toLocaleString('ru') + ' ₽');

  return (
    '<div class="menu-kpi-row">' +
      kpi('Всего блюд', summary.total_dishes, 'в KS-анализе') +
      kpi('Выручка меню', revFmt, 'за выбранный период') +
      kpi('Средняя маржа', (summary.avg_margin_pct || 0).toFixed(1) + '%', 'по всему меню', 'accent-gold') +
      kpi('⭐ Лидеры', leaders, 'Stars + Plowhorses', 'accent-gold') +
      kpi('⚠ Требуют внимания', focus, 'Puzzles + Dogs + Dormant', 'accent-amber') +
    '</div>'
  );
}

function kpi(label, value, sub, extraClass) {
  const cls = 'menu-kpi' + (extraClass ? ' ' + extraClass : '');
  return (
    '<div class="' + cls + '">' +
      '<div class="lbl">' + escapeHtml(label) + '</div>' +
      '<div class="val">' + escapeHtml(String(value)) + '</div>' +
      '<div class="sub">' + escapeHtml(sub) + '</div>' +
    '</div>'
  );
}

// --- Breakdown по 8 классам KS -------------------------------------------

function renderClassesBreakdown(counts, dormantReasons) {
  counts = counts || {};
  dormantReasons = dormantReasons || {};

  // Порядок: сначала классические KS (4), потом методологические (too_small),
  // потом временные (event, new), потом dormant (самый большой пул проблем).
  // Это не алфавит и не по убыванию — это визуальная группировка по смыслу.
  const CLASSES = [
    { key: 'star',      ico: '⭐', name: 'Star' },
    { key: 'plowhorse', ico: '🐎', name: 'Plowhorse' },
    { key: 'puzzle',    ico: '❓', name: 'Puzzle' },
    { key: 'dog',       ico: '🐶', name: 'Dog' },
    { key: 'too_small', ico: '⚙',  name: 'Too small' },
    { key: 'event',     ico: '🎉', name: 'Event' },
    { key: 'new',       ico: '🆕', name: 'New' },
    { key: 'dormant',   ico: '🔁', name: 'Dormant' },
  ];

  const cells = CLASSES.map(c => {
    const n = counts[c.key] || 0;
    return (
      '<div class="menu-class cls-' + c.key + '" title="' + escapeAttr(c.name) + '">' +
        '<div class="ico">' + c.ico + '</div>' +
        '<div class="n">' + n + '</div>' +
        '<div class="name">' + escapeHtml(c.name) + '</div>' +
      '</div>'
    );
  }).join('');

  // Дополнительная подпись под dormant — разбивка replaced/seasonal/retired.
  // Полезно понимать, сколько "настоящих" проблемных блюд среди dormant.
  let dormantNote = '';
  const dr = dormantReasons;
  const drTotal = (dr.replaced || 0) + (dr.seasonal || 0) + (dr.retired || 0);
  if (drTotal > 0) {
    const parts = [];
    if (dr.replaced) parts.push(dr.replaced + ' заменённых');
    if (dr.seasonal) parts.push(dr.seasonal + ' сезонных');
    if (dr.retired)  parts.push(dr.retired  + ' снятых');
    dormantNote =
      '<div style="font-size:10px;color:var(--text3);margin-top:8px;text-align:right">' +
        'Из <b style="color:var(--amber)">' + drTotal + '</b> dormant: ' + parts.join(' · ') +
      '</div>';
  }

  return (
    '<div class="menu-classes">' +
      '<div class="menu-classes-title">Структура меню по классам Kasavana-Smith</div>' +
      '<div class="menu-classes-grid">' + cells + '</div>' +
      dormantNote +
    '</div>'
  );
}

// --- Мелкие хелперы ---

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// Инвалидация кэша меню при смене ресторана и периода.
// Хуки аккуратные: мы не меняем pickRest/pickPeriod напрямую — просто
// сбрасываем loadedFor в вспомогательных местах.
function invalidateMenuCache() {
  MENU_STATE.raw = null;
  MENU_STATE.loadedFor = null;
  MENU_STATE.selectedDishCode = null;
  // Если сейчас открыта вкладка меню — перерисуем
  const menuPanel = document.getElementById('p-menu');
  if (menuPanel && menuPanel.classList.contains('active')) {
    renderMenu();
  }
}

init();
