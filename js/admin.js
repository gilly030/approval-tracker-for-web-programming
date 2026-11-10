// 관리자 페이지: 브라우저 안에서 PDF를 파싱해 data.json에 반영한다. 서버 필요 없음.
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
import { parseGallupPdf } from './parser.js';
import { mergeInto } from './merge.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';
pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'build/pdf.worker.min.mjs';
const PDF_OPTS = { cMapUrl: PDFJS + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS + 'standard_fonts/' };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let db = { updated: null, surveys: [] };
let parsedFiles = []; // { name, res }
let outJson = null;

async function loadDb() {
  try {
    const r = await fetch('data/data.json', { cache: 'no-cache' });
    if (r.ok) db = await r.json();
  } catch { /* 새로 시작 */ }
  showDb();
}
function showDb() {
  const w = db.surveys.filter((s) => s.type === 'weekly').length;
  const m = db.surveys.length - w;
  const last = [...db.surveys].sort((a, b) => a.key.localeCompare(b.key)).pop();
  $('#db-status').textContent = db.surveys.length
    ? `주간 ${w}건 · 월간 통합 ${m}건 · 가장 최근 ${last.label}`
    : '아직 데이터가 없어요. PDF를 올리면 새로 만듭니다.';
}
$('#db-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { db = JSON.parse(await f.text()); showDb(); renderResults(); }
  catch (err) { $('#db-status').textContent = `JSON을 읽지 못했어요: ${err.message}`; }
});

// ---------- PDF 파싱 ----------
async function handleFiles(files) {
  const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!pdfs.length) return;
  for (const [i, f] of pdfs.entries()) {
    $('#parse-status').textContent = `읽는 중 ${i + 1}/${pdfs.length}: ${f.name}`;
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      const res = await parseGallupPdf(pdfjsLib, data, PDF_OPTS);
      parsedFiles.push({ name: f.name, res });
    } catch (err) {
      parsedFiles.push({ name: f.name, error: err.message });
    }
  }
  $('#parse-status').textContent = `${parsedFiles.length}개 파일을 읽었어요.`;
  renderResults();
}

function statusOf(t, issue) {
  const ex = db.surveys.find((s) => s.key === t.key);
  if (!ex) return { cls: 'ok', text: '새 조사' };
  if (t.type === 'monthly' && (issue ?? 0) > (ex.fromIssue ?? ex.issue ?? 0)) return { cls: 'warn', text: `기존 자료 교체 (제${ex.fromIssue ?? ex.issue}호 → 제${issue}호)` };
  return { cls: '', text: '이미 있음 · 건너뜀' };
}

function renderResults() {
  const out = [];
  parsedFiles.forEach((pf, fi) => {
    if (pf.error) { out.push(`<div class="tcard"><header><b>${esc(pf.name)}</b><span class="tag err">읽기 실패</span></header><div class="status">${esc(pf.error)}</div></div>`); return; }
    const { res } = pf;
    if (!res.tables.length) {
      out.push(`<div class="tcard"><header><b>${esc(pf.name)}</b><span class="tag err">대통령 직무 평가 표 없음</span></header>${res.skipped.length ? `<ul class="warns">${res.skipped.map((s) => `<li>${s.page}쪽: ${esc(s.reason)}</li>`).join('')}</ul>` : '<div class="status">이 PDF에서 응답자 특성별 직무 평가 표를 찾지 못했어요.</div>'}</div>`);
      return;
    }
    res.tables.forEach((t, ti) => {
      const st = statusOf(t, res.issue);
      const tot = t.rows.find((r) => r.banner === '전체');
      const banners = [...new Set(t.rows.map((r) => r.banner))].filter((b) => b !== '전체');
      const hardWarn = t.warnings.filter((w) => !/사례수 합/.test(w));
      const softWarn = t.warnings.filter((w) => /사례수 합/.test(w));
      const checked = st.cls !== '' && (st.cls === 'ok' || st.cls === 'warn');
      const id = `pick-${fi}-${ti}`;
      out.push(`<div class="tcard">
        <header>
          <label for="${id}"><input type="checkbox" id="${id}" data-f="${fi}" data-t="${ti}"${checked ? ' checked' : ''}> ${esc(t.label)}</label>
          <span class="tag">${esc(t.president ?? '대통령 미상')}</span>
          <span class="tag ${st.cls}">${esc(st.text)}</span>
          ${hardWarn.length ? `<span class="tag warn">확인 필요 ${hardWarn.length}</span>` : '<span class="tag ok">검증 통과</span>'}
        </header>
        <div class="status">제${res.issue ?? '?'}호 ${t.page}쪽 · 전체 <span class="num">${tot.n?.toLocaleString('ko-KR')}</span>명 · 잘하고 있다 <b class="num">${tot.pos}%</b> · 잘못하고 있다 <b class="num">${tot.neg}%</b> · 의견유보 <span class="num">${tot.rest}%</span></div>
        <div class="status">배너 ${banners.length}개: ${banners.map((b) => (t.unknownBanners.includes(b) ? `<b title="normalize.js에 없는 새 배너 이름">${esc(b)} (새 이름)</b>` : esc(b))).join(' · ')}</div>
        <div class="status">열: ${esc([...t.columns.n, ...t.columns.main, ...t.columns.detail].join(' / '))}</div>
        ${hardWarn.length ? `<ul class="warns">${hardWarn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${softWarn.length ? `<details><summary class="hint">참고 ${softWarn.length}건 (사례수 합계)</summary><ul class="warns">${softWarn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
      </div>`);
    });
  });
  $('#results').innerHTML = out.join('');
  $('#apply').disabled = !parsedFiles.some((p) => p.res?.tables.length);
}

// ---------- 반영 ----------
$('#apply').addEventListener('click', () => {
  let next = db, added = [], replaced = [], kept = [];
  parsedFiles.forEach((pf, fi) => {
    if (!pf.res) return;
    const tables = pf.res.tables.filter((_, ti) => document.getElementById(`pick-${fi}-${ti}`)?.checked);
    if (!tables.length) return;
    const r = mergeInto(next, { ...pf.res, tables }, pf.name);
    next = r.db; added.push(...r.added); replaced.push(...r.replaced); kept.push(...r.kept);
  });
  db = next;
  outJson = JSON.stringify(db);
  $('#apply-status').textContent = `추가 ${added.length} · 교체 ${replaced.length} · 건너뜀 ${kept.length} → 전체 ${db.surveys.length}건`;
  $('#download').disabled = false; $('#copy').disabled = false;
  showDb(); renderResults();
});
$('#download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([outJson], { type: 'application/json' }));
  a.download = 'data.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(outJson); $('#apply-status').textContent = '복사했어요.'; }
  catch { $('#apply-status').textContent = '복사가 막혀 있어요. 내려받기를 써 주세요.'; }
});

// ---------- 끌어다 놓기 ----------
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
$('#pdf-file').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });

loadDb();
