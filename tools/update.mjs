// 갤럽 리포트 자동 반영 (GitHub Actions에서 매일 실행).
//
// 1) 리포트 게시판 첫 페이지에서 가장 큰 게시물 번호(seqNo)를 찾는다.
// 2) data/state.json 의 lastSeq 보다 큰 번호의 PDF를 받아 파싱해 data/data.json 에 반영한다.
// 3) state.backfill 이 남아 있으면 과거 번호로 내려가며 한 번에 최대 BACKFILL_PER_RUN 개씩 채운다.
//    (취임 이후 리포트를 모두 채우면 done 으로 바뀌고 더 이상 내려가지 않는다)
//
// 사용법: node tools/update.mjs [--dry-run] [--max N]
// 브라우저가 아니라 서버(Actions)에서 실행되므로 CORS 제한이 없다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseGallupPdf } from '../js/parser.js';
import { mergeInto } from '../js/merge.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(root, 'data', 'data.json');
const STATE = path.join(root, 'data', 'state.json');
const LIST_URL = 'https://www.gallup.co.kr/gallupdb/report.asp';
const PDF_URL = (seq) => `https://www.gallup.co.kr/gallupdb/fileDownload.asp?seqNo=${seq}&bType=8`;
const UA = 'Mozilla/5.0 (compatible; approval-tracker/1.0; +https://github.com/gilly030/approval-tracker-for-web-programming)';
const PDFJS = path.join(root, 'node_modules', 'pdfjs-dist');
const PDF_OPTS = { cMapUrl: PDFJS + '/cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS + '/standard_fonts/', verbosity: 0 };

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const BACKFILL_PER_RUN = Number(args[args.indexOf('--max') + 1]) || 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
let db = readJson(DATA, { surveys: [] });
const state = readJson(STATE, { lastSeq: 0, processed: {}, backfill: null });
state.processed ??= {};

// ---------- 게시판 ----------
export function latestSeqFromHtml(html) {
  const seqs = [...html.matchAll(/seqNo=(\d+)/gi)].map((m) => +m[1]);
  return seqs.length ? Math.max(...seqs) : null;
}
export function titlesFromHtml(html) {
  // 제목 텍스트 옆에 다운로드 링크가 있는 구조. 번호별 제목을 느슨하게 잡아 로그용으로만 쓴다.
  const out = {};
  for (const m of html.matchAll(/(데일리 오피니언 제\s*(\d+)\s*호[^<]{0,80})[\s\S]{0,1500}?seqNo=(\d+)/g)) out[+m[3]] ??= m[1].trim();
  return out;
}

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' }, redirect: 'follow' });
      if (res.status === 404) return { status: 404 };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
    } catch (err) {
      if (i === tries) throw err;
      await sleep(2000 * i);
    }
  }
}

// ---------- 리포트 하나 처리 ----------
async function processSeq(seq, since = null) {
  if (state.processed[seq]) return state.processed[seq];
  const r = await get(PDF_URL(seq));
  if (r.status === 404 || !r.buf || r.buf.length < 1000 || r.buf.subarray(0, 4).toString() !== '%PDF') {
    return (state.processed[seq] = { kind: 'none' });
  }
  const res = await parseGallupPdf(pdfjs, new Uint8Array(r.buf), PDF_OPTS);
  // 과거 채우기 중에는 기준 월 이전 표는 넣지 않는다
  if (since) res.tables = res.tables.filter((t) => t.key.slice(0, 7) >= since);
  const info = {
    kind: res.issue ? 'daily' : 'other',
    issue: res.issue,
    month: res.reportMonth,
    tables: res.tables.map((t) => t.key),
    warnings: res.tables.reduce((a, t) => a + t.warnings.filter((w) => !/사례수 합/.test(w)).length, 0),
    skipped: res.skipped.length ? res.skipped : undefined,
  };
  if (res.tables.length) {
    const m = mergeInto(db, res, `seq${seq}`);
    db = m.db;
    info.added = m.added; info.replaced = m.replaced;
  }
  state.processed[seq] = info;
  return info;
}

// ---------- 실행 ----------
const listRes = await get(LIST_URL);
const html = listRes.buf.toString('utf8');
const latest = latestSeqFromHtml(html);
if (!latest) { console.error('게시판에서 게시물 번호를 찾지 못했어요. 페이지 구조가 바뀌었을 수 있어요.'); process.exit(1); }
const titles = titlesFromHtml(html);
log(`게시판 최신 번호: ${latest} (저장된 마지막 번호: ${state.lastSeq})`);

let changed = false;

// 1) 새 리포트
const start = state.lastSeq ? state.lastSeq + 1 : latest;
for (let seq = start; seq <= latest; seq++) {
  const info = await processSeq(seq);
  log(`  새 번호 ${seq} ${titles[seq] ?? ''} → ${info.kind}${info.tables?.length ? ` [${info.tables.join(', ')}]` : ''}${info.added?.length ? ` 추가 ${info.added.length}` : ''}${info.warnings ? ` ⚠${info.warnings}` : ''}`);
  if (info.added?.length || info.replaced?.length) changed = true;
  await sleep(1500);
}
if (latest > state.lastSeq) { state.lastSeq = latest; changed = true; }

// 2) 과거 채우기
const bf = state.backfill;
if (bf && !bf.done) {
  let seq = bf.next ?? (Math.min(latest, ...Object.keys(state.processed).map(Number)) - 1);
  let count = 0;
  log(`과거 채우기: ${bf.since} 이후 리포트, ${seq}번부터 최대 ${BACKFILL_PER_RUN}개`);
  while (count < BACKFILL_PER_RUN && seq > 0) {
    const info = await processSeq(seq, bf.since);
    count++;
    log(`  과거 번호 ${seq} → ${info.kind}${info.issue ? ` 제${info.issue}호 ${info.month ?? ''}` : ''}${info.tables?.length ? ` [${info.tables.join(', ')}]` : ''}`);
    if (info.added?.length || info.replaced?.length) changed = true;
    // 대통령 평가 표가 없는 번호가 오래 이어지면(데일리 오피니언 이전 시기) 끝낸다
    bf.misses = info.tables?.length ? 0 : (bf.misses || 0) + 1;
    if (bf.misses >= 80) { bf.done = true; log('  평가 표가 있는 리포트가 더 나오지 않아 과거 채우기를 마쳤어요.'); break; }
    if (info.kind === 'daily' && info.month && info.month < bf.since) {
      bf.olderSeen = (bf.olderSeen || 0) + 1;
      if (bf.olderSeen >= 2) { bf.done = true; log(`  ${bf.since} 이전 리포트에 도달해 과거 채우기를 마쳤어요.`); break; }
    }
    seq--;
    await sleep(1500);
  }
  bf.next = seq;
  changed = true;
}

if (DRY) { log('(dry-run: 파일을 쓰지 않음)'); process.exit(0); }
if (changed) db.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(DATA, JSON.stringify(db));
fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
log(`완료: 조사 ${db.surveys.length}건`);
