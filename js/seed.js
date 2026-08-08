'use strict';

const DEFAULT_MACHINES = [
  { name: 'Heliptic', type: 'cardio' },
  { name: 'Tapis de marche', type: 'cardio' },
  { name: 'Press', type: 'strength' },
  { name: 'Hip adductor', type: 'strength' },
  { name: 'Abductor', type: 'strength' },
  { name: 'Leg press', type: 'strength' },
  { name: 'Seated row', type: 'strength' },
  { name: 'Glute', type: 'strength' },
  { name: 'Tractions', type: 'strength' },
];

async function ensureSeedData() {
  const existing = await DB.getAll('machines');
  if (existing.length > 0) return;
  const machines = DEFAULT_MACHINES.map((m) => ({
    id: DB.uid(),
    name: m.name,
    type: m.type,
    lastUsed: null,
  }));
  await DB.bulkPut('machines', machines);
}

window.ensureSeedData = ensureSeedData;
