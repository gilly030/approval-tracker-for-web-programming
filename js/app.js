// 공개 페이지: data/data.json 을 읽어 배너별 막대와 추이선을 그린다. 외부 라이브러리 없음.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtN = (n) => (n == null ? '–' : n.toLocaleString('ko-KR'));
const moe = (n) => (n ? (1.96 * Math.sqrt(0.25 / n) * 100) : null);
const SMALL_N = 100;
const MAX_SERIES = 6;
const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'];

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
  slots: new Map(), // 그룹 → 색 슬롯 (선택돼 있는 동안 유지)
};

function dateOf(s) {
  return s.type === 'weekly'
    ? new Date(s.year, s.month - 1, Math.min(28, 1 + (s.week - 1) * 7 + 3))
    : new Date(s.year, s.month - 1, 15);
}
const shortLabel = (s) => (s.type === 'weekly' ? `${s.year}.${s.month} ${s.week}주` : `${s.year}.${s.month}`);
const surveysOf = (type) => state.db.surveys.filter((s) => s.type === type);
const current = () => state.db.surveys.find((s) => s.key === state.surveyKey);
const totalOf = (s) => s.rows.find((r) => r.banner === '전체');
const metricVal = (r) => (r == null || r.pos == null ? null : state.metric === 'pos' ? r.pos : state.metric === 'neg' ? r.neg : r.pos - r.neg);
const metricName = () => ({ pos: '긍정률', neg: '부정률', net: '긍정−부정' }[state.metric]);

// ---------- 최신 수치 ----------
function renderHeadline() {
  const all = [...state.db.surveys].sort((a, b) => dateOf(a) - dateOf(b));
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

// ---------- 조사 선택 ----------
function renderSurveySelect() {
  const list = surveysOf(state.type).sort((a, b) => dateOf(b) - dateOf(a));
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
function bannersIn(s) {
  return [...new Set(s.rows.map((r) => r.banner))].filter((b) => b !== '전체');
}
function renderBanners() {
  const s = current();
  const list = bannersIn(s);
  if (!list.includes(state.banner)) state.banner = list[0];
  $('#banners').innerHTML = list.map((b) => `<button type="button" id="banner-${list.indexOf(b)}" data-banner="${esc(b)}" aria-pressed="${b === state.banner}">${esc(b)}</button>`).join('');
}

// ---------- 특성별 막대 ----------
function rowHTML(r, isTotal = false) {
  const small = r.n != null && r.n < SMALL_N;
  const m = moe(r.n);
  const raw = r.raw ? `<span class="raw">${esc(r.raw.split('|')[1])}</span>` : '';
  const label = `<div class="g">${esc(isTotal ? '전체' : r.group)}${small ? '<span class="pill">표본 적음</span>' : ''}${raw}</div>`;
  const nn = `<div class="nn"><span class="num">${fmtN(r.n)}</span>명${m ? `<br>±<span class="num">${m.toFixed(1)}</span>%p` : ''}</div>`;
  if (r.pos == null) {
    return `<div class="row">${label}<div class="na">표본이 적어 수치 미공개</div>${nn}</div>`;
  }
  const lbl = (v, min) => (v >= min ? `${v}%` : '');
  return `<div class="row${isTotal ? ' total' : ''}" title="잘하고 있다 ${r.pos}% · 의견유보 ${r.rest}% · 잘못하고 있다 ${r.neg}%">
    ${label}
    <div class="bar${small ? ' small' : ''}" role="img" aria-label="${esc(r.group)}: 잘하고 있다 ${r.pos}%, 의견유보 ${r.rest}%, 잘못하고 있다 ${r.neg}%">
      <span class="p" style="flex:0 0 calc(${r.pos}% - 2px)">${lbl(r.pos, 9)}</span>
      <span class="m" style="flex:0 0 calc(${r.rest}% - 2px)">${lbl(r.rest, 9)}</span>
      <span class="n" style="flex:1 1 auto">${lbl(r.neg, 9)}</span>
    </div>
    ${nn}</div>`;
}
function renderSnapshot() {
  const s = current();
  const rows = s.rows.filter((r) => r.banner === state.banner);
  $('#snap-title').textContent = `${state.banner} 평가 · ${s.label}`;
  $('#rows').innerHTML = rowHTML(totalOf(s), true) + rows.map((r) => rowHTML(r)).join('');
  const detailKeys = Object.keys(rows.find((r) => r.detail)?.detail || {});
  $('#snap-table').innerHTML = `<table><thead><tr><th>${esc(state.banner)}</th><th>사례수</th>${rows.some((r) => r.nWeighted != null) ? '<th>가중 사례수</th>' : ''}<th>잘하고 있다</th><th>잘못하고 있다</th><th>의견유보</th>${detailKeys.map((k) => `<th>${esc(k)}</th>`).join('')}<th>표본오차</th></tr></thead><tbody>${
    [totalOf(s), ...rows].map((r) => `<tr><td>${esc(r.banner === '전체' ? '전체' : r.group)}</td><td>${fmtN(r.n)}</td>${rows.some((x) => x.nWeighted != null) ? `<td>${fmtN(r.nWeighted)}</td>` : ''}<td>${r.pos ?? '–'}${r.pos != null ? '%' : ''}</td><td>${r.neg ?? '–'}${r.neg != null ? '%' : ''}</td><td>${r.rest ?? '–'}${r.rest != null ? '%' : ''}</td>${detailKeys.map((k) => `<td>${r.detail?.[k] != null ? r.detail[k] + '%' : '–'}</td>`).join('')}<td>±${moe(r.n)?.toFixed(1) ?? '–'}%p</td></tr>`).join('')
  }</tbody></table>`;
}

// ---------- 추이 ----------
function trendSurveys() {
  const s = current();
  return surveysOf(state.type).filter((x) => x.president === s.president).sort((a, b) => dateOf(a) - dateOf(b));
}
function trendGroups(list) {
  const out = [];
  for (const s of list) for (const r of s.rows) if (r.banner === state.banner && !out.includes(r.group)) out.push(r.group);
  return out;
}
function ensureSelection(groups, list) {
  for (const g of [...state.slots.keys()]) if (!groups.includes(g)) state.slots.delete(g);
  if (state.slots.size === 0) {
    // 수치가 공개된 시점이 많은 그룹을 먼저 고른다 (원래 순서 유지)
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
    const color = on ? `var(${SLOTS[state.slots.get(g)]})` : 'var(--line)';
    return `<button type="button" id="lg-${i}" data-group="${esc(g)}" aria-pressed="${on}"${!on && full ? ' disabled title="최대 6개까지 비교할 수 있어요"' : ''}><i style="background:${color}"></i>${esc(g)}</button>`;
  }).join('');
}

function renderTrend() {
  const list = trendSurveys();
  const groups = trendGroups(list);
  ensureSelection(groups, list);
  renderLegend(groups);
  const s = current();
  $('#trend-title').textContent = `${state.banner} ${metricName()} 추이 · ${s.president ?? ''} 대통령 · ${state.type === 'weekly' ? '주간' : '월간 통합'}`;
  const hint = $('#trend-hint');
  hint.textContent = '';
  if (list.length < 3) {
    const other = state.type === 'weekly' ? 'monthly' : 'weekly';
    const otherN = surveysOf(other).filter((x) => x.president === s.president).length;
    $('#chart').innerHTML = `<div class="empty">이 대통령의 ${state.type === 'weekly' ? '주간' : '월간 통합'} 자료가 ${list.length}건뿐이라 추이를 그리기엔 부족해요.${otherN >= 3 ? ` <button type="button" class="btn primary" id="switch-type" data-switch="${other}">${other === 'monthly' ? '월간 통합' : '주간'} 추이 보기 (${otherN}건)</button>` : ''}</div>`;
    return;
  }
  drawChart(list);
  hint.textContent = `점이 빈 원이면 사례수 ${SMALL_N}명 미만입니다. 그래프 위에 마우스를 올리면 그 시점 수치와 사례수가 나옵니다.`;
}

function drawChart(list) {
  const el = $('#chart');
  const W = Math.max(320, el.clientWidth || 800);
  const H = W < 560 ? 280 : 340;
  const narrow = W < 560;
  const m = { t: 14, r: narrow ? 14 : 110, b: 30, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const series = [...state.slots.entries()].map(([g, slot]) => ({
    g, color: `var(${SLOTS[slot]})`,
    pts: list.map((s) => { const r = s.rows.find((x) => x.banner === state.banner && x.group === g); return { s, r, v: metricVal(r) }; }),
  }));
  const tot = list.map((s) => ({ s, r: totalOf(s), v: metricVal(totalOf(s)) }));
  const vals = [...series.flatMap((x) => x.pts.map((p) => p.v)), ...tot.map((p) => p.v)].filter((v) => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (state.metric === 'net') { lo = Math.floor((lo - 5) / 10) * 10; hi = Math.ceil((hi + 5) / 10) * 10; }
  else { lo = Math.max(0, Math.floor((lo - 5) / 10) * 10); hi = Math.min(100, Math.ceil((hi + 5) / 10) * 10); }
  if (hi - lo < 20) hi = lo + 20;
  const step = (hi - lo) > 60 ? 20 : 10;
  hi = lo + Math.ceil((hi - lo) / step) * step;
  const t0 = dateOf(list[0]).getTime(), t1 = dateOf(list[list.length - 1]).getTime();
  const x = (s) => m.l + (t1 === t0 ? iw / 2 : ((dateOf(s).getTime() - t0) / (t1 - t0)) * iw);
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(state.banner)} ${metricName()} 추이 선 그래프">`;
  for (let v = lo; v <= hi; v += step) {
    svg += `<line class="${v === 0 && state.metric === 'net' ? 'base' : 'grid'}" x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  svg += `<line class="base" x1="${m.l}" x2="${m.l + iw}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
  // x축 눈금: 겹치지 않게 솎아낸다
  const minGap = narrow ? 56 : 70;
  let lastX = -1e9;
  list.forEach((s, i) => {
    const xx = x(s);
    if (xx - lastX < minGap && i !== list.length - 1) return;
    if (i === list.length - 1 && xx - lastX < minGap) return;
    lastX = xx;
    svg += `<text x="${xx}" y="${H - 8}" text-anchor="middle">${esc(shortLabel(s))}</text>`;
  });
  const path = (pts) => {
    let d = '', pen = false;
    for (const p of pts) { if (p.v == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(p.s).toFixed(1)},${y(p.v).toFixed(1)}`; pen = true; }
    return d;
  };
  svg += `<path d="${path(tot)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  const lastTot = [...tot].reverse().find((p) => p.v != null);
  const ends = [];
  if (lastTot && !narrow) ends.push({ y: y(lastTot.v), text: `전체 ${lastTot.v}`, color: 'var(--muted)' });
  for (const sr of series) {
    svg += `<path d="${path(sr.pts)}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const p of sr.pts) {
      if (p.v == null) continue;
      const small = p.r?.n != null && p.r.n < SMALL_N;
      svg += `<circle cx="${x(p.s)}" cy="${y(p.v)}" r="4" fill="${small ? 'var(--surface)' : sr.color}" stroke="${small ? sr.color : 'var(--surface)'}" stroke-width="2"/>`;
    }
    const last = [...sr.pts].reverse().find((p) => p.v != null);
    if (last && !narrow) ends.push({ y: y(last.v), text: `${sr.g} ${last.v}`, color: sr.color });
  }
  // 끝 라벨 겹침 정리
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const e of ends) svg += `<circle cx="${m.l + iw + 10}" cy="${e.y - 4}" r="3.5" fill="${e.color}"/><text class="endlabel" x="${m.l + iw + 18}" y="${e.y}">${esc(e.text)}</text>`;
  svg += `<line id="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="var(--axis)" stroke-width="1" visibility="hidden"/>`;
  svg += `<rect id="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
  svg += `</svg><div class="tip" id="tip" hidden></div>`;
  el.innerHTML = svg;

  const svgEl = el.querySelector('svg'), tip = el.querySelector('#tip'), cross = el.querySelector('#cross');
  const onMove = (ev) => {
    const rect = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    let best = 0, bd = Infinity;
    list.forEach((s, i) => { const d = Math.abs(x(s) - px); if (d < bd) { bd = d; best = i; } });
    const s = list[best];
    cross.setAttribute('x1', x(s)); cross.setAttribute('x2', x(s)); cross.setAttribute('visibility', 'visible');
    const fmt = (r) => (r == null ? '자료 없음' : r.pos == null ? '미공개' : `${metricVal(r)}${state.metric === 'net' ? '' : '%'} <span style="color:var(--muted)">(${fmtN(r.n)}명)</span>`);
    tip.innerHTML = `<b>${esc(s.label)}</b>` +
      `<div class="tr"><span><i style="background:var(--muted)"></i>전체</span><span class="num">${fmt(totalOf(s))}</span></div>` +
      series.map((sr) => `<div class="tr"><span><i style="background:${sr.color}"></i>${esc(sr.g)}</span><span class="num">${fmt(sr.pts[best].r)}</span></div>`).join('');
    tip.hidden = false;
    const cx = (x(s) / W) * rect.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(0, cx + 12), rect.width - tw)}px`;
    tip.style.top = `${8}px`;
  };
  el.querySelector('#hit').addEventListener('pointermove', onMove);
  el.querySelector('#hit').addEventListener('pointerdown', onMove);
  el.querySelector('#hit').addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}

// ---------- 이벤트 ----------
function renderAll() {
  renderSurveySelect();
  renderBanners();
  renderSnapshot();
  renderTrend();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
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
$('#survey').addEventListener('change', (e) => { state.surveyKey = e.target.value; renderBanners(); renderSnapshot(); renderTrend(); });
let rz, lastW = 0;
new ResizeObserver((ents) => {
  const w = Math.round(ents[0].contentRect.width);
  if (Math.abs(w - lastW) < 2) return; // 높이 변화는 무시 (툴팁 유지)
  lastW = w; clearTimeout(rz); rz = setTimeout(() => state.db && renderTrend(), 120);
}).observe($('#chart'));

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
  renderAll();
}
start();
