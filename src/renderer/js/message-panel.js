import { getAgentColor, setColorTheme, getColorTheme, refreshAgentColors, getActiveAgents } from './agent-panel.js';

// Global refs — set when discussion component is created
let msgListEl = null;
let masterInputEl = null;

export function initMessagePanel(el) {
  const list = el.querySelector('.disc-message-list');
  const portInput = el.querySelector('.disc-port-input');
  const restartBtn = el.querySelector('.disc-restart-btn');
  const archiveBtn = el.querySelector('.disc-archive-btn');
  const zoomSel = el.querySelector('.disc-zoom-select');

  msgListEl = list;

  // Archive
  archiveBtn.addEventListener('click', showArchiveModal);
  window.electronAPI.onMenuEvent('menu:archiveDiscussion', showArchiveModal);
  window.electronAPI.onMenuEvent('menu:restoreArchived', async () => { await restoreArchivedMessages(); });

  // New messages from IPC
  window.electronAPI.onNewMessage((msg) => appendMessage(msg));

  // Zoom
  const ZOOM_LEVELS = [75, 85, 100, 115, 130, 150];
  const BASE_FONT_SIZE = 14;
  let currentZoom = 100;
  function applyZoom(zoom) {
    currentZoom = zoom;
    const scale = zoom / 100;
    const fontSize = (BASE_FONT_SIZE * scale) + 'px';
    list.style.fontSize = fontSize;
    if (masterInputEl) masterInputEl.style.fontSize = fontSize;
    zoomSel.value = String(zoom);
    window.electronAPI.setSetting('messageZoom', zoom);
  }
  applyZoom(currentZoom);
  window.electronAPI.getSetting('messageZoom').then((z) => { if (z && ZOOM_LEVELS.includes(z)) applyZoom(z); });
  zoomSel.addEventListener('change', () => applyZoom(parseInt(zoomSel.value, 10)));
  // Ctrl+Wheel on the discussion content changes zoom
  el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; e.preventDefault();
    const idx = ZOOM_LEVELS.indexOf(currentZoom);
    if (e.deltaY < 0 && idx < ZOOM_LEVELS.length - 1) applyZoom(ZOOM_LEVELS[idx + 1]);
    else if (e.deltaY > 0 && idx > 0) applyZoom(ZOOM_LEVELS[idx - 1]);
  }, { passive: false });

  // Theme
  function applyTheme(theme) {
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(`theme-${theme}`);
    setColorTheme(theme);
    refreshAgentColors();
  }
  window.electronAPI.getSetting('theme').then((t) => { if (t) applyTheme(t); });
  window.electronAPI.onMenuEvent('menu:toggleTheme', () => {
    const nt = getColorTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(nt); window.electronAPI.setSetting('theme', nt);
  });

  // Port
  window.electronAPI.getServerPort().then((p) => { portInput.value = p; });
  window.electronAPI.onServerPort((p) => { portInput.value = p; });
  restartBtn.addEventListener('click', async () => {
    const p = parseInt(portInput.value, 10);
    if (isNaN(p) || p < 1024 || p > 65535) { portInput.style.borderColor = '#f44747'; return; }
    restartBtn.disabled = true; restartBtn.textContent = '...';
    const r = await window.electronAPI.restartServer(p);
    if (r.success) { portInput.value = r.port; portInput.style.borderColor = ''; }
    else portInput.style.borderColor = '#f44747';
    restartBtn.disabled = false; restartBtn.textContent = 'Restart';
  });

  // Load existing messages
  window.electronAPI.getMessages().then((msgs) => { if (msgs && msgs.length > 0) loadMessages(msgs); });
}

export function initMasterInput(el) {
  const input = el.querySelector('.disc-master-input');
  const btn = el.querySelector('.disc-broadcast-btn');
  masterInputEl = input;

  btn.addEventListener('click', () => broadcast(input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); broadcast(input); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });

  // Drag-and-drop from Tasks
  input.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; input.classList.add('drag-over'); });
  input.addEventListener('dragleave', () => input.classList.remove('drag-over'));
  input.addEventListener('drop', (e) => {
    e.preventDefault(); input.classList.remove('drag-over');
    const text = e.dataTransfer.getData('text/plain');
    if (text) { input.value = input.value ? input.value + '\n' + text : text; input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; input.focus(); }
  });
}

// Broadcast
function sendToAgent(agentId, text) {
  const multi = text.includes('\n') || text.includes('\r');
  const long = text.length > 100;
  if (multi || long) { window.electronAPI.writeToAgent(agentId, text); setTimeout(() => window.electronAPI.writeToAgent(agentId, '\r'), Math.min(300 + text.length, 1500)); }
  else window.electronAPI.writeToAgent(agentId, text + '\r');
}

function broadcast(input) {
  const text = input.value.trim(); if (!text) return;
  const agents = getActiveAgents();
  const hashMatch = text.match(/^#(\S+)\s+([\s\S]*)$/);
  if (hashMatch) {
    const tn = hashMatch[1], mb = hashMatch[2].trim();
    let tid = null;
    for (const [id, e] of agents) { if (e.name.toLowerCase() === tn.toLowerCase()) { tid = id; break; } }
    if (tid && mb) { sendToAgent(tid, mb); appendAside(mb, tn); }
    else if (!tid) appendAside(`Agent "${tn}" not found`, tn);
  } else {
    for (const [id] of agents) sendToAgent(id, text);
    appendBroadcast(text);
  }
  input.value = ''; input.style.height = 'auto';
}

// Message rendering
const MAX_VISIBLE = 200;
let allMessages = [];

export function appendMessage(msg) {
  if (!msgListEl) return;
  msgListEl.appendChild(createMessageElement(msg));
  msgListEl.scrollTop = msgListEl.scrollHeight;
  autoTrimMessages();
}

export function appendBroadcast(text) {
  if (!msgListEl) return;
  const e = document.createElement('div'); e.className = 'message-entry message-broadcast';
  e.innerHTML = `<div class="message-meta"><span class="message-from broadcast-from">You</span> &rarr; <span class="message-to">All Agents</span> &middot; ${esc(new Date().toLocaleTimeString())}</div><div class="message-content">${esc(text)}</div>`;
  msgListEl.appendChild(e); msgListEl.scrollTop = msgListEl.scrollHeight;
}

export function appendAside(text, target) {
  if (!msgListEl) return;
  const e = document.createElement('div'); e.className = 'message-entry message-aside';
  e.innerHTML = `<div class="message-meta"><span class="message-from broadcast-from">You</span> &rarr; <span class="message-to">${esc(target)}</span> &middot; ${esc(new Date().toLocaleTimeString())}</div><div class="message-content">${esc(text)}</div>`;
  msgListEl.appendChild(e); msgListEl.scrollTop = msgListEl.scrollHeight;
}

export function loadMessages(messages) {
  if (!msgListEl) return;
  msgListEl.innerHTML = ''; allMessages = messages;
  if (messages.length > MAX_VISIBLE) {
    addShowOlderButton(msgListEl, messages.length - MAX_VISIBLE);
    for (let i = messages.length - MAX_VISIBLE; i < messages.length; i++) msgListEl.appendChild(createMessageElement(messages[i]));
  } else {
    for (const m of messages) msgListEl.appendChild(createMessageElement(m));
  }
  msgListEl.scrollTop = msgListEl.scrollHeight;
}

function addShowOlderButton(list, count) {
  const ex = list.querySelector('.show-older-btn'); if (ex) ex.remove();
  const b = document.createElement('div'); b.className = 'show-older-btn';
  b.textContent = `Show ${Math.min(count, MAX_VISIBLE)} older messages (${count} hidden)`;
  b.addEventListener('click', () => { const si = Math.max(0, count - MAX_VISIBLE); const batch = allMessages.slice(si, count); b.remove(); const fc = list.firstChild; for (const m of batch) list.insertBefore(createMessageElement(m), fc); if (si > 0) addShowOlderButton(list, si); });
  list.insertBefore(b, list.firstChild);
}

function autoTrimMessages() {
  if (!msgListEl) return;
  const entries = msgListEl.querySelectorAll('.message-entry');
  if (entries.length > MAX_VISIBLE * 1.5) { const n = entries.length - MAX_VISIBLE; for (let i = 0; i < n; i++) entries[i].remove(); }
}

function createMessageElement(msg) {
  const e = document.createElement('div'); e.className = 'message-entry';
  const fid = msg.from_agent || msg.from;
  if (fid) { const c = getAgentColor(fid); e.style.borderLeftColor = c; }
  const t = msg.timestamp ? new Date(msg.timestamp + 'Z').toLocaleTimeString() : new Date().toLocaleTimeString();
  const fn = msg.fromName || msg.from_agent || msg.from || '?';
  const tn = msg.toName || msg.to_agent || msg.to || '?';
  const fc = fid ? getAgentColor(fid) : null;
  const fs = fc ? ` style="color: ${fc}"` : '';
  e.innerHTML = `<span class="msg-remove" title="Remove">&times;</span><div class="message-meta"><span class="message-from"${fs}>${esc(fn)}</span> &rarr; <span class="message-to">${esc(tn)}</span> &middot; ${esc(t)}</div><div class="message-content">${esc(msg.content || '')}</div>`;
  e.querySelector('.msg-remove').addEventListener('click', async () => { if (msg.id) await window.electronAPI.removeMessage(msg.id); e.remove(); });
  return e;
}

export async function restoreArchivedMessages() {
  const a = await window.electronAPI.getArchivedMessages(); if (!a || a.length === 0) return 0;
  await window.electronAPI.restoreAllMessages();
  loadMessages(await window.electronAPI.getMessages());
  return a.length;
}

function showArchiveModal() {
  const modal = document.getElementById('archive-modal');
  const pd = document.getElementById('archive-path-display');
  const cc = document.getElementById('archive-clear-on-save');
  const bb = document.getElementById('archive-select-dir');
  const sb = document.getElementById('archive-save');
  const cb = document.getElementById('archive-cancel');
  pd.textContent = ''; pd.dataset.path = ''; cc.checked = true; modal.classList.remove('hidden');
  let done = false;
  function fin() { if (done) return; done = true; modal.classList.add('hidden'); document.removeEventListener('keydown', ok); bb.removeEventListener('click', ob); sb.removeEventListener('click', os); cb.removeEventListener('click', oc); }
  function ok(e) { if (e.key === 'Escape') fin(); }
  function oc() { fin(); }
  async function ob() {
    const fp = await window.electronAPI.saveFileDialog({ title: 'Save Discussion Archive', defaultPath: 'discussion-archive.csv', filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'Text', extensions: ['txt'] }] });
    if (fp) { pd.textContent = fp; pd.dataset.path = fp; pd.title = fp; }
  }
  async function os() {
    const fp = pd.dataset.path; if (!fp) { pd.textContent = 'Please select a location'; pd.style.color = 'var(--danger)'; setTimeout(() => pd.style.color = '', 2000); return; }
    if (!msgListEl) { fin(); return; }
    const entries = msgListEl.querySelectorAll('.message-entry');
    const rows = ['Date,Sender,Target,Message'];
    for (const en of entries) {
      const me = en.querySelector('.message-meta'); const fr = me?.querySelector('.message-from')?.textContent?.trim() || '';
      const to = me?.querySelector('.message-to')?.textContent?.trim() || ''; const mt = me?.textContent || '';
      const tm = mt.match(/·\s*(.+)$/); const ti = tm ? tm[1].trim() : '';
      const co = en.querySelector('.message-content')?.textContent?.trim() || '';
      const cf = (s) => (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
      rows.push(`${cf(ti)},${cf(fr)},${cf(to)},${cf(co)}`);
    }
    await window.electronAPI.writeTextFile(fp, rows.join('\n'));
    if (cc.checked) { await window.electronAPI.clearMessages(); if (msgListEl) msgListEl.innerHTML = ''; }
    fin();
  }
  document.addEventListener('keydown', ok); bb.addEventListener('click', ob); sb.addEventListener('click', os); cb.addEventListener('click', oc);
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
