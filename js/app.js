// Public page. Loads data/index.json (summary of every survey) first, and
// data/years/YYYY.json (results by respondent group) only when a week is shown.
import { lineChart, downloadCSV, downloadPNG } from './linechart.js';
import { regionMap } from './tilemap.js';
import { PRESIDENTS } from './parser.js';
import { t, term, surveyLabel, shortSurveyLabel, ymLabel, monthName, yearName, fmtNum, applyStatic } from './i18n.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtN = (n) => (n == null ? '–' : fmtNum(n));
// Margin of error at 95% confidence, assuming a 50% response share
const moe = (n) => (n ? 1.96 * Math.sqrt(0.25 / n) * 100 : null);
// Prefer the value printed on the Gallup report cover; otherwise compute it
const surveyMoe = (s) => s?.moe ?? moe(s?.n);
const SMALL_N = 100;      // groups below this sample size are marked "small n"
const GAP_DAYS = 45;      // break the line when surveys stop for longer than this
const EARLIEST = '2012-01'; // Gallup Korea Daily Opinion starts in January 2012
const TOTAL = '전체';     // banner name of the all-respondents row in the data
const REGION = '지역별';  // banner that also gets the map

const store = {
  get(k) { try { return localStorage.getItem('jt:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('jt:' + k, v); } catch { /* storage unavailable */ } },
};

const state = {
  index: null,
  years: new Map(),  // year -> Promise<surveys>
  detail: new Map(), // survey key -> survey with group rows
  surveyKey: null,
  banner: store.get('banner') || REGION,
  range: { preset: store.get('range') || 'term', from: null, to: null },
  charts: {},
};

// ---------- dates ----------
// Survey start date, read from labels such as '2026년 11월 2주 (10~12일)' or '(1/16~20)'
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

const all = () => state.index.surveys;
const weekly = () => all().filter((s) => s.type === 'weekly' && s.pos != null).sort(byDate);
const latest = () => { const w = weekly(); return w[w.length - 1] || [...all()].sort(byDate).pop(); };
const currentMeta = () => all().find((s) => s.key === state.surveyKey);

// ---------- loading group results ----------
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

// ---------- period ----------
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
    default: { // 'term': the current president's term
      const p = latest().president;
      const mine = weekly().filter((s) => s.president === p);
      return [mine.length ? dateOf(mine[0]) : first, last];
    }
  }
}
const inRange = (s) => { const [a, b] = rangeDates(); const d = dateOf(s); return d >= a && d <= b; };

// Custom period: a year and a month dropdown for each end. Built here (not <input type="month">)
// so the labels follow the page language instead of the browser's.
function fillMonthPicker(id, value, max) {
  const [y0] = EARLIEST.split('-').map(Number);
  const [y1] = max.split('-').map(Number);
  const [vy, vm] = value.split('-').map(Number);
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(`<option value="${y}"${y === vy ? ' selected' : ''}>${yearName(y)}</option>`);
  $(`#${id}-y`).innerHTML = years.join('');
  $(`#${id}-m`).innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${i + 1 === vm ? ' selected' : ''}>${monthName(i + 1)}</option>`).join('');
}
function readMonthPicker(id, max) {
  const v = `${$(`#${id}-y`).value}-${String($(`#${id}-m`).value).padStart(2, '0')}`;
  return v > max ? max : v < EARLIEST ? EARLIEST : v;
}

function renderRange() {
  const { last } = bounds();
  // 'Custom' opens the from/to pickers; the chart changes only after Apply
  const custom = state.customOpen || state.range.preset === 'custom';
  const pressed = custom ? 'custom' : state.range.preset;
  document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === pressed)));
  $('#range-custom').hidden = !custom;
  const [a, b] = rangeDates();
  fillMonthPicker('range-from', state.range.from || ym(a), ym(last));
  fillMonthPicker('range-to', state.range.to || ym(b), ym(last));
  setPending(false);
}
// The pickers were changed but Apply has not been pressed yet
function setPending(on) {
  state.rangePending = on;
  $('#range-apply').classList.toggle('idle', !on);
  $('#range-info').classList.toggle('pending', on);
  $('#range-info').textContent = on ? t('pending') : '';
}
function applyCustomRange() {
  const max = ym(bounds().last);
  let from = readMonthPicker('range-from', max), to = readMonthPicker('range-to', max);
  if (from > to) [from, to] = [to, from];
  state.range = { preset: 'custom', from, to };
  renderRange(); ensureSurvey(); renderMain(); renderBanners(); renderSnapshot();
}
function setRange(preset) {
  state.range.preset = preset;
  if (preset !== 'custom') { state.range.from = null; state.range.to = null; }
  store.set('range', preset);
  renderRange(); ensureSurvey(); renderMain(); renderBanners(); renderSnapshot();
}

// Chart x-axis: the chosen period, but never past the latest survey
function axisRange() {
  const [a, b] = rangeDates();
  const last = bounds().last;
  return [a < monthStart(EARLIEST) ? monthStart(EARLIEST) : a, b > last ? last : b];
}
// Tell the reader when the start of the chosen period has no data
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
  // While old reports are still being collected there can be a gap of over a year
  const hole = list.findIndex((s, i) => i && (dateOf(s) - dateOf(list[i - 1])) / 864e5 > 365);
  if (hole > 0 && collecting) {
    el.hidden = false;
    el.textContent = t('noDataBetween', ymLabel(ym(dateOf(list[hole - 1]))), ymLabel(ym(dateOf(list[hole])))) + collecting;
  } else el.hidden = true;
}

// ---------- slide 1: latest approval ----------
function renderHeadline() {
  const s = latest();
  // Bar segments: name above the bar, value inside it
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

// ---------- slide 2: trend chart ----------
// Insert an empty point (which breaks the line) when surveys pause or the president changes
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
// Shaded presidential terms, using real term dates so periods without surveys
// (impeachment, vacancy) are still covered
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
    selectedLabel: sel ? shortSurveyLabel(sel) : null,
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

// ---------- selected survey week ----------
// With no selection, or a selection outside the period, use the latest week in the period
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
  if (fromChart) goSlide(2); // a click on the chart opens that week's group results
}
function stepSurvey(dir) {
  const w = weekly();
  const i = w.findIndex((s) => s.key === state.surveyKey);
  const next = w[i + dir];
  if (!next) return;
  // Stepping outside the period widens it to a custom period
  if (!inRange(next)) {
    const [a, b] = rangeDates();
    const d = dateOf(next);
    state.range = { preset: 'custom', from: ym(d < a ? d : a), to: ym(d > b ? d : b) };
    renderRange();
  }
  state.surveyKey = null; // force selectSurvey to redraw
  selectSurvey(next.key);
}
function renderStepper() {
  const w = weekly();
  const i = w.findIndex((s) => s.key === state.surveyKey);
  $('#prev-week').disabled = i <= 0;
  $('#next-week').disabled = i < 0 || i >= w.length - 1;
}

// ---------- slide 3: results by respondent group ----------
// Banners shown as buttons (one-off banners in some reports stay in the data only)
const STANDARD_BANNERS = ['지역별', '성별', '연령별', '지지정당별', '직업별', '생활수준별', '이념성향별', '정치관심도별'];
function renderBanners() {
  const list = STANDARD_BANNERS.filter((b) => currentMeta().banners.includes(b));
  if (!list.includes(state.banner)) state.banner = list[0];
  $('#banners').innerHTML = list.map((b, i) => `<button type="button" id="banner-${i}" data-banner="${esc(b)}" aria-pressed="${b === state.banner}">${esc(term(b))}</button>`).join('');
}

function rowHTML(r, isTotal = false, totalMoe = null) {
  const small = r.n != null && r.n < SMALL_N;
  const m = isTotal ? totalMoe : null; // margin of error is shown for the total row only
  const rawG = r.raw?.split('|')[1];   // original wording when the group name was normalized
  const name = isTotal ? t('total') : term(r.group);
  const raw = rawG && rawG !== r.group && term(rawG) !== name ? `<span class="raw">${esc(term(rawG))}</span>` : '';
  const label = `<div class="g">${esc(name).replace(/\//g, '/<wbr>')}${small ? `<span class="pill">${t('smallN')}</span>` : ''}${raw}</div>`;
  const nn = `<div class="nn">${t('people', `<span class="num">${fmtN(r.n)}</span>`)}${m ? `<br>±<span class="num">${m.toFixed(1)}</span>%p` : ''}</div>`;
  if (r.pos == null) return `<div class="row">${label}<div class="na">${t('hidden')}</div>${nn}</div>`;
  const lbl = (v) => (v >= 9 ? `${v}%` : ''); // too narrow for a label below 9%
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
  if (!s || s.key !== state.surveyKey) return; // a newer selection arrived while loading
  const rows = s.rows.filter((r) => r.banner === state.banner);
  const total = s.rows.find((r) => r.banner === TOTAL);
  $('#rows').innerHTML = rowHTML(total, true, surveyMoe({ ...total, moe: s.moe })) + rows.map((r) => rowHTML(r)).join('');
  const mapEl = $('#regionmap');
  mapEl.hidden = state.banner !== REGION;
  if (state.banner === REGION) regionMap(mapEl, rows);
  const detailKeys = Object.keys(rows.find((r) => r.detail)?.detail || {});
  const hasW = rows.some((r) => r.nWeighted != null);
  $('#snap-table').innerHTML = `<table><thead><tr><th>${esc(term(state.banner))}</th><th>${t('thN')}</th>${hasW ? `<th>${t('thNW')}</th>` : ''}<th>${t('pos')}</th><th>${t('neg')}</th><th>${t('rest')}</th>${detailKeys.map((k) => `<th>${esc(term(k))}</th>`).join('')}</tr></thead><tbody>${
    [total, ...rows].map((r) => `<tr><td>${esc(r.banner === TOTAL ? t('total') : term(r.group))}</td><td>${fmtN(r.n)}</td>${hasW ? `<td>${fmtN(r.nWeighted)}</td>` : ''}<td>${r.pos ?? '–'}${r.pos != null ? '%' : ''}</td><td>${r.neg ?? '–'}${r.neg != null ? '%' : ''}</td><td>${r.rest ?? '–'}${r.rest != null ? '%' : ''}</td>${detailKeys.map((k) => `<td>${r.detail?.[k] != null ? r.detail[k] + '%' : '–'}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

// ---------- export ----------
function exportCSV() {
  const d = state.mainData;
  if (!d) return;
  const header = [t('thSurvey'), t('thPresident'), ...d.series.map((s) => s.name), t('thN')];
  const rows = d.list.map((s) => {
    const vals = d.series.map((sr) => sr.points.find((p) => p.y != null && +p.x === +dateOf(s))?.y ?? '');
    return [surveyLabel(s), term(s.president), ...vals, s.n];
  });
  downloadCSV(`${d.title}.csv`, header, rows);
}
function exportPNG() {
  const c = state.charts.main, d = state.mainData;
  if (!c || !d) return;
  const sub = `${surveyLabel(d.list[0])} ~ ${surveyLabel(d.list[d.list.length - 1])}${t('pngSub')}`;
  const cs = getComputedStyle(document.documentElement);
  const color = (v) => (v.startsWith('var(') ? cs.getPropertyValue(v.slice(4, -1)).trim() : v);
  downloadPNG(`${d.title}.png`, c.svg, {
    title: d.title, subtitle: sub,
    legend: d.series.map((s) => ({ name: s.name, color: color(s.color) })),
    footer: `${t('pngFooter')} · ${location.host || ''}`,
  });
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, a[data-export]');
  if (!b) return;
  if (b.dataset.export) { e.preventDefault(); b.dataset.export.startsWith('csv') ? exportCSV() : exportPNG(); }
  else if (b.dataset.range === 'custom') { state.customOpen = true; renderRange(); $('#range-from-y').focus(); }
  else if (b.dataset.range) { state.customOpen = false; setRange(b.dataset.range); }
  else if (b.id === 'prev-week') stepSurvey(-1);
  else if (b.id === 'next-week') stepSurvey(1);
  else if (b.dataset.banner) { state.banner = b.dataset.banner; store.set('banner', state.banner); renderBanners(); renderSnapshot(); }
});
for (const id of ['#range-from-y', '#range-from-m', '#range-to-y', '#range-to-m']) {
  $(id).addEventListener('change', () => setPending(true));
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCustomRange(); } });
}
$('#range-apply').addEventListener('click', applyCustomRange);

// Redraw the chart when its width changes (it is drawn to fit its box)
let chartW = 0, rz;
const ro = new ResizeObserver(([en]) => {
  const w = Math.round(en.contentRect.width);
  if (Math.abs(w - chartW) < 2 || !state.index) return;
  chartW = w;
  clearTimeout(rz); rz = setTimeout(renderMain, 120);
});

// ---------- slides (approval · trend · by group) ----------
const deck = { i: 0, timer: null };
const NEXT_LABEL = t('next');
const PREV_LABEL = t('prev');
const slides = () => [...document.querySelectorAll('#deck-track > .slide')];
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
// Match the track height to the current slide so short slides leave no blank space
function fitDeck() { const sl = slides()[deck.i]; if (sl) $('#deck-track').style.height = `${sl.offsetHeight}px`; }
function setSlide(i) {
  deck.i = i;
  const list = slides();
  list.forEach((sl, k) => { sl.inert = k !== i; }); // keep Tab focus on the visible slide
  document.querySelectorAll('.deck-tabs [data-go]').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.go === i)));
  $('#deck-prev').disabled = i === 0;
  $('#deck-next').disabled = i === list.length - 1;
  $('#deck-next-label').textContent = NEXT_LABEL[i] || '';
  $('#deck-prev-label').textContent = PREV_LABEL[i] || '';
  // Footnotes: only the paragraphs that belong to this slide
  document.querySelectorAll('.notes [data-slides]').forEach((p) => { p.hidden = !p.dataset.slides.split(' ').includes(String(i)); });
  fitDeck();
}
function goSlide(i) {
  const track = $('#deck-track');
  i = Math.max(0, Math.min(slides().length - 1, i));
  setSlide(i);
  track.scrollTo({ left: i * track.clientWidth, behavior: smooth() });
  const d = $('#deck');
  if (d.getBoundingClientRect().top < 0) d.scrollIntoView({ block: 'start', behavior: smooth() });
}
function initDeck() {
  const track = $('#deck-track');
  // Swipes: once scrolling stops, the scroll position decides the slide
  track.addEventListener('scroll', () => {
    clearTimeout(deck.timer);
    deck.timer = setTimeout(() => { const i = Math.round(track.scrollLeft / track.clientWidth); if (i !== deck.i) setSlide(i); }, 90);
  }, { passive: true });
  $('#deck-prev').addEventListener('click', () => goSlide(deck.i - 1));
  $('#deck-next').addEventListener('click', () => goSlide(deck.i + 1));
  document.querySelectorAll('.deck-tabs [data-go]').forEach((b) => b.addEventListener('click', () => goSlide(+b.dataset.go)));
  // Keyboard: ← / → outside form controls
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.target.closest('input, select, textarea, [contenteditable], .seg, .banners')) return;
    goSlide(deck.i + (e.key === 'ArrowRight' ? 1 : -1));
  });
  // Keep height and position right when content or window width changes
  let lastW = track.clientWidth;
  const resize = new ResizeObserver(() => {
    fitDeck();
    if (track.clientWidth !== lastW) { lastW = track.clientWidth; track.scrollLeft = deck.i * track.clientWidth; }
  });
  slides().forEach((sl) => resize.observe(sl));
  setSlide(0);
}

// ---------- start ----------
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
  renderHeadline();
  renderRange();
  ensureSurvey();
  renderMain();
  renderBanners();
  renderSnapshot();
  initDeck();
  chartW = Math.round($('#main-chart').clientWidth);
  ro.observe($('#main-chart'));
}
start();
