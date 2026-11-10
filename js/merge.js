// 파싱 결과를 data.json 구조에 병합한다.
// data.json = { updated, surveys: [ { key, type, year, month, week, label, president, issue, source, columns, rows:[...] } ] }
// 같은 key(기간)가 이미 있으면: 주간은 교체하지 않고 유지, 월간 통합은 더 최근 호수에서 온 것으로 교체.

export function mergeInto(db, parsed, sourceName) {
  const surveys = [...(db.surveys || [])];
  const added = [], replaced = [], kept = [];
  for (const t of parsed.tables) {
    const rec = {
      key: t.key, type: t.type, year: t.year, month: t.month, week: t.week,
      label: t.label, president: t.president,
      issue: parsed.issue ?? t.sourceIssue, source: sourceName,
      columns: t.columns,
      rows: t.rows.map(({ bannerRaw, groupRaw, ...r }) => (r.group !== groupRaw || r.banner !== bannerRaw ? { ...r, raw: `${bannerRaw}|${groupRaw}` } : r)),
    };
    const i = surveys.findIndex((s) => s.key === rec.key);
    if (i < 0) { surveys.push(rec); added.push(rec.key); }
    else if ((parsed.issue ?? 0) > (surveys[i].fromIssue ?? surveys[i].issue ?? 0) && rec.type === 'monthly') {
      surveys[i] = { ...rec, fromIssue: parsed.issue }; replaced.push(rec.key);
    } else kept.push(rec.key);
  }
  surveys.sort((a, b) => a.key.localeCompare(b.key));
  return { db: { updated: new Date().toISOString().slice(0, 10), surveys }, added, replaced, kept };
}
