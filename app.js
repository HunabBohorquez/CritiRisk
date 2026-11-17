'use strict';

const STORAGE_KEY = 'critirisk.project.v1';
const EPS = 0.001;
const MC_ITERATIONS = 2000;
const $ = (id) => document.getElementById(id);
const fmt = (x) => String(Number(x.toFixed(2)));
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 1. Validación del grafo (Kahn) ---------- */
class GraphValidator {
  static parsePreds(text) {
    return [...new Set(text.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
  }

  static validate(tasks) {
    const errors = [];
    const ids = new Set();
    tasks.forEach((t) => {
      if (ids.has(t.id)) errors.push(`ID duplicado: ${t.id}.`);
      ids.add(t.id);
      if (![t.o, t.m, t.p].every(Number.isFinite) || t.o < 0) errors.push(`Tarea ${t.id}: los tiempos deben ser números ≥ 0.`);
      else if (!(t.o <= t.m && t.m <= t.p)) errors.push(`Tarea ${t.id}: se requiere O ≤ M ≤ P.`);
    });
    tasks.forEach((t) => t.preds.forEach((p) => {
      if (!ids.has(p)) errors.push(`La tarea ${t.id} referencia un ID inexistente: "${p}".`);
    }));
    if (errors.length) return { ok: false, errors, order: [] };

    const indeg = new Map(tasks.map((t) => [t.id, t.preds.length]));
    const succ = new Map(tasks.map((t) => [t.id, []]));
    tasks.forEach((t) => t.preds.forEach((p) => succ.get(p).push(t.id)));
    const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
    const order = [];
    while (queue.length) {
      const u = queue.shift();
      order.push(u);
      succ.get(u).forEach((v) => {
        indeg.set(v, indeg.get(v) - 1);
        if (indeg.get(v) === 0) queue.push(v);
      });
    }
    if (order.length !== tasks.length) {
      const cyc = tasks.filter((t) => !order.includes(t.id)).map((t) => t.id);
      errors.push(`⚠ Dependencia circular detectada. Tareas involucradas: ${cyc.join(', ')}.`);
      return { ok: false, errors, order: [] };
    }
    return { ok: true, errors: [], order };
  }
}

/* ---------- 2. Motor determinista CPM / PERT ---------- */
class CpmSolver {
  static expected(t) { return (t.o + 4 * t.m + t.p) / 6; }

  /** durations: Map id -> duración. order: orden topológico. */
  static solve(tasks, order, durations) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const succ = new Map(tasks.map((t) => [t.id, []]));
    tasks.forEach((t) => t.preds.forEach((p) => succ.get(p).push(t.id)));
    const r = new Map();

    order.forEach((id) => {                       // Forward pass
      const es = Math.max(0, ...byId.get(id).preds.map((p) => r.get(p).ef));
      r.set(id, { id, d: durations.get(id), es, ef: es + durations.get(id) });
    });
    const end = Math.max(0, ...[...r.values()].map((x) => x.ef));

    [...order].reverse().forEach((id) => {        // Backward pass
      const x = r.get(id);
      x.lf = succ.get(id).length ? Math.min(...succ.get(id).map((s) => r.get(s).ls)) : end;
      x.ls = x.lf - x.d;
      x.slack = x.ls - x.es;
      x.critical = x.slack <= EPS;
    });
    return { rows: tasks.map((t) => r.get(t.id)), duration: end };
  }

  static deterministic(tasks, order) {
    const d = new Map(tasks.map((t) => [t.id, CpmSolver.expected(t)]));
    return CpmSolver.solve(tasks, order, d);
  }
}

/* ---------- 3. Simulación Monte Carlo ---------- */
class ScheduleMonteCarlo {
  static triangular(o, m, p, u = Math.random()) {
    if (p - o < 1e-12) return m;
    const c = (m - o) / (p - o);
    return u < c ? o + Math.sqrt(u * (p - o) * (m - o)) : p - Math.sqrt((1 - u) * (p - o) * (p - m));
  }

  static run(tasks, order, deadline, n = MC_ITERATIONS) {
    const totals = new Array(n);
    const critCount = new Map(tasks.map((t) => [t.id, 0]));
    for (let i = 0; i < n; i++) {
      const d = new Map(tasks.map((t) => [t.id, ScheduleMonteCarlo.triangular(t.o, t.m, t.p)]));
      const res = CpmSolver.solve(tasks, order, d);
      totals[i] = res.duration;
      res.rows.forEach((x) => { if (x.critical) critCount.set(x.id, critCount.get(x.id) + 1); });
    }
    const sorted = [...totals].sort((a, b) => a - b);
    const mean = totals.reduce((s, x) => s + x, 0) / n;
    const variance = totals.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    return {
      n, totals, deadline, mean,
      std: Math.sqrt(variance),
      p90: sorted[Math.ceil(0.9 * n) - 1],
      prob: totals.filter((x) => x <= deadline + 1e-9).length / n,
      criticality: tasks.map((t) => ({ id: t.id, index: critCount.get(t.id) / n })),
    };
  }
}

/* ---------- 4. Renderizado en canvas ---------- */
class GanttAndHistRenderer {
  static prep(canvas, height) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(canvas.parentElement.clientWidth, 600);
    canvas.style.width = w + 'px';
    canvas.style.height = height + 'px';
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    return { ctx, w, h: height };
  }

  static gantt(canvas, tasks, result) {
    const rowH = 32, top = 34, left = 110, right = 24;
    const { ctx, w, h } = GanttAndHistRenderer.prep(canvas, Math.max(140, top + tasks.length * rowH + 20));
    if (!result || !tasks.length) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '14px system-ui';
      ctx.fillText('Agrega tareas para ver el diagrama.', 20, 40);
      return;
    }
    const total = Math.max(result.duration, 1);
    const step = total <= 20 ? 1 : total <= 60 ? 5 : 10;
    const maxX = Math.ceil(total / step) * step;
    const sx = (v) => left + (v / maxX) * (w - left - right);

    ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    for (let d = 0; d <= maxX; d += step) {
      ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.moveTo(sx(d), top - 8); ctx.lineTo(sx(d), h - 10); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.fillText(d, sx(d), top - 14);
    }
    result.rows.forEach((x, i) => {
      const y = top + i * rowH;
      ctx.textAlign = 'right'; ctx.fillStyle = x.critical ? '#f97316' : '#e2e8f0'; ctx.font = 'bold 12px system-ui';
      ctx.fillText(x.id, left - 10, y + 17);
      if (x.slack > EPS) {                         // barra de holgura
        ctx.fillStyle = 'rgba(148,163,184,.25)';
        ctx.fillRect(sx(x.ef), y + 6, sx(x.ef + x.slack) - sx(x.ef), 16);
        ctx.setLineDash([4, 3]); ctx.strokeStyle = '#94a3b8';
        ctx.strokeRect(sx(x.ef) + .5, y + 6.5, sx(x.ef + x.slack) - sx(x.ef) - 1, 15);
        ctx.setLineDash([]);
      }
      ctx.fillStyle = x.critical ? '#f97316' : '#3b82f6';
      ctx.fillRect(sx(x.es), y + 6, Math.max(sx(x.ef) - sx(x.es), 2), 16);
      ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
      if (sx(x.ef) - sx(x.es) > 34) ctx.fillText(fmt(x.d) + 'd', sx(x.es) + 5, y + 18);
    });
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx(result.duration), top - 8); ctx.lineTo(sx(result.duration), h - 10); ctx.stroke();
    ctx.lineWidth = 1;
  }

  static histogram(canvas, mc, bins = 30) {
    const { ctx, w, h } = GanttAndHistRenderer.prep(canvas, 300);
    const L = 50, R = 20, T = 20, B = 42;
    const min = Math.min(...mc.totals), max = Math.max(...mc.totals);
    const span = Math.max(max - min, 1e-6);
    const counts = new Array(bins).fill(0);
    mc.totals.forEach((v) => { counts[Math.min(bins - 1, Math.floor(((v - min) / span) * bins))]++; });
    const peak = Math.max(...counts);
    const sx = (v) => L + ((v - min) / span) * (w - L - R);
    const bw = (w - L - R) / bins;

    counts.forEach((c, i) => {
      const bh = (c / peak) * (h - T - B);
      const binEnd = min + ((i + 1) / bins) * span;
      ctx.fillStyle = binEnd <= mc.deadline + 1e-9 ? '#22c55e' : '#3b82f6';
      ctx.fillRect(L + i * bw + 1, h - B - bh, bw - 2, bh);
    });
    ctx.strokeStyle = '#94a3b8'; ctx.beginPath(); ctx.moveTo(L, h - B); ctx.lineTo(w - R, h - B); ctx.moveTo(L, T); ctx.lineTo(L, h - B); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    for (let i = 0; i <= 6; i++) { const v = min + (span * i) / 6; ctx.fillText(fmt(v), sx(v), h - B + 16); }
    ctx.fillText('Duración total del proyecto (días)', (L + w - R) / 2, h - 8);
    ctx.textAlign = 'right'; ctx.fillText(peak, L - 6, T + 8); ctx.fillText('0', L - 6, h - B);

    const mark = (v, color, label, dy) => {
      if (v < min - 1e-9 || v > max + 1e-9) return;
      ctx.strokeStyle = color; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(sx(v), T); ctx.lineTo(sx(v), h - B); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(label, sx(v) + 4, T + dy);
    };
    mark(mc.deadline, '#ef4444', `Límite ${fmt(mc.deadline)}`, 10);
    mark(mc.mean, '#facc15', `Media ${fmt(mc.mean)}`, 24);
    mark(mc.p90, '#f97316', `P90 ${fmt(mc.p90)}`, 38);
  }
}

/* ---------- 5. Controlador de la aplicación ---------- */
const DEMO = [
  { id: 'T1', name: 'Análisis de requisitos', preds: [],                 o: 1, m: 2, p: 3 },
  { id: 'T2', name: 'Diseño del sistema',     preds: ['T1'],             o: 2, m: 4, p: 6 },
  { id: 'T3', name: 'Compra de equipo',       preds: ['T1'],             o: 1, m: 3, p: 5 },
  { id: 'T4', name: 'Desarrollo backend',     preds: ['T2'],             o: 4, m: 6, p: 8 },
  { id: 'T5', name: 'Desarrollo frontend',    preds: ['T2'],             o: 3, m: 5, p: 7 },
  { id: 'T6', name: 'Infraestructura',        preds: ['T3'],             o: 1, m: 2, p: 3 },
  { id: 'T7', name: 'Integración y pruebas',  preds: ['T4', 'T5', 'T6'], o: 2, m: 3, p: 4 },
  { id: 'T8', name: 'Despliegue',             preds: ['T7'],             o: 1, m: 2, p: 3 },
];

const App = {
  tasks: [],
  order: [],
  result: null,
  mc: null,

  init() {
    this.load();
    $('taskForm').addEventListener('submit', (e) => { e.preventDefault(); this.saveTask(); });
    $('btnCancel').addEventListener('click', () => this.resetForm());
    $('btnDemo').addEventListener('click', () => { this.commit(structuredClone(DEMO)); $('deadline').value = 18; this.notify('Proyecto demo cargado.', true); });
    $('btnClear').addEventListener('click', () => { if (confirm('¿Vaciar todo el proyecto?')) { this.commit([]); } });
    $('btnExport').addEventListener('click', () => this.exportJSON());
    $('btnMC').addEventListener('click', () => this.runMonteCarlo());
    window.addEventListener('resize', () => this.draw());
    this.recompute();
  },

  notify(msg, ok = false, popup = false) {
    const box = $('alertBox');
    box.textContent = msg; box.hidden = !msg; box.className = 'alert' + (ok ? ' ok' : '');
    if (popup && msg) window.alert(msg);
  },

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      this.tasks = Array.isArray(raw) ? raw : [];
    } catch { this.tasks = []; }
  },

  persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tasks)); } catch { /* sin espacio o bloqueado */ }
  },

  /** Intenta aplicar un nuevo conjunto de tareas; si es inválido, lo rechaza. */
  commit(newTasks) {
    const v = GraphValidator.validate(newTasks);
    if (!v.ok) { this.notify('No se aplicó el cambio:\n' + v.errors.join('\n'), false, true); return false; }
    this.tasks = newTasks; this.mc = null;
    this.persist(); this.resetForm(); this.notify(''); this.recompute();
    $('mcResults').hidden = true;
    return true;
  },

  recompute() {
    const v = GraphValidator.validate(this.tasks);
    if (v.ok && this.tasks.length) { this.order = v.order; this.result = CpmSolver.deterministic(this.tasks, v.order); }
    else { this.order = []; this.result = null; if (!v.ok) this.notify(v.errors.join('\n')); }
    this.renderTable(); this.draw();
  },

  saveTask() {
    const editing = $('editingId').value;
    const t = {
      id: $('fId').value.trim().toUpperCase(),
      name: $('fName').value.trim(),
      preds: GraphValidator.parsePreds($('fPreds').value),
      o: parseFloat($('fO').value), m: parseFloat($('fM').value), p: parseFloat($('fP').value),
    };
    let list;
    if (editing) {
      list = this.tasks.map((x) => (x.id === editing ? t : { ...x, preds: x.preds.map((p) => (p === editing ? t.id : p)) }));
    } else list = [...this.tasks, t];
    this.commit(list);
  },

  editTask(id) {
    const t = this.tasks.find((x) => x.id === id);
    $('editingId').value = id;
    $('fId').value = t.id; $('fName').value = t.name; $('fPreds').value = t.preds.join(', ');
    $('fO').value = t.o; $('fM').value = t.m; $('fP').value = t.p;
    $('btnSave').textContent = 'Guardar cambios'; $('btnCancel').hidden = false;
    $('taskForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  deleteTask(id) {
    if (!confirm(`¿Eliminar la tarea ${id}?`)) return;
    this.commit(this.tasks.filter((x) => x.id !== id));
  },

  resetForm() {
    $('taskForm').reset(); $('editingId').value = '';
    $('btnSave').textContent = 'Agregar tarea'; $('btnCancel').hidden = true;
  },

  renderTable() {
    const tb = document.querySelector('#resultTable tbody');
    const rowsById = new Map((this.result ? this.result.rows : []).map((r) => [r.id, r]));
    tb.innerHTML = this.tasks.map((t) => {
      const r = rowsById.get(t.id);
      const cells = r
        ? `<td>${fmt(r.d)}</td><td>${fmt(r.es)}</td><td>${fmt(r.ef)}</td><td>${fmt(r.ls)}</td><td>${fmt(r.lf)}</td><td>${fmt(r.slack)}</td>
           <td><span class="badge ${r.critical ? 'yes' : 'no'}">${r.critical ? 'Sí' : 'No'}</span></td>`
        : '<td colspan="7">—</td>';
      return `<tr class="${r && r.critical ? 'critical' : ''}">
        <td class="id">${escapeHTML(t.id)}</td><td class="left">${escapeHTML(t.name)}</td><td>${escapeHTML(t.preds.join(', ') || '—')}</td>
        <td>${t.o}</td><td>${t.m}</td><td>${t.p}</td>${cells}
        <td><button class="small" data-edit="${escapeHTML(t.id)}">Editar</button><button class="small danger" data-del="${escapeHTML(t.id)}">Borrar</button></td></tr>`;
    }).join('');
    tb.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => this.editTask(b.dataset.edit)));
    tb.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => this.deleteTask(b.dataset.del)));

    $('projDuration').textContent = this.result ? `${fmt(this.result.duration)} días` : '—';
    const path = this.result ? this.order.filter((id) => rowsById.get(id).critical) : [];
    $('critPath').textContent = path.length ? 'Ruta crítica: ' + path.join(' → ') : '';
  },

  draw() {
    GanttAndHistRenderer.gantt($('ganttCanvas'), this.tasks, this.result);
    if (this.mc) GanttAndHistRenderer.histogram($('histCanvas'), this.mc);
  },

  runMonteCarlo() {
    if (!this.result) { this.notify('Primero define un proyecto válido con al menos una tarea.', false, true); return; }
    const deadline = parseFloat($('deadline').value);
    if (!Number.isFinite(deadline) || deadline < 0) { this.notify('Ingresa una fecha límite válida (días).', false, true); return; }
    this.notify('');
    const mc = (this.mc = ScheduleMonteCarlo.run(this.tasks, this.order, deadline));
    $('mcResults').hidden = false;
    $('mcProb').textContent = (mc.prob * 100).toFixed(1) + ' %';
    $('mcMean').textContent = fmt(mc.mean) + ' días';
    $('mcStd').textContent = fmt(mc.std) + ' días';
    $('mcP90').textContent = fmt(mc.p90) + ' días';
    $('critIndex').innerHTML = [...mc.criticality].sort((a, b) => b.index - a.index).map((c) =>
      `<div class="ci-row"><b>${escapeHTML(c.id)}</b><div class="ci-bar"><i style="width:${(c.index * 100).toFixed(1)}%"></i></div><span>${(c.index * 100).toFixed(1)}%</span></div>`).join('');
    this.draw();
  },

  exportJSON() {
    const payload = { app: 'CritiRisk', exportedAt: new Date().toISOString(), tasks: this.tasks, cpm: this.result,
      monteCarlo: this.mc ? { iterations: this.mc.n, deadline: this.mc.deadline, probability: this.mc.prob, mean: this.mc.mean, p90: this.mc.p90, criticality: this.mc.criticality } : null };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = 'critirisk-proyecto.json';
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
