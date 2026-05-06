// app.js — Graph model, node UI, wire drawing, drag/drop, controls

// ── UTILITIES ─────────────────────────────────────────
let _id = 0;
const uid = () => `n${++_id}`;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── GRAPH ─────────────────────────────────────────────
class Graph {
  constructor() {
    this.nodes = [];   // { id, type, x, y, fields }
    this.wires = [];   // { id, srcNodeId, srcPort, dstNodeId, dstPort, flow }
  }

  addNode(type, x, y) {
    const def = NODE_DEFS[type];
    if (!def) return null;
    const fields = {};
    def.fields.forEach(f => { fields[f.id] = f.default; });
    const node = { id: uid(), type, x, y, fields };
    this.nodes.push(node);
    return node;
  }

  removeNode(id) {
    this.nodes = this.nodes.filter(n => n.id !== id);
    this.wires = this.wires.filter(w => w.srcNodeId !== id && w.dstNodeId !== id);
  }

  addWire(srcNodeId, srcPort, dstNodeId, dstPort, flow) {
    // Remove existing wire to the same input port
    this.wires = this.wires.filter(w => !(w.dstNodeId === dstNodeId && w.dstPort === dstPort));
    const wire = { id: uid(), srcNodeId, srcPort, dstNodeId, dstPort, flow };
    this.wires.push(wire);
    return wire;
  }

  removeWire(id) {
    this.wires = this.wires.filter(w => w.id !== id);
  }

  clear() {
    this.nodes = [];
    this.wires = [];
  }

  getNode(id) { return this.nodes.find(n => n.id === id); }

  // Returns [{node, port}] for exec outputs from a given node+port
  getExecOutputs(nodeId, portId) {
    return this.wires
      .filter(w => w.srcNodeId === nodeId && w.srcPort === portId && w.flow === 'exec')
      .map(w => ({ node: this.getNode(w.dstNodeId), port: w.dstPort }))
      .filter(x => x.node);
  }

  // Returns {sourceNode, sourcePort} for a data input
  getDataInput(nodeId, portId) {
    const wire = this.wires.find(w => w.dstNodeId === nodeId && w.dstPort === portId && w.flow === 'data');
    if (!wire) return null;
    return { sourceNode: this.getNode(wire.srcNodeId), sourcePort: wire.srcPort };
  }

  flashNode(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('executing');
    setTimeout(() => el.classList.remove('executing'), 350);
  }
}

// ── APP STATE ─────────────────────────────────────────
const graph = new Graph();
const canvas = document.getElementById('canvas');
const wireSvg = document.getElementById('wire-layer');
const hint = document.getElementById('canvas-hint');
const logOutput = document.getElementById('log-output');
const statusText = document.getElementById('status-text');
const stageCanvas = document.getElementById('stage');

let engine = null;
let wirePreview = null; // SVG path being drawn
let pendingWire = null; // { nodeId, portId, portEl, flow }

// Pan/zoom state
let pan = { x: 0, y: 0 };
let scale = 1;
let isPanning = false;
let panStart = { x: 0, y: 0 };

// Drag state
let dragging = null; // { nodeId, startX, startY, nodeStartX, nodeStartY }

// ── LOGGING ───────────────────────────────────────────
function log(msg, type = 'default') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = msg;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
  // Keep log trimmed
  while (logOutput.children.length > 200) logOutput.removeChild(logOutput.firstChild);
}

function setStatus(msg) { statusText.textContent = msg; }

// ── ENGINE CONTROLS ───────────────────────────────────
document.getElementById('btn-run').addEventListener('click', () => {
  if (engine && engine.running) return;
  logOutput.innerHTML = '';
  engine = new Engine(graph, stageCanvas, log, setStatus);
  document.getElementById('btn-run').disabled = true;
  document.getElementById('btn-stop').disabled = false;
  engine.run().then(() => {
    document.getElementById('btn-run').disabled = false;
    document.getElementById('btn-stop').disabled = true;
  });
});

document.getElementById('btn-stop').addEventListener('click', () => {
  engine && engine.stop();
  document.getElementById('btn-run').disabled = false;
  document.getElementById('btn-stop').disabled = true;
});

document.getElementById('btn-clear').addEventListener('click', () => {
  engine && engine.running && engine.stop();
  graph.clear();
  canvas.innerHTML = '';
  renderWires();
  hint.classList.remove('hidden');
  log('Canvas cleared', 'info');
});

// ── CANVAS TRANSFORM ──────────────────────────────────
function applyTransform() {
  canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
  canvas.style.transformOrigin = '0 0';
  wireSvg.style.transform = canvas.style.transform;
  wireSvg.style.transformOrigin = '0 0';
}

// Pan with middle mouse / right mouse
const canvasArea = document.getElementById('canvas-area');

canvasArea.addEventListener('mousedown', e => {
  if (e.button === 1 || e.button === 2) {
    isPanning = true;
    panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    e.preventDefault();
  }
});

window.addEventListener('mousemove', e => {
  if (isPanning) {
    pan.x = e.clientX - panStart.x;
    pan.y = e.clientY - panStart.y;
    applyTransform();
  }
});

window.addEventListener('mouseup', () => { isPanning = false; });

canvasArea.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvasArea.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = clamp(scale * delta, 0.3, 2.5);
  pan.x = mx - (mx - pan.x) * (newScale / scale);
  pan.y = my - (my - pan.y) * (newScale / scale);
  scale = newScale;
  applyTransform();
}, { passive: false });

canvasArea.addEventListener('contextmenu', e => e.preventDefault());

// ── PALETTE DRAG ──────────────────────────────────────
document.querySelectorAll('.palette-block').forEach(el => {
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('nodeType', el.dataset.type);
  });
});

canvasArea.addEventListener('dragover', e => e.preventDefault());

canvasArea.addEventListener('drop', e => {
  e.preventDefault();
  const type = e.dataTransfer.getData('nodeType');
  if (!type) return;
  const rect = canvasArea.getBoundingClientRect();
  const x = (e.clientX - rect.left - pan.x) / scale;
  const y = (e.clientY - rect.top - pan.y) / scale;
  const node = graph.addNode(type, x, y);
  if (node) {
    createNodeEl(node);
    renderWires();
    hint.classList.add('hidden');
  }
});

// ── NODE ELEMENT CREATION ─────────────────────────────
function createNodeEl(node) {
  const def = NODE_DEFS[node.type];
  const el = document.createElement('div');
  el.className = 'node';
  el.id = node.id;
  el.dataset.category = def.category;
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';

  // Header
  const header = document.createElement('div');
  header.className = 'node-header';
  header.innerHTML = `
    <span class="node-icon">${def.icon}</span>
    <span class="node-title">${def.title}</span>
    <span class="node-delete" title="Delete">✕</span>
  `;
  el.appendChild(header);

  // Fields
  if (def.fields.length) {
    const body = document.createElement('div');
    body.className = 'node-body';
    def.fields.forEach(f => {
      const row = document.createElement('div');
      row.className = 'node-field';
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        f.options.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt.value; o.textContent = opt.label;
          if (opt.value === f.default) o.selected = true;
          input.appendChild(o);
        });
      } else {
        input = document.createElement('input');
        input.type = f.type === 'text' ? 'text' : f.type === 'color' ? 'color' : 'number';
        input.value = node.fields[f.id] ?? f.default;
      }
      input.dataset.field = f.id;
      input.addEventListener('change', () => {
        node.fields[f.id] = input.type === 'number' ? +input.value : input.value;
      });
      input.addEventListener('mousedown', e => e.stopPropagation());
      row.innerHTML = `<label>${f.label}</label>`;
      row.appendChild(input);
      body.appendChild(row);
    });
    el.appendChild(body);
  }

  // Ports row
  const portsRow = document.createElement('div');
  portsRow.className = 'ports-row';

  const inputGroup = document.createElement('div');
  inputGroup.className = 'port-group inputs';

  const outputGroup = document.createElement('div');
  outputGroup.className = 'port-group outputs';

  def.inputs.forEach(p => {
    const entry = makePortEntry(node, p, 'input');
    inputGroup.appendChild(entry);
  });

  def.outputs.forEach(p => {
    const entry = makePortEntry(node, p, 'output');
    outputGroup.appendChild(entry);
  });

  portsRow.appendChild(inputGroup);
  portsRow.appendChild(outputGroup);
  el.appendChild(portsRow);

  // Delete button
  header.querySelector('.node-delete').addEventListener('mousedown', e => {
    e.stopPropagation();
    graph.removeNode(node.id);
    el.remove();
    renderWires();
  });

  // Drag to move node
  setupNodeDrag(el, node);

  canvas.appendChild(el);
  return el;
}

function makePortEntry(node, port, direction) {
  const entry = document.createElement('div');
  entry.className = `port-entry ${direction === 'output' ? 'output' : ''}`;

  const dot = document.createElement('div');
  dot.className = 'port';
  dot.dataset.nodeId = node.id;
  dot.dataset.portId = port.id;
  dot.dataset.flow = port.flow;
  dot.dataset.dir = direction;
  if (port.flow === 'exec') dot.dataset.flow = 'exec';

  const label = document.createElement('span');
  label.textContent = port.label;

  if (direction === 'output') {
    entry.appendChild(label);
    entry.appendChild(dot);
  } else {
    entry.appendChild(dot);
    entry.appendChild(label);
  }

  setupPortInteraction(dot);
  return entry;
}

// ── NODE DRAGGING ─────────────────────────────────────
function setupNodeDrag(el, node) {
  el.querySelector('.node-header').addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Deselect others
    document.querySelectorAll('.node.selected').forEach(n => n.classList.remove('selected'));
    el.classList.add('selected');

    dragging = {
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      nodeStartX: node.x,
      nodeStartY: node.y
    };
  });
}

window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const node = graph.getNode(dragging.nodeId);
  if (!node) return;
  const dx = (e.clientX - dragging.startX) / scale;
  const dy = (e.clientY - dragging.startY) / scale;
  node.x = dragging.nodeStartX + dx;
  node.y = dragging.nodeStartY + dy;
  const el = document.getElementById(node.id);
  if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
  renderWires();
});

window.addEventListener('mouseup', () => { dragging = null; });

// ── WIRE DRAWING ──────────────────────────────────────
function setupPortInteraction(dot) {
  dot.addEventListener('mousedown', e => {
    e.stopPropagation();
    if (e.button !== 0) return;

    // If clicking an input that already has a wire, remove it
    if (dot.dataset.dir === 'input') {
      const existing = graph.wires.find(
        w => w.dstNodeId === dot.dataset.nodeId && w.dstPort === dot.dataset.portId
      );
      if (existing) {
        graph.removeWire(existing.id);
        renderWires();
        return;
      }
    }

    pendingWire = {
      nodeId: dot.dataset.nodeId,
      portId: dot.dataset.portId,
      flow: dot.dataset.flow,
      dir: dot.dataset.dir,
      portEl: dot
    };

    // Create preview line
    wirePreview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    wirePreview.classList.add('wire', 'preview-wire');
    wireSvg.appendChild(wirePreview);
  });
}

canvasArea.addEventListener('mousemove', e => {
  if (!pendingWire || !wirePreview) return;
  const rect = canvasArea.getBoundingClientRect();
  const startPos = getPortCenter(pendingWire.portEl);
  const endX = (e.clientX - rect.left - pan.x) / scale;
  const endY = (e.clientY - rect.top - pan.y) / scale;
  wirePreview.setAttribute('d', bezier(startPos.x, startPos.y, endX, endY));
});

canvasArea.addEventListener('mouseup', e => {
  if (!pendingWire) return;
  // Find what port was released on
  const target = e.target.closest('.port');
  if (target && target !== pendingWire.portEl) {
    tryConnect(pendingWire, {
      nodeId: target.dataset.nodeId,
      portId: target.dataset.portId,
      flow: target.dataset.flow,
      dir: target.dataset.dir
    });
  }
  wirePreview && wirePreview.remove();
  wirePreview = null;
  pendingWire = null;
});

function tryConnect(from, to) {
  // Must connect output → input or input → output
  let src, dst;
  if (from.dir === 'output' && to.dir === 'input') { src = from; dst = to; }
  else if (from.dir === 'input' && to.dir === 'output') { src = to; dst = from; }
  else return;

  // Must be same flow type
  if (src.flow !== dst.flow) {
    log(`Cannot connect ${src.flow} → ${dst.flow}`, 'error');
    return;
  }

  graph.addWire(src.nodeId, src.portId, dst.nodeId, dst.portId, src.flow);
  renderWires();
}

// ── WIRE RENDERING ────────────────────────────────────
function getPortCenter(el) {
  const rect1 = el.getBoundingClientRect();
  const rect2 = canvasArea.getBoundingClientRect();
  return {
    x: (rect1.left + rect1.width / 2 - rect2.left - pan.x) / scale,
    y: (rect1.top + rect1.height / 2 - rect2.top - pan.y) / scale
  };
}

function bezier(x1, y1, x2, y2) {
  const cx = Math.abs(x2 - x1) * 0.6;
  return `M ${x1} ${y1} C ${x1 + cx} ${y1}, ${x2 - cx} ${y2}, ${x2} ${y2}`;
}

function renderWires() {
  // Remove all non-preview wires
  wireSvg.querySelectorAll('.wire:not(.preview-wire)').forEach(w => w.remove());

  // Update port connected state
  document.querySelectorAll('.port').forEach(p => p.classList.remove('connected'));

  graph.wires.forEach(wire => {
    const srcEl = document.querySelector(
      `.port[data-node-id="${wire.srcNodeId}"][data-port-id="${wire.srcPort}"]`
    );
    const dstEl = document.querySelector(
      `.port[data-node-id="${wire.dstNodeId}"][data-port-id="${wire.dstPort}"]`
    );
    if (!srcEl || !dstEl) return;

    srcEl.classList.add('connected');
    dstEl.classList.add('connected');

    const s = getPortCenter(srcEl);
    const d = getPortCenter(dstEl);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('wire', wire.flow === 'exec' ? 'exec-wire' : 'data-wire');
    path.dataset.wireId = wire.id;
    path.setAttribute('d', bezier(s.x, s.y, d.x, d.y));

    // Click to remove wire
    path.style.pointerEvents = 'stroke';
    path.style.strokeWidth = '8px';
    path.addEventListener('click', () => {
      graph.removeWire(wire.id);
      renderWires();
    });

    wireSvg.appendChild(path);
  });
}

// ── CONTEXT MENU ──────────────────────────────────────
let ctxMenu = null;

function closeCtxMenu() {
  ctxMenu && ctxMenu.remove();
  ctxMenu = null;
}

document.addEventListener('click', closeCtxMenu);

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  closeCtxMenu();

  const nodeEl = e.target.closest('.node');
  if (!nodeEl) return;

  const menu = document.createElement('div');
  menu.id = 'context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  const del = document.createElement('div');
  del.className = 'ctx-item danger';
  del.innerHTML = '🗑 Delete Node';
  del.addEventListener('click', () => {
    graph.removeNode(nodeEl.id);
    nodeEl.remove();
    renderWires();
    closeCtxMenu();
  });

  const dup = document.createElement('div');
  dup.className = 'ctx-item';
  dup.innerHTML = '⧉ Duplicate';
  dup.addEventListener('click', () => {
    const node = graph.getNode(nodeEl.id);
    if (!node) return;
    const newNode = graph.addNode(node.type, node.x + 20, node.y + 20);
    Object.assign(newNode.fields, node.fields);
    createNodeEl(newNode);
    renderWires();
    closeCtxMenu();
  });

  menu.appendChild(dup);
  menu.appendChild(del);
  document.body.appendChild(menu);
  ctxMenu = menu;
});

// ── KEYBOARD SHORTCUTS ────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === document.body) {
    document.querySelectorAll('.node.selected').forEach(el => {
      graph.removeNode(el.id);
      el.remove();
    });
    renderWires();
  }
});

// ── INIT ──────────────────────────────────────────────
// Draw initial empty stage
(function initStage() {
  const ctx = stageCanvas.getContext('2d');
  const W = stageCanvas.width, H = stageCanvas.height;
  ctx.fillStyle = '#111118';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 20) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 20) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // Draw initial sprite hint
  ctx.fillStyle = 'rgba(124, 106, 245, 0.3)';
  ctx.beginPath();
  ctx.arc(W/2, H/2, 12, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.font = '10px Space Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('sprite appears here', W/2, H/2 + 26);
})();

log('NodeScratch ready — drag blocks from the panel to get started', 'info');
log('Connect exec ports (square) to sequence blocks, data ports (round) to pass values', 'info');
log('Right-click nodes to delete/duplicate · Click wires to remove · Scroll to zoom', 'info');