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
    // Phase 2.9.4: восстанавливаем вкладку, на которой был пользователь до рефреша
    try {
      const _savedTab = sessionStorage.getItem('chicko_tab');
      if (_savedTab && _savedTab !== 'overview') {
        const _tabEl = document.querySelector('.ntab[data-tab="' + _savedTab + '"]');
        if (_tabEl) goTab(_tabEl);
      }
    } catch(e) {}
    // Тихая фоновая загрузка истории с 2024 через 2 сек после старта
    setTimeout(()=>loadFullHistory(true), 2000);
    // Phase 2.9.3: проверяем, админ ли пользователь. Если да — вставляем вкладку «Активность».
    checkAdminAndShowTab();
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
    // Phase 2.9.4: сохраняем текущий выбор пользователя — buildCalendars()
    // сбрасывает CAL_STATE на {start:MIN_DATE, end:MAX_DATE}, что после
    // загрузки полной истории даёт 844-дневный диапазон и ломает menu-analysis.
    const _savedStart = CAL_STATE.global ? CAL_STATE.global.start : null;
    const _savedEnd = CAL_STATE.global ? CAL_STATE.global.end : null;
    buildCalendars();
    if (_savedStart && _savedEnd && CAL_STATE.global) {
      CAL_STATE.global.start = _savedStart;
      CAL_STATE.global.end = _savedEnd;
      updateCalLabel('global');
    }
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
  if (typeof invalidateStaffCache === 'function') invalidateStaffCache();
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
  // Phase 2.10: блокировка locked вкладок (Персонал — заглушка)
  if (el.classList.contains('locked')) {
    // Покажем panel, но без рендера контента — внутри уже статическая заглушка "Скоро"
    trackUI('tab', { tab: el.dataset.tab + '_locked' });
    document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('p-'+el.dataset.tab).classList.add('active');
    try { sessionStorage.setItem('chicko_tab', el.dataset.tab); } catch(e) {}
    return;
  }
  trackUI('tab', { tab: el.dataset.tab });
  document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  const tab = el.dataset.tab;
  document.getElementById('p-'+tab).classList.add('active');
  // Phase 2.9.4: запоминаем вкладку для восстановления после рефреша
  try { sessionStorage.setItem('chicko_tab', tab); } catch(e) {}
  if(tab==='dynamics') renderDynamics();
  if(tab==='compare') renderCompare();
  if(tab==='analysis') renderAnalysis();
  if(tab==='menu') renderMenu();
  if(tab==='staff') renderStaff();
  if(tab==='admin') renderAdmin();
  if(tab==='marketing') renderMarketing();
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
  renderRankTableFull();
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
        if (typeof invalidateStaffCache === 'function') invalidateStaffCache();
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

// ═══ FULL RANK TABLE (Phase 2.9.4) ═══
// Сводная таблица ресторанов с сортировкой и подсветкой лучших показателей.
// Динамически обновляется при смене ресторана, периода, режима «Вся сеть».

const RANK_FULL_STATE = { sortCol: 'revenue', sortDir: 'desc' };

const RANK_FULL_COLS = [
  { key: 'revenue',  label: 'Выручка',    agg: 'sum', fmt: v => fmtR(v), better: 'high' },
  { key: 'avgCheck', label: 'Ср.чек',     agg: 'avg', fmt: v => Math.round(v).toLocaleString('ru') + '\u00A0₽', better: 'high' },
  { key: 'checks',   label: 'Чеки',       agg: 'sum', fmt: v => Math.round(v).toLocaleString('ru'), better: 'high' },
  { key: 'foodcost', label: 'Фудкост%',    agg: 'avg', fmt: v => v !== null ? v.toFixed(1) : '—', better: 'low' },
  { key: 'discount', label: 'Скидка%',     agg: 'avg', fmt: v => v !== null ? v.toFixed(1) : '—', better: 'low' },
  { key: 'delivery', label: 'Доставка%',   agg: 'avg', fmt: v => v !== null ? v.toFixed(1) : '—', better: 'high' },
];

function renderRankTableFull() {
  const thead = document.getElementById('rankFullHead');
  const tbody = document.getElementById('rankFullBody');
  if (!thead || !tbody) return;

  const st = CAL_STATE && CAL_STATE.global;
  if (!st || !st.start || !st.end) return;

  // Агрегируем метрики по каждому ресторану за выбранный период
  const rows = RESTS.map(function(r, idx) {
    const ts = getTsRange(r, st.start, st.end);
    if (!ts.length) return null;
    const totalRev = ts.reduce(function(s, t) { return s + t.revenue; }, 0);
    const totalChecks = ts.reduce(function(s, t) { return s + t.checks; }, 0);
    const avgChk = safeAvg(ts, 'avgCheck');
    const fc = safeAvg(ts, 'foodcost');
    const disc = safeAvg(ts, 'discount');
    const del = safeAvg(ts, 'deliveryPct');
    return {
      idx: idx,
      name: r.name,
      city: r.city || r.name,
      revenue: totalRev,
      avgCheck: avgChk || 0,
      checks: totalChecks,
      foodcost: fc,
      discount: disc,
      delivery: del,
    };
  }).filter(function(r) { return r !== null && r.revenue > 0; });

  // Сортировка
  var sc = RANK_FULL_STATE.sortCol;
  var sd = RANK_FULL_STATE.sortDir;
  rows.sort(function(a, b) {
    var va = a[sc], vb = b[sc];
    if (va === null) va = -Infinity;
    if (vb === null) vb = -Infinity;
    return sd === 'desc' ? vb - va : va - vb;
  });

  // Определяем лучшие И худшие значения по каждой метрике
  var best = {}, worst = {};
  RANK_FULL_COLS.forEach(function(col) {
    var vals = rows.map(function(r) { return r[col.key]; }).filter(function(v) { return v !== null && v > 0; });
    if (vals.length < 2) return;
    if (col.better === 'low') {
      best[col.key] = Math.min.apply(null, vals);
      worst[col.key] = Math.max.apply(null, vals);
    } else {
      best[col.key] = Math.max.apply(null, vals);
      worst[col.key] = Math.min.apply(null, vals);
    }
  });

  // Заголовок
  var hHtml = '<tr><th>#</th><th>Ресторан</th>';
  RANK_FULL_COLS.forEach(function(col) {
    var isSorted = sc === col.key;
    var arrow = isSorted ? (sd === 'desc' ? '▼' : '▲') : '';
    hHtml += '<th class="' + (isSorted ? 'rft-sorted' : '') + '" onclick="sortRankFull(\'' + col.key + '\')">'
      + col.label + (arrow ? '<span class="rft-arrow">' + arrow + '</span>' : '') + '</th>';
  });
  hHtml += '</tr>';
  thead.innerHTML = hHtml;

  // Тело
  var myName = R ? R.name : '';
  var bHtml = '';
  rows.forEach(function(row, i) {
    var isMe = row.name === myName;
    bHtml += '<tr class="' + (isMe ? 'rft-me' : '') + '" style="cursor:pointer" onclick="selectRest(' + row.idx + ')">';
    bHtml += '<td>' + (i + 1) + '</td>';
    bHtml += '<td>' + row.city + '</td>';
    RANK_FULL_COLS.forEach(function(col) {
      var v = row[col.key];
      var cls = '';
      if (best[col.key] !== undefined && v === best[col.key] && v > 0) cls = 'rft-best';
      else if (worst[col.key] !== undefined && v === worst[col.key] && v > 0) cls = 'rft-worst';
      bHtml += '<td class="' + cls + '">' + col.fmt(v) + '</td>';
    });
    bHtml += '</tr>';
  });
  tbody.innerHTML = bHtml;
}

function sortRankFull(colKey) {
  if (RANK_FULL_STATE.sortCol === colKey) {
    RANK_FULL_STATE.sortDir = RANK_FULL_STATE.sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    RANK_FULL_STATE.sortCol = colKey;
    // Для "low is better" метрик дефолтная сортировка — ascending
    var col = RANK_FULL_COLS.find(function(c) { return c.key === colKey; });
    RANK_FULL_STATE.sortDir = (col && col.better === 'low') ? 'asc' : 'desc';
  }
  renderRankTableFull();
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
// Phase 2.9.4: Гриль — lazy-load кеш
const GRILL_CACHE = {}; // key: "restId:start:end" → {date: revenue}

async function loadGrillData() {
  if (!R || !R.id) return;
  const st = CAL_STATE && CAL_STATE.global;
  if (!st || !st.start || !st.end) return;
  const cacheKey = R.id + ':' + st.start + ':' + st.end;
  if (GRILL_CACHE[cacheKey]) {
    // Кеш есть — реинжектим в R.ts (мог смениться ресторан и вернуться)
    const map = GRILL_CACHE[cacheKey];
    if (R && R.ts) R.ts.forEach(function(t) { t.grill = map[t.date] || 0; });
    return;
  }
  try {
    const qs = '?restaurant_id=' + R.id + '&start=' + encodeURIComponent(st.start) + '&end=' + encodeURIComponent(st.end);
    const resp = await apiGet('/api/grill-daily' + qs);
    const map = {};
    if (resp && resp.data) {
      resp.data.forEach(function(r) { map[r.date] = r.revenue; });
    }
    GRILL_CACHE[cacheKey] = map;
    // Инжектим grill в ts-записи текущего ресторана
    if (R && R.ts) {
      R.ts.forEach(function(t) { t.grill = map[t.date] || 0; });
    }
  } catch(e) {
    console.error('[grill] load failed:', e.message);
  }
}

function setRevM(m,btn){S.revMetric=m;document.querySelectorAll('#revMBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');if(m==='grill'){loadGrillData().then(function(){renderRevChart()})}else{renderRevChart()}}
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
      grill: items.reduce((s,t) => s + (t.grill||0), 0),
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
  // Phase 2.9.4: если активна кнопка «Гриль» — загружаем данные для текущего ресторана
  if (S.revMetric === 'grill') {
    loadGrillData().then(function() { renderRevChart(netTs); });
  } else {
    renderRevChart(netTs);
  }
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
  const mc={revenue:'#D4A84B',kitchen:'#4A9EF5',bar:'#9B59B6',delivery:'#2ECC71',grill:'#E74C3C'};
  const ml={revenue:'Общая',kitchen:'Кухня',bar:'Бар',delivery:'Доставка',grill:'Гриль'};
  const lbls = ts.map(t => t.label || fmtD(t.date));
  const metric = S.revMetric;
  const datasets = [{label:ml[metric],data:ts.map(t=>t[metric]||0),backgroundColor:mc[metric]+'99',borderColor:mc[metric],borderWidth:1,borderRadius:4,yAxisID:'y'}];
  // Линия сети — реальные данные за тот же период
  if (netTs && netTs.length) {
    const netMap = {};
    netTs.forEach(t => { netMap[t.date] = t; });
    datasets.push({label:'Сеть',data:ts.map(t=> { const n=netMap[t.date]; return n ? (n[metric]||0) : 0; }),type:'line',borderColor:'rgba(142,170,206,.5)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false,yAxisID:'y'});
  }
  // Phase 2.9.4: линия «Доля гриля %» на правой оси
  if (metric === 'grill') {
    datasets.push({
      label:'Доля %',
      data:ts.map(t => { const rev = t.revenue || 0; const gr = t.grill || 0; return rev > 0 ? Math.round(gr / rev * 1000) / 10 : 0; }),
      type:'line',
      borderColor:'#F1C40F',
      borderWidth:2,
      pointRadius:ts.length>50?0:3,
      pointBackgroundColor:'#F1C40F',
      fill:false,
      tension:.3,
      yAxisID:'y1'
    });
  }
  const opts = chartOpts(v=>fmtR(v));
  // Правая ось для % доли гриля
  if (metric === 'grill') {
    opts.scales = opts.scales || {};
    opts.scales.y = opts.scales.y || {};
    opts.scales.y.position = 'left';
    opts.scales.y1 = {
      position:'right',
      grid:{drawOnChartArea:false},
      ticks:{color:'#F1C40F',callback:function(v){return v+'%'}},
      min:0
    };
  }
  // Tooltip: доля от выручки для Кухня/Бар/Доставка/Гриль
  if (metric !== 'revenue') {
    opts.plugins.tooltip = {callbacks:{label:function(ctx){
      const val = ctx.raw || 0;
      // Линия «Доля %» — значение уже в процентах
      if (ctx.dataset.yAxisID === 'y1') return ctx.dataset.label+': '+val+'%';
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
  filtered: [],        // отфильтрованные блюда для таблицы (5d)
  activeClass: 'star', // активный класс в KS-матрице/action-панели (5c)
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
    // Phase 2.9.4: KS-анализ за 2+ года бессмыслен, а бэкенд режет
    // диапазон > 400 дней (MAX_DATE_RANGE_DAYS). Автоматически обрезаем
    // до последних 90 дней от end, если диапазон слишком широкий.
    let menuStart = st.start;
    let menuEnd = st.end;
    const _rangeDays = Math.round((new Date(menuEnd) - new Date(menuStart)) / 86400000) + 1;
    if (_rangeDays > 365) {
      const _d = new Date(menuEnd + 'T00:00:00Z');
      _d.setUTCDate(_d.getUTCDate() - 89);
      menuStart = _d.toISOString().slice(0, 10);
      console.log('[menu] range capped from ' + _rangeDays + 'd to 90d: ' + menuStart + '..' + menuEnd);
    }
    const qs = '?restaurant_id=' + R.id +
               '&start=' + encodeURIComponent(menuStart) +
               '&end=' + encodeURIComponent(menuEnd);
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
  html.push(renderKsMatrixAndAction(data.summary));
  html.push(renderMenuTable());
  root.innerHTML = html.join('');

  // Инициализация: активируем default-класс (star) в action-панели
  setMenuActiveClass(MENU_STATE.activeClass || 'star');
  // И сразу применяем фильтры к таблице
  applyMenuFilters();
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
      '<div class="menu-class cls-' + c.key + '" title="' + escapeAttr(c.name) + '" ' +
           'onclick="setMenuActiveClass(\'' + c.key + '\')">' +
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
  MENU_STATE.filtered = [];
  MENU_STATE.selectedDishCode = null;
  // Если сейчас открыта вкладка меню — перерисуем
  const menuPanel = document.getElementById('p-menu');
  if (menuPanel && menuPanel.classList.contains('active')) {
    renderMenu();
  }
}

// --- KS-матрица + Action-панель (Phase 5c) --------------------------------

// Справочник классов с метаданными для action-панели.
// Для каждого: иконка, имя, краткое описание, список рекомендаций.
// Источник — канонический Kasavana-Smith 1982 + практика meneu-engineering-блогов.
const MENU_CLASS_META = {
  star: {
    ico: '⭐',
    name: 'Stars',
    sub: 'Популярные и прибыльные. Ядро меню — именно они делают выручку и формируют восприятие бренда у гостей.',
    actions: [
      'Не менять рецептуру и размер порции без крайней нужды — стабильность главное',
      'Располагать в верхней части меню / на видных местах (eye-tracking зоны)',
      'Обучать персонал проактивно предлагать их как фирменные',
      'При росте цен на ингредиенты — поднимать цену раньше, чем для других блюд',
    ],
  },
  plowhorse: {
    ico: '🐎',
    name: 'Plowhorses',
    sub: 'Популярные, но с низкой маржой. Гости их любят, но ваш бизнес на них не зарабатывает столько, сколько мог бы.',
    actions: [
      'Поднять цену на 5–10% — обычно проходит незаметно на лояльных блюдах',
      'Проверить порцию — часто можно уменьшить на 10–15% без заметной реакции',
      'Заменить 1 дорогой ингредиент на аналог подешевле (с сохранением вкуса)',
      'Предлагать в паре с высокомаржинальным дополнением (соус, напиток, десерт)',
    ],
  },
  puzzle: {
    ico: '❓',
    name: 'Puzzles',
    sub: 'Высокомаржинальные, но не очень популярные. «Спрятанные алмазы» — при росте популярности дадут больше всего прибыли.',
    actions: [
      'Перенести в «eye-tracking» зону меню (верх правой колонки)',
      'Добавить сенсорное описание: «хрустящий», «томлёный», «домашний»',
      'Обучить персонал предлагать как рекомендацию шеф-повара',
      'Задействовать в соцсетях / фото — возможно, проблема в узнаваемости',
    ],
  },
  dog: {
    ico: '🐶',
    name: 'Dogs',
    sub: 'Непопулярные и с низкой маржой. Кандидаты на удаление из меню — они забирают место, внимание и ингредиенты.',
    actions: [
      'Проверить: не портятся ли ингредиенты из-за низких продаж (риск списаний)',
      'Рассмотреть замену на новое блюдо из свободных ингредиентов кухни',
      'Если убирать — снимать вместе с запасом, в момент пересмотра меню',
      'Перед удалением: не является ли блюдо «эмоциональным якорем» постоянных гостей',
    ],
  },
  too_small: {
    ico: '⚙',
    name: 'Too small',
    sub: 'В группе (dish_group) меньше 3-х KS-кандидатов. Матрица требует минимум 3 блюда для честного сравнения внутри группы, поэтому классификация вырождается.',
    actions: [
      'Это методологическое ограничение, а не проблема блюд',
      'Пересмотреть: может стоит добавить блюд в эту группу, чтобы была конкуренция',
      'Либо объединить группу с близкой (если группа искусственно дробится)',
    ],
  },
  event: {
    ico: '🎉',
    name: 'Events',
    sub: 'Временные блюда (промо, коллаборации, сезонные ивенты). Их нет смысла сравнивать с постоянным меню по KS — у них короткое окно и специальная ценовая стратегия.',
    actions: [
      'Ивенты анализируйте отдельно — по ROI кампании, а не по KS',
      'Обращайте внимание на маржу ивентовых блюд в абсолюте — дают ли прибыль',
      'Учитывайте halo-эффект: ивенты привлекают гостей и они заказывают обычное меню',
    ],
  },
  new: {
    ico: '🆕',
    name: 'New',
    sub: 'Блюдо появилось в данных меньше 30 дней назад. KS несправедлив: не набрано достаточно статистики, классификация может быть случайной.',
    actions: [
      'Наблюдайте ещё 30–60 дней до принятия решений',
      'Следите за ростом доли продаж — если не растёт, подскажите персоналу',
      'В начале жизни блюда проверьте фудкост — он часто выше нормы из-за отсутствия оптимизации',
    ],
  },
  dormant: {
    ico: '🔁',
    name: 'Dormant',
    sub: 'Блюдо 14+ дней не продаётся. Попало в период, но фактически выведено. Для каждого dormant backend определил причину: replaced / seasonal / retired.',
    actions: [
      'replaced — в той же группе появилось новое блюдо-замена, можно зачищать',
      'seasonal — продавалось ±30 дней год назад, вернётся в сезон',
      'retired — снятое без явной замены, вычистить из POS и меню-карты',
      'Проверьте: нет ли dormant из-за отсутствия ингредиентов / отказа поставщика',
    ],
  },
};

function renderKsMatrixAndAction(summary) {
  const counts = (summary && summary.ks_counts) || {};
  return (
    '<div class="menu-ks-wrap">' +
      renderKsMatrix(counts) +
      '<div id="menuActionPanel" class="menu-action"></div>' +
    '</div>'
  );
}

function renderKsMatrix(counts) {
  // Квадранты располагаем так, чтобы Y↑ = прибыльность (вверху — высокая),
  // X→ = популярность (справа — высокая). Канон Kasavana-Smith:
  //   top-left    = Puzzle   (прибыльно, непопулярно)
  //   top-right   = Star     (прибыльно, популярно)
  //   bottom-left = Dog      (не прибыльно, не популярно)
  //   bottom-right= Plowhorse(не прибыльно, популярно)
  const quad = (cls, ico, name) =>
    '<div class="menu-ks-quad q-' + cls + '" data-cls="' + cls + '" onclick="setMenuActiveClass(\'' + cls + '\')">' +
      '<div class="ico">' + ico + '</div>' +
      '<div class="n">' + (counts[cls] || 0) + '</div>' +
      '<div class="name">' + name + '</div>' +
    '</div>';

  // Outside-матрицы: 4 класса, не укладывающиеся в 2×2
  const outsideChip = (cls, ico, name) =>
    '<span class="menu-ks-outside-chip" data-cls="' + cls + '" onclick="setMenuActiveClass(\'' + cls + '\')">' +
      ico + ' <b>' + (counts[cls] || 0) + '</b> ' + escapeHtml(name) +
    '</span>';

  return (
    '<div class="menu-ks-matrix">' +
      '<div class="menu-ks-title">Kasavana-Smith — матрица меню</div>' +
      '<div class="menu-ks-frame">' +
        '<div class="menu-ks-y-axis">Прибыльность →</div>' +
        '<div class="menu-ks-grid">' +
          quad('puzzle',    '❓', 'Puzzle') +
          quad('star',      '⭐', 'Star') +
          quad('dog',       '🐶', 'Dog') +
          quad('plowhorse', '🐎', 'Plowhorse') +
        '</div>' +
        '<div class="menu-ks-x-axis">Популярность →</div>' +
      '</div>' +
      '<div class="menu-ks-outside">' +
        '<span class="menu-ks-outside-lbl">Вне матрицы:</span>' +
        outsideChip('too_small', '⚙',  'too_small') +
        outsideChip('event',     '🎉', 'event') +
        outsideChip('new',       '🆕', 'new') +
        outsideChip('dormant',   '🔁', 'dormant') +
      '</div>' +
    '</div>'
  );
}

function renderMenuAction(cls, summary) {
  const meta = MENU_CLASS_META[cls];
  if (!meta) return '<div style="color:var(--text3);font-size:11px">Класс не найден.</div>';
  const counts = (summary && summary.ks_counts) || {};
  const count = counts[cls] || 0;

  const itemsHtml = meta.actions.map(a =>
    '<div class="menu-action-item">' + escapeHtml(a) + '</div>'
  ).join('');

  // Для dormant добавляем разбивку replaced/seasonal/retired
  let dormantBlock = '';
  if (cls === 'dormant') {
    const dr = (summary && summary.dormant_reasons) || {};
    const r = dr.replaced || 0;
    const s = dr.seasonal || 0;
    const t = dr.retired || 0;
    if (r + s + t > 0) {
      dormantBlock =
        '<div class="menu-action-dormant-breakdown">' +
          '<b>Разбивка dormant по причинам:</b><br>' +
          '• replaced (есть замена в группе): <b>' + r + '</b><br>' +
          '• seasonal (был в том же периоде год назад): <b>' + s + '</b><br>' +
          '• retired (снято без замены): <b>' + t + '</b>' +
        '</div>';
    }
  }

  return (
    '<div class="menu-action-head">' +
      '<div class="menu-action-ico">' + meta.ico + '</div>' +
      '<div class="menu-action-name">' + escapeHtml(meta.name) + '</div>' +
      '<div class="menu-action-count">' + count + ' блюд в классе</div>' +
    '</div>' +
    '<div class="menu-action-sub">' + escapeHtml(meta.sub) + '</div>' +
    dormantBlock +
    '<div class="menu-action-list-title">Что делать</div>' +
    '<div class="menu-action-list">' + itemsHtml + '</div>'
  );
}

/**
 * Установить активный класс — синхронизирует:
 *  - подсветку квадранта / chip'а
 *  - содержимое action-панели справа
 *  - подсветку соответствующего quadrant в breakdown-ряду (5b)
 * В 5d сюда же добавим: применение фильтра к таблице блюд.
 */
function setMenuActiveClass(cls) {
  if (!MENU_CLASS_META[cls]) return;
  MENU_STATE.activeClass = cls;
  trackUI('menu_class', { class: cls });

  // Подсветка квадранта
  document.querySelectorAll('.menu-ks-quad').forEach(el => {
    el.classList.toggle('active', el.dataset.cls === cls);
  });
  // Подсветка chip'а вне матрицы
  document.querySelectorAll('.menu-ks-outside-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.cls === cls);
  });
  // Подсветка класса в breakdown-ряду (из 5b)
  document.querySelectorAll('.menu-class').forEach(el => {
    // .menu-class имеет класс "cls-<name>", берём после "cls-"
    const m = (el.className || '').match(/cls-([a-z_]+)/);
    el.classList.toggle('active', m && m[1] === cls);
  });

  // Заполняем правую панель
  const panel = document.getElementById('menuActionPanel');
  if (panel && MENU_STATE.raw && MENU_STATE.raw.summary) {
    panel.innerHTML = renderMenuAction(cls, MENU_STATE.raw.summary);
  }

  // 5d: применяем фильтр к таблице блюд
  MENU_STATE.filters.classes.clear();
  MENU_STATE.filters.classes.add(cls);
  if (typeof applyMenuFilters === 'function') applyMenuFilters();
}


// --- Таблица блюд с фильтрами и drawer (Phase 5d) -------------------------

function renderMenuTable() {
  return (
    '<div>' +
      renderMenuToolbar() +
      '<div class="menu-table-wrap">' +
        '<div class="menu-table-scroll">' +
          '<table class="menu-table" id="menuTable">' +
            renderMenuTableHeader() +
            '<tbody id="menuTableBody"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="menu-drawer-overlay" id="menuDrawerOverlay">' +
      '<div class="menu-drawer">' +
        '<div class="menu-drawer-head">' +
          '<div>' +
            '<div style="font-family:Cormorant Garamond,serif;font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px" id="drawerDishName">—</div>' +
            '<div style="font-size:11px;color:var(--text2)" id="drawerDishMeta">—</div>' +
          '</div>' +
          '<div class="menu-drawer-close" onclick="closeMenuDrawer()">×</div>' +
        '</div>' +
        '<div class="menu-drawer-body" id="drawerBody">—</div>' +
      '</div>' +
    '</div>'
  );
}

function renderMenuToolbar() {
  const f = MENU_STATE.filters;
  const activeClassChip = (f.classes.size === 1)
    ? '<div class="menu-active-filter-chip">' +
        MENU_CLASS_META[Array.from(f.classes)[0]]?.ico + ' ' +
        Array.from(f.classes)[0] +
        ' <span class="close" onclick="clearMenuClassFilter()">×</span>' +
      '</div>'
    : '';
  
  return (
    '<div class="menu-toolbar">' +
      '<input class="menu-toolbar-search" id="menuSearch" placeholder="🔍 Поиск по названию блюда..." ' +
             'value="' + escapeAttr(f.search) + '" oninput="onMenuSearchInput(this.value)">' +
      '<select class="menu-toolbar-group" id="menuGroupFilter" onchange="onMenuGroupFilter(this.value)">' +
        '<option value="">Все группы</option>' +
      '</select>' +
      '<label class="menu-toolbar-check">' +
        '<input type="checkbox" ' + (f.withNetworkOnly ? 'checked' : '') + ' onchange="onMenuNetworkFilter(this.checked)">' +
        'Только с сетевым сравнением' +
      '</label>' +
      '<button class="menu-toolbar-reset" onclick="resetMenuFilters()">Сброс</button>' +
      activeClassChip +
      '<div class="menu-toolbar-count" id="menuCount">—</div>' +
    '</div>'
  );
}

function renderMenuTableHeader() {
  const sortIcon = (col) => {
    if (MENU_STATE.sortBy !== col) return '';
    return '<span class="sort-ind">' + (MENU_STATE.sortDir === 'asc' ? '↑' : '↓') + '</span>';
  };
  const thClass = (col) => MENU_STATE.sortBy === col ? ' class="sorted"' : '';

  return (
    '<thead>' +
      '<tr>' +
        '<th' + thClass('rank') + ' onclick="sortMenuTable(\'rank\')">#' + sortIcon('rank') + '</th>' +
        '<th' + thClass('dish_name') + ' onclick="sortMenuTable(\'dish_name\')">Блюдо' + sortIcon('dish_name') + '</th>' +
        '<th' + thClass('dish_group') + ' onclick="sortMenuTable(\'dish_group\')">Группа' + sortIcon('dish_group') + '</th>' +
        '<th' + thClass('ks_class') + ' onclick="sortMenuTable(\'ks_class\')">Класс' + sortIcon('ks_class') + '</th>' +
        '<th' + thClass('total_qty') + ' onclick="sortMenuTable(\'total_qty\')">Количество' + sortIcon('total_qty') + '</th>' +
        '<th' + thClass('total_revenue') + ' onclick="sortMenuTable(\'total_revenue\')">Выручка' + sortIcon('total_revenue') + '</th>' +
        '<th' + thClass('margin_per_unit') + ' onclick="sortMenuTable(\'margin_per_unit\')">Маржа ₽/шт' + sortIcon('margin_per_unit') + '</th>' +
        '<th' + thClass('mix_pct_group') + ' onclick="sortMenuTable(\'mix_pct_group\')">Доля %' + sortIcon('mix_pct_group') + '</th>' +
        '<th>vs сеть</th>' +
      '</tr>' +
    '</thead>'
  );
}

function applyMenuFilters() {
  if (!MENU_STATE.raw || !MENU_STATE.raw.dishes) {
    MENU_STATE.filtered = [];
    renderMenuTableBody();
    updateMenuCount();
    return;
  }

  const f = MENU_STATE.filters;
  let dishes = MENU_STATE.raw.dishes.filter(d => {
    // Фильтр по классам
    if (f.classes.size > 0 && !f.classes.has(d.ks_class)) return false;
    // Фильтр по группам
    if (f.groups.size > 0 && !f.groups.has(d.dish_group)) return false;
    // Фильтр по dormant причинам
    if (f.dormantReasons.size > 0 && d.ks_class === 'dormant' && !f.dormantReasons.has(d.dormant_reason)) return false;
    // Поиск по имени
    if (f.search && !d.dish_name.toLowerCase().includes(f.search.toLowerCase())) return false;
    // Только с сетевым сравнением
    if (f.withNetworkOnly && (!d.network || d.network.n_rests < 3)) return false;
    return true;
  });

  // Сортировка
  dishes = sortDishes(dishes, MENU_STATE.sortBy, MENU_STATE.sortDir);
  MENU_STATE.filtered = dishes;
  
  renderMenuTableBody();
  updateMenuCount();
  populateGroupFilter();
}

function sortDishes(dishes, sortBy, dir) {
  const mult = dir === 'asc' ? 1 : -1;
  return dishes.slice().sort((a, b) => {
    let va = a[sortBy], vb = b[sortBy];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return -1 * mult;
    if (va > vb) return 1 * mult;
    return 0;
  });
}

function renderMenuTableBody() {
  const tbody = document.getElementById('menuTableBody');
  if (!tbody) return;
  
  if (MENU_STATE.filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="menu-table-empty">Нет блюд, соответствующих фильтрам</td></tr>';
    return;
  }
  
  const rows = MENU_STATE.filtered.map((dish, idx) => {
    // Null-safe значения
    const revenue = dish.total_revenue || 0;
    const qty = dish.total_qty || 0;
    const margin = dish.margin_per_unit || 0;
    const mixPct = dish.mix_pct_group || 0;
    
    const revStr = (revenue >= 1e6)
      ? (revenue / 1e6).toFixed(1) + 'M'
      : Math.round(revenue).toLocaleString('ru');
    
    // vs сеть
    let vsNetStr = '—';
    let vsNetClass = 'menu-vs-net-na';
    if (dish.network && dish.network.n_rests >= 3) {
      const myMargin = margin;
      const netMargin = dish.network.margin_per_unit_median || 0;
      if (netMargin > 0) {
        const diff = ((myMargin - netMargin) / netMargin * 100);
        if (diff > 5) {
          vsNetStr = '+' + diff.toFixed(0) + '%';
          vsNetClass = 'menu-vs-net-up';
        } else if (diff < -5) {
          vsNetStr = diff.toFixed(0) + '%';
          vsNetClass = 'menu-vs-net-down';
        } else {
          vsNetStr = '~' + diff.toFixed(0) + '%';
        }
      }
    }

    return (
      '<tr onclick="openMenuDrawer(\'' + escapeAttr(dish.dish_code || '') + '\')">' +
        '<td class="rank-cell">' + (idx + 1) + '</td>' +
        '<td class="name-cell" title="' + escapeAttr(dish.dish_name || '') + '">' + escapeHtml(dish.dish_name || '—') + '</td>' +
        '<td class="group-cell" title="' + escapeAttr(dish.dish_group || '') + '">' + escapeHtml(dish.dish_group || '—') + '</td>' +
        '<td><span class="menu-cls-chip cls-' + (dish.ks_class || 'unknown') + '">' + (dish.ks_class || '—') + '</span></td>' +
        '<td style="text-align:right">' + Math.round(qty).toLocaleString('ru') + '</td>' +
        '<td style="text-align:right">' + revStr + ' ₽</td>' +
        '<td style="text-align:right">' + Math.round(margin) + ' ₽</td>' +
        '<td style="text-align:right">' + mixPct.toFixed(1) + '%</td>' +
        '<td class="' + vsNetClass + '" style="text-align:center">' + vsNetStr + '</td>' +
      '</tr>'
    );
  }).join('');
  
  tbody.innerHTML = rows;
}

function updateMenuCount() {
  const el = document.getElementById('menuCount');
  if (el) {
    const total = MENU_STATE.raw ? MENU_STATE.raw.dishes.length : 0;
    el.textContent = MENU_STATE.filtered.length + ' из ' + total + ' блюд';
  }
}

function populateGroupFilter() {
  const sel = document.getElementById('menuGroupFilter');
  if (!sel || !MENU_STATE.raw) return;
  
  const groups = new Set();
  MENU_STATE.raw.dishes.forEach(d => groups.add(d.dish_group));
  const sortedGroups = Array.from(groups).sort();
  
  const currentValue = sel.value;
  sel.innerHTML = '<option value="">Все группы</option>' +
    sortedGroups.map(g => '<option value="' + escapeAttr(g) + '">' + escapeHtml(g) + '</option>').join('');
  sel.value = currentValue;
}

// --- События фильтрации и сортировки ---

function onMenuSearchInput(value) {
  MENU_STATE.filters.search = value;
  applyMenuFilters();
}

function onMenuGroupFilter(value) {
  MENU_STATE.filters.groups.clear();
  if (value) MENU_STATE.filters.groups.add(value);
  applyMenuFilters();
}

function onMenuNetworkFilter(checked) {
  MENU_STATE.filters.withNetworkOnly = checked;
  applyMenuFilters();
}

function resetMenuFilters() {
  MENU_STATE.filters.classes.clear();
  MENU_STATE.filters.groups.clear();
  MENU_STATE.filters.dormantReasons.clear();
  MENU_STATE.filters.search = '';
  MENU_STATE.filters.withNetworkOnly = false;
  
  // Обновляем UI
  const search = document.getElementById('menuSearch');
  if (search) search.value = '';
  const groupSel = document.getElementById('menuGroupFilter');
  if (groupSel) groupSel.value = '';
  const netCb = document.querySelector('.menu-toolbar-check input');
  if (netCb) netCb.checked = false;
  
  applyMenuFilters();
}

function clearMenuClassFilter() {
  MENU_STATE.filters.classes.clear();
  applyMenuFilters();
}

function sortMenuTable(col) {
  if (MENU_STATE.sortBy === col) {
    MENU_STATE.sortDir = MENU_STATE.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    MENU_STATE.sortBy = col;
    MENU_STATE.sortDir = 'desc'; // обычно хотят видеть топ сначала
  }
  applyMenuFilters(); // пересортировать и перерисовать
}

// --- Drawer с деталями блюда ---

function openMenuDrawer(dishCode) {
  if (!MENU_STATE.raw) return;
  const dish = MENU_STATE.raw.dishes.find(d => d.dish_code === dishCode);
  if (!dish) return;
  
  MENU_STATE.selectedDishCode = dishCode;
  renderMenuDrawer(dish);
  
  const overlay = document.getElementById('menuDrawerOverlay');
  if (overlay) {
    overlay.classList.add('open');
    // Обработчик Escape
    document.addEventListener('keydown', handleDrawerEscape);
  }
  trackUI('menu_dish_detail', { dish_code: dishCode, dish_class: dish.ks_class });
}

function closeMenuDrawer() {
  const overlay = document.getElementById('menuDrawerOverlay');
  if (overlay) overlay.classList.remove('open');
  MENU_STATE.selectedDishCode = null;
  document.removeEventListener('keydown', handleDrawerEscape);
}

function handleDrawerEscape(e) {
  if (e.key === 'Escape') closeMenuDrawer();
}

function renderMenuDrawer(dish) {
  const nameEl = document.getElementById('drawerDishName');
  const metaEl = document.getElementById('drawerDishMeta');
  const bodyEl = document.getElementById('drawerBody');
  
  if (nameEl) nameEl.textContent = dish.dish_name;
  if (metaEl) {
    const chip = '<span class="menu-cls-chip cls-' + dish.ks_class + '">' + dish.ks_class + '</span>';
    metaEl.innerHTML = escapeHtml(dish.dish_group) + ' • ' + chip;
  }
  if (bodyEl) bodyEl.innerHTML = renderDrawerBody(dish);
}

function renderDrawerBody(dish) {
  const meta = MENU_CLASS_META[dish.ks_class];
  let sections = [];
  
  // KPI-сетка — null-safe значения
  const revenue = dish.total_revenue || 0;
  const qty = dish.total_qty || 0;
  const margin = dish.margin_per_unit || 0;
  
  const revM = (revenue / 1e6).toFixed(2);
  const qtyStr = Math.round(qty).toLocaleString('ru');
  const marginPer = Math.round(margin);
  const avgPrice = qty > 0 ? Math.round(revenue / qty) : 0;
  
  sections.push(
    '<div class="menu-drawer-section">' +
      '<h4>Финансовые показатели</h4>' +
      '<div class="menu-drawer-kpi-grid">' +
        '<div class="menu-drawer-kpi-card"><div class="lbl">Выручка</div><div class="val">' + revM + ' M</div><div class="sub">₽ за период</div></div>' +
        '<div class="menu-drawer-kpi-card"><div class="lbl">Количество</div><div class="val">' + qtyStr + '</div><div class="sub">заказов</div></div>' +
        '<div class="menu-drawer-kpi-card"><div class="lbl">Маржа ₽/шт</div><div class="val">' + marginPer + '</div><div class="sub">₽ за порцию</div></div>' +
        '<div class="menu-drawer-kpi-card"><div class="lbl">Средняя цена</div><div class="val">' + avgPrice + '</div><div class="sub">₽ за блюдо</div></div>' +
      '</div>' +
    '</div>'
  );
  
  // История блюда
  if (dish.first_sold_at || dish.last_sold_at) {
    const props = [
      ['Первая продажа', dish.first_sold_at || '—'],
      ['Последняя продажа', dish.last_sold_at || '—'],
      ['Дней в меню', dish.days_in_menu || '—'],
      ['С последней продажи', dish.days_since_last_sale ? dish.days_since_last_sale + ' дн.' : '—'],
    ];
    if (dish.foodcost_pct) props.push(['Фудкост', dish.foodcost_pct.toFixed(1) + '%']);
    
    sections.push(
      '<div class="menu-drawer-section">' +
        '<h4>История блюда</h4>' +
        '<div class="menu-drawer-props">' +
          '<table>' + props.map(([k, v]) => '<tr><td>' + escapeHtml(k) + '</td><td>' + escapeHtml(v) + '</td></tr>').join('') + '</table>' +
        '</div>' +
      '</div>'
    );
  }
  
  // Сравнение с сетью
  if (dish.network && dish.network.n_rests >= 3) {
    const net = dish.network;
    const myMargin = margin;
    const netMargin = net.margin_per_unit_median || 0;
    const marginDiff = netMargin > 0 ? ((myMargin - netMargin) / netMargin * 100) : 0;
    
    const myMix = dish.mix_pct_group || 0;
    const netMix = net.mix_pct_group_median || 0;
    const mixDiff = netMix > 0 ? ((myMix - netMix) / netMix * 100) : 0;
    
    sections.push(
      '<div class="menu-drawer-section">' +
        '<h4>Сравнение с сетью</h4>' +
        '<div class="menu-drawer-net">' +
          'Медиана по <b>' + net.n_rests + ' ресторанам</b> сети:<br><br>' +
          'Маржа ₽/шт: <b>' + Math.round(netMargin) + ' ₽</b> ' +
          '<span class="' + (marginDiff > 5 ? 'net-better' : marginDiff < -5 ? 'net-worse' : '') + '">' +
            (marginDiff > 0 ? '+' : '') + marginDiff.toFixed(0) + '% у вас' +
          '</span><br>' +
          'Доля в группе: <b>' + netMix.toFixed(1) + '%</b> ' +
          '<span class="' + (mixDiff > 5 ? 'net-better' : mixDiff < -5 ? 'net-worse' : '') + '">' +
            (mixDiff > 0 ? '+' : '') + mixDiff.toFixed(0) + '% у вас' +
          '</span>' +
        '</div>' +
      '</div>'
    );
  } else {
    sections.push(
      '<div class="menu-drawer-section">' +
        '<h4>Сравнение с сетью</h4>' +
        '<div class="menu-drawer-net">' +
          '<div class="net-unavail">Недостаточно данных для сравнения (нужно ≥3 ресторана с этим блюдом)</div>' +
        '</div>' +
      '</div>'
    );
  }
  
  // Dormant детали
  if (dish.ks_class === 'dormant' && dish.dormant_reason) {
    const reasonText = {
      replaced: 'В той же группе появилось блюдо-замена. Можно зачищать из POS.',
      seasonal: 'Продавалось в аналогичный период год назад. Скорее всего вернётся в сезон.',
      retired: 'Снято без явной замены. Требует ручной проверки и очистки меню.'
    }[dish.dormant_reason] || 'Неизвестная причина';
    
    sections.push(
      '<div class="menu-drawer-section">' +
        '<h4>Dormant статус</h4>' +
        '<div class="menu-drawer-dormant">' +
          '<b>Причина:</b> ' + dish.dormant_reason + '<br>' +
          reasonText +
        '</div>' +
      '</div>'
    );
  }
  
  // Рекомендации по классу
  if (meta) {
    sections.push(
      '<div class="menu-drawer-section">' +
        '<h4>Рекомендации (' + meta.name + ')</h4>' +
        '<div class="menu-drawer-actions">' +
          '<div class="menu-action-list">' +
            meta.actions.map(a => '<div class="menu-action-item">' + escapeHtml(a) + '</div>').join('') +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }
  
  return sections.join('');
}

// ═══ STAFF ANALYSIS (Phase 2.9.2 — UI на mock-данных) ════════════════════
//
// Раздел «Персонал». 6 блоков на одной длинной странице. Backend endpoints
// уже в проде (Phase 2.9.0), возвращают mock с meta.mock=true до подключения
// пайплайна в 2.9.1.
//
// Спецификация: STAFF_METRICS_PACT.md (раздел 17 — ASCII-схема 6 блоков).
//
// Парaллельно fetch-им все 4 endpoint-а (list/groups/performance/managers/losses)
// и когда все ответы пришли — единый рендер. staff-detail — по клику на
// строку таблицы.

const STAFF_STATE = {
  loading: false,
  loadedFor: null,
  raw: {
    list: null,
    groups: null,
    performance: null,
    managers: null,
    losses: null,
  },
};

function staffCacheKey() {
  if (!R || !R.id) return null;
  const st = CAL_STATE && CAL_STATE.global;
  if (!st || !st.start || !st.end) return null;
  return R.id + '|' + st.start + '|' + st.end;
}

function invalidateStaffCache() {
  STAFF_STATE.raw = { list:null, groups:null, performance:null, managers:null, losses:null };
  STAFF_STATE.loadedFor = null;
  const panel = document.getElementById('p-staff');
  if (panel && panel.classList.contains('active')) {
    renderStaff();
  }
}

async function loadStaffAll() {
  const key = staffCacheKey();
  if (!key) return null;
  if (STAFF_STATE.loadedFor === key && STAFF_STATE.raw.list) return STAFF_STATE.raw;
  if (STAFF_STATE.loading) return null;

  STAFF_STATE.loading = true;
  try {
    const st = CAL_STATE.global;
    const qs = '?restaurant_id=' + R.id +
               '&start=' + encodeURIComponent(st.start) +
               '&end=' + encodeURIComponent(st.end);

    const [list, groups, performance, managers, losses] = await Promise.all([
      apiGet('/api/staff-list' + qs).catch(e => { console.error('[staff-list]', e.message); return null; }),
      apiGet('/api/staff-groups' + qs).catch(e => { console.error('[staff-groups]', e.message); return null; }),
      apiGet('/api/staff-performance' + qs).catch(e => { console.error('[staff-perf]', e.message); return null; }),
      apiGet('/api/staff-managers' + qs).catch(e => { console.error('[staff-mgrs]', e.message); return null; }),
      apiGet('/api/staff-losses' + qs).catch(e => { console.error('[staff-loss]', e.message); return null; }),
    ]);

    STAFF_STATE.raw = { list, groups, performance, managers, losses };
    STAFF_STATE.loadedFor = key;
    return STAFF_STATE.raw;
  } catch (e) {
    console.error('[staff] load failed:', e.message);
    return null;
  } finally {
    STAFF_STATE.loading = false;
  }
}

async function renderStaff() {
  trackUI('staff_open', { restaurant_id: R && R.id });
  const root = document.getElementById('staffRoot');
  if (!root) return;

  if (!R || !R.id) {
    root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:12px">Выберите ресторан для анализа персонала.</div>';
    return;
  }
  if (NETWORK_MODE) {
    root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:12px">Анализ персонала доступен только для конкретного ресторана. Сетевой режим будет добавлен в Phase 2.10.</div>';
    return;
  }

  root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:12px">Загрузка данных по персоналу…</div>';

  const data = await loadStaffAll();
  if (!data || !data.list) {
    root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--red);font-size:12px">Не удалось загрузить данные. Попробуйте обновить страницу.</div>';
    return;
  }

  console.log('[staff] loaded for period', CAL_STATE.global.start + '..' + CAL_STATE.global.end, {
    days: data.list.period && data.list.period.days,
    active: data.list.kpi && data.list.kpi.active_headcount && data.list.kpi.active_headcount.value,
    excluded_left: data.list.summary && data.list.summary.excluded_left_count,
  });

  const html = [];
  html.push(renderStaffMockBanner(data.list));
  html.push(renderStaffPayrollWarning(data.list));

  // Новый блок «Период в цифрах» — абсолютные значения сверху
  html.push(renderStaffPeriodStats(data.list));

  // Block 1 — KPI с формулами + breakdown по статусам
  html.push('<div class="staff-section-title">📊 Обзор<span class="hint">Ключевые показатели персонала</span></div>');
  html.push(renderStaffKPIs(data.list));
  html.push(renderStaffStatusBreakdown(data.list));

  // Block 3 — Группы + корреляция
  html.push('<div class="staff-section-title">💰 ФОТ и группы<span class="hint">Производственные группы + корреляция часы × выручка</span></div>');
  html.push(renderStaffGroups(data.groups));
  html.push(renderStaffCorrelation(data.groups));

  // Block 4 — Производительность
  html.push('<div class="staff-section-title">⚡ Производительность<span class="hint">Kasavana-Smith матрица для ролей с атрибуцией выручки</span></div>');
  html.push(renderStaffPerformance(data.performance));

  // Block 5 — Менеджеры (только за период)
  html.push('<div class="staff-section-title">👔 Менеджеры дня<span class="hint">Рейтинг по выручке, ФОТ% и качеству смен — за выбранный период</span></div>');
  html.push(renderStaffManagers(data.managers));

  // Block 6 — Потери
  html.push('<div class="staff-section-title">🚨 Потери и риск-профиль<span class="hint">Потери персонала в разрезе менеджеров и дней недели</span></div>');
  html.push(renderStaffLosses(data.losses));

  // Block 2 — Штат (таблица сотрудников) внизу
  html.push('<div class="staff-section-title">👥 Штат и смены<span class="hint">Активные сотрудники (уволенные исключены)</span></div>');
  html.push(renderStaffEmployeesTable(data.list));

  root.innerHTML = html.join('');
}

// ——— Баннеры ————————————————————————————————————————————————————————

function renderStaffMockBanner(list) {
  if (!list || !list.meta || !list.meta.mock) return '';
  return (
    '<div class="staff-mock-banner">' +
      '<span class="icon">🎭</span>' +
      '<div>' +
        '<b>Демо-данные.</b> Цифры реагируют на календарь пропорционально длине периода. ' +
        'Реальные данные из iikoWeb → ClickHouse появятся в Phase 2.9.1.' +
      '</div>' +
    '</div>'
  );
}

function renderStaffPayrollWarning(list) {
  if (!list || !list.meta) return '';
  const validFrom = list.meta.payroll_data_valid_from;
  if (!validFrom) return '';
  const st = CAL_STATE.global;
  if (!st || !st.start) return '';
  if (st.start >= validFrom) return '';

  return (
    '<div class="staff-payroll-warning">' +
      '<span>ℹ</span>' +
      '<div>Данные начислений валидны с <b>' + escapeHtml(validFrom) + '</b>. ' +
      'Показатели ФОТ% и эффективной ставки за часть периода до этой даты могут быть неполны.</div>' +
    '</div>'
  );
}

// ——— Новый блок: Период в цифрах (абсолютные значения) ————————————————————

function renderStaffPeriodStats(list) {
  if (!list || !list.period_stats) return '';
  const p = list.period_stats;
  return (
    '<div class="staff-period-stats">' +
      '<div class="staff-period-stats-title">Период в цифрах</div>' +
      '<div class="staff-period-stats-grid">' +
        stat('Дней',      p.days_in_period) +
        stat('Выручка',   formatBig(p.revenue_total_rub) + ' ₽') +
        stat('Выручка/день', formatBig(p.revenue_per_day_avg_rub) + ' ₽') +
        stat('Часов',     formatBig(p.hours_total)) +
        stat('Смен',      formatBig(p.shifts_total)) +
        stat('ФОТ',       formatBig(p.payroll_total_rub) + ' ₽') +
      '</div>' +
    '</div>'
  );
  function stat(lbl, v) {
    return (
      '<div class="staff-period-stats-cell">' +
        '<div class="lbl">' + escapeHtml(lbl) + '</div>' +
        '<div class="v">' + escapeHtml(String(v)) + '</div>' +
      '</div>'
    );
  }
}

function formatBig(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (abs >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}

// ——— Block 1: 5 KPI-карточек с формулами ————————————————————————————————

function renderStaffKPIs(list) {
  if (!list || !list.kpi) return '';
  const k = list.kpi;

  return (
    '<div class="staff-kpi-row">' +
      staffKpiWithFormula(k.payroll_pct_of_revenue, 'ФОТ %', colorByNorm(k.payroll_pct_of_revenue)) +
      staffKpiWithFormula(k.active_headcount,       'Сотрудников', null) +
      staffKpiWithFormula(k.revenue_per_hour_rub,   'Выручка/час', 'accent-gold') +
      staffKpiWithFormula(k.rotation_pct,           'Ротация', null) +
      staffKpiWithFormula(k.days_without_manager,   'Без менеджера',
        (k.days_without_manager && k.days_without_manager.value > 0) ? 'accent-red' : 'accent-green') +
    '</div>'
  );

  function colorByNorm(kObj) {
    if (!kObj || !kObj.norm) return null;
    const v = kObj.value;
    if (v < kObj.norm.min) return 'accent-green';
    if (v > kObj.norm.max) return 'accent-red';
    return 'accent-amber';
  }
}

function staffKpiWithFormula(kObj, label, extraClass) {
  if (!kObj) return '';
  const cls = 'staff-kpi' + (extraClass ? ' ' + extraClass : '');
  const val = formatKpiValue(kObj);
  // Под каждой карточкой — что на что делится и с какими абсолютами
  const formulaLine = renderKpiFormulaLine(kObj);
  return (
    '<div class="' + cls + '">' +
      '<div class="lbl">' + escapeHtml(label) + '</div>' +
      '<div class="val">' + escapeHtml(val) + '</div>' +
      '<div class="sub">' + formulaLine + '</div>' +
    '</div>'
  );
}

function formatKpiValue(kObj) {
  const v = kObj.value;
  if (v === undefined || v === null) return '—';
  if (kObj.unit === '%') return (typeof v === 'number' ? v.toFixed(1) : v) + '%';
  if (kObj.unit === '₽/час') return Math.round(v).toLocaleString('ru') + ' ₽';
  if (kObj.unit === 'дн') return v + ' дн';
  if (kObj.unit === 'чел') return v;
  return String(v);
}

function renderKpiFormulaLine(kObj) {
  // Если есть числитель/знаменатель — показываем их в сокращённом виде
  if (kObj.numerator !== undefined && kObj.denominator !== undefined) {
    let num, den;
    if (kObj.unit === '%' || kObj.unit === '₽/час') {
      num = formatBig(kObj.numerator);
      den = formatBig(kObj.denominator);
      if (kObj.unit === '%') num += ' ₽', den += ' ₽';
    } else {
      num = kObj.numerator;
      den = kObj.denominator;
    }
    return escapeHtml(num + ' / ' + den);
  }
  // Иначе — показываем сокращённую формулу из бэка
  if (kObj.formula) return escapeHtml(truncate(kObj.formula, 60));
  return '';
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ——— Breakdown по статусам ————————————————————————————————————————————

function renderStaffStatusBreakdown(list) {
  if (!list || !list.summary) return '';
  const sc = list.summary.status_counts || {};
  const excluded = list.summary.excluded_left_count || 0;

  const STATUSES = [
    { key:'core',       ico:'💎', name:'Ядро',        cls:'star' },
    { key:'regular',    ico:'👤', name:'Постоянные',  cls:'plowhorse' },
    { key:'new',        ico:'🆕', name:'Новые',       cls:'new' },
    { key:'occasional', ico:'🎲', name:'Редкие',      cls:'plowhorse' },
    { key:'dormant',    ico:'💤', name:'Dormant',     cls:'dormant' },
  ];
  const cells = STATUSES.map(s =>
    '<div class="menu-class cls-' + s.cls + '" title="' + escapeAttr(s.name) + '">' +
      '<div class="ico">' + s.ico + '</div>' +
      '<div class="n">' + (sc[s.key] || 0) + '</div>' +
      '<div class="name">' + escapeHtml(s.name) + '</div>' +
    '</div>'
  ).join('');

  const excludedNote = excluded > 0
    ? '<div style="font-size:10px;color:var(--text3);margin-top:8px;text-align:right">' +
        'Исключено <b style="color:var(--red)">' + excluded + '</b> уволенных (> 21 дня без смены)' +
      '</div>'
    : '';

  return (
    '<div class="menu-classes">' +
      '<div class="menu-classes-title">Структура активного штата</div>' +
      '<div class="menu-classes-grid" style="grid-template-columns:repeat(5, 1fr)">' + cells + '</div>' +
      excludedNote +
    '</div>'
  );
}

// ——— Block 3: Группы ————————————————————————————————————————————————

function renderStaffGroups(groupsData) {
  if (!groupsData || !groupsData.groups) return '';
  const GROUP_ICONS = {
    'Кухня':'🍳', 'Зал':'🍽', 'Бар':'🍸', 'Клининг':'🧹', 'Менеджмент':'👔',
  };
  const cards = groupsData.groups.map(g => {
    const ico = GROUP_ICONS[g.group_name] || '•';
    const revPerH = g.revenue_per_hour_group_rub
      ? formatBig(g.revenue_per_hour_group_rub) + ' ₽'
      : '—';
    const payrollAbs = formatBig(g.payroll_total_rub) + ' ₽';
    return (
      '<div class="staff-group-card g-' + (g.group_code || 'management') + '">' +
        '<div class="group-title">' + ico + ' ' + escapeHtml(g.group_name) + '</div>' +
        row('Человек', g.headcount || 0) +
        row('Часов', formatBig(g.hours_total || 0)) +
        row('ФОТ', payrollAbs) +
        row('ФОТ %', (g.payroll_pct_of_revenue || 0).toFixed(1) + '%') +
        row('₽/час', Math.round(g.cost_per_hour_rub || 0).toLocaleString('ru')) +
        row('Выр/час', revPerH) +
      '</div>'
    );
  }).join('');
  return '<div class="staff-groups-row">' + cards + '</div>';

  function row(lbl, v) {
    return '<div class="row"><span class="lbl">' + lbl + '</span><span class="v">' + escapeHtml(String(v)) + '</span></div>';
  }
}

function renderStaffCorrelation(groupsData) {
  if (!groupsData || !groupsData.restaurant) return '';
  const r = groupsData.restaurant;
  const corr = r.correlation_hours_revenue;
  if (corr === undefined || corr === null) return '';
  const corrTxt = corr.toFixed(2);
  const diag = corr >= 0.7 ? 'сильная связь — персонал планируется адекватно спросу'
             : corr >= 0.5 ? 'средняя связь — есть зазор для оптимизации графика'
             : corr >= 0.3 ? 'слабая связь — график мало реагирует на спрос'
             : 'корреляции почти нет — проверь график смен';
  return (
    '<div class="staff-scatter">' +
      '<div class="staff-scatter-title">Корреляция часов работы и выручки по дням</div>' +
      '<div class="staff-scatter-viz">' +
        '<span class="corr-val">' + corrTxt + '</span>' +
        '<span>' + escapeHtml(diag) + '</span>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--text3);margin-top:8px">' +
        escapeHtml(r.correlation_formula || 'Pearson(hours, revenue)') +
        ' · Scatter-plot будет в Phase 2.9.2c' +
      '</div>' +
    '</div>'
  );
}

// ——— Block 4: Производительность ————————————————————————————————————————

function renderStaffPerformance(perfData) {
  if (!perfData || !perfData.matrix) return '';

  const byClass = { star: [], plowhorse: [], puzzle: [], dog: [] };
  perfData.matrix.forEach(e => {
    if (byClass[e.ks_class]) byClass[e.ks_class].push(e);
  });

  const thr = perfData.thresholds || {};

  const matrixHtml =
    '<div class="staff-ks-matrix">' +
      '<div class="staff-ks-title">Матрица производительности (роли с атрибуцией выручки)</div>' +
      '<div class="staff-ks-frame">' +
        '<div class="staff-ks-y-axis">Выручка на час →</div>' +
        '<div class="staff-ks-grid">' +
          ksQuad('puzzle',   '❓', 'Puzzle',    byClass.puzzle) +
          ksQuad('star',     '⭐', 'Star',      byClass.star) +
          ksQuad('dog',      '🐶', 'Dog',       byClass.dog) +
          ksQuad('plowhorse','🐎', 'Plowhorse', byClass.plowhorse) +
        '</div>' +
        '<div class="staff-ks-x-axis">Часы работы →</div>' +
      '</div>' +
      (thr.hours_median ?
        '<div style="font-size:10px;color:var(--text3);margin-top:10px">' +
          'Медианы: ' + thr.hours_median + ' ч · ' + Math.round(thr.rph_median || 0).toLocaleString('ru') + ' ₽/час' +
        '</div>' : '') +
    '</div>';

  const shiftsHtml = renderStaffShifts(perfData);
  return '<div class="staff-ks-wrap">' + matrixHtml + shiftsHtml + '</div>';

  function ksQuad(key, ico, name, arr) {
    const names = arr.slice(0, 3).map(e => e.employee_name).join(', ') +
                  (arr.length > 3 ? ` и ещё ${arr.length - 3}` : '');
    return (
      '<div class="staff-ks-quad q-' + key + '">' +
        '<div class="ico">' + ico + '</div>' +
        '<div class="n">' + arr.length + '</div>' +
        '<div class="name">' + escapeHtml(name) + '</div>' +
        (arr.length ? '<div class="names">' + escapeHtml(names) + '</div>' : '') +
      '</div>'
    );
  }
}

function renderStaffShifts(perfData) {
  const goodShifts = (perfData.good_shifts || []).slice(0, 5);
  const badShifts = (perfData.bad_shifts || []).slice(0, 5);
  const thr = perfData.thresholds || {};

  const goodRows = goodShifts.map(s =>
    '<div class="staff-shift-row">' +
      '<span class="date">' + escapeHtml(s.report_date) + '</span>' +
      '<span class="info">' + formatBig(s.revenue) + ' ₽ · ' + s.headcount + ' чел. · <span class="manager">' + escapeHtml(s.manager) + '</span></span>' +
      '<span class="metric pos">' + s.fot_pct.toFixed(1) + '%</span>' +
    '</div>'
  ).join('');

  const badRows = badShifts.map(s =>
    '<div class="staff-shift-row">' +
      '<span class="date">' + escapeHtml(s.report_date) + '</span>' +
      '<span class="info">' + formatBig(s.revenue) + ' ₽ · ' + s.headcount + ' чел. · <span class="manager">' + escapeHtml(s.manager) + '</span></span>' +
      '<span class="metric neg">' + s.fot_pct.toFixed(1) + '%</span>' +
    '</div>'
  ).join('');

  const ruleLine = thr.good_shift_rule
    ? '<div style="font-size:10px;color:var(--text3);margin-top:6px">' +
        '✅ ' + escapeHtml(thr.good_shift_rule) + ' · ⚠ ' + escapeHtml(thr.bad_shift_rule) +
      '</div>'
    : '';

  return (
    '<div class="staff-shifts-panel">' +
      '<div class="staff-shifts-title">Сильные и слабые смены</div>' +
      (goodRows ?
        '<div class="staff-shifts-section">' +
          '<div class="staff-shifts-section-lbl good">✅ Лучшие смены (высокая выручка + низкий ФОТ%)</div>' +
          goodRows +
        '</div>' : '') +
      (badRows ?
        '<div class="staff-shifts-section">' +
          '<div class="staff-shifts-section-lbl bad">⚠ Слабые смены (низкая выручка + высокий ФОТ%)</div>' +
          badRows +
        '</div>' : '') +
      ruleLine +
      (!goodRows && !badRows ? '<div style="font-size:11px;color:var(--text3)">Смен в период не найдено</div>' : '') +
    '</div>'
  );
}

// ——— Block 5: Менеджеры (ТОЛЬКО за период) ————————————————————————————————

function renderStaffManagers(mgrsData) {
  if (!mgrsData || !mgrsData.managers) return '';
  const mgrs = mgrsData.managers;
  const summary = mgrsData.summary || {};

  const rows = mgrs.map(m => {
    const classBadge = '<span class="mgr-class-badge c-' + m.classification + '">' + classLabel(m.classification) + '</span>';
    const daysCell = m.days_as_manager + ' <span class="small" style="color:var(--text3)">(' + m.days_share_pct + '%)</span>';
    return (
      '<tr>' +
        '<td class="name-cell">' + escapeHtml(m.manager_name) + '</td>' +
        '<td class="num">' + daysCell + '</td>' +
        '<td class="num">' + formatBig(m.avg_revenue_per_day_rub) + '</td>' +
        '<td class="num">' + Math.round(m.avg_check_rub) + '</td>' +
        '<td class="num">' + m.fot_pct_avg.toFixed(1) + '%</td>' +
        '<td class="num" title="' + escapeAttr(m.losses_formula || '') + '">' + m.loss_pct_avg.toFixed(2) + '%</td>' +
        '<td class="num">' + formatBig(m.losses_staff_total_rub) + '</td>' +
        '<td class="num" style="color:var(--green)">' + m.strong_shifts_count + '</td>' +
        '<td class="num" style="color:var(--red)">' + m.weak_shifts_count + '</td>' +
        '<td>' + classBadge + '</td>' +
      '</tr>'
    );
  }).join('');

  const coverageLine = summary.days_in_period ?
    '<div style="font-size:10px;color:var(--text3);padding:8px 14px;background:var(--bg2);border-bottom:1px solid var(--border)">' +
      'Покрытие: ' + (summary.total_days_covered || 0) + ' из ' + summary.days_in_period + ' дней периода (' + (summary.coverage_pct || 0) + '%)' +
      (summary.days_without_manager > 0 ? ' · <span style="color:var(--red)">Без менеджера: ' + summary.days_without_manager + ' дн</span>' : '') +
    '</div>' : '';

  return (
    '<div class="staff-table-wrap">' +
      coverageLine +
      '<div class="staff-table-scroll">' +
        '<table class="staff-table">' +
          '<thead><tr>' +
            '<th>Менеджер</th>' +
            '<th style="text-align:right">Дней в периоде</th>' +
            '<th style="text-align:right">Ср.выручка/день</th>' +
            '<th style="text-align:right">Ср.чек</th>' +
            '<th style="text-align:right">ФОТ %</th>' +
            '<th style="text-align:right" title="Потери ÷ Выручка × 100">Потери %</th>' +
            '<th style="text-align:right">Потери ₽</th>' +
            '<th style="text-align:right">✅</th>' +
            '<th style="text-align:right">⚠</th>' +
            '<th>Класс</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>'
  );

  function classLabel(c) {
    return {
      'top':'Топ',
      'reliable':'Надёжный',
      'concerning':'Внимание',
      'problem':'Проблема',
      'insufficient_data':'Мало данных',
      'no_manager':'Без менеджера',
    }[c] || c;
  }
}

// ——— Block 6: Потери ————————————————————————————————————————————————————

function renderStaffLosses(lossesData) {
  if (!lossesData || !lossesData.kpi) return '';
  const kpi = lossesData.kpi;

  // 3 KPI верхнего уровня с формулами
  const kpiRow =
    '<div class="staff-losses-kpi-row">' +
      lossKpi('Потери персонала',
              (kpi.losses_staff_pct_of_revenue || 0).toFixed(2) + '%',
              kpi.losses_pct_formula,
              kpi.losses_staff_pct_of_revenue > 1.5 ? 'accent-red' : 'accent-green') +
      lossKpi('На смену',
              Math.round(kpi.losses_per_shift_avg_rub || 0).toLocaleString('ru') + ' ₽',
              kpi.losses_per_shift_formula, null) +
      lossKpi('Инвестиции в персонал',
              formatBig(kpi.staff_investment_rub || 0) + ' ₽',
              kpi.staff_investment_formula, 'accent-gold') +
    '</div>';

  const alerts = (lossesData.alerts || []).map(a =>
    '<div class="staff-losses-alert sev-' + a.severity + '">' +
      '<span>' + (a.severity === 'red' ? '🔴' : '🟡') + '</span>' +
      '<div>' + escapeHtml(a.message) + '</div>' +
    '</div>'
  ).join('');
  const alertsHtml = alerts
    ? '<div class="staff-losses-alerts"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px;font-weight:500">Сигналы</div>' + alerts + '</div>'
    : '';

  const breakdown = (lossesData.category_a_breakdown || []).slice(0, 6);
  const maxRub = Math.max(...breakdown.map(b => b.total_rub), 1);
  const breakdownRows = breakdown.map(b => {
    const w = Math.round((b.total_rub / maxRub) * 100);
    return (
      '<div class="bar-row">' +
        '<span class="lbl">' + escapeHtml(b.item) + '</span>' +
        '<div class="bar-wrap"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
        '<span class="v">' + formatBig(b.total_rub) + ' ₽</span>' +
      '</div>'
    );
  }).join('');
  const breakdownHtml =
    '<div class="staff-losses-breakdown">' +
      '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px;font-weight:500">Прямые потери персонала — разбивка</div>' +
      breakdownRows +
    '</div>';

  const byMgr = lossesData.by_manager || [];
  const mgrRows = byMgr.map(m =>
    '<tr>' +
      '<td class="name-cell">' + escapeHtml(m.manager) + '</td>' +
      '<td class="num small">' + m.days + '</td>' +
      '<td class="num">' + formatBig(m.losses_total_rub) + ' ₽</td>' +
      '<td class="num small" style="color:var(--text3)">' + formatBig(m.revenue_rub) + ' ₽</td>' +
      '<td class="num" title="' + escapeAttr(m.loss_formula || '') + '" style="color:' + (m.loss_pct > 1.0 ? 'var(--red)' : 'var(--text)') + '">' + m.loss_pct.toFixed(2) + '%</td>' +
    '</tr>'
  ).join('');
  const byMgrHtml = byMgr.length ? (
    '<div class="staff-table-wrap">' +
      '<div style="font-size:10px;color:var(--text3);padding:8px 14px;background:var(--bg2);border-bottom:1px solid var(--border)">Потери в разрезе менеджеров дня</div>' +
      '<div class="staff-table-scroll">' +
        '<table class="staff-table">' +
          '<thead><tr>' +
            '<th>Менеджер</th>' +
            '<th style="text-align:right">Дней</th>' +
            '<th style="text-align:right">Потери ₽</th>' +
            '<th style="text-align:right">Выручка в его дни</th>' +
            '<th style="text-align:right">% потерь</th>' +
          '</tr></thead>' +
          '<tbody>' + mgrRows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>'
  ) : '';

  const byDow = lossesData.by_dow || [];
  const maxDowLoss = Math.max(...byDow.map(d => d.loss_pct), 0.1);
  const minDowLoss = Math.min(...byDow.map(d => d.loss_pct), 0.01);
  const dowCells = byDow.map(d => {
    const cls = d.loss_pct >= maxDowLoss * 0.95 ? 'high' : d.loss_pct <= minDowLoss * 1.05 ? 'low' : '';
    return (
      '<div class="staff-losses-dow-cell ' + cls + '">' +
        '<div class="day">' + escapeHtml(d.day_name) + '</div>' +
        '<div class="v">' + formatBig(d.avg_losses_rub) + '</div>' +
        '<div class="pct">' + d.loss_pct.toFixed(2) + '%</div>' +
      '</div>'
    );
  }).join('');
  const byDowHtml = byDow.length ? (
    '<div class="staff-losses-dow">' +
      '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1.2px;font-weight:500">Потери по дням недели (среднее ₽ / % от выручки)</div>' +
      '<div class="staff-losses-dow-grid">' + dowCells + '</div>' +
    '</div>'
  ) : '';

  return kpiRow + alertsHtml + breakdownHtml + byMgrHtml + byDowHtml;

  function lossKpi(label, value, formula, extraClass) {
    const cls = 'staff-kpi' + (extraClass ? ' ' + extraClass : '');
    return (
      '<div class="' + cls + '">' +
        '<div class="lbl">' + escapeHtml(label) + '</div>' +
        '<div class="val">' + escapeHtml(value) + '</div>' +
        '<div class="sub">' + escapeHtml(truncate(formula || '', 70)) + '</div>' +
      '</div>'
    );
  }
}

// ——— Block 2: Штат (таблица сотрудников + drawer) ————————————————————

function renderStaffEmployeesTable(listData) {
  if (!listData || !listData.employees) return '';
  const employees = listData.employees;

  const rows = employees.map(e => {
    const lastShift = e.days_since_last_shift === 0 ? 'сегодня' : (e.days_since_last_shift || 0) + ' дн.';
    const perf = (e.revenue_per_hour_rub !== null && e.revenue_per_hour_rub !== undefined)
      ? Math.round(e.revenue_per_hour_rub).toLocaleString('ru') + ' ₽/ч'
      : '—';
    return (
      '<tr onclick="openStaffDrawer(\'' + escapeAttr(e.employee_id) + '\')">' +
        '<td class="name-cell">' + escapeHtml(e.employee_name) + '</td>' +
        '<td class="small">' + escapeHtml(e.role_primary || '—') + '</td>' +
        '<td class="small">' + escapeHtml(e.group_primary === '-' ? 'Менеджмент' : e.group_primary) + '</td>' +
        '<td><span class="staff-status-badge st-' + e.status + '">' + statusLabel(e.status) + '</span></td>' +
        '<td class="num">' + (e.shifts_count || 0) + '</td>' +
        '<td class="num">' + Math.round(e.hours_total || 0) + '</td>' +
        '<td class="num">' + Math.round(e.payroll_total_rub || 0).toLocaleString('ru') + '</td>' +
        '<td class="num">' + perf + '</td>' +
        '<td class="small">' + lastShift + '</td>' +
      '</tr>'
    );
  }).join('');

  return (
    '<div class="staff-table-wrap">' +
      '<div class="staff-table-scroll">' +
        '<table class="staff-table">' +
          '<thead><tr>' +
            '<th>Сотрудник</th>' +
            '<th>Роль</th>' +
            '<th>Группа</th>' +
            '<th>Статус</th>' +
            '<th style="text-align:right">Смен</th>' +
            '<th style="text-align:right">Часов</th>' +
            '<th style="text-align:right">Начислено, ₽</th>' +
            '<th style="text-align:right">₽/час выручки</th>' +
            '<th>Посл. смена</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>' +
    renderStaffDrawerSkeleton()
  );

  function statusLabel(s) {
    return {
      'core':'Ядро','regular':'Постоянный','new':'Новый','occasional':'Редкий','dormant':'Dormant',
    }[s] || s;
  }
}

function renderStaffDrawerSkeleton() {
  return (
    '<div class="staff-drawer-overlay" id="staffDrawer" onclick="if(event.target===this)closeStaffDrawer()">' +
      '<div class="staff-drawer">' +
        '<div class="staff-drawer-head">' +
          '<div>' +
            '<div class="staff-drawer-name" id="staffDrawerName">—</div>' +
            '<div class="staff-drawer-sub" id="staffDrawerSub">—</div>' +
          '</div>' +
          '<div class="staff-drawer-close" onclick="closeStaffDrawer()">✕</div>' +
        '</div>' +
        '<div class="staff-drawer-body" id="staffDrawerBody">' +
          '<div style="color:var(--text3);font-size:11px">Загрузка…</div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

async function openStaffDrawer(employeeId) {
  const overlay = document.getElementById('staffDrawer');
  if (!overlay) return;
  overlay.classList.add('open');
  document.getElementById('staffDrawerName').textContent = 'Загрузка…';
  document.getElementById('staffDrawerSub').textContent = '';
  document.getElementById('staffDrawerBody').innerHTML = '<div style="color:var(--text3);font-size:11px">Загрузка…</div>';

  const st = CAL_STATE.global;
  const qs = '?restaurant_id=' + R.id +
             '&employee_id=' + encodeURIComponent(employeeId) +
             '&start=' + encodeURIComponent(st.start) +
             '&end=' + encodeURIComponent(st.end);

  try {
    const data = await apiGet('/api/staff-detail' + qs);
    renderStaffDrawerBody(data);
  } catch (e) {
    document.getElementById('staffDrawerBody').innerHTML =
      '<div style="color:var(--red);font-size:11px">Ошибка загрузки: ' + escapeHtml(e.message) + '</div>';
  }
}

function renderStaffDrawerBody(data) {
  if (!data || !data.employee) return;
  const e = data.employee;
  const k = data.kpi_period || {};
  const c = data.contribution || {};

  document.getElementById('staffDrawerName').textContent = e.employee_name || '—';
  document.getElementById('staffDrawerSub').textContent =
    (e.role_primary || '') + ' · ' + (e.group_primary === '-' ? 'Менеджмент' : e.group_primary) +
    ' · стаж ' + (e.tenure_days || 0) + ' дн.';

  // KPI за период
  const perfKpis = (k.revenue_per_hour_rub !== null && k.revenue_per_hour_rub !== undefined) ?
    '<div class="staff-drawer-kpi"><div class="lbl">Выручка/час</div><div class="val">' + Math.round(k.revenue_per_hour_rub).toLocaleString('ru') + ' ₽</div></div>' +
    '<div class="staff-drawer-kpi"><div class="lbl">Чеков/час</div><div class="val">' + (k.checks_per_hour || 0).toFixed(1) + '</div></div>' +
    '<div class="staff-drawer-kpi"><div class="lbl">Средний чек</div><div class="val">' + Math.round(k.avg_check_rub || 0).toLocaleString('ru') + ' ₽</div></div>'
    : '';

  // Новый блок: вклад сотрудника в ресторан
  const contributionHtml = c.hours_share_pct !== undefined ? (
    '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1.2px;margin:16px 0 8px;font-weight:500">Вклад в ресторан</div>' +
    '<div class="staff-drawer-kpi-grid">' +
      drawerKpi('Доля часов', c.hours_share_pct + '%', c.hours_share_formula) +
      drawerKpi('Доля ФОТ', c.payroll_share_pct + '%', c.payroll_share_formula) +
      (c.revenue_share_pct !== null ? drawerKpi('Доля выручки', c.revenue_share_pct + '%', c.revenue_share_formula) : '') +
      (c.revenue_attributed_rub ? drawerKpi('Атрибуция ₽', formatBig(c.revenue_attributed_rub) + ' ₽',
        'hours_total × revenue_per_hour_rub') : '') +
    '</div>'
  ) : '';

  const timeline = (data.shifts_timeline || []).slice(0, 10).map(s =>
    '<div class="staff-shift-row" style="grid-template-columns:90px 1fr 80px">' +
      '<span class="date">' + escapeHtml(s.date) + '</span>' +
      '<span class="info">' + s.hours.toFixed(1) + ' ч · ' +
        (s.revenue_attributed ? formatBig(s.revenue_attributed) + ' ₽ · ' + (s.checks || 0) + ' чек.' : 'без атрибуции') +
      '</span>' +
      '<span class="metric" style="color:var(--text2)">' + (s.payroll ? Math.round(s.payroll).toLocaleString('ru') : '—') + '</span>' +
    '</div>'
  ).join('');

  const html =
    '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px;font-weight:500">KPI за период</div>' +
    '<div class="staff-drawer-kpi-grid">' +
      '<div class="staff-drawer-kpi"><div class="lbl">Смен</div><div class="val">' + (k.shifts_count || 0) + '</div></div>' +
      '<div class="staff-drawer-kpi"><div class="lbl">Часов</div><div class="val">' + Math.round(k.hours_total || 0) + '</div></div>' +
      '<div class="staff-drawer-kpi"><div class="lbl">Начислено</div><div class="val">' + formatBig(k.payroll_total_rub || 0) + ' ₽</div></div>' +
      '<div class="staff-drawer-kpi"><div class="lbl">₽/час</div><div class="val">' + Math.round(k.rate_effective_rub_per_hour || 0) + '</div></div>' +
      perfKpis +
    '</div>' +
    contributionHtml +
    (timeline ?
      '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1.2px;margin:16px 0 8px;font-weight:500">Последние смены</div>' +
      '<div>' + timeline + '</div>' : ''
    );

  document.getElementById('staffDrawerBody').innerHTML = html;

  function drawerKpi(lbl, val, formula) {
    return (
      '<div class="staff-drawer-kpi" title="' + escapeAttr(formula || '') + '">' +
        '<div class="lbl">' + escapeHtml(lbl) + '</div>' +
        '<div class="val">' + escapeHtml(String(val)) + '</div>' +
        (formula ? '<div style="font-size:9px;color:var(--text3);margin-top:4px">' + escapeHtml(truncate(formula, 45)) + '</div>' : '') +
      '</div>'
    );
  }
}

function closeStaffDrawer() {
  const overlay = document.getElementById('staffDrawer');
  if (overlay) overlay.classList.remove('open');
}

// Закрытие drawer по Esc
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeStaffDrawer();
});

// ═══ ADMIN — Аналитика активности (Phase 2.9.3) ═══════════════════════════
//
// Видна только пользователям с is_admin=true в KV USERS.
// При загрузке дёргаем /api/admin/me — если админ, вставляем кнопку вкладки
// в nav. Если не админ — ничего не происходит, пользователь даже не видит
// что такая вкладка существует.
//
// Источник: /api/admin/activity?window=7|30
// Рендер: 5 блоков — toolbar, сводка, sparkline DAU, топ табов/endpoints, таблица юзеров

const ADMIN_STATE = {
  is_admin: false,
  window: 7,
  data: null,
  loading: false,
};

async function checkAdminAndShowTab() {
  try {
    const r = await apiGet('/api/admin/me');
    if (!r || !r.is_admin) return;
    ADMIN_STATE.is_admin = true;

    // Берём родителя существующей кнопки «Персонал» — это гарантированно
    // правильный контейнер на том же уровне, что и остальные .ntab-кнопки.
    const staffBtn = document.querySelector('[data-tab="staff"]');
    if (!staffBtn || !staffBtn.parentElement) {
      console.log('[admin] staff tab not found, skipping admin tab');
      return;
    }
    const navContainer = staffBtn.parentElement;

    // Защита от повторного добавления (hot-reload / повторный вызов init)
    if (navContainer.querySelector('[data-tab="admin"]')) return;

    const btn = document.createElement('div');
    btn.className = 'ntab';
    btn.setAttribute('data-tab', 'admin');
    btn.setAttribute('onclick', 'goTab(this)');
    btn.textContent = '📊 Активность';
    // Вставляем после «Персонал», чтобы порядок был стабилен
    staffBtn.insertAdjacentElement('afterend', btn);
    console.log('[admin] is_admin=true, tab added next to staff');
  } catch (e) {
    console.log('[admin] check failed (normal for non-admins):', e.message);
  }
}

async function renderAdmin() {
  trackUI('admin_open');
  const root = document.getElementById('adminRoot');
  if (!root) return;
  if (!ADMIN_STATE.is_admin) {
    root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--red);font-size:12px">403 — Доступ только для администраторов.</div>';
    return;
  }
  await loadAdminData();
  drawAdmin();
}

async function loadAdminData() {
  if (ADMIN_STATE.loading) return;
  ADMIN_STATE.loading = true;
  const root = document.getElementById('adminRoot');
  if (root && !ADMIN_STATE.data) {
    root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:12px">Загрузка аналитики активности…</div>';
  }
  try {
    const data = await apiGet('/api/admin/activity?window=' + ADMIN_STATE.window);
    ADMIN_STATE.data = data;
  } catch (e) {
    console.error('[admin] load failed:', e.message);
    if (root) {
      root.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--red);font-size:12px">Ошибка: ' + escapeHtml(e.message) + '</div>';
    }
  } finally {
    ADMIN_STATE.loading = false;
  }
}

function drawAdmin() {
  const root = document.getElementById('adminRoot');
  if (!root || !ADMIN_STATE.data) return;
  const d = ADMIN_STATE.data;
  const html = [
    renderAdminToolbar(d),
    renderAdminSummary(d.summary),
    renderAdminSparkline(d.daily_dau),
    renderAdminTwoCol(d),
    renderAdminUsers(d.by_user),
  ];
  root.innerHTML = html.join('');
}

// ——— Toolbar ——————————————————————————————————————————————————————

function renderAdminToolbar(d) {
  const w = ADMIN_STATE.window;
  return (
    '<div class="admin-toolbar">' +
      '<span class="admin-toolbar-label">Окно:</span>' +
      '<div class="admin-toolbar-switch">' +
        '<button class="' + (w === 7 ? 'active' : '') + '" onclick="switchAdminWindow(7)">7 дней</button>' +
        '<button class="' + (w === 30 ? 'active' : '') + '" onclick="switchAdminWindow(30)">30 дней</button>' +
      '</div>' +
      '<button class="admin-toolbar-refresh" onclick="refreshAdmin()">↻ Обновить</button>' +
      '<span style="color:var(--text3);font-size:10px;margin-left:10px">' +
        'Обновлено: ' + formatAdminTime(d.generated_at) +
      '</span>' +
    '</div>'
  );
}

async function switchAdminWindow(w) {
  if (ADMIN_STATE.window === w) return;
  ADMIN_STATE.window = w;
  ADMIN_STATE.data = null;
  await loadAdminData();
  drawAdmin();
}

async function refreshAdmin() {
  ADMIN_STATE.data = null;
  await loadAdminData();
  drawAdmin();
}

function formatAdminTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) +
           ' ' + d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  } catch (_e) { return iso; }
}

// ——— Сводка KPI ——————————————————————————————————————————————————————

function renderAdminSummary(s) {
  if (!s) return '';
  const errPct = s.total_events > 0 ? +((s.errors / s.total_events) * 100).toFixed(1) : 0;
  const errClass = errPct > 5 ? 'accent-red' : errPct > 2 ? 'accent-gold' : 'accent-green';
  return (
    '<div class="admin-summary-row">' +
      adminCard('DAU', s.dau, 'уникальных за сегодня', 'accent-gold') +
      adminCard('WAU', s.wau, 'уникальных за неделю', 'accent-blue') +
      adminCard('Событий', (s.total_events || 0).toLocaleString('ru'), 'всего в окне', null) +
      adminCard('API / UI', (s.api_calls || 0).toLocaleString('ru') + ' / ' + (s.ui_clicks || 0), 'запросов / кликов', null) +
      adminCard('Ошибок', s.errors, errPct + '% от запросов', errClass) +
    '</div>'
  );
}

function adminCard(label, value, sub, extraClass) {
  const cls = 'admin-summary-card' + (extraClass ? ' ' + extraClass : '');
  return (
    '<div class="' + cls + '">' +
      '<div class="lbl">' + escapeHtml(label) + '</div>' +
      '<div class="val">' + escapeHtml(String(value)) + '</div>' +
      '<div class="sub">' + escapeHtml(sub) + '</div>' +
    '</div>'
  );
}

// ——— Sparkline DAU ————————————————————————————————————————————————

function renderAdminSparkline(daily) {
  if (!daily || !daily.length) return '';
  const maxDau = Math.max.apply(null, daily.map(function(x){ return x.dau; }).concat([1]));
  const bars = daily.slice(-14);
  const todayIso = new Date().toISOString().slice(0, 10);

  const barsHtml = bars.map(function(b) {
    const h = Math.max(4, Math.round((b.dau / maxDau) * 100));
    const isToday = b.date === todayIso;
    const style = 'height:' + h + '%;' + (isToday ? 'background:linear-gradient(180deg,var(--green),var(--green2));' : '');
    return (
      '<div class="admin-spark-bar" style="' + style + '">' +
        '<div class="tip">' + escapeHtml(b.date) + '<br>DAU: <b>' + b.dau + '</b> · событий: ' + b.events + '</div>' +
      '</div>'
    );
  }).join('');

  const labelsHtml = bars.map(function(b) {
    const parts = b.date.split('-');
    return '<div>' + parts[2] + '.' + parts[1] + '</div>';
  }).join('');

  return (
    '<div class="admin-sparkline-wrap">' +
      '<div class="admin-sparkline-title">DAU по дням (последние ' + bars.length + ' дней)</div>' +
      '<div class="admin-sparkline">' + barsHtml + '</div>' +
      '<div class="admin-spark-labels">' + labelsHtml + '</div>' +
    '</div>'
  );
}

// ——— Две колонки: топ табов + топ endpoints ——————————————————————————

function renderAdminTwoCol(d) {
  return (
    '<div class="admin-two-col">' +
      renderAdminTopTabs(d.top_tabs) +
      renderAdminTopEndpoints(d.top_endpoints) +
    '</div>'
  );
}

function renderAdminTopTabs(tabs) {
  const rows = (tabs || []).map(function(t, i) {
    const name = (t.tab_action || '').replace(/^\/ui\//, '');
    return (
      '<div class="admin-rank-row">' +
        '<span class="rank">' + (i + 1) + '.</span>' +
        '<span class="name">' + escapeHtml(name) + '</span>' +
        '<span class="count">' + t.clicks + '</span>' +
        '<span class="users">' + t.unique_users + ' польз.</span>' +
      '</div>'
    );
  }).join('');
  return (
    '<div class="admin-col">' +
      '<div class="admin-col-title">Топ вкладок и UI-кликов</div>' +
      '<div class="admin-rank-list">' + (rows || '<div style="padding:14px;color:var(--text3);font-size:11px">Нет данных</div>') + '</div>' +
    '</div>'
  );
}

function renderAdminTopEndpoints(eps) {
  const rows = (eps || []).map(function(e) {
    const isSlow = e.avg_ms > 1500;
    const hasErrors = e.errors > 0;
    return (
      '<tr>' +
        '<td class="endpoint-cell">' + escapeHtml(e.endpoint) + '</td>' +
        '<td class="method-cell">' + escapeHtml(e.method) + '</td>' +
        '<td class="num">' + e.calls + '</td>' +
        '<td class="num">' + e.unique_users + '</td>' +
        '<td class="num slow-cell' + (isSlow ? ' is-slow' : '') + '">' + e.avg_ms + '</td>' +
        '<td class="num err-cell' + (hasErrors ? ' has-errors' : '') + '">' + e.errors + '</td>' +
      '</tr>'
    );
  }).join('');
  return (
    '<div class="admin-col">' +
      '<div class="admin-col-title">Топ API endpoints</div>' +
      '<div style="overflow:auto;max-height:500px">' +
        '<table class="admin-endpoint-table">' +
          '<thead><tr>' +
            '<th>Endpoint</th>' +
            '<th>Метод</th>' +
            '<th style="text-align:right">Вызовов</th>' +
            '<th style="text-align:right">Польз.</th>' +
            '<th style="text-align:right">Ср. мс</th>' +
            '<th style="text-align:right">Ошибок</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>'
  );
}

// ——— Таблица пользователей ————————————————————————————————————————————

function renderAdminUsers(users) {
  if (!users || !users.length) return '';

  // Индикатор активности: точка зелёная/жёлтая/серая по давности last_seen
  const now = Date.now();
  const rows = users.map(function(u) {
    const last = u.last_seen ? new Date(u.last_seen.replace(' ', 'T') + 'Z').getTime() : 0;
    const hoursAgo = (now - last) / 3600000;
    let dotClass = 'stale';
    let dotLabel = '>1 нед.';
    if (hoursAgo < 24) { dotClass = 'today'; dotLabel = 'сегодня'; }
    else if (hoursAgo < 24 * 3) { dotClass = 'recent'; dotLabel = Math.round(hoursAgo / 24) + ' дн.'; }
    else if (hoursAgo < 24 * 7) { dotClass = 'recent'; dotLabel = Math.round(hoursAgo / 24) + ' дн.'; }
    else { dotLabel = Math.round(hoursAgo / 24) + ' дн.'; }

    return (
      '<tr>' +
        '<td class="email-cell">' +
          '<span class="admin-activity-dot ' + dotClass + '" title="' + dotLabel + '"></span>' +
          escapeHtml(u.email) +
        '</td>' +
        '<td class="num">' + u.total_events + '</td>' +
        '<td class="num">' + u.api_calls + '</td>' +
        '<td class="num">' + u.ui_clicks + '</td>' +
        '<td class="num">' + u.active_days + '</td>' +
        '<td class="num">' + u.unique_endpoints + '</td>' +
        '<td class="num">' + u.restaurants_viewed + '</td>' +
        '<td class="small">' + escapeHtml(u.last_seen || '—') + '</td>' +
      '</tr>'
    );
  }).join('');

  return (
    '<div class="admin-users-wrap">' +
      '<div class="admin-col-title" style="border-bottom:1px solid var(--border)">Пользователи (' + users.length + ')</div>' +
      '<div class="admin-users-scroll">' +
        '<table class="admin-users-table">' +
          '<thead><tr>' +
            '<th>Email</th>' +
            '<th style="text-align:right">Событий</th>' +
            '<th style="text-align:right">API</th>' +
            '<th style="text-align:right">UI</th>' +
            '<th style="text-align:right">Дней</th>' +
            '<th style="text-align:right">Endpoints</th>' +
            '<th style="text-align:right">Ресторанов</th>' +
            '<th>Последний заход</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>'
  );
}


init();


// ════════════════════════════════════════════════════════════════════════
// Phase 2.10 — MARKETING TAB (CRM-портрет лояльности)
// ════════════════════════════════════════════════════════════════════════
//
// Endpoint /api/marketing-overview возвращает один объект со всеми срезами:
// kpi, funnel, rfm, loyalty, campaigns, balances, money, health,
// sparkline_dau (массив точек по дням), meta.
//
// Для динамики используем sparkline_dau — endpoint расширим под все периоды
// (7/14/30/90/120/365 дней) на стороне сервера, либо клиент сам режет.
//
// Сейчас держим всю логику клиентскую — endpoint вернёт максимум, мы режем.

const MKT_STATE = {
  data: null,        // ответ endpoint
  period: 90,        // активный период в днях
  charts: {},        // Chart.js инстансы
  loading: false,
  error: null
};

async function renderMarketing() {
  trackUI('marketing_open', {});
  const root = document.getElementById('mkt-root');
  if (!root) return;

  // Кэшируем — не перегружаем при каждом возврате на вкладку
  if (MKT_STATE.data) {
    mktDraw();
    return;
  }
  if (MKT_STATE.loading) return;
  MKT_STATE.loading = true;

  try {
    const r = await fetch(API_BASE + '/api/marketing-overview', {
      credentials: 'include'
    });
    if (r.status === 401) { showLogin(); return; }
    if (!r.ok) {
      throw new Error('HTTP ' + r.status);
    }
    MKT_STATE.data = await r.json();
    mktDraw();
  } catch (e) {
    console.error('[marketing] error:', e.message);
    MKT_STATE.error = e.message;
    root.innerHTML = '<div class="mkt-error">Не удалось загрузить маркетинг-данные: ' + escapeHtml(e.message) + '</div>';
  } finally {
    MKT_STATE.loading = false;
  }
}

function mktSetPeriod(days, btnEl) {
  MKT_STATE.period = days;
  document.querySelectorAll('#mktPeriodBtns .pbtn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  // Перерисуем только KPI-дельты и графики динамики
  if (MKT_STATE.data) mktDrawDynamics();
}

function mktFmtNum(n) {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toLocaleString('ru');
}
function mktFmtMoney(n) {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toLocaleString('ru') + ' ₽';
}
function mktFmtPct(n, digits=1) {
  if (n === null || n === undefined) return '—';
  return n.toFixed(digits) + '%';
}

function mktDraw() {
  const d = MKT_STATE.data;
  const root = document.getElementById('mkt-root');

  // Meta информация в шапке
  const meta = document.getElementById('mkt-meta');
  if (meta && d.meta) {
    meta.innerHTML = 'Снапшот <b style="color:var(--gold2)">' + escapeHtml(d.meta.snapshot_date) + '</b>';
  }

  // ── Insights ──────────────────────────────────────────────────────────
  // Считаем заранее, чтобы готовые рекомендации с реальными числами
  const insights = mktBuildInsights(d);

  // ── Funnel этапы ──────────────────────────────────────────────────────
  const fnl = d.funnel || {};
  const total = fnl.clients_total || 0;
  const pct = (n) => total > 0 ? (n / total * 100) : 0;
  const repeatPct = pct(fnl.clients_repeat);
  const a90Pct = pct(fnl.clients_active_90d);
  const a30Pct = pct(fnl.clients_active_30d);
  const loyalPct = pct(fnl.clients_loyal_5_plus);
  const conv1to2 = fnl.clients_total > 0 ? (fnl.clients_repeat / fnl.clients_total * 100) : 0;
  const conv2to90 = fnl.clients_repeat > 0 ? (fnl.clients_active_90d / fnl.clients_repeat * 100) : 0;
  const conv90to30 = fnl.clients_active_90d > 0 ? (fnl.clients_active_30d / fnl.clients_active_90d * 100) : 0;
  const conv30toLoyal = fnl.clients_active_30d > 0 ? (fnl.clients_loyal_5_plus / fnl.clients_active_30d * 100) : 0;

  // ── HTML ───────────────────────────────────────────────────────────────
  root.innerHTML = `
    <!-- Row 2: KPI -->
    <div class="g5">
      <div class="kcard">
        <div class="klbl">База клиентов</div>
        <div class="kval"><span id="mkt-k-total">${mktFmtNum(d.kpi.clients_total)}</span></div>
        <div class="kdelta nt" id="mkt-kd-total">—</div>
        <div class="kbench">Уникальных в CRM</div>
        <div class="kbar bgo" style="width:100%"></div>
      </div>
      <div class="kcard">
        <div class="klbl">Активны 30 дней</div>
        <div class="kval"><span id="mkt-k-act">${mktFmtNum(d.kpi.clients_active_30d)}</span> <span class="u">${mktFmtPct(pct(d.kpi.clients_active_30d))}</span></div>
        <div class="kdelta nt" id="mkt-kd-act">—</div>
        <div class="kbench">Купили за последние 30 дней</div>
        <div class="kbar bg" style="width:75%"></div>
      </div>
      <div class="kcard">
        <div class="klbl">Repeat rate</div>
        <div class="kval"><span id="mkt-k-rep">${mktFmtPct(d.kpi.repeat_rate_pct, 1)}</span></div>
        <div class="kdelta nt" id="mkt-kd-rep">—</div>
        <div class="kbench">Доля клиентов с 2+ чеками</div>
        <div class="kbar bb" style="width:84%"></div>
      </div>
      <div class="kcard">
        <div class="klbl">Медиана LTV</div>
        <div class="kval"><span id="mkt-k-ltv">${mktFmtNum(d.kpi.ltv_median)}</span> <span class="u">₽</span></div>
        <div class="kdelta nt" id="mkt-kd-ltv">—</div>
        <div class="kbench">LTV среднего клиента</div>
        <div class="kbar bgo" style="width:60%"></div>
      </div>
      <div class="kcard">
        <div class="klbl">Бонусы в обороте</div>
        <div class="kval"><span>${(d.kpi.bal_total_sum/1000000).toFixed(2)}</span> <span class="u">млн ₽</span></div>
        <div class="kdelta nt">— только текущий снапшот</div>
        <div class="kbench">${mktFmtNum(d.balances.clients_with_gift)} клиентов с подарком</div>
        <div class="kbar ba" style="width:100%"></div>
      </div>
    </div>

    <!-- Row 3: Insights -->
    <div class="card" style="margin-bottom:12px">
      <div class="ctitle">🔔 Что бросается в глаза</div>
      ${insights}
    </div>

    <!-- Row 4: Funnel + RFM -->
    <div class="g21">
      <div class="card">
        <div class="ctitle">
          <span>🪜 Воронка удержания</span>
          <span class="right">от регистрации до лояльного ядра</span>
        </div>
        <div class="mkt-fstep">
          <div class="mkt-flbl">Вся база</div>
          <div class="mkt-fbar"><div class="mkt-fbar-fill" style="width:100%;background:linear-gradient(90deg,var(--gold),var(--gold2))">100%</div></div>
          <div class="mkt-fval">${mktFmtNum(fnl.clients_total)}</div>
          <div class="mkt-fpct"></div>
        </div>
        <div class="mkt-fconv">↓ <span class="v">${conv1to2.toFixed(1)}%</span> вернулись хотя бы 2 раза</div>
        <div class="mkt-fstep">
          <div class="mkt-flbl">Купили 2+ раз</div>
          <div class="mkt-fbar"><div class="mkt-fbar-fill" style="width:${repeatPct.toFixed(1)}%;background:linear-gradient(90deg,#2980b9,var(--blue))">${repeatPct.toFixed(1)}%</div></div>
          <div class="mkt-fval">${mktFmtNum(fnl.clients_repeat)}</div>
          <div class="mkt-fpct">/ ${mktFmtNum(total)}</div>
        </div>
        <div class="mkt-fconv">↓ <span class="v">${conv2to90.toFixed(1)}%</span> остались активными 90д</div>
        <div class="mkt-fstep">
          <div class="mkt-flbl">Активны 90 дней</div>
          <div class="mkt-fbar"><div class="mkt-fbar-fill" style="width:${a90Pct.toFixed(1)}%;background:linear-gradient(90deg,#27AE60,var(--green))">${a90Pct.toFixed(1)}%</div></div>
          <div class="mkt-fval">${mktFmtNum(fnl.clients_active_90d)}</div>
          <div class="mkt-fpct">/ ${mktFmtNum(total)}</div>
        </div>
        <div class="mkt-fconv">↓ <span class="v">${conv90to30.toFixed(1)}%</span> покупали в этом месяце</div>
        <div class="mkt-fstep">
          <div class="mkt-flbl">Активны 30 дней</div>
          <div class="mkt-fbar"><div class="mkt-fbar-fill" style="width:${a30Pct.toFixed(1)}%;background:linear-gradient(90deg,#1ABC9C,var(--teal))">${a30Pct.toFixed(1)}%</div></div>
          <div class="mkt-fval">${mktFmtNum(fnl.clients_active_30d)}</div>
          <div class="mkt-fpct">/ ${mktFmtNum(total)}</div>
        </div>
        <div class="mkt-fconv">↓ <span class="v">${conv30toLoyal.toFixed(1)}%</span> регулярные покупатели</div>
        <div class="mkt-fstep">
          <div class="mkt-flbl">Лояльное ядро (5+ чеков)</div>
          <div class="mkt-fbar"><div class="mkt-fbar-fill" style="width:${loyalPct.toFixed(1)}%;background:linear-gradient(90deg,#9B59B6,#b07cc7)">${loyalPct.toFixed(1)}%</div></div>
          <div class="mkt-fval">${mktFmtNum(fnl.clients_loyal_5_plus)}</div>
          <div class="mkt-fpct">/ ${mktFmtNum(total)}</div>
        </div>
        <div class="mkt-fnote">
          <b>Главная утечка:</b> между 1-м и 2-м визитом — теряем <span class="danger">${(100-conv1to2).toFixed(1)}%</span> новых клиентов (${mktFmtNum(fnl.clients_one_check)} из ${mktFmtNum(total)}). Это самая большая точка роста.
        </div>
      </div>

      <div class="card">
        <div class="ctitle"><span>🎯 RFM сегменты</span><span class="right">для рассылок</span></div>
        ${mktSegRow('var(--gold)', 'VIP', '5+ чеков, активны 60д', d.rfm.vip, total)}
        ${mktSegRow('var(--amber)', 'At risk', '3+ чеков, отвалились 60-120д', d.rfm.at_risk, total)}
        ${mktSegRow('var(--blue)', 'Dormant valuable', 'сильный чек, спят 90-180д', d.rfm.dormant_valuable, total)}
        ${mktSegRow('var(--green)', 'New', 'первая покупка, до 30д', d.rfm.new_first_purchase, total)}
        ${mktSegRow('var(--red)', 'Lost', '1 чек, ушли 180+д назад', d.rfm.lost_one_time, total)}
        ${mktSegRow('var(--text3)', 'Other', '', d.rfm.other, total)}
        <div style="margin-top:14px">
          <div class="ctitle" style="margin-bottom:8px">🏅 Группы лояльности <span class="mkt-tag-no-history">только сейчас</span></div>
          ${mktSegRow('#888', 'Новичок 3%', '', d.loyalty.novichok, total)}
          ${mktSegRow('var(--blue)', 'Трейни 5%', '', d.loyalty.treyni, total)}
          ${mktSegRow('var(--gold)', 'Айдол 10%', '', d.loyalty.idol, total)}
          ${mktSegRow('var(--purple)', 'Легенда 7%', '', d.loyalty.legenda, total)}
        </div>
      </div>
    </div>

    <!-- Row 5: Dynamics charts -->
    <div class="card" style="margin-bottom:12px">
      <div class="ctitle">
        <span>📈 Динамика за <span id="mkt-dyn-lbl">${MKT_STATE.period} дней</span></span>
        <span class="right">по дням</span>
      </div>
      <div class="g2">
        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Рост базы клиентов</div>
          <div class="mkt-chart-h150"><canvas id="mktChartTotal"></canvas></div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Активные за 30 дней</div>
          <div class="mkt-chart-h150"><canvas id="mktChartActive"></canvas></div>
        </div>
      </div>
      <div class="g2" style="margin-top:6px;margin-bottom:0">
        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Repeat rate, %</div>
          <div class="mkt-chart-h150"><canvas id="mktChartRepeat"></canvas></div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Новые регистрации</div>
          <div class="mkt-chart-h150"><canvas id="mktChartNewReg"></canvas></div>
        </div>
      </div>
    </div>

    <!-- Row 6: Triggered campaigns -->
    <div class="card" style="margin-bottom:12px">
      <div class="ctitle">
        <span>🚀 Триггерные кампании <span class="mkt-tag-no-history">текущий снапшот</span></span>
        <span class="right">готовые сегменты для рассылок</span>
      </div>
      <div class="g3" style="margin-bottom:0">
        ${mktCampCard('🔥', 'Самая горячая', 'Сгорание подарков', d.campaigns.burning_gift_clients, 'сумма: ' + mktFmtMoney(d.campaigns.burning_gift_amount), true)}
        ${mktCampCard('🥈', 'Высокий шанс', 'Второй визит (7-30 дней)', d.campaigns.second_visit_clients, 'окно для возврата', false)}
        ${mktCampCard('💔', 'Реактивация', 'Winback (90-180д + LTV выше медианы)', d.campaigns.winback_clients, '~25% обычно возвращаются', false)}
      </div>
      <div class="g3" style="margin-top:10px;margin-bottom:0">
        ${mktCampCard('🎂', 'Срочно', 'ДР через 7 дней', d.campaigns.birthday_7d_clients, 'персональный промокод', false)}
        ${mktCampCard('🎂', 'В планах', 'ДР через 30 дней', d.campaigns.birthday_30d_clients, 'для месячного календаря', false)}
        ${mktCampCard('⚠️', 'Зомби-база', 'Спят 180+ дней', d.health.clients_dormant_180_plus, 'сложно вернуть', false)}
      </div>
    </div>

    <!-- Row 7: Bonuses + LTV + Health -->
    <div class="g3">
      <div class="card">
        <div class="ctitle"><span>💰 Бонусные балансы</span><span class="mkt-tag-no-history">только сейчас</span></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:10px;border-bottom:1px solid var(--border)">
            <span style="font-size:11px;color:var(--text2)">Всего в обороте</span>
            <span style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--gold);font-weight:700">${mktFmtMoney(d.balances.total)}</span>
          </div>
          ${mktBalRow('🎁 Подарок (welcome)', d.balances.gift)}
          ${mktBalRow('💵 Накопительный', d.balances.accumulated)}
          ${mktBalRow('🎉 Промо', d.balances.promo)}
          <div style="margin-top:8px;padding-top:10px;border-top:1px solid var(--border);font-size:10px;color:var(--text3)">
            С балансом: <b style="color:var(--text)">${mktFmtNum(d.balances.clients_with_gift)}</b> с подарком · <b style="color:var(--text)">${mktFmtNum(d.balances.clients_with_accumulated)}</b> с накопит.
          </div>
        </div>
      </div>

      <div class="card">
        <div class="ctitle">💎 LTV распределение</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${mktLtvRow('Total (вся база)', (d.money.ltv_total/1000000).toFixed(1) + ' млн ₽', 'var(--gold2)')}
          ${mktLtvRow('Mean (среднее)', mktFmtMoney(d.money.ltv_mean))}
          ${mktLtvRow('Median (медиана)', mktFmtMoney(d.money.ltv_median), 'var(--gold)')}
          ${mktLtvRow('P75 (75-й процентиль)', mktFmtMoney(d.money.ltv_p75))}
          <div style="display:flex;justify-content:space-between;font-size:11px;padding-top:8px;border-top:1px solid var(--border)">
            <span style="color:var(--text2)">Средний чек по сети</span>
            <span style="font-family:'JetBrains Mono',monospace;color:var(--gold)">${mktFmtMoney(d.money.avg_check)}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="ctitle">🏥 Здоровье данных CRM</div>
        ${mktHealthRow('Дата рождения', d.health.pct_with_birth_date, 'var(--green)')}
        ${mktHealthRow('Email', d.health.pct_with_email, 'var(--amber)')}
        ${mktHealthRow('Пол', d.health.pct_with_gender, 'var(--red)')}
        <div style="margin-top:14px;padding:10px 12px;background:var(--card2);border-radius:8px;font-size:10px;color:var(--text2);line-height:1.55">
          <div style="color:var(--gold);font-weight:600;margin-bottom:4px;font-size:11px">⚠️ Аномалии</div>
          <b>${d.health.anomaly_zero_revenue_with_balance}</b> клиентов имеют положительный баланс при нулевой выручке (тестовые карты или отмены).<br>
          <b>${mktFmtNum(d.health.clients_dormant_180_plus)}</b> клиентов спят 180+ дней — кандидаты на «зомби-список».
        </div>
      </div>
    </div>

    <div class="mkt-foot">
      <b>Источник:</b> ${escapeHtml(d.meta.source)} · Снапшот <b>${escapeHtml(d.meta.snapshot_date)}</b> · Обновляется ежедневно в 06:45 ·
      <span class="mkt-tag-no-history" style="margin:0 4px">только сейчас</span> — данные доступны только из текущего CRM-снапшота
    </div>
  `;

  // Графики динамики
  mktDrawDynamics();
}

function mktSegRow(color, name, desc, val, total) {
  const pct = total > 0 ? (val / total * 100) : 0;
  return `
    <div class="mkt-srow">
      <div class="mkt-sdot" style="background:${color}"></div>
      <div class="mkt-sname">${escapeHtml(name)}${desc ? '<span class="desc">' + escapeHtml(desc) + '</span>' : ''}</div>
      <div class="mkt-sval">${mktFmtNum(val)}</div>
      <div class="mkt-spct">${pct.toFixed(1)}%</div>
    </div>`;
}

function mktCampCard(ico, tag, name, val, sub, isHot) {
  return `
    <div class="mkt-camp ${isHot ? 'hot' : ''}">
      <div class="mkt-camp-head">
        <div class="mkt-camp-icon">${ico}</div>
        <div class="mkt-camp-tag ${isHot ? 'hot' : ''}">${escapeHtml(tag)}</div>
      </div>
      <div>
        <div class="mkt-camp-sub">${escapeHtml(name)}</div>
        <div class="mkt-camp-val">${mktFmtNum(val)}</div>
        <div class="mkt-camp-money">${escapeHtml(sub)}</div>
      </div>
      <div class="mkt-camp-cta" title="Запустится после интеграции с каналом отправки">скоро · скачать список →</div>
    </div>`;
}

function mktBalRow(name, val) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:11px;color:var(--text2)">${escapeHtml(name)}</span>
      <span style="font-family:'JetBrains Mono',monospace;color:var(--gold2);font-weight:600">${mktFmtMoney(val)}</span>
    </div>`;
}

function mktLtvRow(name, val, color='var(--text)') {
  return `
    <div style="display:flex;justify-content:space-between;font-size:11px">
      <span style="color:var(--text2)">${escapeHtml(name)}</span>
      <span style="font-family:'JetBrains Mono',monospace;color:${color};font-weight:500">${val}</span>
    </div>`;
}

function mktHealthRow(name, pct, color) {
  if (pct === null || pct === undefined) {
    return `
      <div class="mkt-hrow">
        <div class="mkt-hlbl">${escapeHtml(name)}</div>
        <div class="mkt-hbar"><div class="mkt-hbar-fill" style="width:0;background:var(--text3)"></div></div>
        <div class="mkt-hval" style="color:var(--text3)">—</div>
      </div>`;
  }
  return `
    <div class="mkt-hrow">
      <div class="mkt-hlbl">${escapeHtml(name)}</div>
      <div class="mkt-hbar"><div class="mkt-hbar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      <div class="mkt-hval" style="color:${color}">${pct.toFixed(1)}%</div>
    </div>`;
}

function mktBuildInsights(d) {
  const out = [];
  // Сгорание
  if (d.campaigns.burning_gift_clients > 0) {
    out.push(`
      <div class="mkt-insight ins-red">
        <span class="ins-ico">🔥</span>
        <div>
          <b>${mktFmtMoney(d.campaigns.burning_gift_amount)}</b> подарочных бонусов зависли у <b>${mktFmtNum(d.campaigns.burning_gift_clients)} клиентов</b>, которые не покупали 60+ дней. Это потенциал для триггерной рассылки с дедлайном.
          <span class="ins-action">Действие: push-уведомление «Ваш подарок сгорает через 7 дней»</span>
        </div>
      </div>`);
  }
  // Второй визит
  if (d.campaigns.second_visit_clients > 0) {
    out.push(`
      <div class="mkt-insight ins-amber">
        <span class="ins-ico">🥈</span>
        <div>
          <b>${mktFmtNum(d.campaigns.second_visit_clients)} клиентов с одним чеком</b> покупали 7-30 дней назад — горячий момент для возврата на второй визит.
          <span class="ins-action">Действие: персональный купон «10% на второй заказ»</span>
        </div>
      </div>`);
  }
  // Один чек
  if (d.funnel.clients_one_check > 0 && d.funnel.clients_total > 0) {
    const pct = (d.funnel.clients_one_check / d.funnel.clients_total * 100);
    out.push(`
      <div class="mkt-insight ins-blue">
        <span class="ins-ico">📉</span>
        <div>
          <b>${pct.toFixed(0)}% базы (${mktFmtNum(d.funnel.clients_one_check)} клиентов)</b> сделали только один чек за всё время. Основная точка роста — превратить новичков в постоянных.
          <span class="ins-action">Действие: welcome-серия из 3 писем + бонус на 2-й заказ</span>
        </div>
      </div>`);
  }
  // ДР
  if ((d.campaigns.birthday_7d_clients > 0) || (d.campaigns.birthday_30d_clients > 0)) {
    out.push(`
      <div class="mkt-insight ins-gold">
        <span class="ins-ico">🎂</span>
        <div>
          У <b>${mktFmtNum(d.campaigns.birthday_7d_clients)}</b> клиентов день рождения в ближайшие 7 дней, у <b>${mktFmtNum(d.campaigns.birthday_30d_clients)}</b> — в ближайшие 30. Готовая аудитория для именной кампании.
          <span class="ins-action">Действие: персональное поздравление + промокод на десерт</span>
        </div>
      </div>`);
  }
  return out.join('');
}

function mktDrawDynamics() {
  const data = MKT_STATE.data;
  // Phase 2.10.1: endpoint теперь возвращает sparkline (5 полей за 365 дней).
  // Старое поле sparkline_dau оставлено для обратной совместимости, fallback на него.
  const series = (data && data.sparkline) || (data && data.sparkline_dau) || [];
  if (!series.length) {
    return;
  }
  const days = MKT_STATE.period;
  // Берём последние N дней (или сколько есть, если запрошенный период длиннее истории)
  const slice = series.slice(-days);
  const realDays = slice.length - 1; // фактическое расстояние first→last в днях

  const labels = slice.map(p => {
    const parts = p.date.split('-');
    return parts[2] + '.' + parts[1];
  });

  // Новые имена полей (как в макете и mart_crm_overview).
  // Если endpoint ещё старый и отдаёт {dau, total, new_today} — fallback.
  const total   = slice.map(p => p.clients_total      ?? p.total      ?? 0);
  const active  = slice.map(p => p.clients_active_30d ?? p.dau        ?? 0);
  const newReg  = slice.map(p => p.new_registrations_today ?? p.new_today ?? 0);
  const repeat  = slice.map(p => p.repeat_rate_pct ?? data.kpi.repeat_rate_pct);
  const ltvMed  = slice.map(p => p.ltv_median      ?? data.kpi.ltv_median);

  mktDrawLine('mktChartTotal',  labels, total,  '#D4A84B');
  mktDrawLine('mktChartActive', labels, active, '#2ECC71');
  mktDrawLine('mktChartRepeat', labels, repeat, '#4A9EF5');
  mktDrawLine('mktChartNewReg', labels, newReg, '#9B59B6');

  const lbl = document.getElementById('mkt-dyn-lbl');
  if (lbl) lbl.textContent = days === 365 ? 'год' : days + ' дней';

  // Дельты на KPI-карточках. Используем realDays для подписи —
  // если в slice меньше точек чем запрошено (нет столько истории), не врём.
  if (slice.length >= 2) {
    const first = slice[0];
    const last  = slice[slice.length - 1];
    const dTotal  = (last.clients_total      ?? last.total      ?? 0) - (first.clients_total      ?? first.total      ?? 0);
    const dActive = (last.clients_active_30d ?? last.dau        ?? 0) - (first.clients_active_30d ?? first.dau        ?? 0);
    const dRepeat = (last.repeat_rate_pct ?? null) !== null && (first.repeat_rate_pct ?? null) !== null
                  ? (last.repeat_rate_pct - first.repeat_rate_pct) : null;
    const dLtv    = (last.ltv_median ?? null) !== null && (first.ltv_median ?? null) !== null
                  ? (last.ltv_median - first.ltv_median) : null;

    mktUpdateDelta('mkt-kd-total', dTotal,  '',     realDays);
    mktUpdateDelta('mkt-kd-act',   dActive, '',     realDays);
    if (dRepeat !== null) mktUpdateDeltaPct('mkt-kd-rep', dRepeat, realDays);
    if (dLtv    !== null) mktUpdateDelta('mkt-kd-ltv', dLtv, ' ₽', realDays);
  }
}

// Спец-форматтер для % — десятые п.п.
function mktUpdateDeltaPct(elId, delta, days) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (Math.abs(delta) < 0.05) {
    el.className = 'kdelta nt';
    el.innerHTML = '— стабильно к ' + days + 'д назад';
  } else if (delta > 0) {
    el.className = 'kdelta up';
    el.innerHTML = '▲ +' + delta.toFixed(1) + ' п.п. за ' + days + 'д';
  } else {
    el.className = 'kdelta dn';
    el.innerHTML = '▼ −' + Math.abs(delta).toFixed(1) + ' п.п. за ' + days + 'д';
  }
}

function mktUpdateDelta(elId, delta, suffix, days) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (delta === 0) {
    el.className = 'kdelta nt';
    el.innerHTML = '— стабильно к ' + days + 'д назад';
  } else if (delta > 0) {
    el.className = 'kdelta up';
    el.innerHTML = '▲ +' + Math.round(Math.abs(delta)).toLocaleString('ru') + suffix + ' за ' + days + 'д';
  } else {
    el.className = 'kdelta dn';
    el.innerHTML = '▼ −' + Math.round(Math.abs(delta)).toLocaleString('ru') + suffix + ' за ' + days + 'д';
  }
}

function mktDrawLine(canvasId, labels, values, color) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  if (MKT_STATE.charts[canvasId]) MKT_STATE.charts[canvasId].destroy();
  const ctx = el.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,150);
  grad.addColorStop(0, color + '60');
  grad.addColorStop(1, color + '00');
  MKT_STATE.charts[canvasId] = new Chart(el, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: grad,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {display: false},
        tooltip: {
          backgroundColor: '#1E2D47',
          borderColor: '#3A5080',
          borderWidth: 1,
          titleColor: '#EBF0FA',
          bodyColor: '#F0C96A',
          padding: 8
        }
      },
      scales: {
        x: {ticks: {color: '#4E6A90', font: {size: 9}, maxTicksLimit: 6, autoSkip: true}, grid: {display: false}},
        y: {ticks: {color: '#4E6A90', font: {size: 9}, maxTicksLimit: 4}, grid: {color: '#2E4068', lineWidth: 0.5}}
      }
    }
  });
}

// Утилита: используем существующий escapeHtml из dashboard.js (определён выше).
// Если когда-то в будущем его уберут, тут оставим резервный.
if (typeof escapeHtml !== 'function') {
  window.escapeHtml = function(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  };
}
