// QUIZINOX PDF engines — JavaScript ports of the QUIZ-BOT txt_mixer_engine
// (generic, ForumIAS SFG, Vajiram & Ravi, VisionIAS). Everything runs on-device.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
const squash = s => String(s).replace(/\s{2,}/g, ' ').trim();

/** Read every page as positioned text items. y is measured from the TOP (like PyMuPDF). */
export async function extractPages(file, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const h = Math.abs(it.height || it.transform?.[3] || 10);
      const x = it.transform?.[4] || 0;
      const yBottom = it.transform?.[5] || 0;
      items.push({ text: it.str, x: Math.round(x), y: Math.round(vp.height - yBottom - h), w: Math.round(it.width || 0), h: Math.round(h) });
    }
    pages.push({ items, width: vp.width, height: vp.height, pageNum: p });
    onProgress?.(Math.round((p / pdf.numPages) * 100), `Read page ${p}/${pdf.numPages}`);
    page.cleanup?.();
  }
  await pdf.destroy?.();
  return pages;
}

/** Group items into text lines. */
function toLines(items, tol = 4) {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = []; let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - cur[0].y) <= tol) cur.push(sorted[i]);
    else { rows.push(cur); cur = [sorted[i]]; }
  }
  rows.push(cur);
  const out = [];
  for (const r of rows) {
    r.sort((a, b) => a.x - b.x);
    let text = '';
    r.forEach((t, i) => {
      if (i === 0) { text = t.text; return; }
      const prev = r[i - 1];
      const gap = t.x - (prev.x + prev.w);
      text += (gap > 1.5 || /\s$/.test(text) || /^\s/.test(t.text) ? ' ' : (prev.w ? '' : ' ')) + t.text;
    });
    text = squash(text);
    if (text) out.push({ y: r[0].y, x: Math.min(...r.map(t => t.x)), text });
  }
  return out;
}

function detectColumns(page, split = 0.5, minLines = 5) {
  const mid = page.width * split;
  const left = page.items.filter(i => i.x < mid - 15), right = page.items.filter(i => i.x >= mid - 15);
  const L = toLines(left), R = toLines(right);
  // Two columns only when both sides have substantial content AND few items cross the middle.
  const crossing = page.items.filter(i => i.x < mid - 15 && i.x + i.w > mid + 15).length;
  if (L.length >= minLines && R.length >= minLines && crossing < Math.max(3, page.items.length * 0.04)) return [...L, ...R];
  return toLines(page.items);
}

/* ------------------------------ GENERIC ------------------------------ */
export function genericText(pages) {
  return pages.map(p => detectColumns(p).map(l => l.text).join('\n')).join('\n\n').trim();
}

/* ----------------------------- FORUMIAS SFG ----------------------------- */
function sfgClean(lines) {
  return lines.map(l => l.trim()).filter(l => l && !(
    /^Forum Learning Centre/i.test(l) || /^9311\d{6}/.test(l) || /^\d{10}\s*,\s*\d{10}/.test(l) || /^\[\d+\]$/.test(l) ||
    /^SFG 20\d\d\s*\|\s*Level/i.test(l) || (/^https?:\/\//i.test(l) && l.length < 120) || /^admissions@forumias/i.test(l) ||
    /^helpdesk@forumias/i.test(l) || /^\d{4,5}\s*,\s*\d{4,5}/.test(l) || /^Page\s+\d+(\s+of\s+\d+)?$/i.test(l)));
}
export function sfgFormat(rawText) {
  const lines = sfgClean(rawText.split('\n'));
  const out = []; let i = 0, qNumber = 0;
  const isQ = l => /^Q\.?\s*\d+\s*[).]/i.test(l);
  const qNum = l => { const m = l.match(/^Q\.?\s*(\d+)\s*[).]/i); return m ? Number(m[1]) : null; };
  const stripQ = l => l.replace(/^Q\.?\s*\d+\s*[).]\s*/i, '').trim();
  const isOpt = l => /^\(?[a-d]\s*[).]\s*.+/i.test(l);
  const cleanOpt = l => l.replace(/^\(?[a-d]\s*[).]\s*/i, '').trim();
  const isAns = l => /^(Ans(wer)?)\s*[).:\-]/i.test(l);
  const isExp = l => /^(Exp(lanation)?)\s*[).:\-]/i.test(l);
  const classify = l => {
    let m = l.match(/^(I{1,3}|IV|V|VI{1,3}|IX|X)\s*[.)\-]\s*(.*)/i); if (m) return { t: 'stmt', rest: m[2].trim() };
    m = l.match(/^Statement\s+(I{1,3}|IV|V|VI{1,3}|IX|X|\d+)\s*[:.\-]\s*(.*)/i); if (m) return { t: 'stmt', rest: m[2].trim() };
    m = l.match(/^(\d+)\s*[.)\-]\s+(.*)/); if (m) return { t: 'arabic', num: m[1], rest: m[2].trim() };
    if (/^(Which\b|How many\b|Select\b|In how many\b|Who\b|What\b|When\b|Where\b|Name\b|Identify\b|Arrange\b|Among\b|Of the above|From the above|Based on\b|In the above|The above)/i.test(l)) return { t: 'dir', rest: l };
    return null;
  };
  const buildBody = (first, body) => {
    const items = [first]; let n = 0;
    for (const l of body) {
      const c = classify(l);
      if (c?.t === 'stmt') items.push(`${++n}. ${c.rest}`);
      else if (c?.t === 'arabic') items.push(`${c.num}. ${c.rest}`);
      else if (c?.t === 'dir') items.push(c.rest);
      else items[items.length - 1] += ' ' + l;
    }
    return items.map(squash).filter(Boolean);
  };
  const explanation = block => {
    const idx = block.findIndex(isExp); if (idx < 0) return '';
    const parts = [];
    for (let j = idx; j < block.length; j++) {
      const l = block[j].trim();
      if (/^(Source|Subject|Topic|Subtopic)\s*[).:]/i.test(l)) break;
      if (/^https?:\/\//i.test(l)) continue;
      if (j === idx) {
        const after = l.replace(/^Exp(lanation)?\s*[).:\-]\s*/i, '').replace(/^Option\s+\(?[a-d]\)?\s+is\s+the\s+correct\s+answer[,.]?\s*/i, '').trim();
        if (after) parts.push(after); continue;
      }
      const c = l.replace(/^[●•·▪▸►*\-]\s+/, '').trim(); if (c) parts.push(c);
    }
    return squash(parts.join(' ')).replace(/\*\*/g, '');
  };
  while (i < lines.length) {
    if (!isQ(lines[i])) { i++; continue; }
    qNumber++;
    const num = qNum(lines[i]) || qNumber; const block = [lines[i]]; i++;
    while (i < lines.length && !isQ(lines[i])) block.push(lines[i++]);
    let optStart = -1, ansIdx = -1;
    for (let j = 1; j < block.length; j++) { if (optStart < 0 && isOpt(block[j])) optStart = j; if (ansIdx < 0 && isAns(block[j])) ansIdx = j; }
    // Inline options on one line: "(a) x (b) y (c) z (d) w"
    const bodyEnd = optStart > -1 ? optStart : ansIdx > -1 ? ansIdx : block.length;
    const qText = buildBody(stripQ(block[0]), block.slice(1, bodyEnd).map(s => s.trim()).filter(Boolean)).join('\n');
    let opts = [];
    if (optStart > -1) {
      for (let j = optStart; j < block.length; j++) {
        const ol = block[j].trim();
        if (isAns(ol) || isExp(ol)) break;
        const inline = ol.split(/\s+(?=\(?[b-d]\s*[).]\s)/i);
        if (inline.length > 1 && isOpt(inline[0])) { inline.forEach(x => isOpt(x) && opts.push(x)); continue; }
        if (isOpt(ol)) opts.push(ol);
        else if (opts.length && !/^(Source|Subject|Topic|Subtopic)/i.test(ol)) opts[opts.length - 1] += ' ' + ol;
      }
    }
    let ans = -1;
    if (ansIdx > -1) { const m = block[ansIdx].match(/^Ans(?:wer)?\s*[).:\-]\s*\(?([a-d])\)?/i); if (m) ans = m[1].toLowerCase().charCodeAt(0) - 97; }
    if (!qText && !opts.length) continue;
    out.push(`Q${num}. ${qText}`, '😂');
    opts.forEach((o, k) => { const t = squash(cleanOpt(o)); out.push(k === ans ? `${t} ✅` : t); });
    const ex = explanation(block); if (ex) out.push(`Ex: ${ex}`);
    out.push('');
  }
  return out.join('\n');
}
export function processSFG(pages) {
  const raw = pages.map(p => toLines(p.items).map(l => l.text).join('\n')).join('\n');
  return finish(sfgFormat(raw));
}

/* --------------------------- VAJIRAM & RAVI --------------------------- */
const VAJ_NOISE = [/VAJIRAM\s*(&|AND)\s*RAVI/i, /PRELIMS\s*TEST\s*SERIES/i, /FULL\s*LENGTH\s*TEST/i, /TEST\s*BOOKLET/i, /MAXIMUM\s*MARKS/i, /TIME\s*ALLOWED/i, /DO\s*NOT\s*OPEN/i, /COMMENCEMENT\s*OF\s*THE\s*EXAMINATION/i, /UNPRINTED\s*OR\s*TORN/i, /CANDIDATE'S\s*RESPONSIBILITY/i, /ROLL\s*NUMBER/i, /OMR\s*ANSWER/i, /ANSWER\s*SHEET/i, /PENALTY\s*FOR\s*WRONG/i, /WRONG\s*ANSWERS\s*MARKED/i, /ALTERNATIVES\s*FOR\s*THE\s*ANSWER/i, /QUESTION\s*IS\s*LEFT\s*BLANK/i, /ECONOMICS\s*\(V\d+\)/i, /SCIENCE\s*&\s*TECHNOLOGY\s*\(V\d+\)/i, /POLITY\s*\(V\d+\)/i, /GS\s*TEST\s*-\s*\d+/i, /POWERUP\s*PRELIMS/i, /^\d{1,3}$/];
const vajNoise = l => !l.trim() || VAJ_NOISE.some(r => r.test(l));
function vajParseText(text, map) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  let active = null, body = [], opts = [], inOpts = false;
  const flush = () => {
    if (active !== null && opts.length >= 2 && (!map[active] || opts.length > map[active].options.length)) map[active] = { body: [...body], options: [...opts] };
    active = null; body = []; opts = []; inOpts = false;
  };
  for (const line of lines) {
    // A line may carry several options: "(a) x (b) y"
    if (active !== null && /^\(([a-d])\)\s+/i.test(line)) {
      inOpts = true;
      line.split(/\s+(?=\([b-d]\)\s)/i).forEach(part => { const m = part.match(/^\(([a-d])\)\s+(.+)$/i); if (m) opts.push({ letter: m[1].toLowerCase(), text: m[2].trim() }); else if (opts.length) opts[opts.length - 1].text += ' ' + part; });
      continue;
    }
    const q = line.match(/^(\d{1,3})\.\s{1,6}(.+)$/);
    if (q) {
      const n = Number(q[1]);
      if (n >= 1 && n <= 150) {
        const isListItem = active !== null && !inOpts && n !== active + 1 && n <= 6;
        if (!isListItem || active === null) { flush(); active = n; body = [q[2].trim()]; continue; }
      }
    }
    if (inOpts && opts.length && active !== null) { opts[opts.length - 1].text += ' ' + line; continue; }
    if (active !== null && !inOpts) body.push(line);
  }
  flush();
}
function vajCore(raw) {
  const norm = raw.map(l => l.trim().replace(/^\s*(I{1,3}|IV|V|VI{0,3}|IX|XI{0,2}|X)\.\s+/, (m, r) => ROMAN[r.toUpperCase()] ? `${ROMAN[r.toUpperCase()]}. ` : m)).filter(Boolean);
  const starts = [/^\d{1,2}\.\s+\S/, /^Statement\s+[IVXLC]+\s*:/i, /^(Which|How\s+many|How\s+|What|Select|Arrange|In\s+how|Who\s+|Where\s+|Among\s+|Identify|Of\s+the|With\s+reference|With\s+regard|Consider|Regarding|As\s+per|According\s+to|In\s+which\s+of\s+the\s+above)/i];
  const out = []; let buf = '';
  norm.forEach((l, i) => { if (i === 0 || starts.some(r => r.test(l))) { if (buf) out.push(squash(buf)); buf = l; } else buf += ' ' + l; });
  if (buf) out.push(squash(buf));
  return out;
}
function vajExplain(raw) {
  let t = raw.replace(/^Answer\s*:\s*[a-d]\s*$/gim, '').replace(/^Explanation\s*:\s*$/gim, '')
    .replace(/(Therefore|So|Hence)[,\s]+option\s*\(?[a-d]\)?\s*is\s*the\s*correct\s*answer\.?[^\n]*/gi, '')
    .replace(/Therefore[,\s]+the\s*correct\s*answer[^\n]*/gi, '').replace(/Relevance\s*:[^\n]*/gi, '')
    .replace(/^(?:Source|Ref|Reference)\s*:[^\n]*/gim, '').replace(/^[\s]*[●○•▪◆▸▹→\-–—]+\s*/gm, '').replace(/^Q\d{1,3}\.\s*/gm, '');
  return squash(t.split('\n').map(s => s.trim()).filter(s => s.length > 2).join(' ')).replace(/\.\s*\./g, '.');
}
export function processVajiram(testPages, solPages) {
  const map = {};
  for (const page of testPages) {
    const all = toLines(page.items).filter(l => !vajNoise(l.text));
    const joined = all.map(l => l.text).join(' ');
    if (!/\(a\)/i.test(joined) && !/\(b\)/i.test(joined)) continue;
    const text = detectColumns({ ...page, items: page.items }, 0.5, 6).filter(l => !vajNoise(l.text)).map(l => l.text).join('\n');
    vajParseText(text, map);
  }
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  if (!keys.length) throw Error('No questions found in the Test PDF. Use the Vajiram test booklet with (a) (b) (c) (d) options (not a scanned copy).');
  const solText = solPages.map(p => toLines(p.items).filter(l => !vajNoise(l.text)).map(l => l.text).join('\n')).join('\n');
  const answers = {};
  for (const m of solText.matchAll(/\b(\d{1,3})\.\s*\(([a-d])\)/gi)) { const n = Number(m[1]); if (n >= 1 && n <= 150) answers[n] = m[2].toLowerCase(); }
  const blocks = [...solText.matchAll(/(?:^|\n)Q\s*(\d{1,3})\s*\.\s*(?:\n|$)/g)].map(m => ({ num: Number(m[1]), start: m.index + m[0].length }));
  const expl = {};
  blocks.forEach((b, i) => { expl[b.num] = vajExplain(solText.slice(b.start, blocks[i + 1]?.start ?? solText.length)); });
  if (blocks.length < 5) for (const m of solText.matchAll(/\bQ\s*(\d{1,3})\s*\.\s*([A-D])\b/g)) { const n = Number(m[1]); if (!answers[n]) answers[n] = m[2].toLowerCase(); }
  // "Answer: c" style keys inside explanation blocks
  blocks.forEach((b, i) => { if (answers[b.num]) return; const seg = solText.slice(b.start, blocks[i + 1]?.start ?? solText.length); const m = seg.match(/Answer\s*[:\-]\s*\(?([a-d])\)?/i); if (m) answers[b.num] = m[1].toLowerCase(); });
  const lines = [];
  for (const k of keys) {
    const q = map[k], ans = answers[k];
    const core = vajCore(q.body);
    lines.push(`Q${k}. ${core[0] || ''}`, ...core.slice(1), '😂');
    const combined = q.options.map(o => `(${o.letter}) ${o.text}`).join(' ');
    ['a', 'b', 'c', 'd'].forEach((L, idx) => {
      const next = ['b', 'c', 'd'][idx];
      const re = next ? new RegExp(`\\(${L}\\)\\s*([\\s\\S]*?)(?=\\s*\\(${next}\\)|$)`, 'i') : new RegExp(`\\(${L}\\)\\s*([\\s\\S]*?)$`, 'i');
      const m = combined.match(re); if (!m) return;
      const t = squash(m[1].replace(/^\s*\([a-d]\)\s*/i, ''));
      lines.push(t + (ans === L ? ' ✅' : ''));
    });
    lines.push(`Ex: ${expl[k] || 'Explanation not found for this question.'}`, '');
  }
  return finish(lines.join('\n'));
}

/* ------------------------------ VISIONIAS ------------------------------ */
const HF = [/visionias/i, /vision\s*ias/i, /www\.visionias/i, /©\s*vision/i, /general\s+studies\s*\(p\)/i, /test\s+booklet/i, /answers?\s*(&|and)?\s*explanations?/i, /^https?:\/\//i, /upscpdf\.com/i, /^www\./i, /iasscore/i, /time\s+allowed/i, /maximum\s+marks/i, /do\s+not\s+open/i, /rough\s+work/i, /invigilator/i, /permitted\s+to\s+take/i, /hand\s+over/i, /answer\s+sheet/i, /roll\s+number/i, /^\d{1,3}\s*$/, /^[A-D]\s*$/, /IMMEDIATELY\s+AFTER/i, /ENCODE\s+CLEARLY/i, /this\s+test\s+booklet\s+contains\s+\d+\s+items/i, /you\s+have\s+to\s+(mark|enter)/i, /all\s+items\s+carry\s+equal/i, /before\s+you\s+proceed\s+to\s+mark/i, /after\s+you\s+have\s+completed\s+filling/i, /sheet\s+for\s+rough/i, /^\d+(st|nd|rd|th)\s*of\s*the\s*allotted/i, /^responses?\s*\(answers?\)/i, /check\s+that\s+this\s+booklet/i, /do\s+not\s+write\s+anything/i, /select\s+the\s+response/i, /separate\s+answer\s+sheet/i, /only\s+on\s+the\s*separate/i, /each\s+item\s+(is\s+)?printed\s+in/i];
const isHF = t => !t.trim() || HF.some(r => r.test(t.trim()));
const isStem = l => /^(which\s+of\s+the|how\s+many\s+of\s+the|how\s+many\s+are|how\s+many\s+among|how\s+many\s+provisions|how\s+many\s+of\s+above|select\s+the\s+correct|choose\s+the\s+correct|in\s+how\s+many|arrange\s+the\s+following|what\s+is\s+the\s+correct|which\s+one\s+of\s+the)/i.test(l) || /\?\s*$/.test(l) || /\bhow\s+many\b/i.test(l) || /select\s+the\s+correct\s+answer/i.test(l);
function visionBody(raw) {
  const main = [], subs = []; let stem = '', header = '', state = 'main', cur = '';
  const flushItem = () => { if (cur.trim()) subs.push(cur.trim()); cur = ''; };
  for (const r of raw) {
    const line = r.trim(); if (!line) continue;
    const sm = line.match(/^(\d{1,2})\.\s+(.+)$/);
    const isHeader = /^[^0-9(].+\|.+/.test(line) && !sm;
    const isRow = /^(\d{1,2})\.\s+.+\|.+/.test(line);
    const isSub = !isRow && sm && Number(sm[1]) >= 1 && Number(sm[1]) <= 15;
    const s1 = /^statement[- ]i\s*:/i.test(line), s2 = /^statement[- ]ii\s*:/i.test(line);
    if (state === 'main') {
      if (isHeader && !subs.length && !header) { header = line; state = 'items'; }
      else if (isSub || isRow || s1) { state = 'items'; cur = line; }
      else main.push(line);
    } else if (state === 'items') {
      if (isStem(line)) { flushItem(); stem = line; state = 'stem'; }
      else if (isHeader && !header) { flushItem(); header = line; }
      else if (isSub || isRow || s1 || s2) { flushItem(); cur = line; }
      else cur += ' ' + line;
    } else stem += ' ' + line;
  }
  flushItem();
  let mainQ = squash(main.join(' ')), subStem = squash(stem);
  if (/how\s+many/i.test(mainQ) && subs.length && /select\s+the\s+correct\s+answer/i.test(subStem)) subStem = 'How many of the above are correct?';
  return { mainQ, subs, subStem, header };
}
function visionExplain(raw) {
  let t = raw.replace(/Hence[,\s]+option\s*\([a-d]\)\s*is\s*(the\s+)?correct\s*(answer)?\.?[^\n]*/gi, '').replace(/Hence\s+option\s*\(?[a-d]\)?\s*is[^.\n]*\.\s*/gi, '')
    .replace(/Hence\s+option\s*\d[^.]*\.\s*/gi, '').replace(/Therefore[,\s]+option\s*\(?[a-d]\)?[^.]*\.\s*/gi, '').replace(/Hence\s+the\s+correct\s+(answer|option)[^.]*\.\s*/gi, '')
    .replace(/Hence\s+(the\s+)?statement\s+\d+\s+is[^.]*\.\s*/gi, '').replace(/Hence\s+option\s+\d+\s+is\s+(correct|not\s+correct)\.\s*/gi, '')
    .replace(/^(Source|Note|Reference)\s*:[^\n]*/gim, '').replace(/^\s*(Answer\s*:\s*[a-d]\s*$|Explanation\s*:\s*)/gim, '').replace(/[●○•▪◆▸▹→‣]/g, '').replace(/^\s*o\s+/gm, ' ').replace(/^Q\s*\d{1,3}\s*\.\s*[A-D]\s*$/gm, '');
  return squash(t.split('\n').map(s => s.trim()).filter(s => s.length > 3 && !isHF(s)).join(' ')).replace(/\.\s*\./g, '.');
}
export function processVision(testPages, solPages) {
  const all = [];
  for (const page of testPages) {
    const txt = detectColumns(page, 0.52, 5).map(l => l.text).join('\n');
    if (!/\(\s*[abcd]\s*\)/i.test(txt)) continue;
    // split inline options "(a) x (b) y" onto separate lines
    txt.split('\n').flatMap(l => l.split(/\s+(?=\([b-d]\)\s)/i)).map(s => s.trim()).filter(l => l && !isHF(l)).forEach(l => all.push(l));
  }
  const optRe = /^\(([a-d])\)\s+(.+)$/i, qRe = /^(\d{1,3})\.\s+(.+)$/;
  const aIdx = all.map((l, i) => { const m = l.match(optRe); return m && m[1].toLowerCase() === 'a' ? i : -1; }).filter(i => i >= 0);
  const map = {};
  aIdx.forEach((a, ai) => {
    const cands = [];
    for (let j = a - 1; j >= Math.max(0, a - 80); j--) {
      const om = all[j].match(optRe); if (om && om[1].toLowerCase() !== 'a') break;
      const m = all[j].match(qRe); if (m && +m[1] >= 1 && +m[1] <= 150) cands.push({ n: +m[1], idx: j, text: m[2].trim() });
    }
    if (!cands.length) return;
    const c = cands[cands.length - 1];
    const body = [c.text];
    for (let j = c.idx + 1; j < a; j++) { const bm = all[j].match(optRe); if (bm && bm[1].toLowerCase() !== 'a') break; body.push(all[j]); }
    const opts = []; let cur = null; const end = Math.min(aIdx[ai + 1] ?? all.length, a + 40);
    for (let j = a; j < end; j++) {
      const m = all[j].match(optRe);
      if (m) { if (cur) opts.push(cur); cur = { letter: m[1].toLowerCase(), text: m[2].trim() }; if (cur.letter === 'd') { opts.push(cur); cur = null; break; } }
      else if (cur) { if (qRe.test(all[j]) && opts.length < 3) break; if (j !== a && aIdx.includes(j)) break; cur.text += ' ' + all[j]; }
    }
    if (cur && !opts.some(o => o.letter === cur.letter)) opts.push(cur);
    if (opts.length >= 2 && (!map[c.n] || opts.length > map[c.n].options.length)) map[c.n] = { parsed: visionBody(body), options: opts };
  });
  const nums = Object.keys(map).map(Number).sort((a, b) => a - b);
  if (!nums.length) throw Error('No questions found in the Test PDF. Make sure it has text-based (a) (b) (c) (d) options and is not scanned.');
  const full = solPages.map(p => toLines(p.items, 6).filter(l => !isHF(l.text)).map(l => l.text).join('\n')).join('\n');
  let blocks = [...full.matchAll(/^Q\s*(\d{1,3})\s*\.\s*([A-D])\s*$/gm)].map(m => ({ num: +m[1], letter: m[2].toLowerCase(), start: m.index, end: m.index + m[0].length }));
  if (blocks.length < 5) {
    for (const m of full.matchAll(/\bQ\s*(\d{1,3})\s*\.\s*([A-D])\b/gi)) { const n = +m[1]; if (n >= 1 && n <= 150 && !blocks.some(b => b.num === n)) blocks.push({ num: n, letter: m[2].toLowerCase(), start: m.index, end: m.index + m[0].length }); }
    blocks.sort((a, b) => a.start - b.start);
  }
  if (!blocks.length) throw Error('No answers found in the Solution PDF. It needs "Q 1.A" style answer headings.');
  const answers = {}, expl = {};
  blocks.forEach((b, i) => { answers[b.num] = b.letter; const cl = visionExplain(full.slice(b.end, blocks[i + 1]?.start ?? full.length)); if (cl.length > 10) expl[b.num] = cl; });
  const lines = [];
  for (const n of nums) {
    const { parsed: p, options } = map[n];
    if (p.mainQ) { lines.push(`Q${n}. ${p.mainQ}`); if (p.header) lines.push(p.header); lines.push(...p.subs); if (p.subStem) lines.push(p.subStem); }
    else if (p.subStem) { lines.push(`Q${n}. ${p.subStem}`); if (p.header) lines.push(p.header); lines.push(...p.subs); }
    else lines.push(`Q${n}.`);
    lines.push('😂');
    ['a', 'b', 'c', 'd'].forEach(L => { const o = options.find(x => x.letter === L); if (o) lines.push(squash(o.text).replace(/^\s*\(([a-d])\)\s*/i, '') + (answers[n] === L ? ' ✅' : '')); });
    lines.push(`Ex: ${expl[n] || `[Explanation not extracted for Q${n}]`}`, '');
  }
  return finish(lines.join('\n'));
}

function finish(output) {
  const questionCount = (output.match(/^Q\d+\./gm) || []).length;
  const matched = (output.match(/✅/g) || []).length;
  const expl = (output.match(/^Ex: (?!\[Explanation not|Explanation not found)/gm) || []).length;
  return { output, questionCount, stats: { matched, noAns: questionCount - matched, explanationsFound: expl, noExpl: questionCount - expl } };
}
