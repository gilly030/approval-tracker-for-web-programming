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
