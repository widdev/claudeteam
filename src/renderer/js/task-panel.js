let taskListEl = null;

export function initTaskPanel(el) {
  const list = el.querySelector('.tasks-list');
  const input = el.querySelector('.tasks-input');
  const addBtn = el.querySelector('.tasks-add-btn');
  taskListEl = list;

  addBtn.addEventListener('click', () => addTask(input, list));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addTask(input, list); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });

  // Zoom
  const zoomSel = el.querySelector('.tasks-zoom-select');
  const ZOOM_LEVELS = [75, 85, 100, 115, 130, 150];
  const BASE_FONT_SIZE = 14;
  let currentZoom = 100;
  function applyZoom(zoom) {
    currentZoom = zoom;
    const scale = zoom / 100;
    const fontSize = (BASE_FONT_SIZE * scale) + 'px';
    list.style.fontSize = fontSize;
    input.style.fontSize = fontSize;
    zoomSel.value = String(zoom);
    window.electronAPI.setSetting('taskZoom', zoom);
  }
  applyZoom(currentZoom);
  window.electronAPI.getSetting('taskZoom').then((z) => { if (z && ZOOM_LEVELS.includes(z)) applyZoom(z); });
  zoomSel.addEventListener('change', () => applyZoom(parseInt(zoomSel.value, 10)));
  el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; e.preventDefault();
    const idx = ZOOM_LEVELS.indexOf(currentZoom);
    if (e.deltaY < 0 && idx < ZOOM_LEVELS.length - 1) applyZoom(ZOOM_LEVELS[idx + 1]);
    else if (e.deltaY > 0 && idx > 0) applyZoom(ZOOM_LEVELS[idx - 1]);
  }, { passive: false });

  // Load existing tasks
  window.electronAPI.getTasks().then((tasks) => { if (tasks && tasks.length > 0) for (const t of tasks) appendTaskEntry(list, t); });
}

async function addTask(input, list) {
  const content = input.value.trim(); if (!content) return;
  const task = await window.electronAPI.addTask(content);
  if (task) appendTaskEntry(list, task);
  input.value = ''; input.style.height = 'auto';
}

function appendTaskEntry(list, task) {
  const e = document.createElement('div');
  e.className = 'task-entry'; e.dataset.taskId = task.id; e.draggable = true;
  e.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', task.content); ev.dataTransfer.effectAllowed = 'copy'; });
  const time = task.created_at ? new Date(task.created_at + 'Z').toLocaleTimeString() : new Date().toLocaleTimeString();
  e.innerHTML = `<div class="task-header"><span class="task-id">${esc(task.id)}</span><span class="task-time">${esc(time)}</span><span class="task-remove" title="Delete">&times;</span></div><div class="task-content">${esc(task.content)}</div>`;
  e.querySelector('.task-remove').addEventListener('click', async () => { await window.electronAPI.removeTask(task.id); e.remove(); });
  list.appendChild(e); list.scrollTop = list.scrollHeight;
}

export function loadTasks(tasks) {
  if (!taskListEl) return;
  taskListEl.innerHTML = '';
  for (const t of tasks) appendTaskEntry(taskListEl, t);
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
