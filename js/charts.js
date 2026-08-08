'use strict';

const Charts = (() => {
  const instances = {};

  const ACCENT = '#f97316';
  const ACCENT_SOFT = 'rgba(249, 115, 22, 0.15)';
  const SECONDARY = '#0ea5e9';

  function destroy(canvasId) {
    if (instances[canvasId]) {
      instances[canvasId].destroy();
      delete instances[canvasId];
    }
  }

  function clear(canvasId) {
    destroy(canvasId);
  }

  function baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { font: { size: 10 } } },
      },
    };
  }

  function renderBar(canvasId, labels, data, label) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (labels.length === 0) return;
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label, data, backgroundColor: ACCENT, borderRadius: 6, maxBarThickness: 36 }] },
      options: baseOptions(),
    });
  }

  function renderLine(canvasId, labels, data, label) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (labels.length === 0) return;
    instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label, data,
          borderColor: ACCENT,
          backgroundColor: ACCENT_SOFT,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        }],
      },
      options: baseOptions(),
    });
  }

  function renderDualLine(canvasId, labels, dataA, dataB, labelA, labelB) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (labels.length === 0) return;
    const opts = baseOptions();
    opts.plugins.legend.display = true;
    opts.plugins.legend.labels = { font: { size: 11 } };
    opts.scales.y1 = { beginAtZero: true, position: 'right', ticks: { font: { size: 10 } }, grid: { display: false } };
    instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: labelA, data: dataA, borderColor: ACCENT, backgroundColor: ACCENT_SOFT, tension: 0.3, pointRadius: 3, yAxisID: 'y' },
          { label: labelB, data: dataB, borderColor: SECONDARY, backgroundColor: 'rgba(14,165,233,0.15)', tension: 0.3, pointRadius: 3, yAxisID: 'y1' },
        ],
      },
      options: opts,
    });
  }

  return { renderBar, renderLine, renderDualLine, clear };
})();

window.Charts = Charts;
