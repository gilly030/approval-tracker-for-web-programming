// 공개 페이지: data/data.json 을 읽어 그린다. 외부 라이브러리 없음.
import { lineChart, downloadCSV, downloadPNG } from './linechart.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtN = (n) => (n == null ? '–' : n.toLocaleString('ko-KR'));
const moe = (n) => (n ? 1.96 * Math.sqrt(0.25 / n) * 100 : null);
const SMALL_N = 100;
const MAX_SERIES = 6;
const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'];
const MIN_WEEKLY = 6; // 주간 자료가 이보다 적으면 메인 그래프는 월간 통합으로

const store = {
  get(k) { try { return localStorage.getItem('jt:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('jt:' + k, v); } catch { /* 저장 불가 환경 */ } },
};

const state = {
  db: null,
  type: store.get('type') || 'weekly',
  surveyKey: null,
  banner: store.get('banner') || '지역별',
  metric: 'pos',
  slots: new Map(),
  charts: {},
};

// ---------- 날짜 ----------
// 라벨의 조사일 "(3~5일)", "(9/30~10/2)" 을 읽어 실제 날짜로. 없으면 주차로 추정.
function dateOf(s) {
  if (s._d) return s._d;
  let d = null;
  const m1 = s.label.match(/\((\d{1,2})\/(\d{1,2})\s*~/);
  const m2 = s.label.match(/\((\d{1,2})\s*~\s*\d{1,2}일?\)/);
  if (s.type === 'weekly' && m1) d = new Date(s.year - (+m1[1] === 12 && s.month === 1 ? 1 : 0), +m1[1] - 1, +m1[2]);
  else if (s.type === 'weekly' && m2) d = new Date(s.year, s.month - 1, +m2[1]);
  else if (s.type === 'weekly') d = new Date(s.year, s.month - 1, Math.min(28, 1 + (s.week - 1) * 7 + 2));
  else d = new Date(s.year, s.month - 1, 15);
  return (s._d = d);
}
const byDate = (a, b) => dateOf(a) - dateOf(b);
const surveysOf = (type) => state.db.surveys.filter((s) => s.type === type);
const current = () => state.db.surveys.find((s) => s.key === state.surveyKey);
const totalOf = (s) => s.rows.find((r) => r.banner === '전체');
const metricVal = (r) => (r == null || r.pos == null ? null : state.metric === 'pos' ? r.pos : state.metric === 'neg' ? r.neg : r.pos - r.neg);
const metricName = () => ({ pos: '긍정률', neg: '부정률', net: '긍정−부정' }[state.metric]);
const css = (v) => `var(${v})`;
const shortPeriod = (s) => s.label.replace(/^\d{4}년 /, '');

function latestPresident() {
  const all = [...state.db.surveys].sort(byDate);
  return all[all.length - 1].president;
}

// ---------- 최신 수치 ----------
function renderHeadline() {
  const all = [...state.db.surveys].sort(byDate);
  const weekly = all.filter((s) => s.type === 'weekly');
  const latest = weekly[weekly.length - 1] || all[all.length - 1];
  const t = totalOf(latest);
  const prev = all.filter((s) => s.type === latest.type && s.president === latest.president && dateOf(s) < dateOf(latest)).pop();
  const pt = prev && totalOf(prev);
  const d = pt ? t.pos - pt.pos : null;
  const delta = d == null ? '' : `<span class="delta" title="직전 조사(${esc(prev.label)}) 대비">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}%p</span>`;
  $('#headline').innerHTML = `
    <div>
      <div class="kicker">${esc(latest.president || '')} 대통령 직무 긍정률 · ${esc(latest.label)}</div>
      <div class="big num">${t.pos}<span class="unit">%</span></div>
      <div class="sub">잘못하고 있다 <b class="num">${t.neg}%</b> · 의견유보 <span class="num">${t.rest}%</span>${delta}</div>
    </div>
    <div class="split">
      <div class="split-bar" role="img" aria-label="잘하고 있다 ${t.pos}%, 의견유보 ${t.rest}%, 잘못하고 있다 ${t.neg}%">
        <span style="flex-basis:${t.pos}%;background:var(--pos)"></span>
        <span style="flex-basis:${t.rest}%;background:var(--mid)"></span>
        <span style="flex-basis:${t.neg}%;background:var(--neg)"></span>
      </div>
      <div class="meta">전국 만 18세 이상 <span class="num">${fmtN(t.n)}</span>명 · 표본오차 ±<span class="num">${moe(t.n).toFixed(1)}</span>%p (95% 신뢰수준) · 데일리 오피니언 제${latest.issue ?? '?'}호</div>
    </div>`;
}

// ---------- 메인: 현 정부 추이 ----------
function mainSurveys() {
  const pres = latestPresident();
  const weekly = surveysOf('weekly').filter((s) => s.president === pres).sort(byDate);
  if (weekly.length >= MIN_WEEKLY) return { list: weekly, type: 'weekly', pres };
  return { list: surveysOf('monthly').filter((s) => s.president === pres).sort(byDate), type: 'monthly', pres, fallback: weekly.length };
}

function renderMain() {
  const { list, type, pres, fallback } = mainSurveys();
  $('#main-title').textContent = `${pres} 대통령 직무 수행 평가`;
  $('#main-q').textContent = `귀하는 요즘 ${pres} 대통령이 대통령으로서의 직무를 잘 수행하고 있다고 보십니까, 아니면 잘못 수행하고 있다고 보십니까?`;
  $('#main-measure').textContent = `% · ${type === 'weekly' ? '매주 조사' : '월간 통합'}`;
  const pt = (s, key) => { const t = totalOf(s); return { x: dateOf(s), y: t?.[key] ?? null, label: s.label, n: t?.n }; };
  const series = [
    { id: 'pos', name: '잘하고 있다', color: css('--pos'), points: list.map((s) => pt(s, 'pos')) },
    { id: 'neg', name: '잘못하고 있다', color: css('--neg'), points: list.map((s) => pt(s, 'neg')) },
  ];
  state.charts.main = lineChart($('#main-chart'), {
    series, legendEl: $('#main-legend'), unit: '%', yMin: 0, ariaLabel: `${pres} 대통령 직무 긍정률과 부정률 추이`,
  });
  state.mainData = { list, series, pres, type };
  const first = list[0], last = list[list.length - 1];
  $('#main-note').textContent =
    `${first.label}부터 ${last.label}까지 ${list.length}회 조사. 의견유보(어느 쪽도 아님·모름/응답거절)는 그리지 않았습니다.` +
    (type === 'monthly' ? ` 주간 자료가 ${fallback}회분뿐이라 월간 통합으로 표시합니다. 자동 수집으로 주간 자료가 쌓이면 매주 조사로 바뀝니다.` : '');
  renderMainTable(list);
}

function renderMainTable(list) {
  const rows = [...list].reverse();
  $('#main-table').innerHTML = `<table><thead><tr><th>조사</th><th>잘하고 있다</th><th>잘못하고 있다</th><th>의견유보</th><th>긍정률 변화</th><th>사례수</th><th>표본오차</th><th>출처</th></tr></thead><tbody>${
    rows.map((s, i) => {
      const t = totalOf(s), p = rows[i + 1] && totalOf(rows[i + 1]);
      const d = p ? t.pos - p.pos : null;
      return `<tr><td>${esc(s.label)}</td><td>${t.pos}%</td><td>${t.neg}%</td><td>${t.rest}%</td><td>${d == null ? '–' : (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d)}</td><td>${fmtN(t.n)}</td><td>±${moe(t.n).toFixed(1)}%p</td><td>${s.issue ? `제${s.issue}호` : '–'}</td></tr>`;
    }).join('')
  }</tbody></table>`;
}

// ---------- 조사 선택 ----------
function renderSurveySelect() {
  const list = surveysOf(state.type).sort((a, b) => byDate(b, a));
  if (!list.find((s) => s.key === state.surveyKey)) state.surveyKey = list[0]?.key;
  const byPres = [];
  for (const s of list) {
    let g = byPres.find((x) => x.p === s.president);
    if (!g) byPres.push((g = { p: s.president, items: [] }));
    g.items.push(s);
  }
  $('#survey').innerHTML = byPres.map((g) => `<optgroup label="${esc(g.p || '대통령 미상')}">${g.items.map((s) => `<option value="${s.key}"${s.key === state.surveyKey ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</optgroup>`).join('');
  document.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
}

// ---------- 배너 ----------
function renderBanners() {
  const list = [...new Set(current().rows.map((r) => r.banner))].filter((b) => b !== '전체');
  if (!list.includes(state.banner)) state.banner = list[0];
  $('#banners').innerHTML = list.map((b, i) => `<button type="button" id="banner-${i}" data-banner="${esc(b)}" aria-pressed="${b === state.banner}">${esc(b)}</button>`).join('');
}

// ---------- 특성별 막대 ----------
function rowHTML(r, isTotal = false) {
  const small = r.n != null && r.n < SMALL_N;
  const m = moe(r.n);
  const raw = r.raw ? `<span class="raw">${esc(r.raw.split('|')[1])}</span>` : '';
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
function renderSnapshot() {
  const s = current();
  const rows = s.rows.filter((r) => r.banner === state.banner);
  $('#snap-title').textContent = `${state.banner} 평가 · ${s.label}`;
  $('#rows').innerHTML = rowHTML(totalOf(s), true) + rows.map((r) => rowHTML(r)).join('');
  const detailKeys = Object.keys(rows.find((r) => r.detail)?.detail || {});
  const hasW = rows.some((r) => r.nWeighted != null);
  $('#snap-table').innerHTML = `<table><thead><tr><th>${esc(state.banner)}</th><th>사례수</th>${hasW ? '<th>가중 사례수</th>' : ''}<th>잘하고 있다</th><th>잘못하고 있다</th><th>의견유보</th>${detailKeys.map((k) => `<th>${esc(k)}</th>`).join('')}<th>표본오차</th></tr></thead><tbody>${
    [totalOf(s), ...rows].map((r) => `<tr><td>${esc(r.banner === '전체' ? '전체' : r.group)}</td><td>${fmtN(r.n)}</td>${hasW ? `<td>${fmtN(r.nWeighted)}</td>` : ''}<td>${r.pos ?? '–'}${r.pos != null ? '%' : ''}</td><td>${r.neg ?? '–'}${r.neg != null ? '%' : ''}</td><td>${r.rest ?? '–'}${r.rest != null ? '%' : ''}</td>${detailKeys.map((k) => `<td>${r.detail?.[k] != null ? r.detail[k] + '%' : '–'}</td>`).join('')}<td>±${moe(r.n)?.toFixed(1) ?? '–'}%p</td></tr>`).join('')
  }</tbody></table>`;
}

// ---------- 배너별 추이 ----------
function trendSurveys() {
  const s = current();
  return surveysOf(state.type).filter((x) => x.president === s.president).sort(byDate);
}
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
  const total = { id: '전체', name: '전체', color: 'var(--muted)', points: list.map((s) => { const r = totalOf(s); return { x: dateOf(s), y: metricVal(r), label: s.label, n: r?.n }; }) };
  const groups = [...state.slots.entries()].sort((a, b) => a[1] - b[1]).map(([g, slot]) => ({
    id: g, name: g, color: css(SLOTS[slot]),
    points: list.map((s) => {
      const r = s.rows.find((x) => x.banner === state.banner && x.group === g);
      return { x: dateOf(s), y: metricVal(r), label: s.label, n: r?.n, hollow: r?.n != null && r.n < SMALL_N };
    }),
  }));
  return [total, ...groups];
}

function renderTrend() {
  const list = trendSurveys();
  const groups = trendGroups(list);
  ensureSelection(groups, list);
  renderLegend(groups);
  const s = current();
  $('#trend-title').textContent = `${state.banner} ${metricName()} 추이`;
  $('#trend-sub').textContent = `${s.president ?? ''} 대통령 · ${state.type === 'weekly' ? '매주 조사' : '월간 통합'} · ${state.metric === 'net' ? '%p' : '%'}`;
  if (list.length < 3) {
    const other = state.type === 'weekly' ? 'monthly' : 'weekly';
    const otherN = surveysOf(other).filter((x) => x.president === s.president).length;
    $('#chart').innerHTML = `<div class="empty">이 대통령의 ${state.type === 'weekly' ? '주간' : '월간 통합'} 자료가 ${list.length}건뿐이라 추이를 그리기엔 부족해요.${otherN >= 3 ? ` <button type="button" class="btn primary" id="switch-type" data-switch="${other}">${other === 'monthly' ? '월간 통합' : '주간'} 추이 보기 (${otherN}건)</button>` : ''}</div>`;
    state.charts.trend = null;
    $('#trend-hint').textContent = '';
    return;
  }
  const series = trendSeries(list);
  state.charts.trend = lineChart($('#chart'), {
    series, unit: state.metric === 'net' ? '%p' : '%',
    yMin: state.metric === 'net' ? undefined : 0,
    ariaLabel: `${state.banner} ${metricName()} 추이`,
  });
  state.trendData = { list, series };
  $('#trend-hint').textContent = `회색 선은 전체 응답자입니다. 빈 원은 사례수 ${SMALL_N}명 미만입니다. 그룹 이름을 눌러 최대 ${MAX_SERIES}개까지 비교할 수 있어요.`;
}

// ---------- 내보내기 ----------
function exportCSV(which) {
  const d = which === 'main' ? state.mainData : state.trendData;
  if (!d) return;
  const header = ['조사', ...d.series.map((s) => s.name), '사례수'];
  const rows = d.list.map((s, i) => [s.label, ...d.series.map((sr) => sr.points[i].y), totalOf(s)?.n]);
  downloadCSV(which === 'main' ? `직무평가_${d.pres}.csv` : `직무평가_${state.banner}.csv`, header, rows);
}
function exportPNG(which) {
  const c = state.charts[which];
  const d = which === 'main' ? state.mainData : state.trendData;
  if (!c || !d) return;
  const title = which === 'main' ? $('#main-title').textContent : $('#trend-title').textContent;
  const sub = which === 'main' ? `잘하고 있다 / 잘못하고 있다 (%) · ${d.list[0].label} ~ ${d.list[d.list.length - 1].label}` : $('#trend-sub').textContent;
  const cs = getComputedStyle(document.documentElement);
  const color = (v) => (v.startsWith('var(') ? cs.getPropertyValue(v.slice(4, -1)).trim() : v);
  downloadPNG(`${title}.png`, c.svg, {
    title, subtitle: sub,
    legend: d.series.map((s) => ({ name: s.name, color: color(s.color) })),
    footer: `자료: 한국갤럽 데일리 오피니언 · ${location.host || ''}`,
  });
}

// ---------- 이벤트 ----------
function renderAll() {
  renderSurveySelect();
  renderBanners();
  renderSnapshot();
  renderTrend();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a[data-export]');
  if (!t) return;
  if (t.dataset.export) { e.preventDefault(); const [kind, which] = t.dataset.export.split(':'); kind === 'csv' ? exportCSV(which) : exportPNG(which); return; }
  if (t.dataset.type) { state.type = t.dataset.type; store.set('type', state.type); state.surveyKey = null; renderAll(); }
  else if (t.dataset.switch) { state.type = t.dataset.switch; store.set('type', state.type); state.surveyKey = null; renderAll(); }
  else if (t.dataset.banner) { state.banner = t.dataset.banner; store.set('banner', state.banner); state.slots.clear(); renderBanners(); renderSnapshot(); renderTrend(); }
  else if (t.dataset.metric) {
    state.metric = t.dataset.metric;
    document.querySelectorAll('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    renderTrend();
  } else if (t.dataset.group != null && t.closest('#legend')) {
    const g = t.dataset.group;
    if (state.slots.has(g)) { if (state.slots.size > 1) state.slots.delete(g); }
    else { const f = freeSlot(); if (f >= 0) state.slots.set(g, f); }
    renderTrend();
  }
});
// 배너 그룹 칩에 올리면 그 선을 강조
$('#legend').addEventListener('pointerover', (e) => {
  const b = e.target.closest('[data-group]');
  if (!b || !state.charts.trend || !state.slots.has(b.dataset.group)) return;
  const i = trendSeries(state.trendData.list).findIndex((s) => s.id === b.dataset.group);
  state.charts.trend.highlight(i);
});
$('#legend').addEventListener('pointerleave', () => state.charts.trend?.highlight(null));
$('#survey').addEventListener('change', (e) => { state.surveyKey = e.target.value; renderBanners(); renderSnapshot(); renderTrend(); });

const widths = new Map();
let rz;
const ro = new ResizeObserver((ents) => {
  let changed = false;
  for (const en of ents) {
    const w = Math.round(en.contentRect.width);
    if (Math.abs(w - (widths.get(en.target) ?? 0)) >= 2) { widths.set(en.target, w); changed = true; }
  }
  if (!changed || !state.db) return;
  clearTimeout(rz); rz = setTimeout(() => { renderMain(); renderTrend(); }, 120);
});

// ---------- 시작 ----------
async function start() {
  try {
    const res = await fetch('data/data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    state.db = await res.json();
  } catch (err) {
    $('#headline').innerHTML = `<div class="empty">data/data.json 을 불러오지 못했어요 (${esc(err.message)}). 이 페이지는 웹 서버에서 열어야 합니다. 폴더에서 <code>npx serve</code> 를 실행한 뒤 주소로 접속해 보세요.</div>`;
    return;
  }
  $('#updated').textContent = `${state.db.updated} 갱신`;
  if (!surveysOf(state.type).length) state.type = state.db.surveys[0]?.type || 'weekly';
  renderHeadline();
  renderMain();
  renderAll();
  widths.set($('#main-chart'), Math.round($('#main-chart').clientWidth));
  widths.set($('#chart'), Math.round($('#chart').clientWidth));
  ro.observe($('#main-chart'));
  ro.observe($('#chart'));
}
start();
