// Split data/data.json (the full database) into the small files the site loads:
//   data/index.json      totals and banner list of every survey (main chart and survey table; small)
//   data/years/YYYY.json all group results for that year (loaded only when a week is shown)
// Usage: node tools/build-data.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { presidentOn } from '../js/parser.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildData(dir = path.join(root, 'data')) {
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  const state = fs.existsSync(path.join(dir, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) : null;
  // Set the president from the survey date (in case the name read from the report text is wrong)
  let fixed = 0;
  for (const sv of db.surveys) {
    const p = presidentOn(sv, sv.president);
    if (p !== sv.president) { sv.president = p; fixed++; }
  }
  if (fixed) fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(db));
  const surveys = [...db.surveys].sort((a, b) => a.key.localeCompare(b.key));
  const index = {
    updated: db.updated,
    backfill: state?.backfill ? { since: state.backfill.since, done: !!state.backfill.done } : null,
    surveys: surveys.map((s) => {
      const t = s.rows.find((r) => r.banner === '전체') || {};
      return {
        key: s.key, type: s.type, year: s.year, month: s.month, week: s.week,
        label: s.label, president: s.president, issue: s.issue,
        n: t.n ?? null, moe: s.moe ?? null, pos: t.pos ?? null, neg: t.neg ?? null, rest: t.rest ?? null,
        banners: [...new Set(s.rows.map((r) => r.banner))].filter((b) => b !== '전체'),
      };
    }),
  };
  const ydir = path.join(dir, 'years');
  fs.mkdirSync(ydir, { recursive: true });
  const years = {};
  for (const s of surveys) (years[s.year] ??= []).push(s);
  const keep = new Set();
  for (const [y, list] of Object.entries(years)) {
    const f = path.join(ydir, `${y}.json`);
    keep.add(`${y}.json`);
    const text = JSON.stringify({ year: +y, surveys: list });
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== text) fs.writeFileSync(f, text);
  }
  for (const f of fs.readdirSync(ydir)) if (!keep.has(f)) fs.unlinkSync(path.join(ydir, f));
  index.years = Object.keys(years).map(Number).sort();
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
  return { surveys: surveys.length, years: index.years.length, fixed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = buildData();
  console.log(`index.json: 조사 ${r.surveys}건 · 연도 파일 ${r.years}개 · 대통령 이름 바로잡음 ${r.fixed}건`);
}
