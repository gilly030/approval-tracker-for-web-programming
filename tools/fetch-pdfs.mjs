// Debugging aid: download the PDFs of the given Gallup post numbers into pdfs/
// (the Actions workflow uploads them as an artifact).
// Usage: node tools/fetch-pdfs.mjs 343 345 ...
import fs from 'node:fs';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; approval-tracker/1.0)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('pdfs', { recursive: true });
for (const seq of process.argv.slice(2)) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`https://www.gallup.co.kr/gallupdb/fileDownload.asp?seqNo=${seq}&bType=8`, { headers: UA, signal: AbortSignal.timeout(60000) });
      const b = new Uint8Array(await r.arrayBuffer());
      if (String.fromCharCode(...b.slice(0, 4)) === '%PDF') { fs.writeFileSync(`pdfs/${seq}.pdf`, b); console.log(seq, 'ok', b.length); break; }
      console.log(seq, 'PDF 아님', r.status);
      break;
    } catch (e) { console.log(seq, '실패', e.cause?.code || e.message); await sleep(10000 * (i + 1)); }
  }
  await sleep(4000);
}
