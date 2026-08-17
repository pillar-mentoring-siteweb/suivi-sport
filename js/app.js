'use strict';

/* ============================================================
   State
   ============================================================ */
const state = {
  machines: [],
  sessions: [],
  weights: [],
  editingSessionId: null,
};

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/* ============================================================
   Helpers
   ============================================================ */
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function todayIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatDateFr(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_FR[m - 1]} ${y}`;
}

function isoWeekKey(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(
    ((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
  return `${date.getUTCFullYear()}-S${String(weekNum).padStart(2, '0')}`;
}

function monthKey(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_FR[m - 1]} ${y}`;
}

function num(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('toast-hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('toast-hidden'), 2600);
}

function machinesByType(type) {
  return state.machines
    .filter((m) => m.type === type)
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
}

function sessionVolume(session) {
  return (session.strength || []).reduce((sum, e) => {
    const mult = e.perLeg ? 2 : 1;
    return sum + (e.weightKg || 0) * (e.series || 0) * (e.reps || 0) * mult;
  }, 0);
}

/* ============================================================
   Init
   ============================================================ */
async function boot() {
  await ensureSeedData();
  await reloadAll();

  $('#input-date').value = todayIso();

  bindNav();
  bindSheet();
  bindSessionForm();
  bindWeightForm();
  bindSettings();
  bindStatsControls();

  renderMachineRows('cardio');
  renderMachineRows('strength');
  renderHistory();
  renderWeights();
  updateWeightReminder();
  populateStatsSelectors();
  renderAllCharts();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

async function reloadAll() {
  const [machines, sessions, weights] = await Promise.all([
    DB.getAll('machines'),
    DB.getAll('sessions'),
    DB.getAll('weights'),
  ]);
  state.machines = machines;
  state.sessions = sessions.sort((a, b) => b.date.localeCompare(a.date));
  state.weights = weights.sort((a, b) => b.date.localeCompare(a.date));
}

/* ============================================================
   Navigation (tabs)
   ============================================================ */
function bindNav() {
  $all('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  $all('.view').forEach((v) => v.classList.toggle('view-hidden', v.dataset.view !== view));
  $all('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'stats') renderAllCharts();
  if (view === 'historique') renderHistory();
  if (view === 'poids') { renderWeights(); updateWeightReminder(); }
}

/* ============================================================
   Sheet (bottom modal)
   ============================================================ */
function bindSheet() {
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'sheet-overlay') closeSheet();
  });
}

function openSheet(title, bodyNode) {
  $('#sheet-title').textContent = title;
  const body = $('#sheet-body');
  body.innerHTML = '';
  body.appendChild(bodyNode);
  $('#sheet-overlay').classList.remove('sheet-hidden');
}

function closeSheet() {
  $('#sheet-overlay').classList.add('sheet-hidden');
}

/* ============================================================
   Séance — form building blocks
   ============================================================ */
function bindSessionForm() {
  $all('.category-toggle').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.category').classList.toggle('open'));
  });
  $('#form-seance').addEventListener('submit', onSubmitSession);
}

function lastEntry(machineName, type) {
  for (const s of state.sessions) {
    const list = type === 'cardio' ? s.cardio : s.strength;
    const found = (list || []).find((e) => e.machine.toLowerCase() === machineName.toLowerCase());
    if (found) return { entry: found, date: s.date };
  }
  return null;
}

function formatCardioSummary(entry) {
  const parts = [];
  if (entry.durationMin) parts.push(`${entry.durationMin} min`);
  if (entry.distanceKm) parts.push(`${entry.distanceKm} km`);
  if (entry.calories) parts.push(`${entry.calories} cal`);
  if (entry.avgWatts) parts.push(`${entry.avgWatts} W`);
  if (entry.avgSpeed) parts.push(`${entry.avgSpeed} km/h`);
  if (entry.avgIncline) parts.push(`${entry.avgIncline}% incl.`);
  return parts.join(' / ');
}

function formatStrengthSummary(entry) {
  const leg = entry.perLeg ? ' chaque jambe' : '';
  return `${entry.weightKg}kg — ${entry.series}x${entry.reps}${leg}`;
}

function readRowEntry(row, type) {
  if (type === 'cardio') {
    return {
      machine: row.dataset.machine,
      durationMin: num(row.querySelector('.f-duration').value),
      distanceKm: num(row.querySelector('.f-distance').value),
      calories: num(row.querySelector('.f-calories').value),
      avgWatts: num(row.querySelector('.f-watts').value),
      avgSpeed: num(row.querySelector('.f-speed').value),
      avgIncline: num(row.querySelector('.f-incline').value),
    };
  }
  return {
    machine: row.dataset.machine,
    weightKg: num(row.querySelector('.f-weight').value) || 0,
    series: num(row.querySelector('.f-series').value) || 0,
    reps: num(row.querySelector('.f-reps').value) || 0,
    perLeg: row.querySelector('.f-perleg').checked,
  };
}

function updateRowSummary(row, type) {
  const summaryEl = row.querySelector('.machine-summary');
  if (!summaryEl) return;
  if (row.dataset.touched !== 'true') { summaryEl.textContent = ''; return; }
  const entry = readRowEntry(row, type);
  const hasData = type === 'cardio'
    ? [entry.durationMin, entry.distanceKm, entry.calories, entry.avgWatts, entry.avgSpeed, entry.avgIncline].some((v) => v !== null)
    : (entry.weightKg > 0 || entry.series > 0 || entry.reps > 0);
  summaryEl.textContent = hasData ? (type === 'cardio' ? formatCardioSummary(entry) : formatStrengthSummary(entry)) : '';
}

function clearMachineRow(row, type) {
  const fields = type === 'cardio'
    ? ['.f-duration', '.f-distance', '.f-calories', '.f-watts', '.f-speed', '.f-incline']
    : ['.f-weight', '.f-series', '.f-reps'];
  fields.forEach((sel) => { const el = row.querySelector(sel); if (el) el.value = ''; });
  const legInput = row.querySelector('.f-perleg');
  if (legInput) legInput.checked = false;
  delete row.dataset.touched;
  updateRowSummary(row, type);
  row.classList.remove('open');
}

function toggleRowOpen(row) {
  const container = row.parentElement;
  const wasOpen = row.classList.contains('open');
  $all('.machine-row.open', container).forEach((r) => r.classList.remove('open'));
  row.classList.toggle('open', !wasOpen);
  return !wasOpen;
}

function toggleMachineRow(row, type) {
  const nowOpen = toggleRowOpen(row);
  if (nowOpen) {
    row.dataset.touched = 'true';
    updateRowSummary(row, type);
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function buildMachineDetail(type, name) {
  const wrap = document.createElement('div');
  const last = lastEntry(name, type);

  const lastLine = document.createElement('div');
  lastLine.className = 'machine-last';
  lastLine.textContent = last
    ? `Dernière fois (${formatDateFr(last.date)}) : ${type === 'cardio' ? formatCardioSummary(last.entry) : formatStrengthSummary(last.entry)}`
    : 'Pas encore enregistré.';
  wrap.appendChild(lastLine);

  const grid = document.createElement('div');
  grid.className = 'entry-grid';

  if (type === 'cardio') {
    grid.innerHTML = `
      <div class="field-row"><label>Durée (min)</label><input type="number" class="f-duration" inputmode="numeric" min="0"></div>
      <div class="field-row"><label>Distance (km)</label><input type="number" class="f-distance" step="0.01" inputmode="decimal" min="0"></div>
      <div class="field-row"><label>Calories</label><input type="number" class="f-calories" inputmode="numeric" min="0"></div>
      <div class="field-row"><label>Watts moyens</label><input type="number" class="f-watts" inputmode="numeric" min="0"></div>
      <div class="field-row"><label>Vitesse moy. (km/h)</label><input type="number" class="f-speed" step="0.1" inputmode="decimal" min="0"></div>
      <div class="field-row"><label>Inclinaison (%)</label><input type="number" class="f-incline" step="0.1" inputmode="decimal" min="0"></div>
    `;
    wrap.appendChild(grid);
    if (last) {
      const set = (cls, val) => { const el = grid.querySelector(cls); if (val !== null && val !== undefined) el.value = val; };
      set('.f-duration', last.entry.durationMin);
      set('.f-distance', last.entry.distanceKm);
      set('.f-calories', last.entry.calories);
      set('.f-watts', last.entry.avgWatts);
      set('.f-speed', last.entry.avgSpeed);
      set('.f-incline', last.entry.avgIncline);
    }
  } else {
    grid.innerHTML = `
      <div class="field-row"><label>Charge (kg)</label>${stepperHtml('f-weight', last ? last.entry.weightKg : '', 1)}</div>
      <div class="field-row"><label>Séries</label>${stepperHtml('f-series', last ? last.entry.series : '', 1)}</div>
      <div class="field-row"><label>Répétitions</label>${stepperHtml('f-reps', last ? last.entry.reps : '', 1)}</div>
    `;
    wrap.appendChild(grid);
    bindSteppers(grid);

    const legToggle = document.createElement('label');
    legToggle.className = 'leg-toggle';
    const legInput = document.createElement('input');
    legInput.type = 'checkbox';
    legInput.className = 'f-perleg';
    legInput.checked = !!(last && last.entry.perLeg);
    legToggle.appendChild(legInput);
    legToggle.appendChild(document.createTextNode(' Chaque jambe séparément'));
    wrap.appendChild(legToggle);
  }

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'machine-clear';
  clearBtn.textContent = 'Effacer';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearMachineRow(wrap.closest('.machine-row'), type);
  });
  wrap.appendChild(clearBtn);

  return wrap;
}

function buildMachineRow(type, name) {
  const row = document.createElement('div');
  row.className = 'machine-row';
  row.dataset.machine = name;

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'machine-row-head';

  const nameEl = document.createElement('span');
  nameEl.className = 'machine-name';
  nameEl.textContent = name;

  const summaryEl = document.createElement('span');
  summaryEl.className = 'machine-summary';

  const chevronEl = document.createElement('span');
  chevronEl.className = 'chevron';
  chevronEl.textContent = '▾';

  head.append(nameEl, summaryEl, chevronEl);
  head.addEventListener('click', () => toggleMachineRow(row, type));

  const detail = document.createElement('div');
  detail.className = 'machine-detail';
  detail.appendChild(buildMachineDetail(type, name));

  row.append(head, detail);
  row.addEventListener('input', () => {
    row.dataset.touched = 'true';
    updateRowSummary(row, type);
  });

  return row;
}

function buildAddMachineRow(type) {
  const row = document.createElement('div');
  row.className = 'machine-row machine-add-row';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'machine-row-head';
  head.innerHTML = '<span class="machine-name">+ Nouvelle machine</span><span class="chevron">▾</span>';
  head.addEventListener('click', () => toggleRowOpen(row));

  const form = document.createElement('div');
  form.className = 'machine-add-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Nom de la machine';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn-add';
  confirmBtn.textContent = 'Ajouter';

  const submitNewMachine = async () => {
    const name = input.value.trim();
    if (!name) return;
    await DB.put('machines', { id: DB.uid(), name, type, lastUsed: null });
    await reloadAll();
    renderMachineRows(type);
    const container = $(type === 'cardio' ? '#cardio-list' : '#strength-list');
    const newRow = container.querySelector(`.machine-row[data-machine="${CSS.escape(name)}"]`);
    if (newRow) toggleMachineRow(newRow, type);
  };

  confirmBtn.addEventListener('click', submitNewMachine);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitNewMachine(); }
  });

  form.append(input, confirmBtn);
  row.append(head, form);
  return row;
}

function renderMachineRows(type) {
  const container = $(type === 'cardio' ? '#cardio-list' : '#strength-list');
  container.innerHTML = '';
  machinesByType(type).forEach((m) => container.appendChild(buildMachineRow(type, m.name)));
  container.appendChild(buildAddMachineRow(type));
}

function stepperHtml(cls, value, step) {
  return `
    <div class="stepper">
      <button type="button" data-step="-${step}">−</button>
      <input type="number" class="${cls}" value="${value ?? ''}" inputmode="decimal">
      <button type="button" data-step="${step}">+</button>
    </div>
  `;
}

function bindSteppers(root) {
  $all('.stepper', root).forEach((stepper) => {
    const input = $('input', stepper);
    $all('button', stepper).forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = parseFloat(btn.dataset.step);
        const current = parseFloat(input.value) || 0;
        const next = Math.max(0, Math.round((current + delta) * 100) / 100);
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  });
}

/* ============================================================
   Séance — submit
   ============================================================ */
async function onSubmitSession(e) {
  e.preventDefault();

  const date = $('#input-date').value || todayIso();
  const warmupMinutes = num($('#input-warmup').value);
  const note = $('#input-note').value.trim();

  const cardio = $all('#cardio-list .machine-row[data-touched="true"]')
    .map((row) => readRowEntry(row, 'cardio'))
    .filter((c) => [c.durationMin, c.distanceKm, c.calories, c.avgWatts, c.avgSpeed, c.avgIncline].some((v) => v !== null));

  const strength = $all('#strength-list .machine-row[data-touched="true"]')
    .map((row) => readRowEntry(row, 'strength'))
    .filter((e) => e.weightKg > 0 || e.series > 0 || e.reps > 0);

  if (cardio.length === 0 && strength.length === 0) {
    toast('Ajoute au moins un exercice avant d’enregistrer.');
    return;
  }

  // PR detection (before saving, excluding the session being edited)
  const priorSessions = state.sessions.filter((s) => s.id !== state.editingSessionId);
  const prMachines = [];
  strength.forEach((e) => {
    const priorMax = priorSessions.reduce((max, s) => {
      const found = (s.strength || []).filter((x) => x.machine.toLowerCase() === e.machine.toLowerCase());
      const m = found.reduce((mm, x) => Math.max(mm, x.weightKg || 0), 0);
      return Math.max(max, m);
    }, 0);
    if (priorMax > 0 && e.weightKg > priorMax) prMachines.push(e.machine);
  });

  const session = {
    id: state.editingSessionId || DB.uid(),
    date, warmupMinutes, note, cardio, strength,
  };
  await DB.put('sessions', session);

  // Refresh recency (every touched machine already exists in DB by construction)
  const usedNames = new Set([...cardio.map((c) => c.machine), ...strength.map((s) => s.machine)]);
  for (const name of usedNames) {
    const m = state.machines.find((mm) => mm.name.toLowerCase() === name.toLowerCase());
    if (m) {
      m.lastUsed = Date.now();
      await DB.put('machines', m);
    }
  }

  await reloadAll();
  resetSessionForm();
  renderHistory();
  populateStatsSelectors();

  const prMsg = prMachines.length ? ` 🎉 Record sur ${prMachines.join(', ')} !` : '';
  toast(`Séance enregistrée.${prMsg}`);
}

function resetSessionForm() {
  state.editingSessionId = null;
  $('#input-date').value = todayIso();
  $('#input-warmup').value = '';
  $('#input-note').value = '';
  renderMachineRows('cardio');
  renderMachineRows('strength');
  $all('.category').forEach((c) => c.classList.remove('open'));
  $('#btn-save-session').textContent = 'Enregistrer la séance';
}

/* ============================================================
   Historique
   ============================================================ */
function renderHistory() {
  const container = $('#historique-list');
  container.innerHTML = '';
  if (state.sessions.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucune séance enregistrée pour l’instant.</div>';
    return;
  }
  state.sessions.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'history-card';
    const lines = [];
    if (s.warmupMinutes) lines.push(`Échauffement : ${s.warmupMinutes} min`);
    (s.cardio || []).forEach((c) => {
      lines.push(`${c.machine} — ${formatCardioSummary(c)}`);
    });
    (s.strength || []).forEach((e) => {
      lines.push(`${e.machine} ${formatStrengthSummary(e)}`);
    });
    if (s.note) lines.push(`Note : ${s.note}`);

    card.innerHTML = `
      <div class="history-card-head">
        <strong>${formatDateFr(s.date)}</strong>
        <span>Volume ${Math.round(sessionVolume(s))} kg</span>
      </div>
      ${lines.map((l) => `<div class="history-line">${l}</div>`).join('')}
      <div class="history-actions">
        <button type="button" class="edit-btn">Modifier</button>
        <button type="button" class="danger delete-btn">Supprimer</button>
      </div>
    `;
    card.querySelector('.edit-btn').addEventListener('click', () => loadSessionIntoForm(s));
    card.querySelector('.delete-btn').addEventListener('click', async () => {
      if (!confirm('Supprimer cette séance ?')) return;
      await DB.delete('sessions', s.id);
      await reloadAll();
      renderHistory();
      populateStatsSelectors();
      renderAllCharts();
    });
    container.appendChild(card);
  });
}

function loadSessionIntoForm(s) {
  state.editingSessionId = s.id;
  $('#input-date').value = s.date;
  $('#input-warmup').value = s.warmupMinutes ?? '';
  $('#input-note').value = s.note || '';

  renderMachineRows('cardio');
  renderMachineRows('strength');

  const fillRow = (containerSel, entry, type) => {
    const container = $(containerSel);
    let row = container.querySelector(`.machine-row[data-machine="${CSS.escape(entry.machine)}"]`);
    if (!row) {
      // Machine may have been deleted from Réglages since — recreate its row so data isn't lost.
      row = buildMachineRow(type, entry.machine);
      container.insertBefore(row, container.querySelector('.machine-add-row'));
    }
    const set = (cls, val) => { const el = row.querySelector(cls); if (el) el.value = val ?? ''; };
    if (type === 'cardio') {
      set('.f-duration', entry.durationMin);
      set('.f-distance', entry.distanceKm);
      set('.f-calories', entry.calories);
      set('.f-watts', entry.avgWatts);
      set('.f-speed', entry.avgSpeed);
      set('.f-incline', entry.avgIncline);
    } else {
      set('.f-weight', entry.weightKg);
      set('.f-series', entry.series);
      set('.f-reps', entry.reps);
      const legInput = row.querySelector('.f-perleg');
      if (legInput) legInput.checked = !!entry.perLeg;
    }
    row.dataset.touched = 'true';
    updateRowSummary(row, type);
  };

  (s.cardio || []).forEach((c) => fillRow('#cardio-list', c, 'cardio'));
  (s.strength || []).forEach((e) => fillRow('#strength-list', e, 'strength'));

  $('.category[data-type="cardio"]').classList.toggle('open', (s.cardio || []).length > 0);
  $('.category[data-type="strength"]').classList.toggle('open', (s.strength || []).length > 0);

  $('#btn-save-session').textContent = 'Mettre à jour la séance';
  switchView('seance');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   Poids
   ============================================================ */
function bindWeightForm() {
  $('#form-poids').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = num($('#input-weight').value);
    if (val === null) return;
    await DB.put('weights', { id: DB.uid(), date: todayIso(), weightKg: val });
    $('#input-weight').value = '';
    await reloadAll();
    renderWeights();
    updateWeightReminder();
    renderAllCharts();
    toast('Pesée ajoutée.');
  });
}

function renderWeights() {
  const container = $('#weight-list');
  container.innerHTML = '';
  if (state.weights.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucune pesée enregistrée.</div>';
    return;
  }
  state.weights.forEach((w) => {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-card-head">
        <strong>${w.weightKg} kg</strong>
        <span>${formatDateFr(w.date)}</span>
      </div>
      <div class="history-actions"><button type="button" class="danger delete-btn">Supprimer</button></div>
    `;
    card.querySelector('.delete-btn').addEventListener('click', async () => {
      await DB.delete('weights', w.id);
      await reloadAll();
      renderWeights();
      updateWeightReminder();
      renderAllCharts();
    });
    container.appendChild(card);
  });
}

function updateWeightReminder() {
  const banner = $('#weight-reminder');
  const thisWeek = isoWeekKey(todayIso());
  const hasThisWeek = state.weights.some((w) => isoWeekKey(w.date) === thisWeek);
  if (hasThisWeek) {
    banner.classList.add('banner-hidden');
  } else {
    banner.textContent = '⚖️ Pense à noter ton poids cette semaine.';
    banner.classList.remove('banner-hidden');
  }
}

/* ============================================================
   Réglages (machines + export/import)
   ============================================================ */
function bindSettings() {
  $('#btn-settings').addEventListener('click', openSettingsSheet);
}

function openSettingsSheet() {
  const wrap = document.createElement('div');

  const machinesSection = document.createElement('div');
  machinesSection.innerHTML = '<h3 style="font-size:14px;margin-bottom:8px;">Machines</h3>';
  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '6px';
  state.machines
    .slice()
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
    .forEach((m) => {
      const row = document.createElement('div');
      row.className = 'settings-machine-row';
      row.innerHTML = `<span>${m.name} <span style="color:var(--text-muted);font-size:11px;">(${m.type === 'cardio' ? 'cardio' : 'muscu'})</span></span>`;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Supprimer';
      del.addEventListener('click', async () => {
        await DB.delete('machines', m.id);
        await reloadAll();
        openSettingsSheet();
      });
      row.appendChild(del);
      list.appendChild(row);
    });
  machinesSection.appendChild(list);

  const addForm = document.createElement('div');
  addForm.style.display = 'flex';
  addForm.style.gap = '6px';
  addForm.style.marginTop = '10px';
  addForm.innerHTML = `
    <input type="text" placeholder="Nouvelle machine" style="flex:2;">
    <select style="flex:1;">
      <option value="strength">Muscu</option>
      <option value="cardio">Cardio</option>
    </select>
    <button type="button" class="btn-add">Ajouter</button>
  `;
  addForm.querySelector('.btn-add').addEventListener('click', async () => {
    const nameInput = addForm.querySelector('input');
    const typeSelect = addForm.querySelector('select');
    const name = nameInput.value.trim();
    if (!name) return;
    await DB.put('machines', { id: DB.uid(), name, type: typeSelect.value, lastUsed: null });
    await reloadAll();
    openSettingsSheet();
  });
  machinesSection.appendChild(addForm);

  const dataSection = document.createElement('div');
  dataSection.style.marginTop = '20px';
  dataSection.innerHTML = '<h3 style="font-size:14px;margin-bottom:8px;">Sauvegarde des données</h3>';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn-secondary';
  exportBtn.style.width = '100%';
  exportBtn.style.marginBottom = '8px';
  exportBtn.textContent = 'Exporter (JSON)';
  exportBtn.addEventListener('click', exportData);

  const importLabel = document.createElement('label');
  importLabel.className = 'btn-secondary';
  importLabel.style.display = 'block';
  importLabel.style.textAlign = 'center';
  importLabel.textContent = 'Importer (JSON)';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json';
  importInput.style.display = 'none';
  importInput.addEventListener('change', (e) => importData(e.target.files[0]));
  importLabel.appendChild(importInput);

  dataSection.appendChild(exportBtn);
  dataSection.appendChild(importLabel);

  wrap.appendChild(machinesSection);
  wrap.appendChild(dataSection);
  openSheet('Réglages', wrap);
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    machines: state.machines,
    sessions: state.sessions,
    weights: state.weights,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `suivi-sport-export-${todayIso()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data.sessions) || !Array.isArray(data.machines) || !Array.isArray(data.weights)) {
      throw new Error('Format invalide');
    }
    if (!confirm('Importer remplacera toutes les données actuelles. Continuer ?')) return;
    await DB.clear('sessions');
    await DB.clear('machines');
    await DB.clear('weights');
    await DB.bulkPut('sessions', data.sessions);
    await DB.bulkPut('machines', data.machines);
    await DB.bulkPut('weights', data.weights);
    await reloadAll();
    closeSheet();
    renderHistory();
    renderWeights();
    updateWeightReminder();
    populateStatsSelectors();
    renderAllCharts();
    toast('Données importées avec succès.');
  } catch (err) {
    toast('Échec de l’import : fichier invalide.');
  }
}

/* ============================================================
   Stats
   ============================================================ */
let volumeRange = 'week';

function bindStatsControls() {
  $all('#volume-range .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $all('#volume-range .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      volumeRange = btn.dataset.range;
      renderVolumeChart();
    });
  });
  $('#select-machine-stats').addEventListener('change', renderMachineChart);
  $('#select-cardio-stats').addEventListener('change', renderCardioChart);
}

function populateStatsSelectors() {
  const machineSel = $('#select-machine-stats');
  const cardioSel = $('#select-cardio-stats');
  const strengthNames = [...new Set(state.sessions.flatMap((s) => (s.strength || []).map((e) => e.machine)))].sort();
  const cardioNames = [...new Set(state.sessions.flatMap((s) => (s.cardio || []).map((e) => e.machine)))].sort();

  const fillSelect = (sel, names) => {
    const prev = sel.value;
    sel.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join('');
    if (names.includes(prev)) sel.value = prev;
  };
  fillSelect(machineSel, strengthNames);
  fillSelect(cardioSel, cardioNames);
}

function renderAllCharts() {
  renderVolumeChart();
  renderMachineChart();
  renderCardioChart();
  renderWeightChart();
}

function renderVolumeChart() {
  const keyFn = volumeRange === 'week' ? isoWeekKey : monthKey;
  const labelFn = volumeRange === 'week' ? (k) => k.replace('-S', ' S') : monthLabel;
  const buckets = new Map();
  state.sessions.forEach((s) => {
    const key = keyFn(s.date);
    buckets.set(key, (buckets.get(key) || 0) + sessionVolume(s));
  });
  const keys = [...buckets.keys()].sort();
  Charts.renderBar('chart-volume', keys.map(labelFn), keys.map((k) => Math.round(buckets.get(k))), 'Volume (kg)');
}

function renderMachineChart() {
  const machine = $('#select-machine-stats').value;
  if (!machine) { Charts.clear('chart-machine'); return; }
  const points = state.sessions
    .filter((s) => (s.strength || []).some((e) => e.machine === machine))
    .map((s) => {
      const best = Math.max(...s.strength.filter((e) => e.machine === machine).map((e) => e.weightKg || 0));
      return { date: s.date, value: best };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  Charts.renderLine('chart-machine', points.map((p) => formatDateFr(p.date)), points.map((p) => p.value), 'Charge (kg)');
}

function renderCardioChart() {
  const machine = $('#select-cardio-stats').value;
  if (!machine) { Charts.clear('chart-cardio'); return; }
  const points = state.sessions
    .filter((s) => (s.cardio || []).some((e) => e.machine === machine))
    .map((s) => {
      const entry = s.cardio.find((e) => e.machine === machine);
      return { date: s.date, distance: entry.distanceKm || 0, calories: entry.calories || 0 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  Charts.renderDualLine(
    'chart-cardio',
    points.map((p) => formatDateFr(p.date)),
    points.map((p) => p.distance),
    points.map((p) => p.calories),
    'Distance (km)', 'Calories'
  );
}

function renderWeightChart() {
  const points = state.weights.slice().sort((a, b) => a.date.localeCompare(b.date));
  Charts.renderLine('chart-weight', points.map((p) => formatDateFr(p.date)), points.map((p) => p.weightKg), 'Poids (kg)');
}

/* ============================================================ */
document.addEventListener('DOMContentLoaded', boot);
