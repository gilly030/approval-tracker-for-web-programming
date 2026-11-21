// 공개 페이지. data/index.json(요약)을 먼저 읽고, 배너 상세는 data/years/YYYY.json 을 필요할 때 읽는다.
import { lineChart, downloadCSV, downloadPNG } from './linechart.js';
import { regionMap } from './tilemap.js';
import { PRESIDENTS } from './parser.js';
import { t, term, surveyLabel, shortSurveyLabel, ymLabel, fmtNum, applyStatic } from './i18n.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtN = (n) => (n == null ? '–' : fmtNum(n));
const moe = (n) => (n ? 1.96 * Math.sqrt(0.25 / n) * 100 : null);
// 전체 표본오차: 갤럽 리포트 표지에 적힌 값을 쓰고, 없으면 같은 방식(95% 신뢰수준, 응답비율 50% 가정)으로 계산
const surveyMoe = (s) => s?.moe ?? moe(s?.n);
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
      if (!r.ok) throw new Error(t('yearFail', y, r.status));
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
  $('#range-info').textContent = on ? t('pending') : '';
}
function applyCustomRange() {
  let from = $('#range-from').value, to = $('#range-to').value;
  if (!from || !to) { $('#range-info').textContent = t('pickBoth'); return; }
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
  const collecting = bf && !bf.done ? t('collecting') : '';
  if (!list.length) { el.hidden = false; el.textContent = t('noDataYet') + collecting; return; }
  const firstD = dateOf(list[0]);
  if ((firstD - a) / 864e5 > GAP_DAYS) {
    el.hidden = false;
    el.textContent = t('noDataFromTo', ymLabel(ym(a)), ymLabel(ym(firstD))) + collecting;
    return;
  }
  // 수집 중에는 중간에 1년 넘게 빈 구간이 생길 수 있다
  const hole = list.findIndex((s, i) => i && (dateOf(s) - dateOf(list[i - 1])) / 864e5 > 365);
  if (hole > 0 && collecting) {
    el.hidden = false;
    el.textContent = t('noDataBetween', ymLabel(ym(dateOf(list[hole - 1]))), ymLabel(ym(dateOf(list[hole])))) + collecting;
  } else el.hidden = true;
}

// ---------- 최신 수치 ----------
function renderHeadline() {
  const s = latest();
  // 막대 칸: 이름은 막대 위, 수치는 막대 안
  const parts = [
    { name: t('pos'), v: s.pos, cls: 'p' },
    { name: t('rest'), v: s.rest, cls: 'm' },
    { name: t('neg'), v: s.neg, cls: 'n' },
  ];
  $('#headline').innerHTML = `
    <div class="hl-top">
      <div class="hl-title">
        <h2 class="kicker">${esc(t('approvalOf', term(s.president || '')))}</h2>
        <div class="when">${esc(surveyLabel(s))}</div>
      </div>
      <div class="big num">${s.pos}<span class="unit">%</span></div>
    </div>
    <div class="split">
      <div class="split-labels" aria-hidden="true">${parts.map((q) => `<span class="${q.cls}" style="flex-basis:${q.v}%">${q.name}</span>`).join('')}</div>
      <div class="split-bar" role="img" aria-label="${parts.map((q) => `${q.name} ${q.v}%`).join(', ')}">${parts.map((q) => `<span class="${q.cls}" style="flex-basis:${q.v}%">${q.v}%</span>`).join('')}</div>
      <div class="meta">${t('headMeta', fmtN(s.n), surveyMoe(s).toFixed(1), s.issue ?? '?')}</div>
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
// 대통령 임기 구간: 조사가 없던 기간(탄핵·궐위 등)까지 실제 임기 날짜로 칠한다
function presidentBands(list) {
  const names = [...new Set(list.map((s) => s.president).filter(Boolean))];
  if (names.length < 2) return [];
  return names.map((name) => {
    const i = PRESIDENTS.findIndex(([n]) => n === name);
    if (i < 0) return null;
    const x0 = new Date(PRESIDENTS[i][1]);
    const x1 = PRESIDENTS[i + 1] ? new Date(PRESIDENTS[i + 1][1]) : new Date(8640000000000000);
    return { label: term(name), x0, x1 };
  }).filter(Boolean);
}

// ---------- 메인 그래프 ----------
function renderMain() {
  const list = weekly().filter(inRange);
  const pres = [...new Set(list.map((s) => s.president))];
  const one = pres.length === 1;
  $('#main-title').textContent = t('mainTitle', one ? term(pres[0]) : null);
  $('#main-q').textContent = t('question', one ? term(pres[0]) : null);
  const [a, b] = rangeDates();
  $('#main-info').textContent = list.length ? t('mainInfo', surveyLabel(list[0]), surveyLabel(list[list.length - 1]), list.length) : `${ymLabel(ym(a))} ~ ${ymLabel(ym(b))}`;
  renderGap(list);
  if (list.length < 2) {
    $('#main-legend').innerHTML = '';
    $('#main-chart').innerHTML = `<div class="empty">${esc(t('tooFew', list.length))}</div>`;
    state.charts.main = null; state.mainData = null;
    $('#main-table').innerHTML = '';
    return;
  }
  const pt = (key) => (s) => ({ x: dateOf(s), y: s[key], label: `${surveyLabel(s)}${one ? '' : ` · ${term(s.president)}`}`, n: s.n });
  const series = [
    { id: 'pos', name: t('pos'), color: css('--pos'), points: withBreaks(list, pt('pos')) },
    { id: 'neg', name: t('neg'), color: css('--neg'), points: withBreaks(list, pt('neg')) },
  ];
  const sel = list.find((s) => s.key === state.surveyKey);
  state.charts.main = lineChart($('#main-chart'), {
    series, legendEl: $('#main-legend'), unit: '%', yMin: 0, bands: presidentBands(list),
    xMin: axisRange()[0], xMax: axisRange()[1],
    selectedX: sel ? dateOf(sel) : null,
    selectedLabel: sel ? shortLabel(sel) : null,
    onSelect: (x) => { const s = list.find((q) => +dateOf(q) === +x); if (s) selectSurvey(s.key, true); },
    ariaLabel: t('chartAria', surveyLabel(list[0]), surveyLabel(list[list.length - 1])),
  });
  state.mainData = { list, series, title: $('#main-title').textContent };
  renderMainTable(list);
}

function renderMainTable(list) {
  const rows = [...list].reverse();
  $('#main-table-count').textContent = t('times', rows.length);
  $('#main-table').innerHTML = `<table><thead><tr><th>${t('thSurvey')}</th><th>${t('thPresident')}</th><th>${t('pos')}</th><th>${t('neg')}</th><th>${t('rest')}</th><th>${t('thChange')}</th><th>${t('thN')}</th><th>${t('thMoe')}</th><th>${t('thSource')}</th></tr></thead><tbody>${
    rows.map((s, i) => {
      const p = rows[i + 1];
      const d = p && p.president === s.president ? s.pos - p.pos : null;
      return `<tr><td>${esc(surveyLabel(s))}</td><td>${esc(term(s.president ?? ''))}</td><td>${s.pos}%</td><td>${s.neg}%</td><td>${s.rest}%</td><td>${d == null ? '–' : (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d)}</td><td>${fmtN(s.n)}</td><td>±${surveyMoe(s)?.toFixed(1) ?? '–'}%p</td><td>${s.issue ? t('issue', s.issue) : '–'}</td></tr>`;
    }).join('')
  }</tbody></table>`;
}


// ---------- 선택한 조사 ----------
const surveysOf = (type) => all().filter((s) => s.type === type);
const currentMeta = () => all().find((s) => s.key === state.surveyKey);
const shortLabel = shortSurveyLabel;

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
  if (fromChart) goSlide(2); // 그래프에서 고른 주의 특성별 결과로 넘어간다
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
  $('#banners').innerHTML = list.map((b, i) => `<button type="button" id="banner-${i}" data-banner="${esc(b)}" aria-pressed="${b === state.banner}">${esc(term(b))}</button>`).join('');
}

// ---------- 특성별 막대 ----------
function rowHTML(r, isTotal = false, totalMoe = null) {
  const small = r.n != null && r.n < SMALL_N;
  const m = isTotal ? totalMoe : null; // 표본오차는 전체에만 표시
  const rawG = r.raw?.split('|')[1];
  const name = isTotal ? t('total') : term(r.group);
  const raw = rawG && rawG !== r.group && term(rawG) !== name ? `<span class="raw">${esc(term(rawG))}</span>` : '';
  const label = `<div class="g">${esc(name).replace(/\//g, '/<wbr>')}${small ? `<span class="pill">${t('smallN')}</span>` : ''}${raw}</div>`;
  const nn = `<div class="nn">${t('people', `<span class="num">${fmtN(r.n)}</span>`)}${m ? `<br>±<span class="num">${m.toFixed(1)}</span>%p` : ''}</div>`;
  if (r.pos == null) return `<div class="row">${label}<div class="na">${t('hidden')}</div>${nn}</div>`;
  const lbl = (v) => (v >= 9 ? `${v}%` : '');
  const desc = `${t('pos')} ${r.pos}% · ${t('rest')} ${r.rest}% · ${t('neg')} ${r.neg}%`;
  return `<div class="row${isTotal ? ' total' : ''}" title="${esc(desc)}">
    ${label}
    <div class="bar${small ? ' small' : ''}" role="img" aria-label="${esc(name)}: ${esc(desc)}">
      <span class="p" style="flex:0 0 calc(${r.pos}% - 2px)">${lbl(r.pos)}</span>
      <span class="m" style="flex:0 0 calc(${r.rest}% - 2px)">${lbl(r.rest)}</span>
      <span class="n" style="flex:1 1 auto">${lbl(r.neg)}</span>
    </div>
    ${nn}</div>`;
}
async function renderSnapshot() {
  const meta = currentMeta();
  $('#snap-when').textContent = t('snapWhen', surveyLabel(meta), meta.president ? term(meta.president) : null);
  $('#snap-title').textContent = t('snapTitle', term(state.banner));
  renderStepper();
  const [s] = await details([meta]);
  if (!s || s.key !== state.surveyKey) return;
  const rows = s.rows.filter((r) => r.banner === state.banner);
  const total = s.rows.find((r) => r.banner === '전체');
  $('#rows').innerHTML = rowHTML(total, true, surveyMoe({ ...total, moe: s.moe })) + rows.map((r) => rowHTML(r)).join('');
  // 지역별이면 위에 타일 지도
  const mapEl = $('#regionmap');
  mapEl.hidden = state.banner !== '지역별';
  if (state.banner === '지역별') regionMap(mapEl, rows);
  const detailKeys = Object.keys(rows.find((r) => r.detail)?.detail || {});
  const hasW = rows.some((r) => r.nWeighted != null);
  $('#snap-table').innerHTML = `<table><thead><tr><th>${esc(term(state.banner))}</th><th>${t('thN')}</th>${hasW ? `<th>${t('thNW')}</th>` : ''}<th>${t('pos')}</th><th>${t('neg')}</th><th>${t('rest')}</th>${detailKeys.map((k) => `<th>${esc(term(k))}</th>`).join('')}</tr></thead><tbody>${
    [total, ...rows].map((r) => `<tr><td>${esc(r.banner === '전체' ? t('total') : term(r.group))}</td><td>${fmtN(r.n)}</td>${hasW ? `<td>${fmtN(r.nWeighted)}</td>` : ''}<td>${r.pos ?? '–'}${r.pos != null ? '%' : ''}</td><td>${r.neg ?? '–'}${r.neg != null ? '%' : ''}</td><td>${r.rest ?? '–'}${r.rest != null ? '%' : ''}</td>${detailKeys.map((k) => `<td>${r.detail?.[k] != null ? r.detail[k] + '%' : '–'}</td>`).join('')}</tr>`).join('')
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
  if (!$('#chart')) return; // 배너별 추이 그래프를 페이지에서 뺀 경우
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
  const header = [t('thSurvey'), t('thPresident'), ...d.series.map((s) => s.name), t('thN')];
  const rows = d.list.map((s) => {
    const vals = d.series.map((sr) => sr.points.find((p) => p.y != null && +p.x === +dateOf(s))?.y ?? '');
    return [surveyLabel(s), term(s.president), ...vals, s.n ?? s.rows?.find((r) => r.banner === '전체')?.n];
  });
  downloadCSV(`${d.title}.csv`, header, rows);
}
function exportPNG(which) {
  const c = state.charts[which];
  const d = which === 'main' ? state.mainData : state.trendData;
  if (!c || !d) return;
  const sub = `${surveyLabel(d.list[0])} ~ ${surveyLabel(d.list[d.list.length - 1])}` + (which === 'main' ? t('pngSub') : ` · ${$('#trend-sub').textContent}`);
  const cs = getComputedStyle(document.documentElement);
  const color = (v) => (v.startsWith('var(') ? cs.getPropertyValue(v.slice(4, -1)).trim() : v);
  downloadPNG(`${d.title}.png`, c.svg, {
    title: d.title, subtitle: sub,
    legend: d.series.map((s) => ({ name: s.name, color: color(s.color) })),
    footer: `${t('pngFooter')} · ${location.host || ''}`,
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
$('#legend')?.addEventListener('pointerover', (e) => {
  const b = e.target.closest('[data-group]');
  if (!b || !state.charts.trend || !state.trendData || !state.slots.has(b.dataset.group)) return;
  state.charts.trend.highlight(state.trendData.series.findIndex((s) => s.id === b.dataset.group));
});
$('#legend')?.addEventListener('pointerleave', () => state.charts.trend?.highlight(null));

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

// ---------- 넘겨 보기 (지지도 · 추이 · 특성별) ----------
const deck = { i: 0, timer: null };
const NEXT_LABEL = t('next');
const PREV_LABEL = t('prev');
const slides = () => [...document.querySelectorAll('#deck-track > .slide')];
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
// 트랙 높이를 지금 화면에 맞춘다 (화면마다 길이가 달라 아래 내용이 비어 보이지 않게)
function fitDeck() { const sl = slides()[deck.i]; if (sl) $('#deck-track').style.height = `${sl.offsetHeight}px`; }
function setSlide(i) {
  deck.i = i;
  const all = slides();
  all.forEach((sl, k) => { sl.inert = k !== i; });
  document.querySelectorAll('.deck-tabs [data-go]').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.go === i)));
  $('#deck-prev').disabled = i === 0;
  $('#deck-next').disabled = i === all.length - 1;
  $('#deck-next-label').textContent = NEXT_LABEL[i] || '';
  $('#deck-prev-label').textContent = PREV_LABEL[i] || '';
  // 아래 각주는 지금 화면에 해당하는 문단만
  document.querySelectorAll('.notes [data-slides]').forEach((p) => { p.hidden = !p.dataset.slides.split(' ').includes(String(i)); });
  fitDeck();
}
function goSlide(i) {
  const t = $('#deck-track');
  i = Math.max(0, Math.min(slides().length - 1, i));
  setSlide(i);
  t.scrollTo({ left: i * t.clientWidth, behavior: smooth() });
  const d = $('#deck');
  if (d.getBoundingClientRect().top < 0) d.scrollIntoView({ block: 'start', behavior: smooth() });
}
function initDeck() {
  const t = $('#deck-track');
  // 손가락으로 넘긴 경우: 스크롤이 멈춘 뒤 위치로 현재 화면을 정한다
  t.addEventListener('scroll', () => {
    clearTimeout(deck.timer);
    deck.timer = setTimeout(() => { const i = Math.round(t.scrollLeft / t.clientWidth); if (i !== deck.i) setSlide(i); }, 90);
  }, { passive: true });
  $('#deck-prev').addEventListener('click', () => goSlide(deck.i - 1));
  $('#deck-next').addEventListener('click', () => goSlide(deck.i + 1));
  document.querySelectorAll('.deck-tabs [data-go]').forEach((b) => b.addEventListener('click', () => goSlide(+b.dataset.go)));
  // 키보드: 입력 칸 밖에서 ←/→
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.target.closest('input, select, textarea, [contenteditable], .seg, .banners')) return;
    goSlide(deck.i + (e.key === 'ArrowRight' ? 1 : -1));
  });
  // 내용이 바뀌거나 창 폭이 바뀌면 높이·위치를 다시 맞춘다
  let lastW = t.clientWidth;
  const ro2 = new ResizeObserver(() => {
    fitDeck();
    if (t.clientWidth !== lastW) { lastW = t.clientWidth; t.scrollLeft = deck.i * t.clientWidth; }
  });
  slides().forEach((sl) => ro2.observe(sl));
  setSlide(0);
}

// ---------- 시작 ----------
async function start() {
  applyStatic();
  try {
    const res = await fetch('data/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    state.index = await res.json();
  } catch (err) {
    $('#headline').innerHTML = `<div class="empty">${t('loadFail', esc(err.message))}</div>`;
    return;
  }
  $('#updated').textContent = t('updated', state.index.updated);
  if (!surveysOf(state.type).length) state.type = all()[0]?.type || 'weekly';
  renderHeadline();
  renderRange();
  ensureSurvey();
  renderMain();
  renderBannerSection();
  initDeck();
  for (const id of ['#main-chart', '#chart']) { const el = $(id); if (!el) continue; widths.set(el, Math.round(el.clientWidth)); ro.observe(el); }
}
start();
