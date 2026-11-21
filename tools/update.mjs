// Automatic update from Gallup Korea reports (run by GitHub Actions every 3 hours).
//
// 1) Find the highest post number (seqNo) on the first page of the report board.
// 2) Download and parse every PDF newer than state.lastSeq and merge it into data/data.json.
// 3) While state.backfill is not done, walk back through older posts, up to BACKFILL_PER_RUN per run
//    (it is marked done once every report back to the start date has been read).
//
// Usage: node tools/update.mjs [--dry-run] [--max N]
// Runs on a server (Actions), not in the browser, so there are no CORS limits.

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
const BACKFILL_PER_RUN = Number(args[args.indexOf('--max') + 1]) || 50;
const PAUSE = 6000; // wait between requests so as not to load Gallup's server
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
let db = readJson(DATA, { surveys: [] });
const state = readJson(STATE, { lastSeq: 0, processed: {}, backfill: null });
state.processed ??= {};

// ---------- report board ----------
export function latestSeqFromHtml(html) {
  const seqs = [...html.matchAll(/seqNo=(\d+)/gi)].map((m) => +m[1]);
  return seqs.length ? Math.max(...seqs) : null;
}
export function titlesFromHtml(html) {
  // Each title sits next to its download link. Titles are matched loosely and used only for the log.
  const out = {};
  for (const m of html.matchAll(/(데일리 오피니언 제\s*(\d+)\s*호[^<]{0,80})[\s\S]{0,1500}?seqNo=(\d+)/g)) out[+m[3]] ??= m[1].trim();
  return out;
}

// Gallup's server sometimes does not answer: retry up to 5 times with growing waits
async function get(url, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (res.status === 404) return { status: 404 };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
    } catch (err) {
      if (i === tries) throw err;
      log(`  (접속 실패 ${i}/${tries}: ${err.cause?.code || err.message}, ${5 * 2 ** (i - 1)}초 뒤 다시 시도)`);
      await sleep(5000 * 2 ** (i - 1));
    }
  }
}

// ---------- process one report ----------
async function processSeq(seq, since = null, force = false) {
  if (state.processed[seq]) return state.processed[seq];
  const isPdf = (x) => x && x.status !== 404 && x.buf && x.buf.length >= 1000 && x.buf.subarray(0, 4).toString() === '%PDF';
  let r = await get(PDF_URL(seq));
  if (!isPdf(r)) {
    // For some posts the download URL returns an error page; use the direct PDF link from the post instead
    const page = await get(`https://www.gallup.co.kr/gallupdb/reportContent.asp?seqNo=${seq}`);
    const html = page.buf ? new TextDecoder('euc-kr').decode(page.buf) : '';
    const link = (html.match(/href=["']([^"']+\.pdf)["']/i) || [])[1];
    if (link) {
      await sleep(PAUSE / 2);
      r = await get(new URL(link, 'https://www.gallup.co.kr/gallupdb/').href);
      if (isPdf(r)) log(`    (게시물 본문 링크로 받음: ${link.split('/').pop()})`);
    }
  }
  if (!isPdf(r)) return (state.processed[seq] = { kind: 'none' });
  const res = await parseGallupPdf(pdfjs, new Uint8Array(r.buf), PDF_OPTS);
  // During backfill, skip tables from before the start month
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
    // Reprocessing: remove the existing data for these periods and add the new tables
    if (force) { const keys = new Set(res.tables.map((t) => t.key)); db.surveys = db.surveys.filter((s) => !keys.has(s.key)); }
    const m = mergeInto(db, res, `seq${seq}`);
    db = m.db;
    info.added = m.added; info.replaced = m.replaced;
  }
  state.processed[seq] = info;
  return info;
}

// ---------- run ----------
// If the connection drops part-way, everything read so far is still saved.
let changed = false;
let structureError = false;
async function run() {
  const listRes = await get(LIST_URL);
  const html = listRes.buf.toString('utf8');
  const latest = latestSeqFromHtml(html);
  if (!latest) { structureError = true; throw new Error('게시판에서 게시물 번호를 찾지 못했어요. 페이지 구조가 바뀌었을 수 있어요.'); }
  const titles = titlesFromHtml(html);
  log(`게시판 최신 번호: ${latest} (저장된 마지막 번호: ${state.lastSeq})`);


  // 0) Reprocess list: re-read given posts after a parser fix (state.reprocess = [seq, ...]).
  // Up to BACKFILL_PER_RUN per run; each is removed when done, so an interrupted run resumes where it stopped
  for (const seq of [...(state.reprocess || [])].slice(0, BACKFILL_PER_RUN)) {
    const src = `seq${seq}`;
    delete state.processed[seq];
    db.surveys = db.surveys.filter((s) => s.source !== src); // if no table is found this time, drop the old result too
    const info = await processSeq(seq, null, true);
    const banners = (db.surveys.find((s) => s.source === src && s.type === 'weekly')?.rows || []).map((r) => r.banner);
    log(`  재처리 ${seq} → ${info.kind} [${(info.tables || []).join(', ')}] 배너: ${[...new Set(banners)].join(' / ')}`);
    state.reprocess = state.reprocess.filter((q) => q !== seq);
    changed = true;
    await sleep(PAUSE);
  }

  // 1) new reports
  const start = state.lastSeq ? state.lastSeq + 1 : latest;
  for (let seq = start; seq <= latest; seq++) {
    const info = await processSeq(seq);
    log(`  새 번호 ${seq} ${titles[seq] ?? ''} → ${info.kind}${info.tables?.length ? ` [${info.tables.join(', ')}]` : ''}${info.added?.length ? ` 추가 ${info.added.length}` : ''}${info.warnings ? ` ⚠${info.warnings}` : ''}`);
    if (info.added?.length || info.replaced?.length) changed = true;
    await sleep(PAUSE);
  }
  if (latest > state.lastSeq) { state.lastSeq = latest; changed = true; }

  // 2) backfill
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
      // Stop after a long run of posts without approval tables (before Daily Opinion began)
      bf.misses = info.tables?.length ? 0 : (bf.misses || 0) + 1;
      if (bf.misses >= 80) { bf.done = true; log('  평가 표가 있는 리포트가 더 나오지 않아 과거 채우기를 마쳤어요.'); break; }
      if (info.kind === 'daily' && info.month && info.month < bf.since) {
        bf.olderSeen = (bf.olderSeen || 0) + 1;
        if (bf.olderSeen >= 2) { bf.done = true; log(`  ${bf.since} 이전 리포트에 도달해 과거 채우기를 마쳤어요.`); break; }
      }
      seq--;
      bf.next = seq;
      changed = true;
      await sleep(PAUSE);
    }
  }
}

let failure = null;
try {
  await run();
  state.failStreak = 0;
} catch (err) {
  failure = err;
  state.failStreak = (state.failStreak || 0) + 1;
  console.log(`::warning::갤럽 사이트 처리 중 멈춤 (연속 ${state.failStreak}회): ${err.cause?.code || err.message}`);
}

if (DRY) { log('(dry-run: 파일을 쓰지 않음)'); process.exit(0); }
if (changed) db.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(DATA, JSON.stringify(db));
fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
log(`완료: 조사 ${db.surveys.length}건${failure ? ' (중간에 멈춤, 받은 만큼 저장)' : ''}`);
// GitHub Actions: if the run succeeded and backfill is not finished, ask for a follow-up run
if (process.env.GITHUB_OUTPUT) {
  const more = !failure && ((state.backfill && !state.backfill.done) || (state.reprocess || []).length > 0);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `chain=${more ? 'true' : 'false'}\n`);
}
// Fail the run (so GitHub emails the owner) if the page layout changed or runs kept failing for
// over a day (8 runs, 3 hours apart)
if (failure && (structureError || state.failStreak >= 8)) process.exit(1);
