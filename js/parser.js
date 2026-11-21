// Gallup Korea report PDF -> presidential job approval tables by respondent group.
// Runs in both the browser and Node (the pdf.js library is passed in).
//
// Main idea: nothing about the banners or columns is hard-coded.
//  - Each table is anchored on its '전체' (total) row.
//  - Columns are found by grouping values on their right edge; column names are the header
//    text stacked above each column.
//  - Rating columns ('main') run from the '잘하고' (approve) column until the total row adds
//    up to 100%. Columns after that which split the previous one (e.g. no opinion = neither +
//    don't know) are kept as 'detail'.
//  - The banner name is the text left of the group names. It may be split over several lines,
//    and may sit on the group's first line (2013 on) or be centred vertically (2012).

import { normalizeBanner, normalizeGroup, BANNER_MAP } from './normalize.js';

const KNOWN_BANNERS = Object.keys(BANNER_MAP);

const VALUE_RE = /^(-|\d{1,3}(,\d{3})*%?|\d+%?)$/;
const isValue = (s) => VALUE_RE.test(s);
const toNum = (s) => (s === '-' ? null : Number(s.replace(/[,%]/g, '')));
// Normalize a column header (table-title text can get mixed in, so match on key words)
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

// ---------- 1. pdf.js text items -> words -> rows ----------

function itemsToWords(items, pageHeight) {
  const raw = [];
  let g = 0;
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = pageHeight - it.transform[5];
    const w = it.width;
    // Some reports (e.g. 2019-2020) store '48%' with spaces between the characters: '4 8 %'
    const str = /^\d(?:\s+\d)+\s*%$|^\d\s+%$/.test(it.str.trim()) ? it.str.replace(/\s+/g, '') : it.str;
    // Split an item at its spaces, placing each part by its share of the characters
    const parts = str.split(/(\s+)/);
    let off = 0;
    for (const p of parts) {
      const px0 = x + (w * off) / str.length;
      const px1 = x + (w * (off + p.length)) / str.length;
      off += p.length;
      if (p.trim()) raw.push({ s: p, x0: px0, x1: px1, y, g });
    }
    g++;
  }
  raw.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  // Merge items on the same line that almost touch into one word
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

// ---------- 2. find tables on a page ----------

function findTables(rows, pageWidth) {
  // A '전체' (total) word followed by several numbers anchors a table
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

// ---------- 3. read one table ----------

function readTable(rows, t) {
  const warnings = [];
  const aRow = t.anchor.row;
  const aIdx = rows.indexOf(aRow);
  const groupX = t.anchor.word.x0;

  // Header area: about 110pt above the anchor row
  const headRows = rows.slice(0, aIdx).filter((r) => r.y >= aRow.y - 110)
    .map((r) => ({ y: r.y, words: r.words.filter((w) => inBox(w, t)) }))
    .filter((r) => r.words.length);
  const headText = headRows.map((r) => r.words.map((w) => w.s).join(' ')).join(' ');

  // Body: from the anchor row down, until a footnote or a large vertical gap
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

  // Split each row into label words and value words (labels come before the first value)
  for (const r of body) {
    const firstVal = r.words.findIndex((w) => isValue(w.s) && w.x0 > groupX);
    r.labels = firstVal < 0 ? r.words : r.words.slice(0, firstVal);
    r.values = firstVal < 0 ? [] : r.words.slice(firstVal).filter((w) => isValue(w.s));
  }

  // Boundary between the banner column and the group column
  const labelXs = body.flatMap((r) => r.labels.map((w) => w.x0));
  const bannerX = Math.min(...labelXs);
  // In some 2012 tables '전체' sits in the banner column, so the group column is the next one right
  let groupColX = groupX;
  // Take the group column from the last label of rows that have values: the second line of a
  // banner ('정당별', '성향별') is indented inside the banner column, so the leftmost label is wrong
  const totalInBanner = Math.abs(bannerX - groupX) < 15;
  if (totalInBanner) {
    const right = body.filter((r) => r.values.length && r.labels.length)
      .map((r) => r.labels[r.labels.length - 1].x0).filter((x) => x > groupX + 15);
    if (right.length) groupColX = Math.min(...right);
  }
  const split = bannerX < groupColX - 15 ? (bannerX + groupColX) / 2 : -Infinity;
  for (const r of body) {
    r.bannerWords = r.labels.filter((w) => w.x0 < split);
    r.groupWords = r.labels.filter((w) => w.x0 >= split);
    // Move a '전체' in the banner column to the group column (otherwise it joins the '지역별' banner below)
    if (totalInBanner && r === body[0] && !r.groupWords.length) {
      r.groupWords = r.bannerWords.filter((w) => w.s === '전체');
      r.bannerWords = r.bannerWords.filter((w) => w.s !== '전체');
    }
  }

  // ---- columns: group values by their right edge ----
  const dataRows = body.filter((r) => r.values.length >= 2);
  // '-' (sample too small) is centred, so leave it out here and attach it to the nearest column later
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
  // Attach header words to the nearest column centre.
  // Column headers run from just above the anchor row up to the line with the question text
  const colHeadRows = [];
  for (let i = headRows.length - 1; i >= 0; i--) {
    const txt = headRows[i].words.map((w) => w.s).join(' ');
    if (/[?？‘’“”]|질문|귀하/.test(txt)) break;
    colHeadRows.unshift(headRows[i]);
  }
  // Headers stored as one item ('잘하고 있다' in the Sep-Nov 2012 reports) are placed by the
  // item's centre instead of word by word
  for (const r of colHeadRows) {
    const units = [];
    for (const w of r.words) {
      const u = units[units.length - 1];
      if (u && u.g === w.g) { u.s += ' ' + w.s; u.x1 = w.x1; } else units.push({ ...w });
    }
    for (const w of units) {
      const cx = (w.x0 + w.x1) / 2;
      let best = null, bd = 22;
      for (const c of cols) { const d = Math.abs(c.x1 - widthGuess / 2 - cx); if (d < bd) { bd = d; best = c; } }
      if (best) best.head.push(w);
    }
  }
  cols.forEach((c) => {
    c.rawLabel = c.head.sort((a, b) => a.y - b.y || a.x0 - b.x0).map((w) => w.s).join('');
    c.label = prettyCol(c.rawLabel);
  });

  // ---- column roles ----
  const totalByCol = new Map();
  for (const w of totalVals) { const c = colOf(w); if (c) totalByCol.set(c, w.s); }
  const posIdx = cols.findIndex((c) => /잘하고/.test(c.label));
  const negIdx = cols.findIndex((c) => /잘못하고/.test(c.label));
  if (posIdx < 0 || negIdx !== posIdx + 1) {
    return { headText, error: `'잘하고/잘못하고' 열을 찾지 못함 (열: ${cols.map((c) => c.label || '?').join(' | ')})` };
  }
  const nCols = cols.slice(0, posIdx).filter((c) => totalByCol.has(c) && !/%/.test(totalByCol.get(c)));
  let sum = 0, mainEnd = posIdx - 1;
  for (let i = posIdx; i < cols.length; i++) {
    const v = toNum(totalByCol.get(cols[i]) ?? '-');
    if (v == null) break;
    sum += v; mainEnd = i;
    if (Math.abs(sum - 100) <= 2) break;
  }
  if (Math.abs(sum - 100) > 2) return { headText, error: `'전체' 행 평가 열 합계가 100이 아님 (${sum})` };
  const mainCols = cols.slice(posIdx, mainEnd + 1);
  // Detail columns: only when they add up exactly to the last main column
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

  // ---- banner blocks: join the banner-column text (a name ending in '별' closes a block) ----
  const pitch = median(pitches) || 10;
  const frags = body.flatMap((r) => r.bannerWords.map((w) => ({ s: w.s, y: r.y })));
  const blocks = [];
  // The first word of a known banner name starts a new banner, unless the text so far is part of
  // that name (e.g. '평소 / 정치에 / 관심이' on the line after '본인·배우자 / 명의 집')
  const known = KNOWN_BANNERS.map((k) => k.replace(/\s/g, ''));
  const startsKnown = (s) => KNOWN_BANNERS.some((k) => k.split(/\s+/)[0] === s && /\s/.test(k));
  const prefixOfKnown = (s) => known.some((k) => k.startsWith(s.replace(/\s/g, '')) && k !== s.replace(/\s/g, ''));
  for (const f of frags) {
    const b = blocks[blocks.length - 1];
    const forceNew = b && startsKnown(f.s) && !prefixOfKnown(b.text);
    if (b && !forceNew && f.y - b.y1 <= 1.7 * pitch && !/별$/.test(b.text) && f.y !== b.y1) { b.text += ' ' + f.s; b.y1 = f.y; b.parts.push(f); }
    else if (b && f.y === b.y1) { b.text += ' ' + f.s; b.parts.push(f); }
    else blocks.push({ text: f.s, y0: f.y, y1: f.y, parts: [f] });
  }

  // ---- data rows -> sections -> banner for each row ----
  const recs = dataRows.filter((r) => r.groupWords.length);

  // Split two special banners (names not ending in '별') that were joined: if banner text
  // continues below the row where the group sample sizes add up to the total, start a new banner there
  const nCol0 = cols.slice(0, posIdx).find((c) => totalByCol.has(c) && !/%/.test(totalByCol.get(c)));
  const totalN = nCol0 ? toNum(totalByCol.get(nCol0)) : null;
  const rowN = (r) => { const w = r.values.find((v) => colOf(v) === nCol0); return w ? toNum(w.s) : null; };
  if (totalN) {
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (/별$/.test(b.text) || b.parts.length < 2) continue;
      const nextY = blocks[bi + 1]?.y0 ?? Infinity;
      const rows = recs.filter((r) => r.y >= b.y0 - 0.6 * pitch && r.y < nextY - 0.6 * pitch);
      let cum = 0;
      for (let i = 0; i < rows.length - 1; i++) {
        cum += rowN(rows[i]) ?? NaN;
        if (!(Math.abs(cum - totalN) <= Math.max(3, totalN * 0.015))) continue;
        const cut = rows[i + 1].y - 0.6 * pitch;
        const A = b.parts.filter((f) => f.y < cut), B = b.parts.filter((f) => f.y >= cut);
        if (!A.length || !B.length) break;
        const mk = (ps) => ({ text: ps.map((f) => f.s).join(' '), y0: ps[0].y, y1: ps[ps.length - 1].y, parts: ps });
        blocks.splice(bi, 1, mk(A), mk(B));
        break;
      }
    }
  }
  for (const b of blocks) b.text = b.text.replace(/\s*\/\s*/g, '/').replace(/^(\S+\/)\s+/, '$1');
  // Split into sections at large gaps (2012 layout: banner centred beside its groups)
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
      // A section with a single banner (including centred ones) belongs entirely to it
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

  // ---- build records ----
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
      // If the 'no opinion' cell is empty but the detail cells are not, use their sum
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

  // Check that each banner's group sample sizes add up to the total
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

// ---------- 4. period, president, issue number ----------

// Start of each term with job approval surveys. The survey date decides the president.
// Add a line when a new president takes office; after the list ends, the name read from the report is used.
export const PRESIDENTS = [
  ['이명박', '2008-02-25'],
  ['박근혜', '2013-02-25'],
  ['문재인', '2017-05-10'],
  ['윤석열', '2022-05-10'],
  ['이재명', '2025-06-04'],
];
const NEXT_ELECTION = '2030-06-03'; // after this date the president may not be in the list

// First day of a survey (weekly: the dates in the label; monthly: the first week included)
export function surveyStart(t) {
  const pad = (n) => String(n).padStart(2, '0');
  const m1 = t.label?.match(/\((\d{1,2})\/(\d{1,2})\s*~/);
  const m2 = t.label?.match(/\((\d{1,2})\s*~\s*\d{1,2}일?\)/);
  if (t.type === 'weekly' && m1) return `${t.year - (+m1[1] === 12 && t.month === 1 ? 1 : 0)}-${pad(+m1[1])}-${pad(+m1[2])}`;
  if (t.type === 'weekly' && m2) return `${t.year}-${pad(t.month)}-${pad(+m2[1])}`;
  if (t.type === 'weekly') return `${t.year}-${pad(t.month)}-${pad(Math.min(28, 1 + (t.week - 1) * 7))}`;
  const w = +(t.label?.match(/\((\d)/)?.[1] || 1);
  return `${t.year}-${pad(t.month)}-${pad(Math.min(28, 1 + (w - 1) * 7))}`;
}
export function presidentOn(t, parsedName = null) {
  const d = surveyStart(t);
  if (d >= NEXT_ELECTION && parsedName) return parsedName;
  let who = null;
  for (const [name, start] of PRESIDENTS) if (d >= start) who = name;
  return who;
}

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
  // Dates without a week number (e.g. '2012년 12월 10~12일')
  if ((m = h.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*~\s*(\d{1,2})\s*일/))) {
    const week = Math.ceil(+m[3] / 7);
    return { type: 'weekly', year: +m[1], month: +m[2], week, label: `${m[1]}년 ${+m[2]}월 ${week}주 (${+m[3]}~${+m[4]}일)` };
  }
  return null;
}

export const periodKey = (p) =>
  p.type === 'weekly'
    ? `${p.year}-${String(p.month).padStart(2, '0')}-W${p.week}`
    : `${p.year}-${String(p.month).padStart(2, '0')}-M`;

// ---------- 5. whole document ----------

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
      // Presidential job approval tables only (skip president-elect, National Assembly, party tables)
      if (!(/대통령/.test(head) && /직무/.test(head)) || /당선인|권한대행/.test(head)) {
        continue;
      }
      const period = parsePeriod(head, pageText);
      if (!period) { result.skipped.push({ page: p, reason: '조사 기간을 읽지 못함', head: head.slice(0, 120) }); continue; }
      const pres = (pageText.match(/귀하는\s*(?:요즘\s*)?([가-힣]{2,4})\s*대통령이/) || head.match(/([가-힣]{2,4})\s*대통령\s*직무/) || [])[1] || null;
      const srcIssue = (pageText.match(/제\s*(\d+)\s*호/) || [])[1];
      result.tables.push({
        key: periodKey(period),
        ...period,
        president: presidentOn(period, pres && pres !== '대통령' ? pres : null),
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
  // Year and month of the report (known even when it has no approval table)
  const rp = firstText.match(/제\s*\d+\s*호\s*\(?\s*(\d{4})\s*년\s*(\d{1,2})\s*월/) || firstText.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*\d\s*주/);
  result.reportMonth = rp ? `${rp[1]}-${String(rp[2]).padStart(2, '0')}` : null;
  // Collect '1,001명 … 표본오차 ±3.1%포인트' from the cover by sample size and attach the margin
  // of error to the table with the same total sample size
  const moeByN = {};
  for (const m of firstText.matchAll(/(\d{1,2},?\d{3})\s*명[^±]{0,60}?표본\s*오차[^±]{0,10}±\s*(\d+(?:\.\d+)?)\s*%/g)) moeByN[+m[1].replace(',', '')] ??= +m[2];
  for (const t of result.tables) {
    const n = t.rows.find((r) => r.banner === '전체')?.n;
    if (n != null && moeByN[n] != null) t.moe = moeByN[n];
  }
  // Keep only the first table for each period
  const seen = new Set();
  result.tables = result.tables.filter((t) => (seen.has(t.key) ? false : seen.add(t.key)));
  return result;
}
