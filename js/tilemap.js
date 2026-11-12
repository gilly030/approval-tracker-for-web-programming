// 지역별 순평가(긍정 − 부정) 지도. 실제 시도 경계(울릉도·독도 포함)를 갤럽 권역별 색으로 칠한다.
import { VIEWBOX, PATHS, DOKDO, ULLEUNG } from './korea-paths.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 시도 → 권역을 찾을 때 쓸 낱말
const SIDO = {
  서울: ['서울'], 인천: ['인천'], 경기: ['경기'], 강원: ['강원'],
  충북: ['충북', '충청'], 충남: ['충남', '충청'], 세종: ['세종', '충청'], 대전: ['대전'],
  전북: ['전북', '전라'], 전남: ['전남', '전라'], 광주: ['광주'],
  경북: ['경북'], 대구: ['대구'], 경남: ['경남'], 울산: ['울산'], 부산: ['부산'], 제주: ['제주'],
};
// 권역 라벨을 둘 시도와 위치 조정 (지도 좌표). 서울은 작아서 바다 쪽으로 빼고 선을 잇는다.
const ANCHOR = [
  { words: ['서울'], sido: '서울', dx: -78, dy: -30, callout: true },
  { words: ['경기', '인천'], sido: '경기', dx: 14, dy: 22 },
  { words: ['강원'], sido: '강원', dx: 0, dy: 0 },
  { words: ['충청', '대전', '세종'], sido: '충북', dx: -34, dy: 18 },
  { words: ['경북', '대구'], sido: '경북', dx: 4, dy: -4 },
  { words: ['전라', '광주'], sido: '전북', dx: -6, dy: 30 },
  { words: ['경남', '부산', '울산'], sido: '경남', dx: 10, dy: 2 },
  { words: ['제주'], sido: '제주', dx: 0, dy: 0 },
];

export const STEPS = [5, 10, 20, 40];
export function stepOf(v) {
  if (v == null) return null;
  const a = Math.abs(v);
  let k = 0;
  for (let i = 0; i < STEPS.length; i++) if (a >= STEPS[i]) k = i + 1;
  return v < 0 ? -k : k;
}
const fillVar = (k) => (k == null ? 'var(--dv-na)' : k === 0 ? 'var(--dv-0)' : `var(--dv-${k < 0 ? 'n' : 'p'}${Math.abs(k)})`);
const fmt = (v) => (v == null ? '–' : v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

export function regionMap(el, rows) {
  const regionOf = (words) => rows.find((r) => words.some((w) => r.group.includes(w)));
  const sidos = Object.entries(SIDO).map(([name, words]) => {
    const reg = regionOf(words);
    const v = reg && reg.pos != null ? reg.pos - reg.neg : null;
    return { name, reg, v, k: stepOf(v) };
  });
  const regOfSido = (n) => sidos.find((s) => s.name === n)?.reg;

  let s = `<svg viewBox="${VIEWBOX}" role="img" aria-label="지역별 대통령 직무 순평가 지도 (울릉도·독도 포함)">`;
  s += `<defs><pattern id="tm-stripes" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" class="tm-stripe"/></pattern></defs>`;
  for (const q of sidos) {
    const label = q.reg ? `${q.name} (${q.reg.group}): 잘하고 있다 ${q.reg.pos ?? '–'}%, 잘못하고 있다 ${q.reg.neg ?? '–'}%` : `${q.name}: 자료 없음`;
    s += `<g class="tm-cell" tabindex="0" data-name="${esc(q.name)}" aria-label="${esc(label)}">`;
    s += `<path class="tm-area" d="${PATHS[q.name]}" style="fill:${fillVar(q.k)}"/>`;
    if (q.k == null && q.reg) s += `<path class="tm-hatch" d="${PATHS[q.name]}"/>`;
    s += `</g>`;
  }
  // 울릉도·독도: 권역 색을 칠하지 않고 회색, 실제 크기 그대로
  if (PATHS['울릉도·독도']) {
    s += `<path class="tm-islands" d="${PATHS['울릉도·독도']}"><title>울릉도·독도</title></path>`;
    if (ULLEUNG) s += `<text class="tm-islet" x="${ULLEUNG[0]}" y="${ULLEUNG[1] + 15}" text-anchor="middle">울릉도</text>`;
    if (DOKDO) s += `<text class="tm-islet" x="${DOKDO[0] - 2}" y="${DOKDO[1] + 13}" text-anchor="end">독도</text>`;
  }
  s += `<g class="tm-labels"></g></svg>`;

  const regs = [...new Set(sidos.map((q) => q.reg).filter(Boolean))];
  const list = regs.map((r) => ({ r, v: r.pos != null ? r.pos - r.neg : null })).sort((a, b) => (b.v ?? -999) - (a.v ?? -999));
  el.innerHTML = `
    <div class="tm-wrap">
      <div class="tm-map">${s}<div class="tm-tip" hidden></div></div>
      <div class="tm-side">
        ${legendHTML()}
        <ol class="tm-list">${list.map(({ r, v }) => `<li data-group="${esc(r.group)}"><i${v == null ? ' class="hatch-swatch"' : ` style="background:${fillVar(stepOf(v))}"`}></i><span class="tm-g">${esc(r.group)}</span>${v == null ? '<span class="tm-v tm-na">미공개</span>' : `<span class="tm-v num">${fmt(v)}</span>`}</li>`).join('')}</ol>
      </div>
    </div>`;

  // 권역 라벨: 기준 시도의 가운데에 '이름 값'
  const svg = el.querySelector('svg');
  const lab = svg.querySelector('.tm-labels');
  let L = '';
  for (const a of ANCHOR) {
    const reg = regionOf(a.words);
    if (!reg) continue;
    const path = svg.querySelector(`.tm-cell[data-name="${a.sido}"] .tm-area`);
    if (!path) continue;
    const b = path.getBBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const x = cx + a.dx, y = cy + a.dy;
    const v = reg.pos != null ? reg.pos - reg.neg : null;
    const short = reg.group.split('/')[0] === reg.group ? reg.group : reg.group.replace(/\//g, '·');
    if (a.callout) L += `<line class="tm-callout" x1="${cx}" y1="${cy}" x2="${x + 18}" y2="${y + 2}"/><circle class="tm-callout-dot" cx="${cx}" cy="${cy}" r="1.8"/>`;
    L += `<text class="tm-lab" x="${x}" y="${y}" text-anchor="middle"><tspan class="tm-lab-name" x="${x}">${esc(short)}</tspan>${v == null ? '' : `<tspan class="tm-lab-val" x="${x}" dy="14">${fmt(v)}</tspan>`}</text>`;
  }
  lab.innerHTML = L;

  // 올리면 그 권역 수치를 보여주고 같은 권역만 진하게
  const tip = el.querySelector('.tm-tip');
  const [, , VW] = VIEWBOX.split(' ').map(Number);
  const show = (name, ev) => {
    const q = sidos.find((c) => c.name === name);
    el.querySelectorAll('.tm-cell').forEach((g) => g.classList.toggle('dim', !!q?.reg && regOfSido(g.dataset.name) !== q.reg));
    el.querySelectorAll('.tm-list li').forEach((li) => li.classList.toggle('on', q?.reg?.group === li.dataset.group));
    if (!q) { tip.hidden = true; return; }
    const r = q.reg;
    tip.innerHTML = r
      ? `<b>${esc(r.group)}</b>${r.pos == null ? '<div>표본이 적어 미공개</div>' : `<div>잘하고 있다 <span class="num">${r.pos}%</span></div><div>잘못하고 있다 <span class="num">${r.neg}%</span></div><div class="tm-n">순평가 ${fmt(r.pos - r.neg)} · ${r.n?.toLocaleString('ko-KR')}명</div>`}`
      : `<b>${esc(q.name)}</b><div>자료 없음</div>`;
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    let x, y;
    if (ev && ev.clientX != null) { x = ev.clientX - box.left + 14; y = ev.clientY - box.top + 10; }
    else {
      const bb = svg.querySelector(`.tm-cell[data-name="${name}"]`).getBBox(), sc = box.width / VW;
      x = (bb.x + bb.width) * sc + 6; y = bb.y * sc;
    }
    tip.style.left = `${Math.max(0, Math.min(x, box.width - tip.offsetWidth))}px`;
    tip.style.top = `${Math.max(0, Math.min(y, box.height - tip.offsetHeight))}px`;
  };
  const clear = () => show(null);
  el.querySelectorAll('.tm-cell').forEach((g) => {
    g.addEventListener('pointermove', (ev) => show(g.dataset.name, ev));
    g.addEventListener('pointerdown', (ev) => show(g.dataset.name, ev));
    g.addEventListener('focus', () => show(g.dataset.name));
    g.addEventListener('blur', clear);
  });
  svg.addEventListener('pointerleave', clear);
  el.querySelectorAll('.tm-list li').forEach((li) => {
    li.addEventListener('pointerenter', () => { const q = sidos.find((c) => c.reg?.group === li.dataset.group); if (q) show(q.name); });
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
    <div class="tm-legend-note">순평가 = 잘하고 있다 − 잘못하고 있다 (%p)</div>
  </div>`;
}
