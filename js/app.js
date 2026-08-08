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
  $('#btn-add-cardio').addEventListener('click', () => addCardioCard());
  $('#btn-add-strength').addEventListener('click', () => addStrengthCard());
  $('#form-seance').addEventListener('submit', onSubmitSession);
}

function makeChipRow(items, onPick, extraLabel) {
  const row = document.createElement('div');
  row.className = 'chip-row';
  items.forEach((m) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = m.name;
    chip.dataset.machine = m.name;
    chip.addEventListener('click', () => {
      row.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      onPick(m.name);
    });
    row.appendChild(chip);
  });
  const newChip = document.createElement('button');
  newChip.type = 'button';
  newChip.className = 'chip';
  newChip.textContent = extraLabel || '+ Nouvelle';
  row.appendChild(newChip);
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.placeholder = 'Nom de la machine';
  customInput.style.display = 'none';
  customInput.style.marginTop = '8px';
  newChip.addEventListener('click', () => {
    row.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
    customInput.style.display = 'block';
    customInput.focus();
  });
  customInput.addEventListener('input', () => onPick(customInput.value.trim()));
  const wrap = document.createElement('div');
  wrap.appendChild(row);
  wrap.appendChild(customInput);
  return wrap;
}

function lastEntryForMachine(machineName, kind) {
  for (const s of state.sessions) {
    const list = kind === 'cardio' ? s.cardio : s.strength;
    const found = (list || []).find((e) => e.machine.toLowerCase() === machineName.toLowerCase());
    if (found) return found;
  }
  return null;
}

function addCardioCard() {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.innerHTML = `
    <div class="entry-card-head">
      <strong>Cardio</strong>
      <button type="button" class="entry-remove" aria-label="Supprimer">✕</button>
    </div>
  `;
  const chips = makeChipRow(machinesByType('cardio'), (name) => { card.dataset.machine = name; prefillCardio(card, name); });
  const grid = document.createElement('div');
  grid.className = 'entry-grid';
  grid.innerHTML = `
    <div class="field-row"><label>Durée (min)</label><input type="number" class="f-duration" inputmode="numeric" min="0"></div>
    <div class="field-row"><label>Distance (km)</label><input type="number" class="f-distance" step="0.01" inputmode="decimal" min="0"></div>
    <div class="field-row"><label>Calories</label><input type="number" class="f-calories" inputmode="numeric" min="0"></div>
    <div class="field-row"><label>Watts moyens</label><input type="number" class="f-watts" inputmode="numeric" min="0"></div>
    <div class="field-row"><label>Vitesse moy. (km/h)</label><input type="number" class="f-speed" step="0.1" inputmode="decimal" min="0"></div>
    <div class="field-row"><label>Inclinaison (%)</label><input type="number" class="f-incline" step="0.1" inputmode="decimal" min="0"></div>
  `;
  card.appendChild(chips);
  card.appendChild(grid);
  card.querySelector('.entry-remove').addEventListener('click', () => card.remove());
  $('#cardio-list').appendChild(card);
}

function prefillCardio(card, name) {
  const last = lastEntryForMachine(name, 'cardio');
  if (!last) return;
  const set = (cls, val) => { const el = card.querySelector(cls); if (el && val !== null && val !== undefined) el.value = val; };
  set('.f-duration', last.durationMin);
  set('.f-distance', last.distanceKm);
  set('.f-calories', last.calories);
  set('.f-watts', last.avgWatts);
  set('.f-speed', last.avgSpeed);
  set('.f-incline', last.avgIncline);
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
      });
    });
  });
}

function addStrengthCard() {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.innerHTML = `
    <div class="entry-card-head">
      <strong>Renforcement</strong>
      <button type="button" class="entry-remove" aria-label="Supprimer">✕</button>
    </div>
  `;
  const chips = makeChipRow(machinesByType('strength'), (name) => { card.dataset.machine = name; prefillStrength(card, name); });
  const grid = document.createElement('div');
  grid.className = 'entry-grid';
  grid.innerHTML = `
    <div class="field-row"><label>Charge (kg)</label>${stepperHtml('f-weight', '', 1)}</div>
    <div class="field-row"><label>Séries</label>${stepperHtml('f-series', '', 1)}</div>
    <div class="field-row"><label>Répétitions</label>${stepperHtml('f-reps', '', 1)}</div>
  `;
  const legToggle = document.createElement('label');
  legToggle.className = 'leg-toggle';
  legToggle.innerHTML = `<input type="checkbox" class="f-perleg"> Chaque jambe séparément`;

  card.appendChild(chips);
  card.appendChild(grid);
  card.appendChild(legToggle);
  card.querySelector('.entry-remove').addEventListener('click', () => card.remove());
  bindSteppers(grid);
  $('#strength-list').appendChild(card);
}

function prefillStrength(card, name) {
  const last = lastEntryForMachine(name, 'strength');
  if (!last) return;
  const set = (cls, val) => { const el = card.querySelector(cls); if (el && val !== null && val !== undefined) el.value = val; };
  set('.f-weight', last.weightKg);
  set('.f-series', last.series);
  set('.f-reps', last.reps);
  const legInput = card.querySelector('.f-perleg');
  if (legInput) legInput.checked = !!last.perLeg;
}

/* ============================================================
   Séance — submit
   ============================================================ */
async function onSubmitSession(e) {
  e.preventDefault();

  const date = $('#input-date').value || todayIso();
  const warmupMinutes = num($('#input-warmup').value);
  const note = $('#input-note').value.trim();

  const cardio = $all('#cardio-list .entry-card').map((card) => {
    const machine = (card.dataset.machine || '').trim();
    if (!machine) return null;
    return {
      machine,
      durationMin: num(card.querySelector('.f-duration').value),
      distanceKm: num(card.querySelector('.f-distance').value),
      calories: num(card.querySelector('.f-calories').value),
      avgWatts: num(card.querySelector('.f-watts').value),
      avgSpeed: num(card.querySelector('.f-speed').value),
      avgIncline: num(card.querySelector('.f-incline').value),
    };
  }).filter(Boolean);

  const strength = $all('#strength-list .entry-card').map((card) => {
    const machine = (card.dataset.machine || '').trim();
    if (!machine) return null;
    return {
      machine,
      weightKg: num(card.querySelector('.f-weight').value) || 0,
      series: num(card.querySelector('.f-series').value) || 0,
      reps: num(card.querySelector('.f-reps').value) || 0,
      perLeg: card.querySelector('.f-perleg').checked,
    };
  }).filter(Boolean);

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

  // Update machine recency + auto-create unseen machine names
  const usedNames = new Set([...cardio.map((c) => c.machine), ...strength.map((s) => s.machine)]);
  for (const name of usedNames) {
    const type = strength.some((s) => s.machine === name) ? 'strength' : 'cardio';
    let m = state.machines.find((mm) => mm.name.toLowerCase() === name.toLowerCase());
    if (!m) {
      m = { id: DB.uid(), name, type, lastUsed: Date.now() };
    } else {
      m.lastUsed = Date.now();
    }
    await DB.put('machines', m);
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
  $('#cardio-list').innerHTML = '';
  $('#strength-list').innerHTML = '';
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
      const parts = [];
      if (c.durationMin) parts.push(`${c.durationMin} min`);
      if (c.distanceKm) parts.push(`${c.distanceKm} km`);
      if (c.calories) parts.push(`${c.calories} cal`);
      if (c.avgWatts) parts.push(`${c.avgWatts} W`);
      if (c.avgSpeed) parts.push(`${c.avgSpeed} km/h`);
      if (c.avgIncline) parts.push(`${c.avgIncline}% incl.`);
      lines.push(`${c.machine} — ${parts.join(' / ')}`);
    });
    (s.strength || []).forEach((e) => {
      const leg = e.perLeg ? ' chaque jambe' : '';
      lines.push(`${e.machine} ${e.weightKg}kg — ${e.series}x${e.reps}${leg}`);
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
  $('#cardio-list').innerHTML = '';
  $('#strength-list').innerHTML = '';

  (s.cardio || []).forEach((c) => {
    addCardioCard();
    const card = $('#cardio-list .entry-card:last-child');
    card.dataset.machine = c.machine;
    card.querySelector('.f-duration').value = c.durationMin ?? '';
    card.querySelector('.f-distance').value = c.distanceKm ?? '';
    card.querySelector('.f-calories').value = c.calories ?? '';
    card.querySelector('.f-watts').value = c.avgWatts ?? '';
    card.querySelector('.f-speed').value = c.avgSpeed ?? '';
    card.querySelector('.f-incline').value = c.avgIncline ?? '';
    const chip = card.querySelector(`.chip[data-machine="${CSS.escape(c.machine)}"]`);
    if (chip) chip.classList.add('selected');
  });

  (s.strength || []).forEach((e) => {
    addStrengthCard();
    const card = $('#strength-list .entry-card:last-child');
    card.dataset.machine = e.machine;
    card.querySelector('.f-weight').value = e.weightKg ?? '';
    card.querySelector('.f-series').value = e.series ?? '';
    card.querySelector('.f-reps').value = e.reps ?? '';
    card.querySelector('.f-perleg').checked = !!e.perLeg;
    const chip = card.querySelector(`.chip[data-machine="${CSS.escape(e.machine)}"]`);
    if (chip) chip.classList.add('selected');
  });

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
      row.className = 'machine-row';
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
