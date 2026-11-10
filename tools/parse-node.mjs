// Node에서 PDF를 파싱해 결과를 출력/병합한다.
// 사용법: node tools/parse-node.mjs <pdf...> [--merge data/data.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseGallupPdf } from '../js/parser.js';
import { mergeInto } from '../js/merge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pdfRoot = path.join(here, '..', 'node_modules', 'pdfjs-dist');
const args = process.argv.slice(2);
const mi = args.indexOf('--merge');
const mergePath = mi >= 0 ? args.splice(mi, 2)[1] : null;
const verbose = args.includes('-v') ? (args.splice(args.indexOf('-v'), 1), true) : false;

let db = mergePath && fs.existsSync(mergePath) ? JSON.parse(fs.readFileSync(mergePath, 'utf8')) : { surveys: [] };

for (const f of args) {
  const data = new Uint8Array(fs.readFileSync(f));
  const res = await parseGallupPdf(pdfjs, data, {
    cMapUrl: pdfRoot + '/cmaps/', cMapPacked: true,
    standardFontDataUrl: pdfRoot + '/standard_fonts/', verbosity: 0,
  });
  console.log(`\n## ${path.basename(f)}  (제${res.issue ?? '?'}호, ${res.pages}쪽) → 표 ${res.tables.length}개`);
  for (const t of res.tables) {
    const tot = t.rows.find((r) => r.banner === '전체');
    const banners = [...new Set(t.rows.map((r) => r.banner))].filter((b) => b !== '전체');
    console.log(`  [p${t.page}] ${t.key} ${t.label} | ${t.president ?? '?'} | 전체 n=${tot?.n} 긍정 ${tot?.pos} 부정 ${tot?.neg} 기타 ${tot?.rest} | 행 ${t.rows.length}`);
    console.log(`     열: n=[${t.columns.n.join(', ')}] main=[${t.columns.main.join(', ')}] detail=[${t.columns.detail.join(', ')}]`);
    console.log(`     배너: ${banners.map((b) => `${b}(${t.rows.filter((r) => r.banner === b).length})`).join(' / ')}`);
    if (t.unknownBanners.length) console.log(`     새 배너명: ${t.unknownBanners.join(', ')}`);
    for (const w of t.warnings) console.log(`     ⚠ ${w}`);
    if (verbose) for (const r of t.rows) console.log(`       ${r.banner} | ${r.group}${r.group !== r.groupRaw ? ` (${r.groupRaw})` : ''} | n=${r.n}${r.nWeighted != null ? '/' + r.nWeighted : ''} | ${r.pos} ${r.neg} ${r.rest}${r.detail ? ' ' + JSON.stringify(r.detail) : ''}`);
  }
  for (const s of res.skipped) console.log(`  (건너뜀 p${s.page}: ${s.reason}${s.head ? ' :: ' + s.head : ''})`);
  if (mergePath) db = mergeInto(db, res, path.basename(f)).db;
}

if (mergePath) {
  fs.mkdirSync(path.dirname(mergePath), { recursive: true });
  fs.writeFileSync(mergePath, JSON.stringify(db, null, 1));
  console.log(`\n→ ${mergePath}: 조사 ${db.surveys.length}건`);
}
