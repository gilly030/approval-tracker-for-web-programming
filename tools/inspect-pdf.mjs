// 점검용: 갤럽 게시물 번호의 PDF를 받아, 대통령 직무 평가가 있는 쪽의 글자 배치를 출력한다.
// 사용법: node tools/inspect-pdf.mjs <게시물 번호> [쪽 번호...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseGallupPdf } from '../js/parser.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = path.join(root, 'node_modules', 'pdfjs-dist');
const OPTS = { cMapUrl: P + '/cmaps/', cMapPacked: true, standardFontDataUrl: P + '/standard_fonts/', verbosity: 0 };
const [seq, ...pages] = process.argv.slice(2);
const res = await fetch(`https://www.gallup.co.kr/gallupdb/fileDownload.asp?seqNo=${seq}&bType=8`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; approval-tracker/1.0)' } });
const data = new Uint8Array(await res.arrayBuffer());
if (String.fromCharCode(...data.slice(0, 4)) !== '%PDF') {
  // PDF가 아니면 응답 정보와 게시물 본문 페이지의 링크를 보여준다
  console.log(`게시물 ${seq}: PDF 아님 · HTTP ${res.status} · ${res.headers.get('content-type')} · ${data.length}바이트 · 최종 주소 ${res.url}`);
  console.log(new TextDecoder('utf-8').decode(data.slice(0, 600)).replace(/\s+/g, ' '));
  for (const u of [`https://www.gallup.co.kr/gallupdb/reportContent.asp?seqNo=${seq}`]) {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; approval-tracker/1.0)' } });
    const html = await r.text();
    const title = (html.match(/<title>([^<]*)/i) || [])[1];
    console.log(`\n${u} → HTTP ${r.status}, 제목: ${title}`);
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const i = text.search(/데일리|제\s*\d+\s*호/);
    console.log('본문 일부:', text.slice(Math.max(0, i - 100), i + 300));
    console.log('링크:', [...html.matchAll(/href=["']([^"']*(?:download|fileDown|\.pdf)[^"']*)["']/gi)].map((m) => m[1]).slice(0, 10));
  }
  process.exit(0);
}
const parsed = await parseGallupPdf(pdfjs, data.slice(), OPTS);
console.log(`게시물 ${seq}: 제${parsed.issue}호 ${parsed.reportMonth} · ${parsed.pages}쪽 · 표 ${parsed.tables.length}개 · 건너뜀 ${JSON.stringify(parsed.skipped)}`);
const doc = await pdfjs.getDocument({ data, ...OPTS }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const H = page.getViewport({ scale: 1 }).height;
  const items = (await page.getTextContent()).items.filter((i) => i.str.trim());
  const text = items.map((i) => i.str).join(' ');
  const want = pages.length ? pages.includes(String(p)) : /직무/.test(text) && /잘하고/.test(text) && /전체/.test(text);
  if (!want) continue;
  console.log(`\n===== ${p}쪽 =====`);
  const rows = [];
  for (const it of items) {
    const y = Math.round(H - it.transform[5]);
    let r = rows.find((q) => Math.abs(q.y - y) <= 2);
    if (!r) rows.push((r = { y, w: [] }));
    r.w.push(`${it.str.trim()}@${Math.round(it.transform[4])}`);
  }
  rows.sort((a, b) => a.y - b.y).slice(0, 70).forEach((r) => console.log(String(r.y).padStart(4), '|', r.w.join('  ')));
}
