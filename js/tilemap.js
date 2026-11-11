// 지역별 순평가(긍정 − 부정) 타일 지도. 17개 시도를 칸으로 그리고 갤럽 권역별로 색과 굵은 테두리로 묶는다.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// [시도, 열, 행, 권역을 찾을 때 쓸 낱말들]
const TILES = [
  ['서울', 1, 0, ['서울']],
  ['강원', 2, 0, ['강원']],
  ['인천', 0, 1, ['인천']],
  ['경기', 1, 1, ['경기']],
  ['충북', 2, 1, ['충북', '충청']],
  ['경북', 3, 1, ['경북']],
  ['충남', 0, 2, ['충남', '충청']],
  ['세종', 1, 2, ['세종', '충청']],
  ['대전', 2, 2, ['대전']],
  ['대구', 3, 2, ['대구']],
  ['전북', 0, 3, ['전북', '전라']],
  ['광주', 1, 3, ['광주']],
  ['경남', 2, 3, ['경남']],
  ['울산', 3, 3, ['울산']],
  ['전남', 1, 4, ['전남', '전라']],
  ['부산', 2, 4, ['부산']],
  ['제주', 0, 5, ['제주']],
];

// 순평가 → 색 단계 (-4 … +4). |값| 5 미만은 가운데 회색
export const STEPS = [5, 10, 20, 40];
export function stepOf(v) {
  if (v == null) return null;
  const a = Math.abs(v);
  let k = 0;
  for (let i = 0; i < STEPS.length; i++) if (a >= STEPS[i]) k = i + 1;
  return v < 0 ? -k : k;
}
const fillVar = (k) => (k == null ? 'var(--dv-na)' : k === 0 ? 'var(--dv-0)' : `var(--dv-${k < 0 ? 'n' : 'p'}${Math.abs(k)})`);
const darkText = (k) => k != null && Math.abs(k) <= 2; // 옅은 칸은 진한 글자

/**
 * @param {HTMLElement} el
 * @param {Array} rows  지역별 배너의 행들 ({ group, n, pos, neg, rest })
 * @param {(row) => void} [onHover]
 */
export function regionMap(el, rows) {
  const regionOf = (words) => rows.find((r) => words.some((w) => r.group.includes(w)));
  const T = 58, G = 4; // 칸 크기, 간격
  const cols = 4, rowsN = 6;
  const W = cols * (T + G) + G, H = rowsN * (T + G) + G;
  const cells = TILES.map(([name, c, r, words]) => {
    const reg = regionOf(words);
    const v = reg && reg.pos != null ? reg.pos - reg.neg : null;
    return { name, c, r, reg, v, k: stepOf(v), x: G + c * (T + G), y: G + r * (T + G) };
  });
  const at = (c, r) => cells.find((q) => q.c === c && q.r === r);

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="지역별 대통령 직무 순평가 지도">`;
  for (const q of cells) {
    const label = q.reg ? `${q.reg.group}: 잘하고 있다 ${q.reg.pos ?? '–'}%, 잘못하고 있다 ${q.reg.neg ?? '–'}%` : `${q.name}: 자료 없음`;
    s += `<g class="tm-cell" tabindex="0" data-name="${esc(q.name)}" aria-label="${esc(label)}">`;
    s += `<rect x="${q.x}" y="${q.y}" width="${T}" height="${T}" rx="3" style="fill:${fillVar(q.k)}"/>`;
    if (q.k == null && q.reg) s += `<rect x="${q.x}" y="${q.y}" width="${T}" height="${T}" rx="3" class="tm-hatch"/>`;
    s += `<text x="${q.x + T / 2}" y="${q.y + T / 2 + 5}" text-anchor="middle" class="tm-name${darkText(q.k) || q.k == null ? '' : ' on-dark'}">${esc(q.name)}</text>`;
    s += `</g>`;
  }
  // 같은 권역끼리 묶는 굵은 테두리: 이웃 칸이 다른 권역(또는 없음)인 변만 긋는다
  const half = G / 2;
  for (const q of cells) {
    const same = (o) => o && o.reg && q.reg && o.reg === q.reg;
    const x0 = q.x - half, x1 = q.x + T + half, y0 = q.y - half, y1 = q.y + T + half;
    if (!same(at(q.c, q.r - 1))) s += `<line class="tm-edge" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}"/>`;
    if (!same(at(q.c, q.r + 1))) s += `<line class="tm-edge" x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}"/>`;
    if (!same(at(q.c - 1, q.r))) s += `<line class="tm-edge" x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}"/>`;
    if (!same(at(q.c + 1, q.r))) s += `<line class="tm-edge" x1="${x1}" y1="${y0}" x2="${x1}" y2="${y1}"/>`;
  }
  s += `<defs><pattern id="tm-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="tm-stripe"/></pattern></defs>`;
  s += `</svg>`;

  // 권역 목록 (값 순)
  const regs = [...new Set(cells.map((q) => q.reg).filter(Boolean))];
  const list = regs.map((r) => ({ r, v: r.pos != null ? r.pos - r.neg : null }))
    .sort((a, b) => (b.v ?? -999) - (a.v ?? -999));
  const fmt = (v) => (v == null ? '–' : v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

  el.innerHTML = `
    <div class="tm-wrap">
      <div class="tm-map">${s}<div class="tm-tip" hidden></div></div>
      <div class="tm-side">
        ${legendHTML()}
        <ol class="tm-list">${list.map(({ r, v }) => `<li data-group="${esc(r.group)}"><i style="background:${fillVar(stepOf(v))}"></i><span class="tm-g">${esc(r.group)}</span><span class="tm-v num">${v == null ? '미공개' : fmt(v)}</span></li>`).join('')}</ol>
      </div>
    </div>`;

  // 칸에 올리면 그 권역 수치를 보여주고, 같은 권역 칸과 목록을 강조
  const tip = el.querySelector('.tm-tip');
  const svg = el.querySelector('svg');
  const show = (name) => {
    const q = cells.find((c) => c.name === name);
    el.querySelectorAll('.tm-cell').forEach((g) => g.classList.toggle('dim', !!q?.reg && cells.find((c) => c.name === g.dataset.name)?.reg !== q.reg));
    el.querySelectorAll('.tm-list li').forEach((li) => li.classList.toggle('on', q?.reg?.group === li.dataset.group));
    if (!q) { tip.hidden = true; return; }
    const r = q.reg;
    tip.innerHTML = r
      ? `<b>${esc(r.group)}</b>${r.pos == null ? '<div>표본이 적어 미공개</div>' : `<div>잘하고 있다 <span class="num">${r.pos}%</span></div><div>잘못하고 있다 <span class="num">${r.neg}%</span></div><div class="tm-n">순평가 ${fmt(r.pos - r.neg)} · ${r.n?.toLocaleString('ko-KR')}명</div>`}`
      : `<b>${esc(q.name)}</b><div>자료 없음</div>`;
    tip.hidden = false;
    const box = svg.getBoundingClientRect(), sc = box.width / W;
    const left = (q.x + T) * sc + 8, top = q.y * sc;
    tip.style.left = `${Math.min(left, box.width - tip.offsetWidth)}px`;
    tip.style.top = `${top}px`;
  };
  const clear = () => show(null);
  el.querySelectorAll('.tm-cell').forEach((g) => {
    g.addEventListener('pointerenter', () => show(g.dataset.name));
    g.addEventListener('focus', () => show(g.dataset.name));
    g.addEventListener('pointerdown', () => show(g.dataset.name));
    g.addEventListener('blur', clear);
  });
  svg.addEventListener('pointerleave', clear);
  el.querySelectorAll('.tm-list li').forEach((li) => {
    li.addEventListener('pointerenter', () => { const q = cells.find((c) => c.reg?.group === li.dataset.group); if (q) show(q.name); });
    li.addEventListener('pointerleave', clear);
  });
}

function legendHTML() {
  const neg = [4, 3, 2, 1].map((k) => `<span style="background:var(--dv-n${k})"></span>`).join('');
  const pos = [1, 2, 3, 4].map((k) => `<span style="background:var(--dv-p${k})"></span>`).join('');
  return `<div class="tm-legend" aria-label="색 범례: 순평가 (긍정 − 부정, %p)">
    <div class="tm-legend-heads"><b class="neg">부정 우세</b><b class="pos">긍정 우세</b></div>
    <div class="tm-scale">${neg}<span class="mid" style="background:var(--dv-0)"></span>${pos}</div>
    <div class="tm-ticks num"><span>40</span><span>20</span><span>10</span><span></span><span>0</span><span></span><span>10</span><span>20</span><span>40</span></div>
    <div class="tm-legend-note">순평가 = 잘하고 있다 − 잘못하고 있다 (%p). 가운데 회색은 차이 5%p 미만, 빗금은 표본이 적어 미공개.</div>
  </div>`;
}
