// Gallup 리포트 스타일 선 그래프 (SVG, 라이브러리 없음)
//  - 위쪽 범례에 올리면 그 선만 진하게, 나머지는 흐리게
//  - 그래프에 올리면 가장 가까운 점에 '이름 / 시점 / 값' 주석
//  - 선 끝에 마지막 값
//  - 키보드: 그래프에 포커스 후 ←→ 시점 이동, ↑↓ 선 바꾸기

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {HTMLElement} el  그래프를 그릴 상자
 * @param {object} o
 *   series: [{ id, name, color, points: [{ x: Date, y: number|null, label: string, n?: number, hollow?: bool }] }]
 *   legendEl?: 범례를 그릴 상자 (없으면 범례 없음)
 *   unit: '%' | '%p'
 *   yMin?, yMax?: 고정 범위
 *   height?: 기본 높이
 *   ariaLabel
 */
export function lineChart(el, o) {
  const series = o.series.filter((s) => s.points.some((p) => p.y != null));
  const state = { hi: null, lock: null, focus: null };
  const W = Math.max(300, Math.round(el.clientWidth || 800));
  const narrow = W < 560;
  const H = o.height ?? (narrow ? 300 : 380);
  const m = { t: o.bands?.length || o.onSelect ? 30 : 18, r: narrow ? 34 : 46, b: 44, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  // ---- 눈금 ----
  const allY = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v != null);
  let lo = o.yMin ?? Math.min(0, Math.floor(Math.min(...allY) / 10) * 10);
  let hi = o.yMax ?? Math.ceil((Math.max(...allY) + 4) / 10) * 10;
  if (hi - lo < 20) hi = lo + 20;
  const step = hi - lo > 60 ? 20 : 10;
  hi = lo + Math.ceil((hi - lo) / step) * step;
  const xs = [...new Set(series.flatMap((s) => s.points.filter((p) => p.y != null).map((p) => +p.x)))].sort((a, b) => a - b);
  // 가로축 범위: 고른 기간(xMin~xMax)이 있으면 그대로, 없으면 자료 범위. 자료가 없는 구간은 비워 둔다.
  const t0 = o.xMin != null ? Math.min(+o.xMin, xs[0]) : xs[0];
  const t1 = o.xMax != null ? Math.max(+o.xMax, xs[xs.length - 1]) : xs[xs.length - 1];
  const pad = (t1 - t0) * (o.xMin != null ? 0.01 : 0.02) || 86400000 * 15;
  const X = (t) => m.l + ((+t - (t0 - pad)) / (t1 - t0 + 2 * pad)) * iw;
  const Y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="${esc(o.ariaLabel || '선 그래프')}">`;
  // 구간 띠 (예: 대통령 임기). 번갈아 음영, 폭이 넉넉하면 위에 이름
  (o.bands || []).forEach((b, i) => {
    const x0 = Math.max(m.l, X(b.x0)), x1 = Math.min(m.l + iw, X(b.x1));
    if (x1 - x0 < 1) return;
    if (i % 2 === (o.bands.length % 2 === 0 ? 1 : 0)) s += `<rect class="lc-band" x="${x0}" y="${m.t}" width="${x1 - x0}" height="${ih}"/>`;
    if (x1 - x0 > 46) s += `<text class="lc-bandlabel" x="${x0 + 6}" y="${m.t + 14}">${esc(b.label)}</text>`;
  });
  for (let v = lo; v <= hi; v += step) {
    s += `<line class="lc-grid${v === 0 ? ' lc-zero' : ''}" x1="${m.l}" x2="${m.l + iw}" y1="${Y(v)}" y2="${Y(v)}"/>`;
    s += `<text class="lc-tick" x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v}${v === hi ? esc(o.unit || '') : ''}</text>`;
  }
  // x축: 월 단위 눈금, 1월과 첫 눈금에는 연도
  const d0 = new Date(t0), d1 = new Date(t1);
  const months = (d1.getFullYear() - d0.getFullYear()) * 12 + d1.getMonth() - d0.getMonth() + 1;
  const every = [1, 2, 3, 4, 6, 12, 24, 36, 60].find((k) => months / k <= (narrow ? 5 : 9)) || 60;
  const ticks = [];
  for (let i = 0; i <= months + 1; i++) {
    const d = new Date(d0.getFullYear(), d0.getMonth() + i, 1);
    if (+d < t0 - pad || +d > t1 + pad) continue;
    if (every >= 12 ? d.getMonth() !== 0 || d.getFullYear() % (every / 12) !== 0 : d.getMonth() % every !== 0) continue;
    ticks.push(d);
  }
  if (!ticks.length) ticks.push(new Date(t0));
  ticks.forEach((d, i) => {
    const x = X(d);
    s += `<line class="lc-tickline" x1="${x}" x2="${x}" y1="${m.t + ih}" y2="${m.t + ih + 5}"/>`;
    if (every >= 12) {
      s += `<text class="lc-tick" x="${x}" y="${m.t + ih + 19}" text-anchor="middle">${d.getFullYear()}</text>`;
      return;
    }
    const yr = i === 0 || d.getMonth() === 0;
    s += `<text class="lc-tick" x="${x}" y="${m.t + ih + 19}" text-anchor="middle">${d.getMonth() + 1}월</text>`;
    if (yr) s += `<text class="lc-tick lc-year" x="${x}" y="${m.t + ih + 34}" text-anchor="middle">${d.getFullYear()}</text>`;
  });
  s += `<line class="lc-axis" x1="${m.l}" x2="${m.l + iw}" y1="${Y(lo)}" y2="${Y(lo)}"/>`;

  // ---- 선 ----
  const dense = xs.length > 36;
  series.forEach((sr, si) => {
    let d = '', pen = false;
    for (const p of sr.points) {
      if (p.y == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`; pen = true;
    }
    s += `<g class="lc-series" data-i="${si}" style="--c:${sr.color}">`;
    s += `<path class="lc-line" d="${d}"/>`;
    for (const p of sr.points) {
      if (p.y == null) continue;
      if (dense && !p.hollow) continue;
      s += `<circle class="lc-dot${p.hollow ? ' hollow' : ''}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${dense ? 2.5 : 3.5}"/>`;
    }
    s += `</g>`;
  });
  // ---- 끝 값 ----
  const ends = series.map((sr, si) => {
    const p = [...sr.points].reverse().find((q) => q.y != null);
    return { si, x: X(p.x), y: Y(p.y), v: p.y };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  for (const e of ends) {
    s += `<g class="lc-end" data-i="${e.si}"><circle class="lc-enddot" cx="${e.x}" cy="${Y(series[e.si].points.filter((p) => p.y != null).pop().y)}" r="4" style="--c:${series[e.si].color}"/>`;
    s += `<text class="lc-endval" x="${e.x + 9}" y="${e.y + 4.5}">${e.v}</text></g>`;
  }
  // 선택된 시점: 세로선과 진한 점
  if (o.selectedX != null && xs.includes(+o.selectedX)) {
    const sx = X(o.selectedX);
    s += `<line class="lc-sel" x1="${sx}" x2="${sx}" y1="${m.t}" y2="${m.t + ih}"/>`;
    series.forEach((sr) => {
      const p = sr.points.find((q) => +q.x === +o.selectedX && q.y != null);
      if (p) s += `<circle class="lc-seldot" cx="${sx}" cy="${Y(p.y)}" r="5" style="--c:${sr.color}"/>`;
    });
    if (o.selectedLabel) {
      const anchor = sx < m.l + 60 ? 'start' : sx > m.l + iw - 60 ? 'end' : 'middle';
      s += `<text class="lc-sellabel" x="${sx}" y="${m.t - 6}" text-anchor="${anchor}">${esc(o.selectedLabel)}</text>`;
    }
  }
  s += `<g class="lc-note" visibility="hidden"><circle class="lc-ring" r="7"/><text class="lc-ann"></text></g>`;
  s += `<rect class="lc-hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`;
  s += `</svg>`;
  el.innerHTML = s;

  const svg = el.querySelector('svg');
  const groups = [...svg.querySelectorAll('.lc-series')];
  const endGs = [...svg.querySelectorAll('.lc-end')];
  const note = svg.querySelector('.lc-note');
  const ring = note.querySelector('.lc-ring');
  const ann = note.querySelector('.lc-ann');

  function paint() {
    const h = state.hi ?? state.lock;
    groups.forEach((g, i) => g.classList.toggle('dim', h != null && h !== i));
    endGs.forEach((g) => g.classList.toggle('dim', h != null && h !== +g.dataset.i));
    if (o.legendEl) o.legendEl.querySelectorAll('[data-si]').forEach((b) => {
      b.classList.toggle('dim', h != null && h !== +b.dataset.si);
      b.setAttribute('aria-pressed', String(state.lock === +b.dataset.si));
    });
  }

  function showPoint(si, xi) {
    const sr = series[si];
    const p = sr.points.find((q) => +q.x === xs[xi]);
    if (!p || p.y == null) return hidePoint();
    state.focus = { si, xi };
    state.hi = si;
    const px = X(p.x), py = Y(p.y);
    ring.setAttribute('cx', px); ring.setAttribute('cy', py);
    ring.style.setProperty('--c', sr.color);
    const lines = [
      `<tspan class="lc-ann-name" style="fill:${sr.color}">${esc(sr.name)}</tspan>`,
      `<tspan>${esc(p.label)}</tspan>`,
      `<tspan class="lc-ann-val">${p.y}${esc(o.unit || '')}${p.n ? `<tspan class="lc-ann-n"> · ${p.n.toLocaleString('ko-KR')}명</tspan>` : ''}</tspan>`,
    ];
    if (o.onSelect && +o.selectedX !== xs[xi]) lines.push(`<tspan class="lc-ann-n">눌러서 특성별 보기</tspan>`);
    const h = lines.length * 15 + 8;
    const above = py - h - 8 > m.t;
    const baseY = above ? py - h : py + 24;
    const anchor = px < m.l + 70 ? 'start' : px > m.l + iw - 70 ? 'end' : 'middle';
    ann.setAttribute('text-anchor', anchor);
    ann.innerHTML = lines.map((l, i) => l.replace('<tspan', `<tspan x="${px}" y="${baseY + i * 15}"`)).join('');
    note.setAttribute('visibility', 'visible');
    paint();
  }
  function hidePoint() {
    state.focus = null; state.hi = null;
    note.setAttribute('visibility', 'hidden');
    paint();
  }

  function onMove(ev) {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const py = ((ev.clientY - r.top) / r.height) * H;
    if (px < m.l - 10) return hidePoint(); // 오른쪽 끝 값 라벨 위에서도 마지막 시점을 보여준다
    let xi = 0, bd = Infinity;
    xs.forEach((t, i) => { const d = Math.abs(X(t) - px); if (d < bd) { bd = d; xi = i; } });
    let si = null, by = Infinity;
    series.forEach((sr, i) => {
      if (state.lock != null && state.lock !== i) return;
      const p = sr.points.find((q) => +q.x === xs[xi]);
      if (!p || p.y == null) return;
      const d = Math.abs(Y(p.y) - py);
      if (d < by) { by = d; si = i; }
    });
    if (si == null) return hidePoint();
    showPoint(si, xi);
  }
  const hit = svg.querySelector('.lc-hit');
  if (o.onSelect) {
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', (ev) => { onMove(ev); if (state.focus) o.onSelect(new Date(xs[state.focus.xi])); });
  }
  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerdown', onMove);
  hit.addEventListener('pointerleave', hidePoint);
  svg.addEventListener('keydown', (e) => {
    const f = state.focus ?? { si: 0, xi: xs.length - 1 };
    if (e.key === 'ArrowLeft') showPoint(f.si, Math.max(0, f.xi - 1));
    else if (e.key === 'ArrowRight') showPoint(f.si, Math.min(xs.length - 1, f.xi + 1));
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') showPoint((f.si + (e.key === 'ArrowUp' ? series.length - 1 : 1)) % series.length, f.xi);
    else if (e.key === 'Escape') hidePoint();
    else if ((e.key === 'Enter' || e.key === ' ') && o.onSelect && state.focus) o.onSelect(new Date(xs[state.focus.xi]));
    else return;
    e.preventDefault();
  });
  svg.addEventListener('blur', hidePoint);

  // ---- 범례 ----
  if (o.legendEl) {
    o.legendEl.innerHTML = series.map((sr, i) => `<button type="button" class="lc-key" data-si="${i}" aria-pressed="false" style="--c:${sr.color}"><i></i>${esc(sr.name)}</button>`).join('');
    o.legendEl.querySelectorAll('[data-si]').forEach((b) => {
      const i = +b.dataset.si;
      b.addEventListener('pointerenter', () => { state.hi = i; paint(); });
      b.addEventListener('pointerleave', () => { state.hi = null; paint(); });
      b.addEventListener('focus', () => { state.hi = i; paint(); });
      b.addEventListener('blur', () => { state.hi = null; paint(); });
      b.addEventListener('click', () => { state.lock = state.lock === i ? null : i; paint(); });
    });
  }
  paint();
  return {
    svg,
    highlight(i) { state.hi = i; paint(); },
  };
}

// ---------- 내보내기 ----------

/** 표 데이터를 CSV로 내려받기 */
export function downloadCSV(filename, header, rows) {
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const text = '﻿' + [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
  save(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename);
}

/** 그래프를 제목·각주와 함께 PNG로 저장 */
export async function downloadPNG(filename, svg, { title, subtitle, legend = [], footer }) {
  const vb = svg.viewBox.baseVal;
  const W = vb.width, top = 92, bottom = 40, H = vb.height + top + bottom;
  const cs = getComputedStyle(document.body);
  const clone = svg.cloneNode(true);
  const src = [...svg.querySelectorAll('*')], dst = [...clone.querySelectorAll('*')];
  src.forEach((n, i) => {
    const c = getComputedStyle(n), d = dst[i];
    for (const k of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-weight', 'font-family', 'paint-order', 'stroke-linejoin', 'stroke-linecap']) d.style.setProperty(k, c.getPropertyValue(k));
  });
  clone.querySelector('.lc-hit')?.remove();
  const ink = cs.getPropertyValue('color');
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#777';
  const font = cs.fontFamily.replace(/"/g, "'");
  let lx = 0;
  const leg = legend.map((l) => {
    const g = `<line x1="${lx}" x2="${lx + 18}" y1="-4" y2="-4" stroke="${l.color}" stroke-width="3"/><text x="${lx + 24}" y="0" font-size="13" fill="${ink}">${esc(l.name)}</text>`;
    lx += 34 + l.name.length * 12.5;
    return g;
  }).join('');
  const out = `<svg xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">
    <rect width="${W}" height="${H}" fill="${cs.backgroundColor}"/>
    <text x="16" y="30" font-size="19" font-weight="700" fill="${ink}">${esc(title)}</text>
    <text x="16" y="52" font-size="13" fill="${muted}">${esc(subtitle || '')}</text>
    <g transform="translate(16 78)">${leg}</g>
    <g transform="translate(0 ${top})">${clone.innerHTML}</g>
    <text x="16" y="${H - 14}" font-size="11.5" fill="${muted}">${esc(footer || '')}</text>
  </svg>`;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const scale = 2, cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const ctx = cv.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  cv.toBlob((b) => save(b, filename), 'image/png');
}

function save(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
