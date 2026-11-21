// Merge parser output into the data.json structure.
// data.json = { updated, surveys: [ { key, type, year, month, week, label, president, issue, source, columns, rows:[...] } ] }
// When a key (period) already exists: weekly surveys are kept as they are; monthly combined tables
// are replaced by the one from the more recent report.

export function mergeInto(db, parsed, sourceName) {
  const surveys = [...(db.surveys || [])];
  const added = [], replaced = [], kept = [];
  for (const t of parsed.tables) {
    const rec = {
      key: t.key, type: t.type, year: t.year, month: t.month, week: t.week,
      label: t.label, president: t.president,
      issue: parsed.issue ?? t.sourceIssue, source: sourceName,
      ...(t.moe != null ? { moe: t.moe } : {}),
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
