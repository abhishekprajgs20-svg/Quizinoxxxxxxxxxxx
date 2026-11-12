// TXT fixer + emoji formatter (ports of QUIZ-BOT txtfixer.py) and the MCQ text parser.
const EMOJI_NUMS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export function fixQuestionsFile(content) {
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n');
  const result = []; let removed = 0;
  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i].replace(/[ \t]+$/, ''));
    if (lines[i].trimEnd().endsWith(':')) {
      let j = i + 1, next = -1, digit = false;
      while (j < lines.length) { if (lines[j].trim()) { next = j; digit = /^\d+\./.test(lines[j].trimStart()); break; } j++; }
      if (digit) { removed += next - i - 1; i = next - 1; }
    }
  }
  // Collapse 3+ blank lines into a single blank line
  const text = result.join('\n').replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n').trim() + '\n';
  return { text, removed };
}

const hasEmoji = l => EMOJI_NUMS.some(e => l.includes(e));
function expandEmoji(line) {
  if (!hasEmoji(line)) return { lines: [line], had: false };
  const re = new RegExp(`(${EMOJI_NUMS.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);
  const parts = line.split(re).filter(p => p !== '');
  if (parts.length <= 1) return { lines: [line], had: false };
  const out = []; let i = 0;
  if (!EMOJI_NUMS.includes(parts[0])) { if (parts[0].trim()) out.push(parts[0].trimEnd()); i = 1; }
  while (i < parts.length) {
    if (EMOJI_NUMS.includes(parts[i])) { out.push(`${parts[i]} ${(parts[i + 1] || '').trim()}`); i += 2; }
    else { if (parts[i].trim()) out.push(parts[i].trim()); i++; }
  }
  return { lines: out, had: true };
}
function isOptionLine(line) {
  const t = line.trim();
  if (!t || /^[Qq]\.\d+\)/.test(t) || /^Ex[:.]/i.test(t) || /^\d+[.)]/.test(t) || EMOJI_NUMS.some(e => t.startsWith(e))) return false;
  return true;
}
function convertBlock(block) {
  const lines = block.split('\n').map(l => l.trimEnd()); const out = []; let stemDone = false, sep = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 || (!stemDone && /^\s*[Qq]\.\d+\)/.test(line))) { const e = expandEmoji(line); out.push(...e.lines); if (e.had) { out.push('😂'); sep = true; } stemDone = true; continue; }
    if (!sep && hasEmoji(line)) { const e = expandEmoji(line); out.push(...e.lines); if (e.had) { out.push('😂'); sep = true; } continue; }
    if (!line.trim()) { const nx = lines.slice(i + 1).find(l => l.trim()); if (!nx || nx.trim().toLowerCase().startsWith('ex')) out.push(''); continue; }
    if (line.trim() === '😂') { if (!sep) { out.push('😂'); sep = true; } continue; }
    const isEx = /^\s*Ex[:.]/i.test(line);
    if ((isOptionLine(line) || isEx) && !sep) { out.push('😂'); sep = true; }
    out.push(line); if (isEx) out.push('');
  }
  return out.join('\n').trimEnd();
}
function convertNumbered(content) {
  const lines = content.split('\n'); const out = []; let inside = false, sep = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^\s*\d+[.)]/.test(t) && !EMOJI_NUMS.some(e => t.startsWith(e))) { inside = true; sep = false; const e = expandEmoji(line); out.push(...e.lines); if (e.had) { out.push('😂'); sep = true; } continue; }
    if (inside && hasEmoji(t) && !sep) { const e = expandEmoji(line); out.push(...e.lines); if (e.had) { out.push('😂'); sep = true; } continue; }
    const isEx = /^\s*Ex[:.]/i.test(t);
    if (((inside && isOptionLine(line)) || isEx) && !sep) { out.push('😂'); sep = true; }
    out.push(line); if (isEx) out.push('');
  }
  return out.join('\n');
}
export function convertFormat(content) {
  const c = String(content).replace(/\r\n?/g, '\n');
  const blocks = c.split(/(?=^\s*[Qq]\.\d+\))/m).filter(b => b.trim());
  if (blocks.length <= 1 && !/^\s*[Qq]\.\d+\)/m.test(c)) return convertNumbered(c);
  return blocks.map(convertBlock).join('\n\n') + '\n';
}

/* ------------------------------ MCQ PARSER ------------------------------ */
const MARK = /(?:✅|✔️?|✓|☑️?|\[correct\]|\*correct\*|\(correct\))/i;
const OPT_LABEL = /^\(?([A-Ha-h])\s*[).:\-]\s*(\S.*)$/;
const Q_START = /^\s*(?:Q(?:ues(?:tion)?)?\s*\.?\s*\d+\s*[).:\-]|Question\s+\d+\s*[:.)\-]|प्रश्न\s*\d+\s*[.):\-])/gim;
const Q_PREFIX = /^(?:Q(?:ues(?:tion)?)?\s*\.?\s*\d+\s*[).:\-]|Question\s+\d+\s*[:.)\-]|प्रश्न\s*\d+\s*[.):\-])\s*/i;
const SEP = /^(?:😂|🔹|💡|✨|🟡|🧠|➖+|-{3,})\s*$/;

export function parseText(t, mkQuestion) {
  const text = String(t || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  if (!text) return [];
  const starts = [...text.matchAll(Q_START)];
  let blocks = [];
  if (starts.length) starts.forEach((s, i) => blocks.push(text.slice(s.index, starts[i + 1]?.index ?? text.length).trim()));
  else {
    // Plain "1. question" numbering: split at numbered lines that follow a blank line
    const numbered = [...text.matchAll(/(?:^|\n\s*\n)\s*(\d{1,3})[.)]\s+\S/g)];
    if (numbered.length >= 2) numbered.forEach((s, i) => blocks.push(text.slice(s.index, numbered[i + 1]?.index ?? text.length).trim()));
    else blocks = text.split(/\n\s*\n+/).filter(Boolean);
  }
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(x => x.trim()).filter(Boolean); if (!lines.length) continue;
    lines[0] = lines[0].replace(Q_PREFIX, '').replace(/^\d{1,3}[.)]\s+/, '').trim();
    const exIdx = lines.findIndex(x => /^(?:Ex|Exp|Explanation|Solution|व्याख्या)\s*[:.)\-]/i.test(x));
    const explanation = exIdx >= 0 ? lines.slice(exIdx).join(' ').replace(/^(?:Ex|Exp|Explanation|Solution|व्याख्या)\s*[:.)\-]\s*/i, '').trim() : '';
    let body = lines.slice(0, exIdx >= 0 ? exIdx : lines.length);
    const ansLine = body.find(x => /^(?:Answer|Ans|Correct(?:\s+answer)?|उत्तर)\s*[:.)\-]/i.test(x));
    body = body.filter(x => !/^(?:Answer|Ans|Correct(?:\s+answer)?|उत्तर)\s*[:.)\-]/i.test(x));
    // Split inline options "(a) x (b) y (c) z"
    body = body.flatMap((l, i) => (i > 0 || OPT_LABEL.test(l)) && /\(?[a-d]\)\s.*\(?[b-d]\)\s/i.test(l) ? l.split(/\s+(?=\(?[b-h]\)\s)/i) : [l]);
    const sep = body.findIndex(x => SEP.test(x));
    let qLines, optLines;
    if (sep >= 0) { qLines = body.slice(0, sep); optLines = body.slice(sep + 1); }
    else {
      const li = body.findIndex((x, i) => i > 0 && OPT_LABEL.test(x) && /^\(?[Aa]/.test(x));
      const li2 = li >= 0 ? li : body.findIndex((x, i) => i > 0 && OPT_LABEL.test(x));
      if (li2 >= 0) { qLines = body.slice(0, li2); optLines = body.slice(li2); }
      else if (body.length >= 3) { const n = Math.min(4, body.length - 1); qLines = body.slice(0, body.length - n); optLines = body.slice(body.length - n); }
      else continue;
    }
    const qtext = qLines.join('\n').replace(/[ \t]+/g, ' ').trim(); if (!qtext || optLines.length < 2) continue;
    const options = []; let correct = 0, found = false;
    const labeled = optLines.some(x => OPT_LABEL.test(x));
    for (const line of optLines) {
      const m = labeled ? line.match(OPT_LABEL) : null;
      if (labeled && !m) { if (options.length) options[options.length - 1] += ' ' + line.replace(MARK, '').trim(); if (MARK.test(line) && options.length) { correct = options.length - 1; found = true; } continue; }
      let value = (m ? m[2] : line).replace(/\s+(?:An\s*(?:s|a)?\s*[).:\-]|Answer\s*[:.)\-])\s*[A-H]\b.*$/i, '');
      const marked = MARK.test(value); value = value.replace(new RegExp(MARK.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
      if (!value) continue; options.push(value); if (marked) { correct = options.length - 1; found = true; }
    }
    if (!found) {
      const tag = block.match(/(?:\bAnswer\b|\bAns\b|\bAn\s*s\b|\bAna\b|\bCorrect(?:\s+answer)?\b|उत्तर)\s*[:.)\-]\s*\(?([A-Ha-h])\)?(?![a-z])/i);
      if (tag) { correct = tag[1].toUpperCase().charCodeAt(0) - 65; found = true; }
      else if (ansLine) { const a = ansLine.replace(/^(?:Answer|Ans|Correct(?:\s+answer)?|उत्तर)\s*[:.)\-]\s*/i, '').trim(); if (/^\d+$/.test(a)) correct = Math.max(0, Number(a) - 1); else { const k = options.findIndex(o => o.toLowerCase() === a.toLowerCase()); if (k >= 0) correct = k; } }
    }
    if (options.length >= 2 && correct < options.length) out.push(mkQuestion(qtext, options, correct, explanation));
  }
  return out;
}
