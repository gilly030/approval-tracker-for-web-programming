// 공개 페이지. data/index.json(요약)을 먼저 읽고, 배너 상세는 data/years/YYYY.json 을 필요할 때 읽는다.
import { lineChart, downloadCSV, downloadPNG } from './linechart.js';
import { regionMap } from './tilemap.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtN = (n) => (n == null ? '–' : n.toLocaleString('ko-KR'));
const moe = (n) => (n ? 1.96 * Math.sqrt(0.25 / n) * 100 : null);
const SMALL_N = 100;
const MAX_SERIES = 6;
const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'];
const GAP_DAYS = 45; // 이보다 오래 조사가 비면 선을 끊는다

const store = {
  get(k) { try { return localStorage.getItem('jt:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('jt:' + k, v); } catch { /* 저장 불가 환경 */ } },
};

const state = {
  index: null,
  years: new Map(),     // 연도 → Promise<surveys>
  detail: new Map(),    // key → survey(상세)
  type: store.get('type') || 'weekly', // 배너별 추이에만 쓰임
  surveyKey: null,
  banner: store.get('banner') || '지역별',
  metric: 'pos',
  slots: new Map(),
  range: { preset: store.get('range') || 'term', from: null, to: null },
  charts: {},
};

// ---------- 날짜 ----------
function dateOf(s) {
  if (s._d) return s._d;
  let d;
  const m1 = s.label.match(/\((\d{1,2})\/(\d{1,2})\s*~/);
  const m2 = s.label.match(/\((\d{1,2})\s*~\s*\d{1,2}일?\)/);
  if (s.type === 'weekly' && m1) d = new Date(s.year - (+m1[1] === 12 && s.month === 1 ? 1 : 0), +m1[1] - 1, +m1[2]);
  else if (s.type === 'weekly' && m2) d = new Date(s.year, s.month - 1, +m2[1]);
  else if (s.type === 'weekly') d = new Date(s.year, s.month - 1, Math.min(28, 1 + (s.week - 1) * 7 + 2));
  else d = new Date(s.year, s.month - 1, 15);
  return (s._d = d);
}
const byDate = (a, b) => dateOf(a) - dateOf(b);
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ymLabel = (v) => { const [y, m] = v.split('-'); return `${y}년 ${+m}월`; };
const monthStart = (v) => { const [y, m] = v.split('-').map(Number); return new Date(y, m - 1, 1); };
const monthEnd = (v) => { const [y, m] = v.split('-').map(Number); return new Date(y, m, 0, 23, 59); };
const css = (v) => `var(${v})`;
const metricVal = (r) => (r == null || r.pos == null ? null : state.metric === 'pos' ? r.pos : state.metric === 'neg' ? r.neg : r.pos - r.neg);
const metricName = () => ({ pos: '긍정률', neg: '부정률', net: '긍정−부정' }[state.metric]);

const all = () => state.index.surveys;
const weekly = () => all().filter((s) => s.type === 'weekly' && s.pos != null).sort(byDate);
const latest = () => { const w = weekly(); return w[w.length - 1] || [...all()].sort(byDate).pop(); };

// ---------- 상세 불러오기 ----------
function loadYear(y) {
  if (!state.years.has(y)) {
    state.years.set(y, fetch(`data/years/${y}.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${y}년 자료를 불러오지 못했어요 (${r.status})`);
      return r.json();
    }).then((j) => { for (const s of j.surveys) state.detail.set(s.key, s); return j.surveys; }));
  }
  return state.years.get(y);
}
async function details(list) {
  await Promise.all([...new Set(list.map((s) => s.year))].map(loadYear));
  return list.map((s) => state.detail.get(s.key)).filter(Boolean);
}

// ---------- 기간 ----------
function bounds() {
  const w = weekly();
  return { first: dateOf(w[0] || all()[0]), last: dateOf(latest()) };
}
function rangeDates() {
  const { first, last } = bounds();
  const r = state.range;
  const back = (months) => new Date(last.getFullYear(), last.getMonth() - months, last.getDate() + 1);
  switch (r.preset) {
    case '3m': return [back(3), last];
    case '6m': return [back(6), last];
    case '1y': return [back(12), last];
    case 'all': return [first, last];
    case 'custom': return [monthStart(r.from || ym(first)), monthEnd(r.to || ym(last))];
    default: { // 'term': 현 대통령 임기
      const p = latest().president;
      const mine = weekly().filter((s) => s.president === p);
      return [mine.length ? dateOf(mine[0]) : first, last];
    }
  }
}
const inRange = (s) => { const [a, b] = rangeDates(); const d = dateOf(s); return d >= a && d <= b; };

function renderRange() {
  const { first, last } = bounds();
  // '기간 설정'을 누르면 시작~끝 칸이 열리고, 적용을 눌러야 그래프가 바뀐다
  const custom = state.customOpen || state.range.preset === 'custom';
  const pressed = custom ? 'custom' : state.range.preset;
  document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === pressed)));
  $('#range-custom').hidden = !custom;
  const [a, b] = rangeDates();
  // 갤럽 데일리 오피니언은 2012년 1월부터. 아직 수집 전인 기간도 고를 수 있게 한다.
  for (const id of ['#range-from', '#range-to']) { $(id).min = EARLIEST; $(id).max = ym(last); }
  $('#range-from').value = state.range.from || ym(a);
  $('#range-to').value = state.range.to || ym(b);
  setPending(false);
}
const EARLIEST = '2012-01';

// 날짜 칸을 고쳤지만 아직 적용하지 않은 상태
function setPending(on) {
  state.rangePending = on;
  $('#range-apply').classList.toggle('idle', !on);
  $('#range-info').classList.toggle('pending', on);
  if (on) $('#range-info').textContent = '적용을 누르면 이 기간으로 바뀝니다';
}
function applyCustomRange() {
  let from = $('#range-from').value, to = $('#range-to').value;
  if (!from || !to) { $('#range-info').textContent = '시작과 끝 월을 모두 골라 주세요'; return; }
  if (from > to) [from, to] = [to, from];
  state.range = { preset: 'custom', from, to };
  renderRange(); ensureSurvey(); renderMain(); renderBanners(); renderSnapshot(); renderTrend();
}

// 그래프 가로축: 고른 기간 그대로 (끝은 최신 조사까지만)
function axisRange() {
  const [a, b] = rangeDates();
  const last = bounds().last;
  return [a < monthStart(EARLIEST) ? monthStart(EARLIEST) : a, b > last ? last : b];
}
// 고른 기간 앞부분에 자료가 없으면 알려준다
function renderGap(list) {
  const el = $('#range-gap');
  const [a] = axisRange();
  const bf = state.index.backfill;
  const collecting = bf && !bf.done ? ' 과거 자료를 자동으로 모으는 중이라, 며칠 안에 채워집니다.' : '';
  if (!list.length) { el.hidden = false; el.textContent = `이 기간에는 아직 자료가 없어요.${collecting}`; return; }
  const firstD = dateOf(list[0]);
  if ((firstD - a) / 864e5 > GAP_DAYS) {
    el.hidden = false;
    el.textContent = `${ymLabel(ym(a))}부터 ${ymLabel(ym(firstD))} 전까지는 아직 자료가 없어요.${collecting}`;
    return;
  }
  // 수집 중에는 중간에 1년 넘게 빈 구간이 생길 수 있다
  const hole = list.findIndex((s, i) => i && (dateOf(s) - dateOf(list[i - 1])) / 864e5 > 365);
  if (hole > 0 && collecting) {
    el.hidden = false;
    el.textContent = `${ymLabel(ym(dateOf(list[hole - 1])))}부터 ${ymLabel(ym(dateOf(list[hole])))} 사이는 아직 자료가 없어요.${collecting}`;
  } else el.hidden = true;
}

// ---------- 최신 수치 ----------
function renderHeadline() {
  const s = latest();
  const prev = weekly().filter((x) => x.president === s.president && dateOf(x) < dateOf(s)).pop();
  const d = prev ? s.pos - prev.pos : null;
  const delta = d == null ? '' : `<span class="delta" title="직전 조사(${esc(prev.label)}) 대비">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}%p</span>`;
  $('#headline').innerHTML = `
    <div>
      <div class="kicker">${esc(s.president || '')} 대통령 직무 긍정률 · ${esc(s.label)}</div>
      <div class="big num">${s.pos}<span class="unit">%</span></div>
      <div class="sub">잘못하고 있다 <b class="num">${s.neg}%</b> · 의견유보 <span class="num">${s.rest}%</span>${delta}</div>
    </div>
    <div class="split">
      <div class="split-bar" role="img" aria-label="잘하고 있다 ${s.pos}%, 의견유보 ${s.rest}%, 잘못하고 있다 ${s.neg}%">
        <span style="flex-basis:${s.pos}%;background:var(--pos)"></span>
        <span style="flex-basis:${s.rest}%;background:var(--mid)"></span>
        <span style="flex-basis:${s.neg}%;background:var(--neg)"></span>
      </div>
      <div class="meta">전국 만 18세 이상 <span class="num">${fmtN(s.n)}</span>명 · 표본오차 ±<span class="num">${moe(s.n).toFixed(1)}</span>%p (95% 신뢰수준) · 데일리 오피니언 제${s.issue ?? '?'}호</div>
    </div>`;
}

// ---------- 공통: 끊김·대통령 구간 ----------
// 조사가 오래 비거나 대통령이 바뀌면 사이에 빈 점을 넣어 선을 끊는다
function withBreaks(list, toPoint) {
  const out = [];
  list.forEach((s, i) => {
    const p = list[i - 1];
    if (p && ((dateOf(s) - dateOf(p)) / 864e5 > GAP_DAYS || p.president !== s.president)) {
      out.push({ x: new Date((+dateOf(s) + +dateOf(p)) / 2), y: null });
    }
    out.push(toPoint(s));
  });
  return out;
}
function presidentBands(list) {
  const bands = [];
  for (const s of list) {
    const b = bands[bands.length - 1];
    if (b && b.label === s.president) b.x1 = dateOf(s);
    else bands.push({ label: s.president || '?', x0: dateOf(s), x1: dateOf(s) });
  }
  return bands.length > 1 ? bands : [];
}

// ---------- 메인 그래프 ----------
function renderMain() {
  const list = weekly().filter(inRange);
  const pres = [...new Set(list.map((s) => s.president))];
  const one = pres.length === 1;
  $('#main-title').textContent = one ? `${pres[0]} 대통령 직무 수행 평가` : '대통령 직무 수행 평가';
  $('#main-q').textContent = `귀하는 요즘 ${one ? pres[0] : '○○○'} 대통령이 대통령으로서의 직무를 잘 수행하고 있다고 보십니까, 아니면 잘못 수행하고 있다고 보십니까?`;
  const [a, b] = rangeDates();
  if (!state.rangePending) $('#range-info').textContent = list.length ? `자료: ${list[0].label} ~ ${list[list.length - 1].label} · 주간 조사 ${list.length}회` : `${ymLabel(ym(a))} ~ ${ymLabel(ym(b))}`;
  renderGap(list);
  if (list.length < 2) {
    $('#main-legend').innerHTML = '';
    $('#main-chart').innerHTML = `<div class="empty">이 기간에는 주간 조사 자료가 ${list.length ? '1회뿐' : '없'}이에요. 기간을 넓혀 보세요.</div>`;
    state.charts.main = null; state.mainData = null;
    $('#main-table').innerHTML = '';
    return;
  }
  const pt = (key) => (s) => ({ x: dateOf(s), y: s[key], label: `${s.label}${one ? '' : ` · ${s.president}`}`, n: s.n });
  const series = [
    { id: 'pos', name: '잘하고 있다', color: css('--pos'), points: withBreaks(list, pt('pos')) },
    { id: 'neg', name: '잘못하고 있다', color: css('--neg'), points: withBreaks(list, pt('neg')) },
  ];
  const sel = list.find((s) => s.key === state.surveyKey);
  state.charts.main = lineChart($('#main-chart'), {
    series, legendEl: $('#main-legend'), unit: '%', yMin: 0, bands: presidentBands(list),
    xMin: axisRange()[0], xMax: axisRange()[1],
    selectedX: sel ? dateOf(sel) : null,
    selectedLabel: sel ? shortLabel(sel) : null,
    onSelect: (x) => { const s = list.find((q) => +dateOf(q) === +x); if (s) selectSurvey(s.key, true); },
    ariaLabel: `대통령 직무 긍정률과 부정률 추이, ${list[0].label}부터 ${list[list.length - 1].label}까지`,
  });
  state.mainData = { list, series, title: $('#main-title').textContent };
  $('#main-note').textContent = '점을 누르면 그 주의 응답자 특성별 결과가 아래에 나옵니다. 매주 조사(전국 만 18세 이상 약 1,000명), 의견유보(어느 쪽도 아님·모름/응답거절)는 그리지 않았습니다.'
    + (one ? '' : ' 음영은 대통령 임기 구분이고, 대통령이 바뀌거나 조사가 한 달 넘게 비면 선을 끊었습니다.');
  renderMainTable(list);
}

function renderMainTable(list) {
  const rows = [...list].reverse();
  $('#main-table-count').textContent = `${rows.length}회`;
  $('#main-table').innerHTML = `<table><thead><tr><th>조사</th><th>대통령</th><th>잘하고 있다</th><th>잘못하고 있다</th><th>의견유보</th><th>긍정률 변화</th><th>사례수</th><th>표본오차</th><th>출처</th></tr></thead><tbody>${
    rows.map((s, i) => {
      const p = rows[i + 1];
      const d = p && p.president === s.president ? s.pos - p.pos : null;
      return `<tr><td>${esc(s.label)}</td><td>${esc(s.president ?? '')}</td><td>${s.pos}%</td><td>${s.neg}%</td><td>${s.rest}%</td><td>${d == null ? '–' : (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d)}</td><td>${fmtN(s.n)}</td><td>±${moe(s.n)?.toFixed(1) ?? '–'}%p</td><td>${s.issue ? `제${s.issue}호` : '–'}</td></tr>`;
    }).join('')
  }</tbody></table>`;
}


// ---------- 선택한 조사 ----------
const surveysOf = (type) => all().filter((s) => s.type === type);
const currentMeta = () => all().find((s) => s.key === state.surveyKey);
const shortLabel = (s) => s.label.replace(/^\d{4}년 /, '').replace(/\s*\(.*\)$/, '');

// 선택이 없거나 기간 밖이면 기간 안의 가장 최근 주로
function ensureSurvey() {
  const inR = weekly().filter(inRange);
  const cur = currentMeta();
  if (!cur || (cur.type === 'weekly' && !inR.includes(cur))) state.surveyKey = (inR[inR.length - 1] || latest()).key;
}
function selectSurvey(key, fromChart = false) {
  if (key === state.surveyKey) return;
  state.surveyKey = key;
  renderMain();
  renderBanners();
  renderSnapshot();
  renderTrend();
  if (fromChart) {
    const el = $('#snapshot');
    const r = el.getBoundingClientRect();
    if (r.top > innerHeight * 0.85) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
}
function stepSurvey(dir) {
  const w = weekly();
  const i = w.findIndex((s) => s.key === state.surveyKey);
  const next = w[i + dir];
  if (!next) return;
  // 기간 밖으로 넘어가면 기간을 직접 설정으로 넓힌다
  if (!inRange(next)) {
    const [a, b] = rangeDates();
    const d = dateOf(next);
    state.range = { preset: 'custom', from: ym(d < a ? d : a), to: ym(d > b ? d : b) };
    renderRange();
  }
  state.surveyKey = null; // selectSurvey가 항상 다시 그리도록
  selectSurvey(next.key);
}
function renderStepper() {
  const w = weekly();
  const i = w.findIndex((s) => s.key === state.surveyKey);
  $('#prev-week').disabled = i <= 0;
  $('#next-week').disabled = i < 0 || i >= w.length - 1;
}

// 화면에 보여줄 기본 배너 (회차마다 붙는 특별 배너는 데이터에만 두고 숨긴다)
const STANDARD_BANNERS = ['지역별', '성별', '연령별', '지지정당별', '직업별', '생활수준별', '이념성향별', '정치관심도별'];
function renderBanners() {
  const list = STANDARD_BANNERS.filter((b) => currentMeta().banners.includes(b));
  if (!list.includes(state.banner)) state.banner = list[0];
  $('#banners').innerHTML = list.map((b, i) => `<button type="button" id="banner-${i}" data-banner="${esc(b)}" aria-pressed="${b === state.banner}">${esc(b)}</button>`).join('');
}

// ---------- 특성별 막대 ----------
function rowHTML(r, isTotal = false) {
  const small = r.n != null && r.n < SMALL_N;
  const m = moe(r.n);
  const rawG = r.raw?.split('|')[1];
  const raw = rawG && rawG !== r.group ? `<span class="raw">${esc(rawG)}</span>` : '';
  const label = `<div class="g">${esc(isTotal ? '전체' : r.group)}${small ? '<span class="pill">표본 적음</span>' : ''}${raw}</div>`;
  const nn = `<div class="nn"><span class="num">${fmtN(r.n)}</span>명${m ? `<br>±<span class="num">${m.toFixed(1)}</span>%p` : ''}</div>`;
  if (r.pos == null) return `<div class="row">${label}<div class="na">표본이 적어 수치 미공개</div>${nn}</div>`;
  const lbl = (v) => (v >= 9 ? `${v}%` : '');
  return `<div class="row${isTotal ? ' total' : ''}" title="잘하고 있다 ${r.pos}% · 의견유보 ${r.rest}% · 잘못하고 있다 ${r.neg}%">
    ${label}
    <div class="bar${small ? ' small' : ''}" role="img" aria-label="${esc(isTotal ? '전체' : r.group)}: 잘하고 있다 ${r.pos}%, 의견유보 ${r.rest}%, 잘못하고 있다 ${r.neg}%">
      <span class="p" style="flex:0 0 calc(${r.pos}% - 2px)">${lbl(r.pos)}</span>
      <span class="m" style="flex:0 0 calc(${r.rest}% - 2px)">${lbl(r.rest)}</span>
      <span class="n" style="flex:1 1 auto">${lbl(r.neg)}</span>
    </div>
    ${nn}</div>`;
}
async function renderSnapshot() {
  const meta = currentMeta();
  $('#snap-when').textContent = `${meta.label}${meta.president ? ` · ${meta.president} 대통령` : ''}`;
  $('#snap-title').textContent = `${state.banner} 평가`;
  renderStepper();
  const [s] = await details([meta]);
  if (!s || s.key !== state.surveyKey) return;
  const rows = s.rows.filter((r) => r.banner === state.banner);
  const total = s.rows.find((r) => r.banner === '전체');
  $('#rows').innerHTML = rowHTML(total, true) + rows.map((r) => rowHTML(r)).join('');
  // 지역별이면 위에 타일 지도
  const mapEl = $('#regionmap');
  mapEl.hidden = state.banner !== '지역별';
  if (state.banner === '지역별') regionMap(mapEl, rows);
  const detailKeys = Object.keys(rows.find((r) => r.detail)?.detail || {});
  const hasW = rows.some((r) => r.nWeighted != null);
  $('#snap-table').innerHTML = `<table><thead><tr><th>${esc(state.banner)}</th><th>사례수</th>${hasW ? '<th>가중 사례수</th>' : ''}<th>잘하고 있다</th><th>잘못하고 있다</th><th>의견유보</th>${detailKeys.map((k) => `<th>${esc(k)}</th>`).join('')}<th>표본오차</th></tr></thead><tbody>${
    [total, ...rows].map((r) => `<tr><td>${esc(r.banner === '전체' ? '전체' : r.group)}</td><td>${fmtN(r.n)}</td>${hasW ? `<td>${fmtN(r.nWeighted)}</td>` : ''}<td>${r.pos ?? '–'}${r.pos != null ? '%' : ''}</td><td>${r.neg ?? '–'}${r.neg != null ? '%' : ''}</td><td>${r.rest ?? '–'}${r.rest != null ? '%' : ''}</td>${detailKeys.map((k) => `<td>${r.detail?.[k] != null ? r.detail[k] + '%' : '–'}</td>`).join('')}<td>±${moe(r.n)?.toFixed(1) ?? '–'}%p</td></tr>`).join('')
  }</tbody></table>`;
}

// ---------- 배너별 추이 (위 기간 선택을 따름) ----------
function trendGroups(list) {
  const out = [];
  for (const s of list) for (const r of s.rows) if (r.banner === state.banner && !out.includes(r.group)) out.push(r.group);
  return out;
}
function ensureSelection(groups, list) {
  for (const g of [...state.slots.keys()]) if (!groups.includes(g)) state.slots.delete(g);
  if (state.slots.size === 0) {
    const count = (g) => list.filter((s) => s.rows.some((r) => r.banner === state.banner && r.group === g && r.pos != null)).length;
    const best = Math.max(0, ...groups.map(count));
    const pick = groups.filter((g) => count(g) >= Math.max(1, best * 0.6)).slice(0, 4);
    (pick.length ? pick : groups.slice(0, 4)).forEach((g, i) => state.slots.set(g, i));
  }
}
function freeSlot() {
  const used = new Set(state.slots.values());
  for (let i = 0; i < MAX_SERIES; i++) if (!used.has(i)) return i;
  return -1;
}
function renderLegend(groups) {
  const full = state.slots.size >= MAX_SERIES;
  $('#legend').innerHTML = groups.map((g, i) => {
    const on = state.slots.has(g);
    const color = on ? css(SLOTS[state.slots.get(g)]) : 'var(--line)';
    return `<button type="button" id="lg-${i}" data-group="${esc(g)}" aria-pressed="${on}"${!on && full ? ' disabled title="최대 6개까지 비교할 수 있어요"' : ''}><i style="background:${color}"></i>${esc(g)}</button>`;
  }).join('');
}
function trendSeries(list) {
  const tot = (s) => s.rows.find((r) => r.banner === '전체');
  const one = new Set(list.map((s) => s.president)).size === 1;
  const lab = (s) => `${s.label}${one ? '' : ` · ${s.president}`}`;
  const total = { id: '전체', name: '전체', color: 'var(--muted)', points: withBreaks(list, (s) => ({ x: dateOf(s), y: metricVal(tot(s)), label: lab(s), n: tot(s)?.n })) };
  const groups = [...state.slots.entries()].sort((a, b) => a[1] - b[1]).map(([g, slot]) => ({
    id: g, name: g, color: css(SLOTS[slot]),
    points: withBreaks(list, (s) => {
      const r = s.rows.find((x) => x.banner === state.banner && x.group === g);
      return { x: dateOf(s), y: metricVal(r), label: lab(s), n: r?.n, hollow: r?.n != null && r.n < SMALL_N };
    }),
  }));
  return [total, ...groups];
}

let trendToken = 0;
async function renderTrend() {
  const token = ++trendToken;
  const metaList = surveysOf(state.type).filter(inRange).sort(byDate);
  $('#trend-title').textContent = `${state.banner} ${metricName()} 추이`;
  $('#trend-sub').textContent = `${state.type === 'weekly' ? '매주 조사' : '월간 통합'} · 위에서 고른 기간 · ${state.metric === 'net' ? '%p' : '%'}`;
  if (metaList.length < 2) {
    const other = state.type === 'weekly' ? 'monthly' : 'weekly';
    const otherN = surveysOf(other).filter(inRange).length;
    $('#legend').innerHTML = '';
    $('#chart').innerHTML = `<div class="empty">이 기간의 ${state.type === 'weekly' ? '주간' : '월간 통합'} 자료가 ${metaList.length}건뿐이라 추이를 그릴 수 없어요.${otherN >= 2 ? ` <button type="button" class="btn primary" id="switch-type" data-switch="${other}">${other === 'monthly' ? '월간 통합' : '주간'}으로 보기 (${otherN}건)</button>` : ' 위에서 기간을 넓혀 보세요.'}</div>`;
    state.charts.trend = null; state.trendData = null;
    $('#trend-hint').textContent = '';
    return;
  }
  if (metaList.some((s) => !state.detail.has(s.key))) $('#chart').innerHTML = '<div class="empty">자료를 불러오는 중…</div>';
  const list = (await details(metaList)).filter((s) => s.rows.some((r) => r.banner === state.banner));
  if (token !== trendToken) return;
  const groups = trendGroups(list);
  ensureSelection(groups, list);
  renderLegend(groups);
  if (list.length < 2) {
    $('#chart').innerHTML = `<div class="empty">이 기간에는 '${esc(state.banner)}' 배너가 실린 조사가 ${list.length}건뿐이에요.</div>`;
    state.charts.trend = null; state.trendData = null;
    return;
  }
  const series = trendSeries(list);
  const sel = list.find((s) => s.key === state.surveyKey);
  state.charts.trend = lineChart($('#chart'), {
    series, unit: state.metric === 'net' ? '%p' : '%',
    selectedX: sel ? dateOf(sel) : null,
    selectedLabel: sel ? shortLabel(sel) : null,
    onSelect: (x) => { const s = list.find((q) => +dateOf(q) === +x); if (s) selectSurvey(s.key); },
    yMin: state.metric === 'net' ? undefined : 0, bands: presidentBands(list),
    xMin: axisRange()[0], xMax: axisRange()[1],
    ariaLabel: `${state.banner} ${metricName()} 추이`,
  });
  state.trendData = { list, series, title: $('#trend-title').textContent };
  $('#trend-hint').textContent = `회색 선은 전체 응답자입니다. 빈 원은 사례수 ${SMALL_N}명 미만입니다. 그룹 이름을 눌러 최대 ${MAX_SERIES}개까지 비교할 수 있어요.`;
}

// ---------- 내보내기 ----------
function exportCSV(which) {
  const d = which === 'main' ? state.mainData : state.trendData;
  if (!d) return;
  const header = ['조사', '대통령', ...d.series.map((s) => s.name), '사례수'];
  const rows = d.list.map((s) => {
    const vals = d.series.map((sr) => sr.points.find((p) => p.y != null && +p.x === +dateOf(s))?.y ?? '');
    return [s.label, s.president, ...vals, s.n ?? s.rows?.find((r) => r.banner === '전체')?.n];
  });
  downloadCSV(`${d.title}.csv`, header, rows);
}
function exportPNG(which) {
  const c = state.charts[which];
  const d = which === 'main' ? state.mainData : state.trendData;
  if (!c || !d) return;
  const sub = `${d.list[0].label} ~ ${d.list[d.list.length - 1].label}` + (which === 'main' ? ' · 잘하고 있다 / 잘못하고 있다 (%)' : ` · ${$('#trend-sub').textContent}`);
  const cs = getComputedStyle(document.documentElement);
  const color = (v) => (v.startsWith('var(') ? cs.getPropertyValue(v.slice(4, -1)).trim() : v);
  downloadPNG(`${d.title}.png`, c.svg, {
    title: d.title, subtitle: sub,
    legend: d.series.map((s) => ({ name: s.name, color: color(s.color) })),
    footer: `자료: 한국갤럽 데일리 오피니언 · ${location.host || ''}`,
  });
}

// ---------- 이벤트 ----------
function renderBannerSection() {
  document.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
  renderBanners();
  renderSnapshot();
  renderTrend();
}
function setRange(preset) {
  state.range.preset = preset;
  if (preset !== 'custom') { state.range.from = null; state.range.to = null; }
  store.set('range', preset);
  renderRange(); ensureSurvey(); renderMain(); renderBanners(); renderSnapshot(); renderTrend();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a[data-export]');
  if (!t) return;
  if (t.dataset.export) { e.preventDefault(); const [kind, which] = t.dataset.export.split(':'); kind === 'csv' ? exportCSV(which) : exportPNG(which); return; }
  if (t.dataset.range === 'custom') { state.customOpen = true; renderRange(); $('#range-from').focus(); }
  else if (t.dataset.range) { state.customOpen = false; setRange(t.dataset.range); }
  else if (t.dataset.type || t.dataset.switch) {
    state.type = t.dataset.type || t.dataset.switch; store.set('type', state.type);
    document.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
    state.slots.clear(); renderTrend();
  }
  else if (t.id === 'prev-week') stepSurvey(-1);
  else if (t.id === 'next-week') stepSurvey(1);
  else if (t.dataset.banner) { state.banner = t.dataset.banner; store.set('banner', state.banner); state.slots.clear(); renderBanners(); renderSnapshot(); renderTrend(); }
  else if (t.dataset.metric) {
    state.metric = t.dataset.metric;
    document.querySelectorAll('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    renderTrend();
  } else if (t.dataset.group != null && t.closest('#legend')) {
    const g = t.dataset.group;
    if (state.slots.has(g)) { if (state.slots.size > 1) state.slots.delete(g); } else { const f = freeSlot(); if (f >= 0) state.slots.set(g, f); }
    renderTrend();
  }
});
for (const id of ['#range-from', '#range-to']) {
  $(id).addEventListener('input', () => setPending(true));
  $(id).addEventListener('change', () => setPending(true));
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCustomRange(); } });
}
$('#range-apply').addEventListener('click', applyCustomRange);
$('#legend').addEventListener('pointerover', (e) => {
  const b = e.target.closest('[data-group]');
  if (!b || !state.charts.trend || !state.trendData || !state.slots.has(b.dataset.group)) return;
  state.charts.trend.highlight(state.trendData.series.findIndex((s) => s.id === b.dataset.group));
});
$('#legend').addEventListener('pointerleave', () => state.charts.trend?.highlight(null));

const widths = new Map();
let rz;
const ro = new ResizeObserver((ents) => {
  let changed = false;
  for (const en of ents) {
    const w = Math.round(en.contentRect.width);
    if (Math.abs(w - (widths.get(en.target) ?? 0)) >= 2) { widths.set(en.target, w); changed = true; }
  }
  if (!changed || !state.index) return;
  clearTimeout(rz); rz = setTimeout(() => { renderMain(); renderTrend(); }, 120);
});

// ---------- 시작 ----------
async function start() {
  try {
    const res = await fetch('data/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    state.index = await res.json();
  } catch (err) {
    $('#headline').innerHTML = `<div class="empty">data/index.json 을 불러오지 못했어요 (${esc(err.message)}). 이 페이지는 웹 서버에서 열어야 합니다. 폴더에서 <code>npx serve</code> 를 실행한 뒤 주소로 접속해 보세요.</div>`;
    return;
  }
  $('#updated').textContent = `${state.index.updated} 갱신`;
  if (!surveysOf(state.type).length) state.type = all()[0]?.type || 'weekly';
  renderHeadline();
  renderRange();
  ensureSurvey();
  renderMain();
  renderBannerSection();
  for (const id of ['#main-chart', '#chart']) { widths.set($(id), Math.round($(id).clientWidth)); ro.observe($(id)); }
}
start();
