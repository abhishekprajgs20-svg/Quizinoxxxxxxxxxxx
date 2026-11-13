import './style.css';
import { jsPDF } from 'jspdf';
import { extractPages, genericText, processSFG, processVajiram, processVision, sfgFormat } from './pdf-engines.js';
import { fixQuestionsFile, convertFormat, parseText as parseMcqText } from './text-tools.js';
import { saveFile, shareFile, onBackButton } from './native.js';
const iconUrl = './quizinox-icon.png';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escMl = s => esc(s).replace(/\n/g, '<br>');
const L = i => String.fromCharCode(65 + i);
const STORE = 'quizinox_local_v1', PLAY_STORE = 'quizinox_play_v1';
const AI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'];
const defaultState = () => ({ quizzes: [], attempts: [], settings: { name: 'Learner', geminiKey: '', aiModel: AI_MODELS[0] }, activeTab: 'home' });
let db = load();
let currentQuiz = null, play = null, toastTimer = null, lastResult = null;

function load() {
  try { const d = JSON.parse(localStorage.getItem(STORE) || '{}'); const base = defaultState(); return { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) }, quizzes: Array.isArray(d.quizzes) ? d.quizzes : [], attempts: Array.isArray(d.attempts) ? d.attempts : [] }; }
  catch { return defaultState(); }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(db)); }
  catch (e) {
    // Storage full: drop the oldest attempt details and try again
    if (db.attempts.length > 20) { db.attempts = db.attempts.slice(0, 20); try { localStorage.setItem(STORE, JSON.stringify(db)); toast('Storage was full — older attempts trimmed'); } catch { toast('Storage full. Export a backup and delete old quizzes.'); } }
    else toast('Storage full. Export a backup and delete old quizzes.');
  }
  updateCounts();
}
function savePlay() { try { if (play && !play.finished) localStorage.setItem(PLAY_STORE, JSON.stringify({ ...play, interval: null })); else localStorage.removeItem(PLAY_STORE); } catch { /* ignore */ } }
function updateCounts() { const q = $('#quizCount'); if (q) q.textContent = db.quizzes.length; }
function toast(msg, ms = 2800) { const el = $('#toast'); if (!el) return; el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms); }
function question(text = '', options = ['', '', '', ''], correct = 0, explanation = '') { return { id: uid(), text, options, correct: Number(correct) || 0, explanation }; }
function quizTemplate(title = 'Untitled Quiz') { const now = new Date().toISOString(); return { id: uid(), title, description: '', subject: 'General', createdAt: now, updatedAt: now, settings: { timer: 0, negative: 0, shuffleQ: false, shuffleO: false, pass: 40 }, questions: [] }; }
const parseText = t => parseMcqText(t, question);

/* ------------------------------ MODALS ------------------------------ */
function modal(html, { wide = false } = {}) {
  const m = document.createElement('div'); m.className = 'mode-overlay';
  m.innerHTML = `<div class="mode-dialog ${wide ? 'wide' : ''}"><button class="mode-close" aria-label="Close">×</button>${html}</div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  $('.mode-close', m).onclick = close; m.addEventListener('click', e => { if (e.target === m) close(); });
  return { el: m, close };
}
function actionSheet(title, subtitle, actions) {
  const { el, close } = modal(`<div class="eyebrow">QUICK ACTIONS</div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}${actions.map((a, i) => `<button class="mode-choice ${a.danger ? 'danger-choice' : ''}" data-act="${i}"><span class="mode-icon ${a.cls || 'exam-icon'}">${a.icon}</span><span><b>${esc(a.label)}</b>${a.hint ? `<small>${esc(a.hint)}</small>` : ''}</span><span class="mode-arrow">→</span></button>`).join('')}`);
  $$('[data-act]', el).forEach(b => b.onclick = () => { close(); actions[Number(b.dataset.act)].run(); });
}
function confirmBox(title, text, okLabel = 'Yes', danger = false) {
  return new Promise(res => {
    const { el, close } = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="dialog-actions"><button class="secondary" data-no>Cancel</button><button class="${danger ? 'primary danger-btn' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`);
    const done = v => { close(); res(v); };
    $('[data-yes]', el).onclick = () => done(true); $('[data-no]', el).onclick = () => done(false); $('.mode-close', el).onclick = () => done(false);
  });
}

/* ------------------------------ SHELL ------------------------------ */
document.querySelector('#app').innerHTML = `
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><img class="brandlogo" src="${iconUrl}" alt="QUIZINOX"/><div><b>QUIZINOX</b><small>LEARN · PRACTISE · WIN</small></div></div>
    <div class="profile"><div class="avatar">✦</div><div><b id="profileName">Learner</b><small>Personal workspace</small></div></div>
    <nav class="nav">
      <button class="navitem active" data-tab="home"><span>⌂</span> Overview</button>
      <button class="navitem" data-tab="quizzes"><span>▤</span> My Quizzes <em id="quizCount">0</em></button>
      <button class="navitem" data-tab="create"><span>＋</span> Create Quiz</button>
      <button class="navitem" data-tab="reports"><span>▥</span> Analytics</button>
      <button class="navitem" data-tab="tools"><span>⌘</span> File Studio</button>
      <button class="navitem" data-tab="settings"><span>⚙</span> Settings</button>
    </nav>
    <div class="sidebottom"><div class="offline-pill"><i></i> Works offline</div><small>All quiz data stays on this device. AI tools use the internet only when you start them.</small><div class="version">QUIZINOX · v2.2</div></div>
  </aside>
  <main class="main">
    <header class="topbar"><button class="mobile-brand" data-tab="home"><img src="${iconUrl}" alt=""/> <b>QUIZINOX</b></button><div class="crumb" id="crumb">Your learning space</div><div class="top-actions"><span class="online-state" id="netState"><i></i> OFFLINE</span><button class="iconbtn" id="quickImport" title="Import">⇧</button><button class="avatar small" data-tab="settings">⚙</button></div></header>
    <section class="content" id="view"></section>
  </main>
</div>
<div class="mobile-nav">
 <button data-tab="home" class="active"><span>⌂</span>Home</button><button data-tab="quizzes"><span>▤</span>Quizzes</button><button data-tab="create"><span>＋</span>Create</button><button data-tab="reports"><span>▥</span>Reports</button><button data-tab="tools"><span>⌘</span>Tools</button><button data-tab="settings"><span>⚙</span>More</button>
</div>
<div id="toast" class="toast"></div>
<input type="file" id="fileInput" accept=".txt,.json,.pdf,text/plain,application/json,application/pdf" hidden/>
<input type="file" id="restoreInput" accept=".json,application/json" hidden/>
`;

const view = $('#view');
const labels = { home: 'Your learning space', quizzes: 'Your quiz library', create: 'Quiz studio', reports: 'Performance analytics', tools: 'File studio', settings: 'Preferences' };
function setTab(tab) { if (play) return; db.activeTab = tab; save(); $$('.navitem,.mobile-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); $('#crumb').textContent = labels[tab] || 'QUIZINOX'; lastResult = null; render(); window.scrollTo(0, 0); }
$$('[data-tab]').forEach(b => b.addEventListener('click', () => { if (play) return toast('Finish or exit the quiz first'); setTab(b.dataset.tab); }));
$('#quickImport').onclick = () => $('#fileInput').click();
$('#fileInput').addEventListener('change', async e => { if (e.target.files[0]) await importFile(e.target.files[0]); e.target.value = ''; });
$('#restoreInput').addEventListener('change', async e => { if (e.target.files[0]) await restoreBackup(e.target.files[0]); e.target.value = ''; });
$('#profileName').textContent = db.settings.name || 'Learner';

function updateNet() { const on = navigator.onLine, el = $('#netState'); if (!el) return; el.classList.toggle('is-online', on); el.innerHTML = `<i></i> ${on ? 'ONLINE' : 'OFFLINE'}`; el.title = on ? 'Internet available — AI tools can be used' : 'No internet — all offline features still work'; }
window.addEventListener('online', () => { updateNet(); toast('Back online — AI tools available'); });
window.addEventListener('offline', () => { updateNet(); toast('Offline — your quizzes keep working'); });
updateNet();

function render() { if (play) { renderPlayer(); return; } const tab = db.activeTab || 'home'; ({ home, quizzes: library, create: () => creator(), reports, tools, settings }[tab] || home)(); }

/* ------------------------------ HOME ------------------------------ */
function home() {
  const totalQ = db.quizzes.reduce((n, q) => n + q.questions.length, 0), avg = db.attempts.length ? Math.round(db.attempts.reduce((n, a) => n + a.percent, 0) / db.attempts.length) : 0;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(PLAY_STORE) || 'null'); } catch { return null; } })();
  view.innerHTML = `
 ${saved && db.quizzes.some(q => q.id === saved.quiz?.id) ? `<div class="resume-bar"><span>⏸ Unfinished attempt: <b>${esc(saved.quiz.title)}</b> · ${Object.keys(saved.answers || {}).length}/${saved.questions.length} answered</span><div><button class="secondary" id="discardResume">Discard</button><button class="primary" id="resumeQuiz">Resume →</button></div></div>` : ''}
 <div class="hero"><div class="hero-copy"><div class="eyebrow">✦ YOUR PERSONAL QUIZ COMMAND CENTRE</div><h1>Learn smarter.<br><span>Score higher.</span></h1><p>Create powerful tests, practise anywhere and track your progress — with or without internet.</p><div class="hero-actions"><button class="primary" id="heroCreate">＋ Create a quiz</button><button class="ghost light" id="heroImport">⇧ Import questions</button></div></div><div class="hero-art"><div class="orbit orbit1"></div><div class="orbit orbit2"></div><img class="hero-logo" src="${iconUrl}" alt=""/><div class="float-card fc1">⚡ <b>Focus mode</b></div><div class="float-card fc2">✓ <b>Offline ready</b></div><div class="hero-stat"><strong>${db.quizzes.length}</strong><small>QUIZZES SAVED</small></div></div></div>
 <div class="section-head"><div><div class="eyebrow">AT A GLANCE</div><h2>Your dashboard</h2></div><span class="muted">Stored securely on this phone</span></div>
 <div class="stats-grid"><div class="stat-card"><div class="stat-icon purple">▤</div><small>MY QUIZZES</small><strong>${db.quizzes.length}</strong><span>${totalQ} questions ready</span></div><div class="stat-card"><div class="stat-icon blue">◷</div><small>ATTEMPTS</small><strong>${db.attempts.length}</strong><span>Practice sessions</span></div><div class="stat-card"><div class="stat-icon green">↗</div><small>AVERAGE SCORE</small><strong>${avg}%</strong><span>Across all attempts</span></div><div class="stat-card"><div class="stat-icon amber">◎</div><small>QUESTIONS</small><strong>${totalQ}</strong><span>In your library</span></div></div>
 <div class="two-col"><div class="panel"><div class="panel-head"><div><h3>Recent quizzes</h3><p>Pick up where you left off</p></div><button class="textbtn" id="seeAll">View all →</button></div>${db.quizzes.length ? db.quizzes.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 4).map(quizRow).join('') : '<div class="empty-mini"><span>▤</span><b>No quizzes yet</b><small>Create your first quiz or import a file.</small></div>'}</div><div class="panel insight"><div class="panel-head"><div><h3>Quick actions</h3><p>Everything you need, one tap away</p></div><span class="spark">✦</span></div><button class="action-tile" id="actCreate"><span class="tileicon">＋</span><span><b>Build a quiz</b><small>Create questions manually</small></span><span class="arrow">↗</span></button><button class="action-tile" id="actImport"><span class="tileicon bluebg">⇧</span><span><b>Import a file</b><small>TXT, JSON or PDF</small></span><span class="arrow">↗</span></button><button class="action-tile" id="actPdf"><span class="tileicon amberbg">📄</span><span><b>Coaching PDF → TXT</b><small>SFG · Vajiram · VisionIAS · any PDF</small></span><span class="arrow">↗</span></button><button class="action-tile" id="actReports"><span class="tileicon greenbg">▥</span><span><b>View performance</b><small>Scores and attempt history</small></span><span class="arrow">↗</span></button></div></div>
 <div class="footer-note">🔒 Private by design · No account · Works offline · AI optional</div>`;
  $('#heroCreate').onclick = () => setTab('create'); $('#heroImport').onclick = () => $('#fileInput').click(); $('#seeAll').onclick = () => setTab('quizzes'); $('#actCreate').onclick = () => setTab('create'); $('#actImport').onclick = () => $('#fileInput').click(); $('#actReports').onclick = () => setTab('reports'); $('#actPdf').onclick = () => openPdfStudio();
  $('#resumeQuiz')?.addEventListener('click', resumeQuiz); $('#discardResume')?.addEventListener('click', () => { localStorage.removeItem(PLAY_STORE); home(); });
  wireQuizRows();
}
function quizRow(q) { return `<div class="quiz-row" data-open="${q.id}"><div class="quiz-symbol">▤</div><div class="quiz-info"><b>${esc(q.title)}</b><small>${q.questions.length} questions · ${esc(q.subject || 'General')}</small></div><span class="tag">${q.questions.length ? 'READY' : 'DRAFT'}</span><button class="more" data-menu="${q.id}" aria-label="More">···</button></div>`; }
function wireQuizRows() { $$('[data-open]').forEach(x => x.onclick = () => quizMenu(x.dataset.open)); $$('[data-menu]').forEach(b => b.onclick = e => { e.stopPropagation(); quizMenu(b.dataset.menu); }); }
function quizMenu(id) {
  const q = db.quizzes.find(x => x.id === id); if (!q) return;
  actionSheet(q.title, `${q.questions.length} questions · ${q.subject || 'General'}`, [
    { icon: '▶', label: 'Play quiz', hint: 'Exam or practice mode', run: () => chooseMode(q.id) },
    { icon: '✎', label: 'Edit quiz', cls: 'practice-icon', run: () => editQuiz(q.id) },
    { icon: '⧉', label: 'Duplicate', run: () => { const c = structuredClone(q); c.id = uid(); c.title += ' (Copy)'; c.updatedAt = new Date().toISOString(); db.quizzes.unshift(c); save(); render(); toast('Quiz duplicated'); } },
    { icon: '⇩', label: 'Export', hint: 'JSON, TXT (😂 format) or PDF', run: () => exportQuiz(q) },
    { icon: '🌐', label: 'Translate · 100+ languages', hint: 'Online · bulk translation · no Gemini key', run: () => translateQuiz(q) },
    { icon: '×', label: 'Delete', danger: true, cls: 'danger-icon', run: async () => { if (await confirmBox('Delete quiz?', `"${q.title}" will be removed from this device.`, 'Delete', true)) { db.quizzes = db.quizzes.filter(x => x.id !== q.id); save(); render(); toast('Quiz deleted'); } } },
  ]);
}

/* ------------------------------ LIBRARY ------------------------------ */
function library() {
  view.innerHTML = `<div class="page-title"><div><div class="eyebrow">YOUR COLLECTION</div><h1>My quizzes</h1><p>Manage, practise and export your saved quizzes.</p></div><div class="title-actions"><button class="secondary" id="libImport">⇧ Import</button><button class="primary" id="libCreate">＋ New quiz</button></div></div><div class="toolbar"><input id="searchQuiz" placeholder="⌕  Search quizzes..." /><select id="filterSubject"><option value="">All subjects</option>${[...new Set(db.quizzes.map(q => q.subject || 'General'))].map(s => `<option>${esc(s)}</option>`).join('')}</select><span class="muted">${db.quizzes.length} saved</span></div><div class="quiz-grid" id="quizGrid">${db.quizzes.length ? db.quizzes.map(quizCard).join('') : '<div class="empty-state"><div>▤</div><h3>Your library is waiting</h3><p>Create your first quiz or import existing questions.</p><button class="primary" id="emptyCreate">Create a quiz</button></div>'}</div>`;
  $('#libImport').onclick = () => $('#fileInput').click(); $('#libCreate').onclick = () => setTab('create'); $('#emptyCreate')?.addEventListener('click', () => setTab('create'));
  const filter = () => { const term = $('#searchQuiz').value.toLowerCase(), sub = $('#filterSubject').value; $$('.quiz-card').forEach(c => c.hidden = !(c.dataset.title.includes(term) && (!sub || c.dataset.subject === sub))); };
  $('#searchQuiz').oninput = filter; $('#filterSubject').onchange = filter;
  $$('.quiz-card [data-action]').forEach(b => b.onclick = async () => {
    const q = db.quizzes.find(x => x.id === b.closest('.quiz-card').dataset.id); if (!q) return;
    const a = b.dataset.action;
    if (a === 'play') chooseMode(q.id); else if (a === 'edit') editQuiz(q.id); else if (a === 'more') quizMenu(q.id);
    else if (a === 'delete' && await confirmBox('Delete quiz?', `"${q.title}" will be removed from this device.`, 'Delete', true)) { db.quizzes = db.quizzes.filter(x => x.id !== q.id); save(); render(); }
  });
}
function quizCard(q) { const best = db.attempts.filter(a => a.quizId === q.id).reduce((m, a) => Math.max(m, a.percent), -1); return `<article class="quiz-card" data-id="${q.id}" data-title="${esc(q.title.toLowerCase())}" data-subject="${esc(q.subject || 'General')}"><div class="card-top"><div class="quiz-symbol large">▤</div><span class="tag">${q.questions.length} Q${best >= 0 ? ` · BEST ${best}%` : ''}</span></div><h3>${esc(q.title)}</h3><p>${esc(q.description || 'No description added.')}</p><div class="card-meta"><span>◷ ${q.settings.timer ? `${q.settings.timer}s / Q` : 'Untimed'}</span><span>▣ ${esc(q.subject || 'General')}</span></div><div class="card-buttons"><button class="primary" data-action="play" ${q.questions.length ? '' : 'disabled'}>▶ Play</button><button class="secondary" data-action="edit">Edit</button><button class="iconbtn" data-action="more" title="More">···</button><button class="iconbtn danger" data-action="delete" title="Delete">×</button></div></article>`; }

/* ------------------------------ CREATOR ------------------------------ */
function creator(editId = null) {
  const old = editId ? db.quizzes.find(q => q.id === editId) : null; currentQuiz = old ? structuredClone(old) : (currentQuiz && !db.quizzes.some(q => q.id === currentQuiz.id) && currentQuiz.questions.length ? currentQuiz : quizTemplate());
  view.innerHTML = `<div class="page-title"><div><div class="eyebrow">QUIZ STUDIO</div><h1>${old ? 'Edit quiz' : 'Create a quiz'}</h1><p>Build your question set. Changes are saved only on this device.</p></div><button class="secondary" id="backLib">← Library</button></div>
 <div class="editor-layout"><div class="panel editor-main"><div class="form-grid"><label>Quiz title<input id="qTitle" value="${esc(currentQuiz.title)}" placeholder="e.g. Indian Polity — Fundamental Rights"/></label><label>Subject / category<input id="qSubject" value="${esc(currentQuiz.subject)}" placeholder="General Studies"/></label><label class="wide">Description<textarea id="qDesc" rows="2" placeholder="Short description...">${esc(currentQuiz.description)}</textarea></label></div><div class="divider"></div><div class="panel-head"><div><h3>Questions <span class="countbubble" id="questionCount">${currentQuiz.questions.length}</span></h3><p>Add MCQs with correct answers and explanations.</p></div><div class="title-actions row"><button class="secondary" id="pasteQs">⎘ Paste text</button><button class="primary" id="addQuestion">＋ Add question</button></div></div><div id="questionEditor">${currentQuiz.questions.map(questionEditor).join('')}</div><div class="empty-mini" id="noQuestions" ${currentQuiz.questions.length ? 'hidden' : ''}><span>✎</span><b>No questions added</b><small>Add a question, or paste many questions at once.</small></div></div>
 <aside class="panel editor-settings"><h3>Quiz settings</h3><label>Timer per question<select id="timer"><option value="0">No timer</option>${[10, 15, 20, 30, 36, 45, 60, 72, 90, 120].map(n => `<option value="${n}" ${currentQuiz.settings.timer == n ? 'selected' : ''}>${n} seconds</option>`).join('')}</select></label><label>Negative marking<select id="negative">${[0, .25, .33, .5, 1].map(n => `<option value="${n}" ${Math.abs((currentQuiz.settings.negative || 0) - n) < .01 ? 'selected' : ''}>${n === 0 ? 'No negative marking' : '−' + n + ' per wrong answer'}</option>`).join('')}</select></label><label>Pass percentage<input id="passMark" type="number" min="0" max="100" value="${currentQuiz.settings.pass ?? 40}"/></label><div class="toggleline"><span><b>Shuffle questions</b><small>Random question order</small></span><input type="checkbox" id="shuffleQ" ${currentQuiz.settings.shuffleQ ? 'checked' : ''}/></div><div class="toggleline"><span><b>Shuffle options</b><small>Random answer order</small></span><input type="checkbox" id="shuffleO" ${currentQuiz.settings.shuffleO ? 'checked' : ''}/></div><button class="primary full" id="saveQuiz">Save quiz</button><button class="secondary full" id="translateInEditor">🌐 Translate quiz</button><button class="secondary full" id="previewQuiz">Save & play</button></aside></div>`;
  $('#backLib').onclick = () => setTab('quizzes');
  $('#addQuestion').onclick = () => { syncEditor(); currentQuiz.questions.push(question()); refreshQuestionEditor(); $$('.question-edit').pop()?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('#pasteQs').onclick = () => { const { el, close } = modal(`<div class="eyebrow">BULK ADD</div><h2>Paste questions</h2><p>Paste MCQs in any supported format (Q1. … 😂 … ✅, a) b) c) d) with Answer:, etc).</p><textarea id="bulkText" rows="10" placeholder="Q1. Question text\n😂\nOption A\nOption B ✅\nOption C\nOption D\nEx: explanation"></textarea><div class="dialog-actions"><button class="primary" id="bulkAdd">Add questions</button></div>`, { wide: true }); $('#bulkAdd', el).onclick = () => { const qs = parseText($('#bulkText', el).value); if (!qs.length) return toast('No questions detected in the text'); syncEditor(); currentQuiz.questions.push(...qs); close(); refreshQuestionEditor(); toast(`${qs.length} questions added`); }; };
  $('#saveQuiz').onclick = () => saveQuiz();
  $('#translateInEditor').onclick = () => { if(saveQuiz(true)){ const q=db.quizzes.find(x=>x.id===currentQuiz.id); if(q)translateQuiz(q); } };
  $('#previewQuiz').onclick = () => { if (saveQuiz(true)) chooseMode(currentQuiz.id); };
  wireQuestionButtons(); updateQuestionCount();
}
function questionEditor(q, i) { return `<div class="question-edit" data-qid="${q.id}"><div class="qedit-head"><b>QUESTION ${String(i + 1).padStart(2, '0')}</b><div><button class="mini" data-qmove="up" title="Move up">↑</button><button class="mini" data-qmove="down" title="Move down">↓</button><button class="mini delete" data-qremove title="Delete">×</button></div></div><textarea class="qtext" placeholder="Write your question...">${esc(q.text)}</textarea><div class="option-list">${q.options.map((o, j) => `<div class="option-edit"><input type="radio" name="correct-${q.id}" value="${j}" ${q.correct === j ? 'checked' : ''} title="Mark correct"/><span>${L(j)}</span><input class="opttext" value="${esc(o)}" placeholder="Option ${L(j)}"/><button class="mini delete" data-optremove="${j}" title="Remove option">×</button></div>`).join('')}</div><button class="textbtn addopt" data-addopt>＋ Add option</button><textarea class="explanation" rows="2" placeholder="Explanation (optional)">${esc(q.explanation || '')}</textarea></div>`; }
function refreshQuestionEditor() { $('#questionEditor').innerHTML = currentQuiz.questions.map(questionEditor).join(''); $('#noQuestions').hidden = !!currentQuiz.questions.length; wireQuestionButtons(); updateQuestionCount(); }
function updateQuestionCount() { $('#questionCount').textContent = currentQuiz.questions.length; }
function wireQuestionButtons() {
  $$('#questionEditor [data-qremove]').forEach(b => b.onclick = () => { syncEditor(); const id = b.closest('.question-edit').dataset.qid; currentQuiz.questions = currentQuiz.questions.filter(q => q.id !== id); refreshQuestionEditor(); });
  $$('#questionEditor [data-addopt]').forEach(b => b.onclick = () => { syncEditor(); const q = currentQuiz.questions.find(x => x.id === b.closest('.question-edit').dataset.qid); if (q.options.length >= 8) return toast('Maximum 8 options'); q.options.push(''); refreshQuestionEditor(); });
  $$('#questionEditor [data-optremove]').forEach(b => b.onclick = () => { syncEditor(); const card = b.closest('.question-edit'), q = currentQuiz.questions.find(x => x.id === card.dataset.qid), idx = Number(b.dataset.optremove); if (q.options.length <= 2) return toast('At least 2 options required'); q.options.splice(idx, 1); if (q.correct === idx) q.correct = 0; else if (q.correct > idx) q.correct--; refreshQuestionEditor(); });
  $$('#questionEditor [data-qmove]').forEach(b => b.onclick = () => { syncEditor(); const card = b.closest('.question-edit'), i = currentQuiz.questions.findIndex(q => q.id === card.dataset.qid), j = b.dataset.qmove === 'up' ? i - 1 : i + 1; if (j < 0 || j >= currentQuiz.questions.length) return; [currentQuiz.questions[i], currentQuiz.questions[j]] = [currentQuiz.questions[j], currentQuiz.questions[i]]; refreshQuestionEditor(); });
}
function syncEditor() { if (!$('#qTitle')) return; currentQuiz.title = $('#qTitle').value.trim() || 'Untitled Quiz'; currentQuiz.subject = $('#qSubject').value.trim() || 'General'; currentQuiz.description = $('#qDesc').value; currentQuiz.settings = { timer: Number($('#timer').value), negative: Number($('#negative').value), pass: Math.min(100, Math.max(0, Number($('#passMark').value) || 0)), shuffleQ: $('#shuffleQ').checked, shuffleO: $('#shuffleO').checked }; $$('.question-edit').forEach(card => { const q = currentQuiz.questions.find(x => x.id === card.dataset.qid); if (!q) return; q.text = $('.qtext', card).value; q.options = $$('.opttext', card).map(x => x.value); q.correct = Number($(`input[name="correct-${q.id}"]:checked`, card)?.value || 0); q.explanation = $('.explanation', card).value; }); }
function saveQuiz(silent = false) {
  syncEditor();
  if (!currentQuiz.questions.length) { toast('Add at least one question'); return false; }
  for (let i = 0; i < currentQuiz.questions.length; i++) {
    const q = currentQuiz.questions[i];
    // drop empty options, keep correct index pointing at the same option
    const keep = q.options.map((o, j) => ({ o: o.trim(), j })).filter(x => x.o);
    if (!q.text.trim() || keep.length < 2) { toast(`Question ${i + 1}: add text and at least 2 options`); $$('.question-edit')[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return false; }
    const newCorrect = keep.findIndex(x => x.j === q.correct);
    if (newCorrect < 0) { toast(`Question ${i + 1}: the correct option is empty`); return false; }
    q.options = keep.map(x => x.o); q.correct = newCorrect;
  }
  currentQuiz.updatedAt = new Date().toISOString();
  const idx = db.quizzes.findIndex(q => q.id === currentQuiz.id);
  if (idx >= 0) db.quizzes[idx] = structuredClone(currentQuiz); else db.quizzes.unshift(structuredClone(currentQuiz));
  save();
  if (!silent) { toast('Quiz saved on this device ✓'); setTab('quizzes'); }
  return true;
}
function editQuiz(id) { db.activeTab = 'create'; $$('.navitem,.mobile-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'create')); $('#crumb').textContent = labels.create; creator(id); window.scrollTo(0, 0); }

/* ------------------------------ PLAYER ------------------------------ */
function chooseMode(id) {
  const q = db.quizzes.find(x => x.id === id); if (!q || !q.questions.length) return toast('This quiz has no questions');
  const { el, close } = modal(`<div class="eyebrow">CHOOSE YOUR EXPERIENCE</div><h2>${esc(q.title)}</h2><p>${q.questions.length} questions${q.settings.timer ? ` · ${q.settings.timer}s per question` : ''}${q.settings.negative ? ` · −${q.settings.negative} negative` : ''}</p><button class="mode-choice" data-mode="exam"><span class="mode-icon exam-icon">◷</span><span><b>Exam mode</b><small>Attempt freely, jump between questions, mark for review. Score and full review at the end.</small></span><span class="mode-arrow">→</span></button><button class="mode-choice" data-mode="practice"><span class="mode-icon practice-icon">✦</span><span><b>Practice mode</b><small>See the correct answer and explanation right after each response.</small></span><span class="mode-arrow">→</span></button>`);
  $$('[data-mode]', el).forEach(b => b.onclick = () => { close(); startQuiz(id, b.dataset.mode); });
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function startQuiz(id, mode = 'exam') {
  const q = db.quizzes.find(x => x.id === id); if (!q || !q.questions.length) return toast('This quiz has no questions');
  let qs = q.questions.map(x => ({ ...x, options: x.options.map((t, i) => ({ text: t, original: i })) }));
  if (q.settings.shuffleQ) shuffle(qs);
  if (q.settings.shuffleO) qs.forEach(x => shuffle(x.options));
  play = { quiz: q, mode, questions: qs, index: 0, answers: {}, marked: {}, visited: { 0: true }, timeLeft: {}, started: Date.now(), interval: null, finished: false, paletteOpen: false };
  enterPlayer();
}
function resumeQuiz() {
  try { const s = JSON.parse(localStorage.getItem(PLAY_STORE)); const q = db.quizzes.find(x => x.id === s.quiz.id); if (!q) throw 0; play = { ...s, quiz: q, interval: null }; enterPlayer(); toast('Attempt resumed'); }
  catch { localStorage.removeItem(PLAY_STORE); toast('Could not resume that attempt'); }
}
function enterPlayer() { document.body.classList.add('in-quiz'); renderPlayer(); window.scrollTo(0, 0); }
function leavePlayer() { if (play) clearInterval(play.interval); play = null; localStorage.removeItem(PLAY_STORE); document.body.classList.remove('in-quiz'); }
const answeredCount = p => Object.keys(p.answers).filter(k => p.answers[k] != null).length;
function qState(p, i) { const a = p.answers[i] != null, m = !!p.marked[i]; if (p.mode === 'practice' && a) return p.answers[i] === p.questions[i].correct ? 'right' : 'wrongq'; if (a && m) return 'ans-marked'; if (m) return 'marked'; if (a) return 'answered'; if (p.visited[i]) return 'skipped'; return 'fresh'; }
function renderPlayer() {
  const p = play; if (!p) return; const q = p.questions[p.index]; if (!q) return finishQuiz();
  p.visited[p.index] = true;
  const sel = p.answers[p.index]; const answered = sel != null; const locked = p.mode === 'practice' && answered;
  const isRight = answered && sel === q.correct; const right = q.options.find(o => o.original === q.correct);
  const timer = p.quiz.settings.timer || 0; if (timer && p.timeLeft[p.index] == null) p.timeLeft[p.index] = timer;
  const done = answeredCount(p), total = p.questions.length, last = p.index === total - 1;
  const feedback = locked ? `<div class="instant-feedback ${isRight ? 'is-correct' : 'is-wrong'}"><b>${isRight ? '✓ Correct answer' : '✕ Not quite — learn from it'}</b><div>Correct answer: <strong>${L(q.options.indexOf(right))}. ${esc(right?.text || 'Not specified')}</strong></div><p>${esc(q.explanation || 'No explanation was provided for this question.')}</p></div>` : '';
  view.innerHTML = `<div class="player-wrap"><div class="player-top"><button class="secondary" id="quitPlay">← Exit</button><span class="tag">${p.mode === 'exam' ? 'EXAM MODE' : 'PRACTICE MODE'}</span><button class="secondary" id="playerTranslate">🌐 ${p.language ? esc(p.languageName || p.language) : 'Translate'}</button><button class="secondary palette-toggle" id="paletteToggle">☷ ${p.index + 1}/${total}</button></div>
  <div class="progress"><i style="width:${Math.round(done / total * 100)}%"></i></div>
  <div class="player-grid ${p.paletteOpen ? 'palette-open' : ''}">
   <div class="player-card"><div class="question-meta"><span>QUESTION ${String(p.index + 1).padStart(2, '0')} OF ${total}</span><span class="timer ${timer && p.timeLeft[p.index] <= 5 ? 'timer-low' : ''}" id="timerDisplay">${timer ? `◷ ${p.timeLeft[p.index]}s` : esc(p.quiz.subject || 'General')}</span></div><h1>${escMl(q.text)}</h1><div class="answer-list">${q.options.map((o, i) => `<button class="answer ${sel === o.original ? 'chosen' : ''} ${locked ? (o.original === q.correct ? 'answer-correct' : o.original === sel ? 'answer-wrong' : '') : ''}" data-answer="${o.original}" ${locked ? 'disabled' : ''}><span class="letter">${L(i)}</span><span class="answer-text">${escMl(o.text)}</span><span class="radio"></span></button>`).join('')}</div>${feedback}
    <div class="player-tools">${p.mode === 'exam' ? `<button class="textbtn" id="markReview">${p.marked[p.index] ? '★ Marked for review' : '☆ Mark for review'}</button>` : ''}${answered && !locked ? '<button class="textbtn" id="clearAns">⟲ Clear response</button>' : ''}</div>
    <div class="player-bottom"><button class="secondary" id="prevQuestion" ${p.index === 0 ? 'disabled' : ''}>← Previous</button><span class="muted">${done}/${total} answered</span>${last ? '<button class="primary" id="submitQuiz">Submit ✓</button>' : '<button class="primary" id="nextQuestion">Next →</button>'}</div>
   </div>
   <aside class="palette panel"><div class="panel-head"><div><h3>Question palette</h3><p>Tap any number to jump</p></div><button class="textbtn palette-close" id="paletteClose">×</button></div><div class="palette-grid">${p.questions.map((_, i) => `<button class="pal ${qState(p, i)} ${i === p.index ? 'current' : ''}" data-jump="${i}">${i + 1}</button>`).join('')}</div>
    <div class="legend">${p.mode === 'exam' ? '<span><i class="answered"></i>Answered</span><span><i class="skipped"></i>Not answered</span><span><i class="marked"></i>Marked</span><span><i class="ans-marked"></i>Answered + marked</span><span><i class="fresh"></i>Not visited</span>' : '<span><i class="right"></i>Correct</span><span><i class="wrongq"></i>Wrong</span><span><i class="skipped"></i>Skipped</span><span><i class="fresh"></i>Not visited</span>'}</div>
    <button class="primary full" id="submitSide">Submit quiz</button></aside>
  </div>
  <div class="player-hint">${p.mode === 'exam' ? 'Use Previous / Next or the palette to move between questions. Answers are revealed after you submit.' : 'Choose an option to reveal the answer. You can go back to any question.'}</div></div>`;
  $('#playerTranslate')?.addEventListener('click', openPlayerLanguagePicker);
  $('#quitPlay').onclick = async () => { const r = await confirmBox('Exit quiz?', 'Choose "Save & exit" to resume later from the dashboard.', 'Save & exit'); if (r) { clearInterval(p.interval); savePlay(); const t = db.activeTab; play = null; document.body.classList.remove('in-quiz'); setTab(t === 'create' ? 'quizzes' : 'home'); } };
  $$('.answer').forEach(b => b.onclick = () => { if (locked) return; p.answers[p.index] = Number(b.dataset.answer); savePlay(); renderPlayer(); });
  $('#prevQuestion').onclick = () => go(p.index - 1);
  $('#nextQuestion')?.addEventListener('click', () => go(p.index + 1));
  $('#submitQuiz')?.addEventListener('click', submitQuiz); $('#submitSide').onclick = submitQuiz;
  $('#markReview')?.addEventListener('click', () => { p.marked[p.index] = !p.marked[p.index]; savePlay(); renderPlayer(); });
  $('#clearAns')?.addEventListener('click', () => { delete p.answers[p.index]; savePlay(); renderPlayer(); });
  $$('[data-jump]').forEach(b => b.onclick = () => { p.paletteOpen = false; go(Number(b.dataset.jump)); });
  $('#paletteToggle').onclick = () => { p.paletteOpen = !p.paletteOpen; renderPlayer(); };
  $('#paletteClose').onclick = () => { p.paletteOpen = false; renderPlayer(); };
  clearInterval(p.interval);
  if (timer && !locked && p.timeLeft[p.index] > 0) {
    p.interval = setInterval(() => {
      p.timeLeft[p.index]--; const t = $('#timerDisplay'); if (t) { t.textContent = `◷ ${Math.max(0, p.timeLeft[p.index])}s`; t.classList.toggle('timer-low', p.timeLeft[p.index] <= 5); }
      if (p.timeLeft[p.index] % 5 === 0) savePlay();
      if (p.timeLeft[p.index] <= 0) { clearInterval(p.interval); p.timeLeft[p.index] = 0; if (p.index < total - 1) { toast('Time up — moved to next question'); go(p.index + 1); } else { toast('Time up'); renderPlayer(); } }
    }, 1000);
  } else if (timer && !locked && p.timeLeft[p.index] <= 0) {
    $$('.answer').forEach(b => b.disabled = true); const t = $('#timerDisplay'); if (t) t.textContent = '◷ Time up';
  }
}
function go(i) { if (!play) return; if (i < 0 || i >= play.questions.length) return; clearInterval(play.interval); play.index = i; savePlay(); renderPlayer(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
async function submitQuiz() {
  const p = play; if (!p) return; const left = p.questions.length - answeredCount(p); const marked = Object.values(p.marked).filter(Boolean).length;
  const msg = left || marked ? `${left ? `${left} unanswered` : ''}${left && marked ? ' · ' : ''}${marked ? `${marked} marked for review` : ''}. Submit anyway?` : 'All questions answered. Submit your attempt?';
  if (await confirmBox('Submit quiz?', msg, 'Submit')) finishQuiz();
}
function finishQuiz() {
  const p = play; if (!p) return; clearInterval(p.interval); p.finished = true;
  let correct = 0, wrong = 0, blank = 0, score = 0; const neg = Number(p.quiz.settings.negative) || 0;
  const details = p.questions.map((q, i) => { const ans = p.answers[i]; let status = 'blank'; if (ans == null) blank++; else if (ans === q.correct) { correct++; score++; status = 'correct'; } else { wrong++; score -= neg; status = 'wrong'; } return { question: q.text, selected: ans ?? null, correct: q.correct, status, explanation: q.explanation, options: q.options }; });
  const max = p.questions.length, percent = Math.max(0, Math.round(score / max * 100));
  const attempt = { id: uid(), quizId: p.quiz.id, quizTitle: p.quiz.title, mode: p.mode, date: new Date().toISOString(), durationSec: Math.round((Date.now() - p.started) / 1000), total: max, correct, wrong, blank, score: Number(score.toFixed(2)), percent, pass: p.quiz.settings.pass ?? 40, details };
  db.attempts.unshift(attempt); save(); leavePlayer(); renderResult(attempt);
}
const fmtDur = s => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`;
function renderResult(a, filter = 'all') {
  lastResult = a; window.scrollTo(0, 0);
  const passed = a.percent >= (a.pass ?? 40);
  const idxOf = (d, orig) => d.options.findIndex(o => o.original === orig);
  const rows = a.details.map((d, i) => ({ d, i })).filter(({ d }) => filter === 'all' || d.status === filter);
  view.innerHTML = `<div class="result-wrap"><div class="result-hero"><div class="result-ring" style="--score:${a.percent * 3.6}deg"><div><strong>${a.percent}%</strong><small>SCORE</small></div></div><div><div class="eyebrow">${passed ? '🏆 PASSED' : 'SESSION COMPLETE'}</div><h1>${passed ? 'Great work!' : 'Quiz completed!'}</h1><p>${esc(a.quizTitle)} · ${new Date(a.date).toLocaleString()}${a.durationSec ? ` · ${fmtDur(a.durationSec)}` : ''}</p></div></div>
  <div class="stats-grid result-stats"><div class="stat-card"><small>CORRECT</small><strong class="green-text">${a.correct}</strong></div><div class="stat-card"><small>INCORRECT</small><strong class="red-text">${a.wrong}</strong></div><div class="stat-card"><small>UNANSWERED</small><strong>${a.blank}</strong></div><div class="stat-card"><small>MARKS</small><strong>${a.score}/${a.total}</strong></div></div>
  <div class="panel artifact-panel"><div class="panel-head"><div><h3>🌐 Language & study exports</h3><p>Choose a language, then download or share each generated file directly.</p></div></div><div class="form-grid"><label>Export language<select id="artifactLang"><option value="original">Original</option></select></label><label>Translate into<select id="artifactTarget"></select></label></div><div class="dialog-actions"><button class="secondary" id="artifactTranslate">🌐 Translate / prepare language</button></div><div class="artifact-grid"><div class="artifact-item"><b>🎮 Playable HTML Quiz</b><div><button class="primary" id="downloadQuizHtml">⬇ Download HTML</button><button class="secondary" id="shareQuizHtml">↗ Share</button></div></div><div class="artifact-item"><b>📄 Test PDF</b><div><button class="primary" id="downloadTestPdf">⬇ Download PDF</button><button class="secondary" id="shareTestPdf">↗ Share</button></div></div><div class="artifact-item"><b>✅ Solution PDF</b><div><button class="primary" id="downloadSolPdf">⬇ Download PDF</button><button class="secondary" id="shareSolPdf">↗ Share</button></div></div><div class="artifact-item"><b>📚 Test + Solution PDF</b><div><button class="primary" id="downloadMergedPdf">⬇ Download PDF</button><button class="secondary" id="shareMergedPdf">↗ Share</button></div></div><div class="artifact-item"><b>📝 Notes HTML</b><div><button class="primary" id="downloadNotesHtml">⬇ Download HTML</button><button class="secondary" id="shareNotesHtml">↗ Share</button></div></div><div class="artifact-item"><b>📘 Notes PDF</b><div><button class="primary" id="downloadNotesPdf">⬇ Download PDF</button><button class="secondary" id="shareNotesPdf">↗ Share</button></div></div></div><p class="muted" id="artifactStatus">Files are saved to Downloads on web, or shared through Android's share sheet.</p><div class="dialog-actions"><button class="secondary" id="openTestMaker">Open supplied Test Series Maker</button><button class="secondary" id="openNotesMaker">Open supplied Notes Maker</button><button class="secondary" id="openQuizMaker">Open supplied Quiz Maker</button><button class="secondary" id="openTranslatorTool">Open supplied Translator</button></div></div>
  <div class="panel"><div class="panel-head"><div><h3>Answer review</h3><p>Review every response and explanation.</p></div><button class="secondary" id="resultPdf">⇩ PDF report</button></div>
  <div class="chips">${[['all', 'All', a.total], ['correct', 'Correct', a.correct], ['wrong', 'Wrong', a.wrong], ['blank', 'Unanswered', a.blank]].map(([k, l, n]) => `<button class="chip ${filter === k ? 'active' : ''}" data-filter="${k}">${l} · ${n}</button>`).join('')}</div>
  ${rows.length ? rows.map(({ d, i }) => `<div class="review-row"><div class="review-number">${i + 1}</div><div class="review-content"><b>${escMl(d.question)}</b><div class="review-status ${d.status}">${d.status.toUpperCase()} · ${d.selected == null ? 'Not answered' : `Your answer: ${L(idxOf(d, d.selected))}`} · Correct: ${L(idxOf(d, d.correct))}</div><div class="review-options">${d.options.map((o, j) => `<div class="${o.original === d.correct ? 'review-correct' : o.original === d.selected ? 'review-wrong' : ''}">${L(j)}. ${esc(o.text)} ${o.original === d.correct ? '✓' : o.original === d.selected ? '✕' : ''}</div>`).join('')}</div>${d.explanation ? `<p>${escMl(d.explanation)}</p>` : ''}</div></div>`).join('') : '<div class="empty-mini"><b>Nothing here</b></div>'}</div>
<div class="result-actions"><button class="primary" id="resultHome">Back to dashboard</button><button class="secondary" id="resultAgain">↻ Retry quiz</button>${a.wrong + a.blank ? '<button class="secondary" id="retryWrong">✎ Practise mistakes</button>' : ''}</div></div>`;
  setupResultArtifacts(a); $('#resultHome').onclick = () => setTab('home'); $('#resultAgain').onclick = () => chooseMode(a.quizId); $('#resultPdf').onclick = () => exportAttemptPDF(a);
  $$('[data-filter]').forEach(b => b.onclick = () => renderResult(a, b.dataset.filter));
  $('#retryWrong')?.addEventListener('click', () => {
    const src = db.quizzes.find(q => q.id === a.quizId);
    const qs = a.details.filter(d => d.status !== 'correct').map(d => question(d.question, d.options.slice().sort((x, y) => x.original - y.original).map(o => o.text), d.correct, d.explanation));
    const mq = quizTemplate(`${a.quizTitle} — Mistakes`); mq.subject = src?.subject || 'Revision'; mq.settings = { ...(src?.settings || mq.settings), shuffleQ: false }; mq.questions = qs;
    db.quizzes.unshift(mq); save(); toast(`${qs.length} questions saved as "${mq.title}"`); chooseMode(mq.id);
  });
}

/* ------------------------------ REPORTS ------------------------------ */
function reports() {
  const at = db.attempts, avg = at.length ? Math.round(at.reduce((s, a) => s + a.percent, 0) / at.length) : 0, best = at.length ? Math.max(...at.map(a => a.percent)) : 0, correct = at.reduce((s, a) => s + a.correct, 0), total = at.reduce((s, a) => s + a.total, 0);
  const trend = at.slice(0, 12).reverse();
  view.innerHTML = `<div class="page-title"><div><div class="eyebrow">YOUR PROGRESS</div><h1>Performance analytics</h1><p>Your personal progress, calculated from locally saved attempts.</p></div><button class="secondary" id="exportAllReports">⇩ Export backup</button></div><div class="stats-grid"><div class="stat-card"><small>TOTAL ATTEMPTS</small><strong>${at.length}</strong><span>All completed quizzes</span></div><div class="stat-card"><small>AVERAGE SCORE</small><strong>${avg}%</strong><span>Across attempts</span></div><div class="stat-card"><small>BEST SCORE</small><strong>${best}%</strong><span>Personal best</span></div><div class="stat-card"><small>ACCURACY</small><strong>${total ? Math.round(correct / total * 100) : 0}%</strong><span>${correct} correct of ${total}</span></div></div>
  ${trend.length > 1 ? `<div class="panel trend"><div class="panel-head"><div><h3>Score trend</h3><p>Last ${trend.length} attempts</p></div></div><div class="bars">${trend.map(a => `<div class="bar" title="${esc(a.quizTitle)} · ${a.percent}%"><i style="height:${Math.max(4, a.percent)}%"></i><small>${a.percent}</small></div>`).join('')}</div></div>` : ''}
  <div class="panel"><div class="panel-head"><div><h3>Recent attempts</h3><p>Review results and download reports.</p></div>${at.length ? '<button class="textbtn danger-text" id="clearAttempts">Clear history</button>' : ''}</div>${at.length ? at.slice(0, 50).map(a => `<div class="attempt-row"><div class="attempt-icon">▥</div><div class="quiz-info"><b>${esc(a.quizTitle)}</b><small>${new Date(a.date).toLocaleString()} · ${a.correct}/${a.total} correct${a.mode ? ` · ${a.mode}` : ''}</small></div><strong class="${a.percent >= 60 ? 'green-text' : 'amber-text'}">${a.percent}%</strong><button class="textbtn" data-report="${a.id}">Review ↗</button></div>`).join('') : '<div class="empty-mini"><span>▥</span><b>No attempts yet</b><small>Complete a quiz to see your analytics here.</small></div>'}</div><div class="footer-note">Your performance data is stored locally. Export a backup regularly.</div>`;
  $('#exportAllReports').onclick = backup;
  $$('[data-report]').forEach(b => b.onclick = () => { const a = at.find(x => x.id === b.dataset.report); if (a) renderResult(a); });
  $('#clearAttempts')?.addEventListener('click', async () => { if (await confirmBox('Clear history?', 'All attempt results will be deleted. Quizzes stay.', 'Clear', true)) { db.attempts = []; save(); reports(); } });
}

/* ------------------------------ TOOLS ------------------------------ */
function tools() {
  view.innerHTML = `<div class="page-title"><div><div class="eyebrow">IMPORT · EXPORT · TRANSFORM</div><h1>File studio</h1><p>Work with your quiz files on this device.</p></div></div><div class="tool-grid">
  <div class="tool-card featured"><div class="tool-icon">📄</div><h3>PDF → TXT converter</h3><p>VisionIAS, ForumIAS SFG, Vajiram & Ravi, PW Only IAS, ForumIAS 100 and any text PDF. Converts to the 😂 quiz format.</p><button class="primary" id="pdfToTxt">Open converter</button></div>
  <div class="tool-card"><div class="tool-icon">⚡</div><h3>PW + Forum IAS suite</h3><p>Original supplied coaching converter with PW Only IAS and ForumIAS formats. Converted TXT can be imported directly into QUIZINOX.</p><button class="secondary" id="openCoachingSuite">Open PW + Forum suite</button></div>
  <div class="tool-card"><div class="tool-icon">⇧</div><h3>Import questions</h3><p>Load TXT, JSON or PDF files. Questions are detected automatically and saved as a quiz.</p><button class="secondary" id="toolImport">Choose a file</button></div>
  <div class="tool-card"><div class="tool-icon">🧹</div><h3>TXT fixer</h3><p>Removes blank lines after "…following:" headings, trailing spaces and extra empty lines.</p><button class="secondary" id="txtFix">Fix a TXT file</button></div>
  <div class="tool-card"><div class="tool-icon">😂</div><h3>Emoji formatter</h3><p>Converts Q.1) / numbered questions into the 😂-separated quiz format, expanding 1️⃣ 2️⃣ points.</p><button class="secondary" id="txtFormat">Format a TXT file</button></div>
  <div class="tool-card"><div class="tool-icon">⇩</div><h3>Backup & restore</h3><p>Export all quizzes, attempts and settings to one JSON file, or restore one.</p><button class="secondary" id="backupBtn">Export backup</button><button class="textbtn" id="restoreBtn">Restore from backup →</button></div>
  <div class="tool-card"><div class="tool-icon">📤</div><h3>Export quiz</h3><p>Save a quiz as JSON, TXT (😂 format) or a printable PDF.</p><button class="secondary" id="exportPick">Choose quiz to export</button></div>
  <div class="tool-card"><div class="tool-icon">✦</div><h3>AI question generator</h3><p>Online · Gemini. Generate MCQs from a topic or from your own notes / PDF.</p><button class="secondary" id="aiOpen">Open AI generator</button></div>
  </div><div class="notice">🔐 Files are processed on your device. Scanned (image-only) PDFs have no text layer — use the AI generator with a text PDF instead.</div>`;
  $('#toolImport').onclick = () => $('#fileInput').click(); $('#pdfToTxt').onclick = () => openPdfStudio(); $('#openCoachingSuite').onclick = () => openCoachingSuite(); $('#txtFix').onclick = () => txtTool('fix'); $('#txtFormat').onclick = () => txtTool('format'); $('#backupBtn').onclick = backup; $('#restoreBtn').onclick = () => $('#restoreInput').click();
  $('#exportPick').onclick = () => { if (!db.quizzes.length) return toast('No quizzes to export'); actionSheet('Export which quiz?', '', db.quizzes.slice(0, 30).map(q => ({ icon: '▤', label: q.title, hint: `${q.questions.length} questions`, run: () => exportQuiz(q) }))); };
  $('#aiOpen').onclick = () => aiGenerator();
}
function pickFile(accept) { return new Promise(res => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.onchange = () => res(inp.files[0] || null); inp.click(); }); }
function openPdfStudio() {
  const engines = {
    generic: { name: 'Any PDF (auto)', hint: 'Normal text PDFs — auto-detects SFG-style Q./Ans./Exp. layouts', two: false },
    sfg: { name: 'ForumIAS SFG', hint: 'Single PDF with questions, Ans) and Exp) — 50 Q', two: false },
    vajiram: { name: 'Vajiram & Ravi', hint: 'Test booklet PDF + Solution PDF — 100 Q', two: true },
    vision: { name: 'VisionIAS', hint: 'Test booklet PDF + Solution PDF ("Q 1.A" answers) — 100 Q', two: true },
  };
  const st = { engine: 'generic', test: null, sol: null, result: null };
  const { el, close } = modal(`<div class="eyebrow">PDF → TXT · ON DEVICE</div><h2>Coaching PDF converter</h2><p>Choose the coaching format, select the PDF(s) and convert.</p>
   <div class="engine-grid">${Object.entries(engines).map(([k, e]) => `<button class="engine ${k === 'generic' ? 'active' : ''}" data-engine="${k}"><b>${e.name}</b><small>${e.hint}</small></button>`).join('')}</div>
   <div class="file-slots"><button class="file-slot" id="slotTest"><span>📄</span><b id="testLabel">Select PDF</b><small id="testName">No file chosen</small></button><button class="file-slot" id="slotSol" hidden><span>🧾</span><b>Select Solution PDF</b><small id="solName">No file chosen</small></button></div>
   <div class="progress small" id="pdfProg" hidden><i style="width:0%"></i></div><div class="muted" id="pdfStatus"></div>
   <div id="pdfResult"></div>
   <div class="dialog-actions"><button class="primary" id="runPdf" disabled>Convert</button></div>`, { wide: true });
  const refresh = () => {
    const e = engines[st.engine];
    $$('.engine', el).forEach(b => b.classList.toggle('active', b.dataset.engine === st.engine));
    $('#slotSol', el).hidden = !e.two; $('#testLabel', el).textContent = e.two ? 'Select Test PDF' : 'Select PDF';
    $('#testName', el).textContent = st.test?.name || 'No file chosen'; $('#solName', el).textContent = st.sol?.name || 'No file chosen';
    $('#runPdf', el).disabled = !st.test || (e.two && !st.sol);
  };
  $$('.engine', el).forEach(b => b.onclick = () => { st.engine = b.dataset.engine; st.result = null; $('#pdfResult', el).innerHTML = ''; refresh(); });
  $('#slotTest', el).onclick = async () => { const f = await pickFile('.pdf,application/pdf'); if (f) { st.test = f; refresh(); } };
  $('#slotSol', el).onclick = async () => { const f = await pickFile('.pdf,application/pdf'); if (f) { st.sol = f; refresh(); } };
  const prog = (pct, msg) => { const p = $('#pdfProg', el); p.hidden = false; $('i', p).style.width = pct + '%'; $('#pdfStatus', el).textContent = msg; };
  $('#runPdf', el).onclick = async () => {
    const btn = $('#runPdf', el); btn.disabled = true; btn.textContent = 'Converting…';
    try {
      prog(3, 'Opening PDF…');
      const testPages = await extractPages(st.test, (p, m) => prog(5 + p * (engines[st.engine].two ? .4 : .75), m));
      if (!testPages.some(p => p.items.length)) throw Error('This PDF has no selectable text (it is scanned/image-only).');
      let res;
      if (st.engine === 'generic') {
        const raw = genericText(testPages); const sfg = sfgFormat(raw);
        const nSfg = (sfg.match(/^Q\d+\./gm) || []).length, nRaw = parseText(raw).length;
        res = nSfg >= Math.max(3, nRaw) ? countResult(sfg) : countResult(raw, nRaw);
        res.note = nSfg >= Math.max(3, nRaw) ? 'Detected Q./Ans./Exp. layout — converted to 😂 quiz format.' : 'Extracted plain text.';
      } else if (st.engine === 'sfg') res = processSFG(testPages);
      else {
        const solPages = await extractPages(st.sol, (p, m) => prog(50 + p * .35, 'Solution: ' + m));
        prog(90, 'Matching answers and explanations…');
        res = st.engine === 'vajiram' ? processVajiram(testPages, solPages) : processVision(testPages, solPages);
      }
      if (!res.output.trim()) throw Error('No text could be extracted from this PDF.');
      if (st.engine === 'sfg' && !res.questionCount) throw Error('No SFG questions found. Questions must start like "Q.1)" with "Ans)" and "Exp)" lines. Try "Any PDF (auto)".');
      st.result = res; prog(100, 'Done ✓');
      const s = res.stats;
      $('#pdfResult', el).innerHTML = `<div class="convert-stats"><div><strong>${res.questionCount}</strong><small>questions</small></div><div><strong>${s?.matched ?? '—'}</strong><small>answers ✅</small></div><div><strong>${s?.explanationsFound ?? '—'}</strong><small>explanations</small></div></div>${res.note ? `<div class="muted">${esc(res.note)}</div>` : ''}${s && s.noAns ? `<div class="muted amber-text">${s.noAns} question(s) without a matched answer — check them before playing.</div>` : ''}<textarea class="txt-preview" readonly>${esc(res.output.slice(0, 20000))}</textarea><div class="dialog-actions"><button class="secondary" id="dlTxt">⇩ Save TXT</button><button class="secondary" id="copyTxt">⎘ Copy</button><button class="primary" id="importTxt" ${parseText(res.output).length ? '' : 'disabled'}>＋ Save as quiz</button></div>`;
      const base = st.test.name.replace(/\.pdf$/i, '');
      $('#dlTxt', el).onclick = async () => { const r = await saveFile(`${base}.txt`, res.output, 'text/plain'); toast(`TXT saved (${r.where}) ✓`); };
      $('#copyTxt', el).onclick = async () => { try { await navigator.clipboard.writeText(res.output); toast('Copied'); } catch { $('.txt-preview', el).select(); document.execCommand('copy'); toast('Copied'); } };
      $('#importTxt', el).onclick = () => { const qs = parseText(res.output); if (!qs.length) return toast('No questions detected'); const q = quizTemplate(base); q.subject = engines[st.engine].name.replace(' (auto)', ''); q.questions = qs; db.quizzes.unshift(q); save(); close(); toast(`${qs.length} questions saved as a quiz ✓`); setTab('quizzes'); };
    } catch (e) { console.error(e); prog(100, ''); $('#pdfStatus', el).innerHTML = `<span class="red-text">✕ ${esc(e.message || e)}</span>`; }
    finally { btn.textContent = 'Convert'; refresh(); }
  };
  refresh();
}
function countResult(output, n) { const qc = n ?? (output.match(/^Q\d+\./gm) || []).length; const m = (output.match(/✅/g) || []).length; const ex = (output.match(/^Ex:/gm) || []).length; return { output, questionCount: qc, stats: { matched: m, noAns: Math.max(0, qc - m), explanationsFound: ex } }; }
async function txtTool(mode) {
  const f = await pickFile('.txt,text/plain'); if (!f) return;
  const t = await f.text(); let out, msg;
  if (mode === 'fix') { const r = fixQuestionsFile(t); out = r.text; msg = `Fixed — ${r.removed} blank line(s) removed`; }
  else { out = convertFormat(t); msg = 'Formatted to 😂 quiz format'; }
  const n = parseText(out).length;
  const { el, close } = modal(`<div class="eyebrow">${mode === 'fix' ? 'TXT FIXER' : 'EMOJI FORMATTER'}</div><h2>${esc(f.name)}</h2><p>${msg}${n ? ` · ${n} questions detected` : ''}</p><textarea class="txt-preview" readonly>${esc(out.slice(0, 20000))}</textarea><div class="dialog-actions"><button class="secondary" id="dl">⇩ Save TXT</button><button class="primary" id="imp" ${n ? '' : 'disabled'}>＋ Save as quiz</button></div>`, { wide: true });
  $('#dl', el).onclick = async () => { const r = await saveFile(f.name.replace(/\.txt$/i, '') + (mode === 'fix' ? '_fixed' : '_formatted') + '.txt', out, 'text/plain'); toast(`Saved (${r.where}) ✓`); };
  $('#imp', el).onclick = () => { const q = quizTemplate(f.name.replace(/\.txt$/i, '')); q.questions = parseText(out); db.quizzes.unshift(q); save(); close(); toast(`${q.questions.length} questions imported ✓`); setTab('quizzes'); };
}
async function importFile(file) {
  try {
    const ext = file.name.split('.').pop().toLowerCase(), name = file.name.replace(/\.[^.]+$/, '');
    let qs = [];
    if (ext === 'pdf') {
      toast('Reading PDF on device…', 8000);
      const pages = await extractPages(file);
      if (!pages.some(p => p.items.length)) return toast('This PDF has no selectable text (scanned). Try the AI generator.');
      const raw = genericText(pages);
      const a = parseText(raw), b = parseText(sfgFormat(raw));
      qs = b.length > a.length ? b : a;
      if (!qs.length) { toast('No MCQs found. For Vajiram / VisionIAS use File Studio → PDF converter.', 5000); return; }
    } else {
      const text = await file.text();
      if (ext === 'json') { const obj = JSON.parse(text); if (obj?.app === 'QUIZINOX' && obj.data) return restoreBackup(file); qs = parseJSON(text); if (obj?.title && qs.length) { const q = { ...quizTemplate(obj.title), ...obj, id: uid(), questions: qs, settings: { ...quizTemplate().settings, ...(obj.settings || {}) } }; db.quizzes.unshift(q); save(); toast(`${qs.length} questions imported ✓`); setTab('quizzes'); return; } }
      else qs = parseText(text);
    }
    if (!qs.length) { toast('No MCQs detected. Questions need numbering (Q1. / 1.) and options.', 4500); return; }
    const q = quizTemplate(name || 'Imported quiz'); q.questions = qs; db.quizzes.unshift(q); save();
    toast(`${qs.length} questions imported ✓`); setTab('quizzes');
  } catch (e) { console.error(e); toast('Could not read this file: ' + e.message, 4500); }
}
function parseJSON(t) {
  const obj = typeof t === 'string' ? JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, '')) : t; const arr = Array.isArray(obj) ? obj : obj.questions || [];
  return arr.map(x => {
    const opts = Array.isArray(x.options) ? x.options.map(o => typeof o === 'string' ? o : (o.text ?? '')) : [];
    let c = x.correct_option_id ?? x.correct ?? x.answer ?? x.correctIndex ?? 0;
    if (typeof c === 'string') { const k = c.trim().toUpperCase().replace(/[().]/g, ''); c = /^[A-H]$/.test(k) ? k.charCodeAt(0) - 65 : /^\d+$/.test(k) ? Number(k) : Math.max(0, opts.findIndex(o => o.trim().toLowerCase() === c.trim().toLowerCase())); }
    return question(String(x.question || x.question_text || x.text || '').trim(), opts.map(o => String(o).trim()), c, x.explanation || '');
  }).filter(q => q.text && q.options.length >= 2 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length);
}
function quizToTxt(q) { return q.questions.map((x, i) => `Q${i + 1}. ${x.text}\n😂\n${x.options.map((o, j) => j === x.correct ? `${o} ✅` : o).join('\n')}${x.explanation ? `\nEx: ${x.explanation}` : ''}`).join('\n\n') + '\n'; }
function exportQuiz(q) {
  actionSheet(`Export "${q.title}"`, 'Choose a format', [
    { icon: '{ }', label: 'JSON', hint: 'Full quiz with settings — re-import anytime', run: async () => { const r = await saveFile(slug(q.title) + '.json', JSON.stringify(q, null, 2), 'application/json'); toast(`Saved (${r.where}) ✓`); } },
    { icon: '😂', label: 'TXT (quiz format)', hint: 'Q1. … 😂 … ✅ … Ex:', cls: 'practice-icon', run: async () => { const r = await saveFile(slug(q.title) + '.txt', quizToTxt(q), 'text/plain'); toast(`Saved (${r.where}) ✓`); } },
    { icon: '⎙', label: 'PDF question paper', hint: 'Questions + answer key', run: () => exportQuizPDF(q) },
  ]);
}
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'quiz'; }
function backup() { saveFile(`quizinox-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'QUIZINOX', version: 2, exportedAt: new Date().toISOString(), data: { ...db, settings: { ...db.settings, geminiKey: '' } } }, null, 2), 'application/json').then(r => toast(`Backup saved (${r.where}) ✓`)); }
async function restoreBackup(file) {
  try {
    const b = JSON.parse(await file.text()); const d = b.data || b;
    if (!Array.isArray(d.quizzes) || !Array.isArray(d.attempts)) throw Error('Not a QUIZINOX backup file');
    actionSheet('Restore backup', `${d.quizzes.length} quizzes · ${d.attempts.length} attempts`, [
      { icon: '⊕', label: 'Merge with current data', hint: 'Keeps your current quizzes, adds missing ones', cls: 'practice-icon', run: () => { const qIds = new Set(db.quizzes.map(q => q.id)), aIds = new Set(db.attempts.map(a => a.id)); db.quizzes.push(...d.quizzes.filter(q => !qIds.has(q.id))); db.attempts.push(...d.attempts.filter(a => !aIds.has(a.id))); db.attempts.sort((x, y) => String(y.date).localeCompare(String(x.date))); save(); setTab('home'); toast('Backup merged ✓'); } },
      { icon: '↺', label: 'Replace everything', hint: 'Current data on this device is replaced', danger: true, cls: 'danger-icon', run: () => { const key = db.settings.geminiKey; db = { ...defaultState(), ...d, settings: { ...defaultState().settings, ...(d.settings || {}) } }; if (!db.settings.geminiKey) db.settings.geminiKey = key; save(); $('#profileName').textContent = db.settings.name || 'Learner'; setTab('home'); toast('Backup restored ✓'); } },
    ]);
  } catch (e) { toast('Backup invalid: ' + e.message); }
}

/* ------------------------------ PDF REPORTS ------------------------------ */
// jsPDF core fonts only cover Latin-1; strip unsupported characters so the PDF never breaks.
const pdfSafe = s => String(s ?? '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
function pdfWriter(title) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' }); let y = 18;
  const ensure = h => { if (y + h > 284) { doc.addPage(); y = 16; } };
  const text = (t, x = 14, size = 10, style = 'normal', width = 182, color = [20, 24, 36]) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); const lines = doc.splitTextToSize(pdfSafe(t), width); const lh = size * 0.45; ensure(lines.length * lh); doc.text(lines, x, y); y += lines.length * lh + 1.2; };
  doc.setFillColor(17, 24, 39); doc.rect(0, 0, 210, 12, 'F'); doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.text('QUIZINOX', 14, 8); y = 22;
  text(title, 14, 17, 'bold');
  return { doc, text, gap: (h = 3) => { y += h; }, ensure };
}
function exportAttemptPDF(a) {
  const w = pdfWriter('Result Report');
  w.text(a.quizTitle, 14, 12, 'bold'); w.text(`Date: ${new Date(a.date).toLocaleString()}${a.durationSec ? `   Time taken: ${fmtDur(a.durationSec)}` : ''}`);
  w.text(`Score: ${a.percent}%   Marks: ${a.score}/${a.total}   Correct: ${a.correct}   Wrong: ${a.wrong}   Unanswered: ${a.blank}`, 14, 11, 'bold'); w.gap(4);
  a.details.forEach((d, i) => {
    const idx = o => d.options.findIndex(x => x.original === o);
    w.text(`${i + 1}. ${d.question}`, 14, 10, 'bold');
    d.options.forEach((o, j) => w.text(`${L(j)}. ${o.text}${o.original === d.correct ? '  (correct)' : o.original === d.selected ? '  (your answer)' : ''}`, 18, 9, o.original === d.correct ? 'bold' : 'normal', 176, o.original === d.correct ? [10, 120, 80] : o.original === d.selected ? [190, 40, 60] : [60, 66, 80]));
    w.text(`Your answer: ${d.selected == null ? 'Not answered' : L(idx(d.selected))}  |  Correct: ${L(idx(d.correct))}  |  ${d.status.toUpperCase()}`, 18, 9, 'italic');
    if (d.explanation) w.text('Explanation: ' + d.explanation, 18, 9, 'normal', 176, [70, 76, 92]);
    w.gap(3);
  });
  saveFile(`${slug(a.quizTitle)}-result.pdf`, w.doc.output('blob'), 'application/pdf').then(r => toast(`PDF saved (${r.where}) ✓`));
}
function exportQuizPDF(q) {
  const w = pdfWriter(q.title);
  w.text(`${q.questions.length} questions · ${q.subject || 'General'}${q.settings.negative ? ` · Negative: -${q.settings.negative}` : ''}`, 14, 10, 'italic'); w.gap(3);
  q.questions.forEach((x, i) => { w.text(`${i + 1}. ${x.text}`, 14, 10, 'bold'); x.options.forEach((o, j) => w.text(`${L(j)}. ${o}`, 18, 9.5)); w.gap(2.5); });
  w.doc.addPage(); w.text('Answer key & explanations', 14, 14, 'bold');
  q.questions.forEach((x, i) => { w.text(`${i + 1}. ${L(x.correct)}${x.explanation ? ' — ' + x.explanation : ''}`, 14, 9.5); });
  saveFile(`${slug(q.title)}.pdf`, w.doc.output('blob'), 'application/pdf').then(r => toast(`PDF saved (${r.where}) ✓`));
}

/* ------------------------------ AI (ONLINE) ------------------------------ */
async function gemini(prompt, { json = true } = {}) {
  const key = db.settings.geminiKey; if (!key) throw Error('Add your Gemini API key in Settings first');
  if (!navigator.onLine) throw Error('No internet connection. AI needs internet — offline features still work.');
  const model = db.settings.aiModel || AI_MODELS[0];
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: json ? { responseMimeType: 'application/json', temperature: 0.6 } : { temperature: 0.4 } }) });
    if (!res.ok) { let m = `Gemini error ${res.status}`; try { const e = await res.json(); m = e.error?.message || m; } catch { /* */ } if (res.status === 400 && /API key/i.test(m)) m = 'Invalid Gemini API key'; if (res.status === 429) m = 'Gemini rate limit / quota reached. Try again later or switch model in Settings.'; if (res.status === 404) m = `Model "${model}" not available. Pick another model in Settings.`; throw Error(m); }
    const data = await res.json(); const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!raw) throw Error('Empty AI response'); return raw;
  } catch (e) { if (e.name === 'AbortError') throw Error('AI request timed out'); throw e; } finally { clearTimeout(timer); }
}
function aiGenerator() {
  if (!db.settings.geminiKey) { toast('Add your Gemini API key in Settings first'); setTab('settings'); return; }
  let sourceText = '';
  const { el, close } = modal(`<div class="eyebrow">AI · ONLINE</div><h2>AI question generator</h2><p>Generate MCQs from a topic, or from your own notes / PDF.</p>
   <label>Topic or instructions<input id="aiTopic" placeholder="e.g. Indian Constitution — Fundamental Rights"/></label>
   <div class="file-slots"><button class="file-slot" id="aiSrc"><span>📄</span><b>Use notes / PDF (optional)</b><small id="aiSrcName">TXT or text PDF</small></button></div>
   <div class="form-grid"><label>Questions<select id="aiCount">${[5, 10, 15, 20, 25, 30, 40, 50].map(n => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>Language<select id="aiLang"><option>English</option><option>Hindi</option><option>Bilingual (English + Hindi)</option></select></label><label>Difficulty<select id="aiDiff"><option>Mixed</option><option>Easy</option><option>Moderate</option><option>Hard (UPSC level)</option></select></label></div>
   <div class="muted" id="aiStatus"></div><div class="dialog-actions"><button class="primary" id="aiGo">✦ Generate</button></div>`, { wide: true });
  $('#aiSrc', el).onclick = async () => { const f = await pickFile('.txt,.pdf,text/plain,application/pdf'); if (!f) return; $('#aiSrcName', el).textContent = 'Reading…'; try { sourceText = /\.pdf$/i.test(f.name) ? genericText(await extractPages(f)) : await f.text(); if (!sourceText.trim()) throw Error('No text found'); $('#aiSrcName', el).textContent = `${f.name} · ${sourceText.length.toLocaleString()} chars`; if (!$('#aiTopic', el).value) $('#aiTopic', el).value = f.name.replace(/\.[^.]+$/, ''); } catch (e) { sourceText = ''; $('#aiSrcName', el).textContent = 'Could not read: ' + e.message; } };
  $('#aiGo', el).onclick = async () => {
    const topic = $('#aiTopic', el).value.trim(); if (!topic && !sourceText) return toast('Enter a topic or choose a file');
    const count = Number($('#aiCount', el).value), lang = $('#aiLang', el).value, diff = $('#aiDiff', el).value;
    const btn = $('#aiGo', el); btn.disabled = true; btn.textContent = 'Generating…'; $('#aiStatus', el).textContent = 'Talking to Gemini — this can take up to a minute.';
    try {
      const prompt = `Create exactly ${count} high-quality multiple-choice questions${topic ? ` on "${topic}"` : ''}. Difficulty: ${diff}. Language: ${lang}.${sourceText ? `\nBase every question strictly on this source material:\n"""${sourceText.slice(0, 60000)}"""` : ''}\nEach question must have exactly 4 options, one correct answer and a short explanation.\nReturn ONLY JSON: {"questions":[{"question":"...","options":["...","...","...","..."],"correct":0,"explanation":"..."}]} where correct is the zero-based index.`;
      const qs = parseJSON(await gemini(prompt)); if (!qs.length) throw Error('AI returned no valid questions');
      const q = quizTemplate((topic || 'Notes') + ' — AI Quiz'); q.subject = 'AI generated'; q.questions = qs; db.quizzes.unshift(q); save(); close(); toast(`${qs.length} AI questions created ✓`); setTab('quizzes');
    } catch (e) { $('#aiStatus', el).innerHTML = `<span class="red-text">✕ ${esc(e.message)}</span>`; } finally { btn.disabled = false; btn.textContent = '✦ Generate'; }
  };
}
const QUIZ_LANGS = Object.fromEntries(`hi:Hindi|bn:Bengali|te:Telugu|mr:Marathi|ta:Tamil|gu:Gujarati|ur:Urdu|kn:Kannada|ml:Malayalam|pa:Punjabi|or:Odia|as:Assamese|ne:Nepali|sa:Sanskrit|sd:Sindhi|gom:Konkani|mai:Maithili|doi:Dogri|bho:Bhojpuri|mni-Mtei:Manipuri|si:Sinhala|af:Afrikaans|sq:Albanian|am:Amharic|ar:Arabic|hy:Armenian|ay:Aymara|az:Azerbaijani|bm:Bambara|eu:Basque|be:Belarusian|bs:Bosnian|bg:Bulgarian|ca:Catalan|ceb:Cebuano|ny:Chichewa|zh-CN:Chinese Simplified|zh-TW:Chinese Traditional|co:Corsican|hr:Croatian|cs:Czech|da:Danish|dv:Dhivehi|nl:Dutch|en:English|eo:Esperanto|et:Estonian|tl:Filipino|fi:Finnish|fr:French|fy:Frisian|gl:Galician|ka:Georgian|de:German|el:Greek|gn:Guarani|ht:Haitian Creole|ha:Hausa|haw:Hawaiian|iw:Hebrew|hmn:Hmong|hu:Hungarian|is:Icelandic|ig:Igbo|ilo:Ilocano|id:Indonesian|ga:Irish|it:Italian|ja:Japanese|jw:Javanese|kk:Kazakh|km:Khmer|rw:Kinyarwanda|ko:Korean|ku:Kurdish|ky:Kyrgyz|lo:Lao|la:Latin|lv:Latvian|ln:Lingala|lt:Lithuanian|lg:Luganda|lb:Luxembourgish|mk:Macedonian|mg:Malagasy|ms:Malay|mt:Maltese|mi:Maori|mn:Mongolian|my:Myanmar|no:Norwegian|om:Oromo|ps:Pashto|fa:Persian|pl:Polish|pt:Portuguese|qu:Quechua|ro:Romanian|ru:Russian|sm:Samoan|gd:Scots Gaelic|sr:Serbian|st:Sesotho|sn:Shona|sk:Slovak|sl:Slovenian|so:Somali|es:Spanish|su:Sundanese|sw:Swahili|sv:Swedish|tg:Tajik|tt:Tatar|th:Thai|ti:Tigrinya|tr:Turkish|tk:Turkmen|ak:Twi|uk:Ukrainian|ug:Uyghur|uz:Uzbek|vi:Vietnamese|cy:Welsh|xh:Xhosa|yi:Yiddish|yo:Yoruba|zu:Zulu`.split('|').map(x=>{const i=x.indexOf(':');return [x.slice(0,i),x.slice(i+1)]}));
const languageLabel = c => QUIZ_LANGS[c] || c;
const TSEP='ZXQLINESEPZX', tCache=new Map();
async function translateBatch(texts,tl,sl='auto'){
  if(!navigator.onLine)throw Error('Internet connection required.');
  const out=new Array(texts.length), ids=[]; texts.forEach((x,i)=>{if(String(x||'').trim())ids.push(i);else out[i]=x;});
  const batches=[];let b=[],n=0;for(const i of ids){const z=String(texts[i]).length+TSEP.length+4;if(b.length&&n+z>3000){batches.push(b);b=[];n=0;}b.push(i);n+=z;}if(b.length)batches.push(b);
  async function one(input,ep){const url=ep===1?`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t`:`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}`;const c=new AbortController(),tm=setTimeout(()=>c.abort(),25000);try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'q='+encodeURIComponent(input),signal:c.signal});if(!r.ok)throw Error('Translation service HTTP '+r.status);const d=await r.json();if(ep===1&&Array.isArray(d?.[0]))return d[0].map(x=>x?.[0]||'').join('');const x=Array.isArray(d)?d[0]:null;if(Array.isArray(x))return String(x[0]||'');if(typeof x==='string')return x;if(d?.sentences)return d.sentences.map(x=>x.trans||'').join('');throw Error('Unexpected translation response');}finally{clearTimeout(tm);}}
  async function run(g,depth=0){const input=g.map(i=>texts[i]).join('\n'+TSEP+'\n'),key=sl+'|'+tl+'|'+input;try{let val=tCache.get(key);if(!val){let err;for(let k=0;k<4;k++){try{val=await one(input,k%2?2:1);tCache.set(key,val);break;}catch(e){err=e;await new Promise(r=>setTimeout(r,400*(k+1)));}}if(val==null)throw err||Error('Translation failed');}const parts=val.split(new RegExp(`\\s*${TSEP}\\s*`,'i'));if(parts.length!==g.length&&g.length>1)throw Error('Batch formatting changed');g.forEach((i,j)=>out[i]=parts[j]||texts[i]);}catch(e){if(g.length>1&&depth<3){const m=Math.ceil(g.length/2);await Promise.all([run(g.slice(0,m),depth+1),run(g.slice(m),depth+1)]);}else throw e;}}
  let nextBatch=0;await Promise.all(Array.from({length:Math.min(6,batches.length)},async()=>{while(nextBatch<batches.length){const i=nextBatch++;await run(batches[i]);}}));return out;
}
async function translateQuestionSet(qs,code){const flat=[],map=[];qs.forEach((q,i)=>{flat.push(q.text);map.push([i,'q']);q.options.forEach((o,j)=>{flat.push(o);map.push([i,'o',j]);});flat.push(q.explanation||'');map.push([i,'e']);});const tr=await translateBatch(flat,code);const out=qs.map(q=>({...q,options:[...q.options]}));map.forEach((m,i)=>{if(m[1]==='q')out[m[0]].text=tr[i]||qs[m[0]].text;else if(m[1]==='o')out[m[0]].options[m[2]]=tr[i]||qs[m[0]].options[m[2]];else out[m[0]].explanation=tr[i]||qs[m[0]].explanation;});return out;}
async function ensureQuizTranslation(q,code,status=()=>{}){if(code==='original')return q.questions;q.translations||={};if(q.translations[code]?.length===q.questions.length)return q.translations[code];status(`Bulk translating ${q.questions.length} questions into ${languageLabel(code)}…`);const out=await translateQuestionSet(q.questions,code);q.translations[code]=out;save();return out;}
function chooseLanguage(q,callback,current='original'){const opts=Object.entries(QUIZ_LANGS).map(([c,n])=>`<option value="${esc(c)}">${esc(n)} (${c})</option>`).join('');const {el,close}=modal(`<div class="eyebrow">ONLINE · BULK TRANSLATION</div><h2>Switch quiz language</h2><p>Question, every option and explanation are translated together. The original remains unchanged.</p><label>Language<select id="langPick"><option value="original">Original</option>${opts}</select></label><div class="muted" id="langStatus">Requires internet. Public Google translation endpoints may rate-limit.</div><div class="dialog-actions"><button class="primary" id="langApply">Translate / Switch</button></div>`,{wide:true});$('#langPick',el).value=current;$('#langApply',el).onclick=async()=>{const code=$('#langPick',el).value,b=$('#langApply',el);b.disabled=true;b.textContent='Translating…';try{await callback(code,m=>$('#langStatus',el).textContent=m);close();}catch(e){$('#langStatus',el).textContent='Translation failed: '+e.message;b.disabled=false;b.textContent='Retry';}};}
function openPlayerLanguagePicker(){if(!play)return;chooseLanguage(play.quiz,async(code,status)=>{const qs=await ensureQuizTranslation(play.quiz,code,status);play.questions=qs.map(q=>({...q,options:q.options.map((t,i)=>({text:t,original:i}))}));play.language=code==='original'?'':code;play.languageName=code==='original'?'':languageLabel(code);play.index=Math.min(play.index,play.questions.length-1);savePlay();renderPlayer();},play.language||'original');}
async function translateQuiz(q){chooseLanguage(q,async(code,status)=>{if(code==='original')return;await ensureQuizTranslation(q,code,status);toast(`${languageLabel(code)} translation saved ✓`);render();});}
function openCoachingSuite(){const url=import.meta.env.BASE_URL+'tools/coaching-suite.html';modal(`<div class="eyebrow">PW + FORUM IAS · ORIGINAL TOOL</div><h2>Coaching PDF Converter Suite</h2><p>PW Only IAS, ForumIAS 100, SFG, VisionIAS and Vajiram. Downloaded TXT files are detected and can be imported into QUIZINOX.</p><iframe title="Coaching converter" src="${url}" style="width:100%;height:74vh;border:1px solid var(--line);border-radius:12px;background:#080808"></iframe>`,{wide:true});}
window.addEventListener('message',ev=>{if(ev.data?.type!=='QUIZINOX_COACHING_TXT')return;const txt=String(ev.data.text||''),name=String(ev.data.name||'Coaching Test').replace(/\.txt$/i,'');const qs=parseText(txt);if(!qs.length)return toast('TXT received but MCQs could not be parsed.');const q=quizTemplate(name);q.subject=ev.data.coaching||'Coaching PDF';q.questions=qs;const {el,close}=modal(`<div class="eyebrow">CONVERSION COMPLETE</div><h2>${esc(name)}</h2><p>${qs.length} questions detected.</p><textarea class="txt-preview" readonly>${esc(txt.slice(0,15000))}</textarea><div class="dialog-actions"><button class="secondary" id="coachingTxtSave">Save TXT</button><button class="primary" id="coachingImport">Import as QUIZINOX quiz</button></div>`,{wide:true});$('#coachingTxtSave',el).onclick=()=>saveFile(`${slug(name)}.txt`,txt,'text/plain');$('#coachingImport',el).onclick=()=>{db.quizzes.unshift(q);save();close();toast('Quiz imported ✓');setTab('quizzes');};});
function resultQuizForLanguage(a,code){const q=db.quizzes.find(x=>x.id===a.quizId);if(code!=='original'&&q?.translations?.[code])return {title:a.quizTitle,questions:q.translations[code]};if(code==='original'&&q?.questions)return {title:a.quizTitle,questions:q.questions};return {title:a.quizTitle,questions:a.details.map(d=>({text:d.question,options:d.options.slice().sort((x,y)=>x.original-y.original).map(x=>x.text),correct:d.options.findIndex(x=>x.original===d.correct),explanation:d.explanation||''}))};}
function setupResultArtifacts(a){
  const q=db.quizzes.find(x=>x.id===a.quizId),sel=$('#artifactLang'),target=$('#artifactTarget');if(!sel||!target)return;
  const refresh=()=>{sel.innerHTML='<option value="original">Original</option>'+Object.keys(q?.translations||{}).map(c=>`<option value="${esc(c)}">${esc(languageLabel(c))}</option>`).join('');};
  refresh();target.innerHTML=Object.entries(QUIZ_LANGS).map(([c,n])=>`<option value="${esc(c)}">${esc(n)}</option>`).join('');
  const cur=()=>resultQuizForLanguage(a,sel.value), name=(suffix,ext)=>`${slug(cur().title)}-${slug(languageLabel(sel.value))}-${suffix}.${ext}`;
  const getHtml=async(kind)=>kind==='quiz'?await makeSuppliedQuizHtml(cur(),languageLabel(sel.value)):kind==='notes'?buildNotesDoc(cur()):null;
  const download=async(kind)=>{try{if(kind==='quiz'||kind==='notes'){const html=await getHtml(kind);await saveFile(name(kind,'html'),html,'text/html');toast(`${kind==='quiz'?'Quiz':'Notes'} HTML downloaded ✓`);return;}const blob=await makeStudyPdf(cur(),kind);await saveFile(name(kind,'pdf'),blob,'application/pdf');toast('PDF downloaded ✓');}catch(e){console.error(e);toast('Could not create file: '+e.message,5000);}};
  const share=async(kind)=>{try{if(kind==='quiz'||kind==='notes'){const html=await getHtml(kind);await shareFile(name(kind,'html'),html,'text/html');}else{const blob=await makeStudyPdf(cur(),kind);await shareFile(name(kind,'pdf'),blob,'application/pdf');}}catch(e){console.error(e);toast('Share failed: '+e.message,5000);}};
  $('#artifactTranslate').onclick=async()=>{const c=target.value,b=$('#artifactTranslate');b.disabled=true;b.textContent='Translating…';try{await ensureQuizTranslation(q,c,m=>$('#artifactStatus').textContent=m);refresh();sel.value=c;$('#artifactStatus').textContent=`${languageLabel(c)} is ready. Exports now use this language.`;}catch(e){$('#artifactStatus').textContent='Translation failed: '+e.message;}finally{b.disabled=false;b.textContent='🌐 Translate / prepare language';}};
  [['downloadQuizHtml','quiz'],['downloadNotesHtml','notes'],['downloadTestPdf','test'],['downloadSolPdf','solution'],['downloadMergedPdf','merged'],['downloadNotesPdf','notespdf']].forEach(([id,k])=>$('#'+id).onclick=()=>download(k==='notespdf'?'notes-pdf':k));
  [['shareQuizHtml','quiz'],['shareNotesHtml','notes'],['shareTestPdf','test'],['shareSolPdf','solution'],['shareMergedPdf','merged'],['shareNotesPdf','notespdf']].forEach(([id,k])=>$('#'+id).onclick=()=>share(k==='notespdf'?'notes-pdf':k));
  $('#openTestMaker').onclick=()=>openSuppliedTool('test-series-maker',cur());$('#openNotesMaker').onclick=()=>openSuppliedTool('notes-generator',cur());$('#openQuizMaker').onclick=()=>openSuppliedTool('quiz-maker',cur());$('#openTranslatorTool').onclick=()=>openSuppliedTool('txt-pdf-translator',cur());
}

async function makeSuppliedQuizHtml(q,lang){
  const content=q.questions.map((x,i)=>`Q${i+1}. ${x.text}\n😂\n${x.options.map((o,j)=>o+(j===x.correct?' ✅':'')).join('\n')}${x.explanation?'\nEx: '+x.explanation:''}`).join('\n\n')+'\n';
  return new Promise((resolve,reject)=>{
    const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;top:0;width:1200px;height:900px';
    const timer=setTimeout(()=>{frame.remove();reject(new Error('Supplied Quiz Maker did not finish in time.'));},30000);
    const cleanup=()=>{clearTimeout(timer);frame.remove();};
    const receive=ev=>{if(ev.source!==frame.contentWindow||ev.data?.type!=='QUIZINOX_GENERATED_HTML')return;window.removeEventListener('message',receive);cleanup();resolve(ev.data.html);};
    window.addEventListener('message',receive);
    frame.onload=async()=>{try{const d=frame.contentDocument,w=frame.contentWindow,input=d.getElementById('file-input');if(!input)throw Error('Supplied Quiz Maker input was not found');const f=new File([content],`${slug(q.title)}.txt`,{type:'text/plain'});const dt=new w.DataTransfer();dt.items.add(f);input.files=dt.files;input.dispatchEvent(new w.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,250));const mode=d.querySelector('input[name="quiz-mode"][value="combined"]');if(mode)mode.checked=true;const trans=d.querySelector('input[name="translate-mode"][value="off"]');if(trans)trans.checked=true;const gen=d.getElementById('generate-btn');if(!gen)throw Error('Quiz Maker generate button not found');gen.click();}catch(e){window.removeEventListener('message',receive);cleanup();reject(e);}};
    frame.src=import.meta.env.BASE_URL+'tools/quiz-maker.html';document.body.appendChild(frame);
  });
}

function buildPrintDoc(q,mode='test'){
  const part=(x,i)=>`<section><b>Q${i+1}. ${esc(x.text)}</b>${x.options.map((o,j)=>`<p>${String.fromCharCode(65+j)}. ${esc(o)}</p>`).join('')}</section>`;
  const test=`<h1>${esc(q.title)} — Test</h1>${q.questions.map(part).join('')}`;
  const sol=`<h1>${esc(q.title)} — Solution & Answer Key</h1>${q.questions.map((x,i)=>`<section><b>Q${i+1}. ${String.fromCharCode(65+x.correct)}. ${esc(x.options[x.correct]||'')}</b><p>${esc(x.explanation||'No explanation provided.')}</p></section>`).join('')}`;
  const body=mode==='test'?test:mode==='solution'?sol:test+'<div style="break-before:page"></div>'+sol;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(q.title)}</title><style>body{font:12pt Arial,sans-serif;color:#111;margin:22px}h1{text-align:center}section{break-inside:avoid;margin:14px 0;padding-bottom:9px;border-bottom:1px solid #ddd}p{margin:5px 0}@media print{body{margin:16mm}}</style></head><body>${body}</body></html>`;
}
function buildNotesDoc(q){return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(q.title)} — Notes</title><style>body{font:15px/1.7 Georgia,serif;background:#f4f0e7;color:#18243b;padding:25px;max-width:950px;margin:auto}.page{background:#fffdf6;padding:25px;border:1px solid #ddd;margin:16px 0;break-inside:avoid}h1,h2{color:#193d70}h2{border-bottom:1px solid #ddd;padding-bottom:6px}.answer{color:#14734b;font-weight:bold}@media print{body{background:white}}</style></head><body><h1>${esc(q.title)} — Study Notes</h1><p>Study notes generated from ${q.questions.length} quiz questions.</p>${q.questions.map((x,i)=>`<article class="page"><h2>Topic ${i+1}: ${esc(x.text)}</h2><p><b>Question focus:</b> ${esc(x.text)}</p><p class="answer">Correct answer: ${String.fromCharCode(65+x.correct)}. ${esc(x.options[x.correct]||'')}</p><h3>Explanation / Key points</h3><p>${esc(x.explanation||'No explanation supplied in the source quiz.')}</p><h3>Options for revision</h3><ol type="A">${x.options.map(o=>`<li>${esc(o)}</li>`).join('')}</ol></article>`).join('')}</body></html>`;}
async function makeStudyPdf(q,mode){
  const doc=new jsPDF({unit:'mm',format:'a4'});let y=18;const page=()=>{doc.addPage();y=18;};
  // Embed Noto Sans Devanagari when available so Hindi is retained in downloaded PDFs.
  let pdfFont='helvetica';
  try{for(const [file,style] of [['NotoSansDevanagari-Regular.ttf','normal'],['NotoSansDevanagari-Bold.ttf','bold']]){const r=await fetch(import.meta.env.BASE_URL+'fonts/'+file);if(!r.ok)continue;const bytes=new Uint8Array(await r.arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));doc.addFileToVFS(file,btoa(bin));doc.addFont(file,'NotoDevanagari',style);}pdfFont='NotoDevanagari';}catch{pdfFont='helvetica';}
  const txt=(str,size=10,bold=false)=>{doc.setFont(pdfFont,bold?'bold':'normal');doc.setFontSize(size);const lines=doc.splitTextToSize(String(str??''),180);for(const line of lines){if(y>282)page();doc.text(line,15,y);y+=Math.max(5,size*.48);}};
  doc.setFillColor(18,31,52);doc.rect(0,0,210,11,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('QUIZINOX',15,7.5);doc.setTextColor(25,35,52);y=20;txt(q.title,17,true);txt(`${q.questions.length} Questions · ${mode==='test'?'Test':mode==='solution'?'Solution':'Test + Solution'}`,10);y+=4;
  const writeTest=()=>q.questions.forEach((x,i)=>{txt(`Q${i+1}. ${x.text}`,11,true);x.options.forEach((o,j)=>txt(`${String.fromCharCode(65+j)}. ${o}`,10));y+=2;});
  const writeSolutions=()=>q.questions.forEach((x,i)=>{txt(`Q${i+1}. ${String.fromCharCode(65+x.correct)}. ${x.options[x.correct]||''}`,11,true);if(x.explanation)txt(`Explanation: ${x.explanation}`,10);y+=3;});
  if(mode==='test')writeTest();else if(mode==='solution')writeSolutions();else if(mode==='merged'){writeTest();page();writeSolutions();}else if(mode==='notes-pdf'){q.questions.forEach((x,i)=>{txt(`Topic ${i+1}: ${x.text}`,12,true);txt(`Correct answer: ${String.fromCharCode(65+x.correct)}. ${x.options[x.correct]||''}`,10,true);txt(`Key points: ${x.explanation||'No explanation supplied.'}`,10);txt('Options: '+x.options.join(' | '),9);y+=4;});}
  return doc.output('blob');
}

function openSuppliedTool(kind,q){
  const paths={'test-series-maker':'test-series-maker.html','notes-generator':'notes-generator.html','quiz-maker':'quiz-maker.html','txt-pdf-translator':'txt-pdf-translator.html'};
  const inputs={'test-series-maker':'fileInput','notes-generator':'file-input','quiz-maker':'file-input','txt-pdf-translator':'file'};
  const url=import.meta.env.BASE_URL+'tools/'+paths[kind];
  const {el}=modal(`<div class="eyebrow">SUPPLIED ORIGINAL TOOL</div><h2>${esc(kind.replace(/-/g,' '))}</h2><p>QUIZINOX is preparing the selected language's quiz text and loading it into the original tool.</p><iframe id="suppliedToolFrame" title="${esc(kind)}" src="${url}" style="width:100%;height:76vh;border:1px solid var(--line);border-radius:12px;background:#fff"></iframe>`,{wide:true});
  const frame=$('#suppliedToolFrame',el),lang=$('#artifactLang')?.value||'original';
  const content=q.questions.map((x,i)=>`Q${i+1}. ${x.text}\n😂\n${x.options.map((o,j)=>o+(j===x.correct?' ✅':'')).join('\n')}${x.explanation?'\nEx: '+x.explanation:''}`).join('\n\n')+'\n';
  frame.addEventListener('load',async()=>{
    try{
      const doc=frame.contentDocument,win=frame.contentWindow,input=doc.getElementById(inputs[kind]);
      if(!input)return;
      const f=new File([content],`${slug(q.title)}-${slug(languageLabel(lang))}.txt`,{type:'text/plain'});
      const dt=new win.DataTransfer();dt.items.add(f);input.files=dt.files;input.dispatchEvent(new win.Event('change',{bubbles:true}));
      if(kind==='test-series-maker'){
        await new Promise(r=>setTimeout(r,450));
        doc.getElementById('btnGeneratePDFs')?.click();
      }
      if(kind==='quiz-maker'){
        const gen=doc.querySelector('#generate-btn, #generateBtn, button[type="submit"]');
        if(gen)gen.click();
      }
      if(kind==='txt-pdf-translator'){
        const sl=doc.getElementById('sl'),tl=doc.getElementById('tl');
        if(tl&&lang!=='original')tl.value=lang;
      }
    }catch(e){toast('Could not prefill original tool: '+e.message);}
  },{once:true});
}


/* ------------------------------ SETTINGS ------------------------------ */
function settings() {
  const used = (() => { try { return Math.round((localStorage.getItem(STORE) || '').length / 1024); } catch { return 0; } })();
  view.innerHTML = `<div class="page-title"><div><div class="eyebrow">APP PREFERENCES</div><h1>Settings</h1><p>Personalize the app and manage local data.</p></div></div><div class="settings-layout"><div class="panel"><h3>Profile</h3><label>Your display name<input id="userName" value="${esc(db.settings.name || 'Learner')}"/></label><button class="primary" id="saveProfile">Save profile</button><div class="divider"></div>
  <h3>AI integration <span class="tag">OPTIONAL · ONLINE</span></h3><p class="muted">Used only when you start AI generation or translation. Get a free key at aistudio.google.com. The key is stored only on this device and never included in backups.</p><label>Gemini API key<input id="geminiKey" type="password" autocomplete="off" placeholder="Paste your Gemini API key" value="${esc(db.settings.geminiKey || '')}"/></label><label>AI model<select id="aiModel">${AI_MODELS.map(m => `<option ${db.settings.aiModel === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label><div class="title-actions row"><button class="secondary" id="saveKey">Save AI settings</button><button class="textbtn" id="testKey">Test connection</button></div><div class="divider"></div>
  <h3>Data management</h3><p class="muted">Your quizzes and reports use about ${used} KB on this device. Export a backup before clearing app data.</p><button class="secondary" id="settingsBackup">⇩ Export backup</button><button class="textbtn" id="settingsRestore">Restore backup</button><button class="textbtn danger-text" id="clearData">Delete all local data</button></div>
  <div class="panel"><h3>About QUIZINOX</h3><img class="about-logo" src="${iconUrl}" alt="QUIZINOX"/><h2>QUIZINOX</h2><p class="muted">A private, offline-first quiz workspace.</p><div class="about-list"><span>✓ Works fully offline — quizzes, results, PDF tools</span><span>✓ Online AI generator & translator (optional)</span><span>✓ Coaching PDF converter: SFG · Vajiram · VisionIAS</span><span>✓ Exam mode with question palette & review marks</span><span>✓ No account, no subscription</span></div><div class="notice">Uninstalling the app or clearing its data erases saved quizzes — keep a backup.</div><div class="version">Version 2.2</div></div></div>`;
  $('#saveProfile').onclick = () => { db.settings.name = $('#userName').value.trim() || 'Learner'; $('#profileName').textContent = db.settings.name; save(); toast('Profile updated'); };
  $('#saveKey').onclick = () => { db.settings.geminiKey = $('#geminiKey').value.trim(); db.settings.aiModel = $('#aiModel').value; save(); toast('AI settings saved on this device'); };
  $('#testKey').onclick = async () => { db.settings.geminiKey = $('#geminiKey').value.trim(); db.settings.aiModel = $('#aiModel').value; save(); toast('Testing…'); try { await gemini('Reply with the single word OK', { json: false }); toast('Gemini connected ✓'); } catch (e) { toast('✕ ' + e.message, 5000); } };
  $('#settingsBackup').onclick = backup; $('#settingsRestore').onclick = () => $('#restoreInput').click();
  $('#clearData').onclick = async () => { if (await confirmBox('Delete everything?', 'All quizzes, attempts and settings on this device will be permanently deleted.', 'Delete all', true)) { localStorage.removeItem(STORE); localStorage.removeItem(PLAY_STORE); db = defaultState(); save(); $('#profileName').textContent = 'Learner'; setTab('home'); toast('Local data cleared'); } };
}

/* ------------------------------ BACK BUTTON ------------------------------ */
onBackButton(async exit => {
  const open = $$('.mode-overlay'); if (open.length) { open[open.length - 1].remove(); return; }
  if (play) { $('#quitPlay')?.click(); return; }
  if (lastResult || db.activeTab !== 'home') { setTab('home'); return; }
  exit();
});
window.addEventListener('beforeunload', () => savePlay());
document.addEventListener('visibilitychange', () => { if (document.hidden) savePlay(); });

render(); updateCounts();
