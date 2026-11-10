// 한국갤럽 리포트 PDF → 대통령 직무 수행 평가 응답자 특성별 표 추출기.
// 브라우저와 Node 양쪽에서 동작한다 (pdf.js 라이브러리를 인자로 받음).
//
// 핵심 원칙: 배너·열 구성을 코드에 고정하지 않는다.
//  - 표의 기준점은 '전체' 행.
//  - 열은 값의 오른쪽 끝 좌표로 묶고, 열 이름은 그 위에 쌓인 머리글 글자로 읽는다.
//  - '잘하고' 열부터 '전체' 행 합계가 100%가 될 때까지가 평가 열(main),
//    그 뒤에 직전 열을 쪼갠 세부 열(예: 의견유보 = 어느 쪽도 아님 + 모름)이 있으면 detail로 붙인다.
//  - 배너명은 그룹명보다 왼쪽 열에 있는 글자. 여러 줄로 쪼개져 있어도 이어 붙이고,
//    그룹 첫 줄에 있든(2013~) 그룹 세로 가운데에 있든(2012) 모두 처리한다.

import { normalizeBanner, normalizeGroup, BANNER_MAP } from './normalize.js';

const KNOWN_BANNERS = Object.keys(BANNER_MAP);

const VALUE_RE = /^(-|\d{1,3}(,\d{3})*%?|\d+%?)$/;
const isValue = (s) => VALUE_RE.test(s);
const toNum = (s) => (s === '-' ? null : Number(s.replace(/[,%]/g, '')));
// 열 머리글 표기 정리 (표 제목 글자가 섞여 들어오므로 핵심어로 판정)
function prettyCol(raw) {
  const s = raw.replace(/\s/g, '');
  if (/잘못하고/.test(s)) return '잘못하고 있다';
  if (/잘하고/.test(s)) return '잘하고 있다';
  if (/의견유보/.test(s)) return '의견유보';
  if (/어느쪽도/.test(s)) return '어느 쪽도 아님';
  if (/보통/.test(s)) return '보통';
  if (/모름/.test(s)) return '모름/응답거절';
  if (/사례수|표본/.test(s)) return /가중/.test(s) ? '가중적용 사례수' : '사례수';
  return s;
}
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

// ---------- 1. pdf.js 텍스트 조각 → 단어 → 행 ----------

function itemsToWords(items, pageHeight) {
  const raw = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = pageHeight - it.transform[5];
    const w = it.width;
    const str = it.str;
    // 조각 안에 공백이 있으면 글자 수 비례로 나눈다
    const parts = str.split(/(\s+)/);
    let off = 0;
    for (const p of parts) {
      const px0 = x + (w * off) / str.length;
      const px1 = x + (w * (off + p.length)) / str.length;
      off += p.length;
      if (p.trim()) raw.push({ s: p, x0: px0, x1: px1, y });
    }
  }
  raw.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  // 같은 줄에서 거의 붙어 있는 조각은 한 단어로 합친다
  const words = [];
  for (const w of raw) {
    const last = words[words.length - 1];
    if (last && Math.abs(last.y - w.y) < 1 && w.x0 - last.x1 < 0.8 && w.x0 >= last.x0) {
      last.s += w.s; last.x1 = w.x1;
    } else words.push({ ...w });
  }
  return words;
}

function groupRows(words, tol = 2.5) {
  const sorted = [...words].sort((a, b) => a.y - b.y);
  const rows = [];
  for (const w of sorted) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r.y - w.y) <= tol) { r.words.push(w); r.ys.push(w.y); r.y = median(r.ys); }
    else rows.push({ y: w.y, ys: [w.y], words: [w] });
  }
  for (const r of rows) r.words.sort((a, b) => a.x0 - b.x0);
  return rows;
}

// ---------- 2. 한 페이지에서 표 찾기 ----------

function findTables(rows, pageWidth) {
  // '전체' 오른쪽에 숫자가 2개 이상 있는 곳이 표의 기준점
  const anchors = [];
  for (const r of rows) {
    r.words.forEach((w, i) => {
      if (w.s !== '전체') return;
      const nums = r.words.slice(i + 1).filter((v) => isValue(v.s));
      if (nums.length >= 3) anchors.push({ row: r, word: w });
    });
  }
  return anchors.map((a, idx) => {
    const sameRow = anchors.filter((b) => b.row === a.row && b !== a);
    const next = sameRow.filter((b) => b.word.x0 > a.word.x0).sort((p, q) => p.word.x0 - q.word.x0)[0];
    const leftNums = a.row.words.filter((w) => w.x1 < a.word.x0 && isValue(w.s));
    const prevEdge = leftNums.length ? Math.max(...leftNums.map((w) => w.x1)) + 2 : 0;
    const left = Math.max(prevEdge, a.word.x0 - 62);
    const right = next ? next.word.x0 - 50 : pageWidth + 1;
    return { anchor: a, left, right };
  });
}

const inBox = (w, t) => w.x0 >= t.left - 0.5 && w.x1 <= t.right + 0.5;

// ---------- 3. 표 하나 읽기 ----------

function readTable(rows, t) {
  const warnings = [];
  const aRow = t.anchor.row;
  const aIdx = rows.indexOf(aRow);
  const groupX = t.anchor.word.x0;

  // 머리글 영역: 기준 행 위쪽 약 110pt
  const headRows = rows.slice(0, aIdx).filter((r) => r.y >= aRow.y - 110)
    .map((r) => ({ y: r.y, words: r.words.filter((w) => inBox(w, t)) }))
    .filter((r) => r.words.length);
  const headText = headRows.map((r) => r.words.map((w) => w.s).join(' ')).join(' ');

  // 데이터 영역: 기준 행부터 아래로, 각주를 만나거나 간격이 크게 벌어지면 끝
  const body = [];
  let lastY = aRow.y;
  const pitches = [];
  for (let i = aIdx; i < rows.length; i++) {
    const ws = rows[i].words.filter((w) => inBox(w, t));
    if (!ws.length) continue;
    const text = ws.map((w) => w.s).join(' ');
    if (/^[-*※]/.test(ws[0].s) && !isValue(ws[0].s)) break;
    if (/한국갤럽|사례\s*(이하|미만)|표본\s*미만|www\./.test(text)) break;
    const gap = rows[i].y - lastY;
    if (body.length > 2 && gap > Math.max(40, 3.5 * median(pitches))) break;
    if (body.length) pitches.push(gap);
    body.push({ y: rows[i].y, words: ws });
    lastY = rows[i].y;
  }

  // 행마다 라벨 단어 / 값 단어 분리 (첫 값 이전까지가 라벨)
  for (const r of body) {
    const firstVal = r.words.findIndex((w) => isValue(w.s) && w.x0 > groupX);
    r.labels = firstVal < 0 ? r.words : r.words.slice(0, firstVal);
    r.values = firstVal < 0 ? [] : r.words.slice(firstVal).filter((w) => isValue(w.s));
  }

  // 배너 열 / 그룹 열 경계
  const labelXs = body.flatMap((r) => r.labels.map((w) => w.x0));
  const bannerX = Math.min(...labelXs);
  const split = bannerX < groupX - 15 ? (bannerX + groupX) / 2 : -Infinity;
  for (const r of body) {
    r.bannerWords = r.labels.filter((w) => w.x0 < split);
    r.groupWords = r.labels.filter((w) => w.x0 >= split);
  }

  // ---- 열 정의: 값의 오른쪽 끝을 묶는다 ----
  const dataRows = body.filter((r) => r.values.length >= 2);
  // '-'(표본 부족)는 가운데 정렬이라 열 위치 계산에서 빼고, 나중에 가장 가까운 열에 붙인다
  const ends = dataRows.flatMap((r) => r.values.filter((w) => w.s !== '-').map((w) => w.x1)).sort((a, b) => a - b);
  const cols = [];
  for (const e of ends) {
    const c = cols[cols.length - 1];
    if (c && e - c.xs[c.xs.length - 1] <= 6) c.xs.push(e);
    else cols.push({ xs: [e] });
  }
  cols.forEach((c) => { c.x1 = median(c.xs); c.head = []; });
  const totalVals = aRow.words.filter((w) => inBox(w, t) && isValue(w.s) && w.x0 > groupX);
  const widthGuess = median(totalVals.filter((w) => /%$/.test(w.s)).map((w) => w.x1 - w.x0))
    || median(totalVals.map((w) => w.x1 - w.x0)) || 12;
  const colOf = (w) => {
    let best = null, bd = w.s === '-' ? 12 : 7;
    for (const c of cols) {
      const d = w.s === '-' ? Math.abs(c.x1 - widthGuess / 2 - (w.x0 + w.x1) / 2) : Math.abs(c.x1 - w.x1);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  // 머리글 단어를 가장 가까운 열 중심에 붙인다
  // 열 머리글은 기준 행 바로 위에서부터, 질문 문장이 나오는 줄 전까지만
  const colHeadRows = [];
  for (let i = headRows.length - 1; i >= 0; i--) {
    const txt = headRows[i].words.map((w) => w.s).join(' ');
    if (/[?？‘’“”]|질문|귀하/.test(txt)) break;
    colHeadRows.unshift(headRows[i]);
  }
  for (const r of colHeadRows) for (const w of r.words) {
    const cx = (w.x0 + w.x1) / 2;
    let best = null, bd = 22;
    for (const c of cols) { const d = Math.abs(c.x1 - widthGuess / 2 - cx); if (d < bd) { bd = d; best = c; } }
    if (best) best.head.push(w);
  }
  cols.forEach((c) => {
    c.rawLabel = c.head.sort((a, b) => a.y - b.y || a.x0 - b.x0).map((w) => w.s).join('');
    c.label = prettyCol(c.rawLabel);
  });

  // ---- 열 역할 판정 ----
  const totalByCol = new Map();
  for (const w of totalVals) { const c = colOf(w); if (c) totalByCol.set(c, w.s); }
  const posIdx = cols.findIndex((c) => /잘하고/.test(c.label));
  const negIdx = cols.findIndex((c) => /잘못하고/.test(c.label));
  if (posIdx < 0 || negIdx !== posIdx + 1) {
    return { error: `'잘하고/잘못하고' 열을 찾지 못함 (열: ${cols.map((c) => c.label || '?').join(' | ')})` };
  }
  const nCols = cols.slice(0, posIdx).filter((c) => totalByCol.has(c) && !/%/.test(totalByCol.get(c)));
  let sum = 0, mainEnd = posIdx - 1;
  for (let i = posIdx; i < cols.length; i++) {
    const v = toNum(totalByCol.get(cols[i]) ?? '-');
    if (v == null) break;
    sum += v; mainEnd = i;
    if (Math.abs(sum - 100) <= 2) break;
  }
  if (Math.abs(sum - 100) > 2) return { error: `'전체' 행 평가 열 합계가 100이 아님 (${sum})` };
  const mainCols = cols.slice(posIdx, mainEnd + 1);
  // 세부 열: 직전 main 열 값을 정확히 쪼갠 경우만
  const detailCols = [];
  const lastMain = toNum(totalByCol.get(cols[mainEnd]));
  let dsum = 0;
  for (let i = mainEnd + 1; i < cols.length; i++) {
    const v = toNum(totalByCol.get(cols[i]) ?? '-');
    if (v == null) break;
    dsum += v; detailCols.push(cols[i]);
    if (Math.abs(dsum - lastMain) <= 1) break;
  }
  if (!(detailCols.length >= 2 && Math.abs(dsum - lastMain) <= 1)) detailCols.length = 0;
  const restLabel = mainCols.length === 3 ? mainCols[2].label : mainCols.slice(2).map((c) => c.label).join('+');

  // ---- 배너 블록: 배너 열 글자를 이어 붙인다 ('…별'로 끝나면 끊음) ----
  const pitch = median(pitches) || 10;
  const frags = body.flatMap((r) => r.bannerWords.map((w) => ({ s: w.s, y: r.y })));
  const blocks = [];
  // 이미 아는 배너 이름의 첫 단어가 나오면, 앞 글자가 그 이름의 일부가 아닌 한 새 배너로 본다
  // (예: '본인·배우자 / 명의 집' 다음 줄의 '평소 / 정치에 / 관심이')
  const known = KNOWN_BANNERS.map((k) => k.replace(/\s/g, ''));
  const startsKnown = (s) => KNOWN_BANNERS.some((k) => k.split(/\s+/)[0] === s && /\s/.test(k));
  const prefixOfKnown = (s) => known.some((k) => k.startsWith(s.replace(/\s/g, '')) && k !== s.replace(/\s/g, ''));
  for (const f of frags) {
    const b = blocks[blocks.length - 1];
    const forceNew = b && startsKnown(f.s) && !prefixOfKnown(b.text);
    if (b && !forceNew && f.y - b.y1 <= 1.7 * pitch && !/별$/.test(b.text) && f.y !== b.y1) { b.text += ' ' + f.s; b.y1 = f.y; }
    else if (b && f.y === b.y1) { b.text += ' ' + f.s; }
    else blocks.push({ text: f.s, y0: f.y, y1: f.y });
  }
  for (const b of blocks) b.text = b.text.replace(/\s*\/\s*/g, '/').replace(/^(\S+\/)\s+/, '$1');

  // ---- 데이터 행 → 구간 → 배너 지정 ----
  const recs = dataRows.filter((r) => r.groupWords.length);
  // 큰 간격으로 구간 나누기 (2012형: 배너가 그룹 가운데에 있음)
  const segs = [];
  recs.forEach((r, i) => {
    if (i === 0 || r.y - recs[i - 1].y > 1.45 * pitch) segs.push([]);
    segs[segs.length - 1].push(r);
  });
  let carry = null;
  for (const seg of segs) {
    const y0 = seg[0].y - 0.6 * pitch, y1 = seg[seg.length - 1].y + 0.6 * pitch;
    const inside = blocks.filter((b) => b.y0 >= y0 && b.y1 <= y1 + pitch);
    if (inside.length === 1) {
      // 구간에 배너가 하나뿐이면 (가운데 정렬형 포함) 구간 전체가 그 배너
      seg.forEach((r) => (r.banner = inside[0].text));
      carry = inside[0].text;
      continue;
    }
    for (const r of seg) {
      const starts = inside.filter((b) => b.y0 <= r.y + 0.6 * pitch);
      if (starts.length) carry = starts[starts.length - 1].text;
      r.banner = carry;
    }
  }

  // ---- 레코드 만들기 ----
  const out = [];
  const unknownBanners = new Set();
  for (const r of recs) {
    const groupRaw = r.groupWords.map((w) => w.s).join(' ');
    const isTotal = groupRaw === '전체';
    const bannerRaw = isTotal ? '전체' : r.banner;
    if (!bannerRaw) { warnings.push(`배너를 정하지 못한 행: ${groupRaw}`); continue; }
    const bn = normalizeBanner(bannerRaw);
    if (!bn.known) unknownBanners.add(bn.name);
    const vals = new Map();
    for (const w of r.values) { const c = colOf(w); if (c) vals.set(c, w.s); }
    const get = (c) => (vals.has(c) ? toNum(vals.get(c)) : undefined);
    const ns = nCols.map(get);
    const main = mainCols.map(get);
    const suppressed = main.every((v) => v === null || v === undefined);
    const rec = {
      banner: bn.name,
      group: normalizeGroup(bn.name, groupRaw),
      bannerRaw, groupRaw,
      n: ns[0] ?? null,
      nWeighted: ns.length > 1 ? ns[ns.length - 1] : null,
      pos: suppressed ? null : main[0] ?? 0,
      neg: suppressed ? null : main[1] ?? 0,
      rest: suppressed ? null : main.slice(2).reduce((a, v) => a + (v ?? 0), 0),
    };
    if (detailCols.length && !suppressed) {
      rec.detail = Object.fromEntries(detailCols.map((c) => [c.label, get(c) ?? 0]));
      // 의견유보 칸이 비어 있는데 세부 칸은 있으면 세부 합으로 채운다
      const lastMainVal = main[main.length - 1];
      if ((lastMainVal == null) && main.length >= 3) {
        const d = Object.values(rec.detail).reduce((a, v) => a + v, 0);
        rec.rest += d;
        warnings.push(`${bn.name} ${groupRaw}: '${mainCols[mainCols.length - 1].label}' 칸이 비어 세부 칸 합(${d}%)으로 채움`);
      }
    }
    if (!suppressed) {
      const s = rec.pos + rec.neg + rec.rest;
      if (Math.abs(s - 100) > 2) warnings.push(`${rec.banner} ${rec.group}: 합계 ${s}%`);
      const filled = rec.detail && main.length >= 3 && main[main.length - 1] == null;
      const missing = main.filter((v, i) => v === undefined && !(filled && i === main.length - 1)).length;
      if (missing) warnings.push(`${rec.banner} ${rec.group}: 빈 칸 ${missing}개 (0으로 처리)`);
    }
    out.push(rec);
  }

  // 배너별 사례수 합 점검
  const total = out.find((r) => r.banner === '전체');
  if (total && total.n) {
    const byBanner = {};
    for (const r of out) if (r.banner !== '전체') (byBanner[r.banner] ??= []).push(r);
    for (const [b, rs] of Object.entries(byBanner)) {
      const s = rs.reduce((a, r) => a + (r.n ?? 0), 0);
      const diff = Math.abs(s - total.n) / total.n;
      if (diff > 0.02) {
        const note = /정당/.test(b) ? ' (주요 정당만 표시되는 배너라 정상일 수 있음)' : '';
        warnings.push(`${b}: 그룹 사례수 합 ${s} ≠ 전체 ${total.n}${note}`);
      }
    }
  }

  return {
    headText,
    columns: {
      n: nCols.map((c) => c.label),
      main: mainCols.map((c) => c.label),
      detail: detailCols.map((c) => c.label),
      restLabel,
    },
    rows: out,
    unknownBanners: [...unknownBanners],
    warnings,
  };
}

// ---------- 4. 기간·대통령·호수 ----------

function parsePeriod(headText, pageText) {
  const h = headText.replace(/\s+/g, ' ');
  const year = (h.match(/(\d{4})\s*년/) || [])[1];
  let m;
  if ((m = h.match(/(\d{1,2})\s*월\s*\(([^)]*)\)\s*통합/)) && year) {
    return { type: 'monthly', year: +year, month: +m[1], week: null, label: `${year}년 ${+m[1]}월 통합 (${m[2]})` };
  }
  if ((m = h.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d)\s*[~-]\s*(\d)\s*주/))) {
    return { type: 'monthly', year: +m[1], month: +m[2], week: null, label: `${m[1]}년 ${+m[2]}월 통합 (${m[3]}~${m[4]}주)` };
  }
  if ((m = h.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d)\s*주/))) {
    const days = (h.match(/\(([\d/~\s-]+일?)\)/) || [])[1];
    return { type: 'weekly', year: +m[1], month: +m[2], week: +m[3], label: `${m[1]}년 ${+m[2]}월 ${m[3]}주${days ? ` (${days.replace(/\s/g, '')})` : ''}` };
  }
  return null;
}

export const periodKey = (p) =>
  p.type === 'weekly'
    ? `${p.year}-${String(p.month).padStart(2, '0')}-W${p.week}`
    : `${p.year}-${String(p.month).padStart(2, '0')}-M`;

// ---------- 5. 문서 전체 ----------

export async function parseGallupPdf(pdfjsLib, data, opts = {}) {
  const doc = await pdfjsLib.getDocument({ data, ...opts }).promise;
  const result = { pages: doc.numPages, issue: null, tables: [], skipped: [] };
  let firstText = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const words = itemsToWords(tc.items, vp.height);
    const pageText = words.map((w) => w.s).join(' ');
    if (p <= 2) firstText += ' ' + pageText;
    const rows = groupRows(words);
    for (const t of findTables(rows, vp.width)) {
      const tb = readTable(rows, t);
      const head = tb.headText || '';
      if (tb.error) {
        if (/대통령/.test(head) && /직무/.test(head)) result.skipped.push({ page: p, reason: tb.error });
        continue;
      }
      // 대통령 직무 평가 표만 (당선인 평가, 국회·정당 평가 등은 제외)
      if (!(/대통령/.test(head) && /직무/.test(head)) || /당선인/.test(head)) {
        continue;
      }
      const period = parsePeriod(head, pageText);
      if (!period) { result.skipped.push({ page: p, reason: '조사 기간을 읽지 못함', head: head.slice(0, 120) }); continue; }
      const pres = (pageText.match(/귀하는\s*(?:요즘\s*)?([가-힣]{2,4})\s*대통령이/) || head.match(/([가-힣]{2,4})\s*대통령\s*직무/) || [])[1] || null;
      const srcIssue = (pageText.match(/제\s*(\d+)\s*호/) || [])[1];
      result.tables.push({
        key: periodKey(period),
        ...period,
        president: pres && pres !== '대통령' ? pres : null,
        page: p,
        sourceIssue: srcIssue ? +srcIssue : null,
        columns: tb.columns,
        rows: tb.rows,
        unknownBanners: tb.unknownBanners,
        warnings: tb.warnings,
      });
    }
  }
  result.issue = +((firstText.match(/제\s*(\d+)\s*호/) || [])[1] || 0) || null;
  // 같은 기간이 여러 번 나오면 첫 번째만
  const seen = new Set();
  result.tables = result.tables.filter((t) => (seen.has(t.key) ? false : seen.add(t.key)));
  return result;
}
