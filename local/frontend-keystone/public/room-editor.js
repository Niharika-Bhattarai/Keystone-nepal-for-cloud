/**
 * Interactive Room Editor for Keystone Training
 * Allows dragging rooms, resizing, and recording annotated changes for ML training.
 */
class RoomEditor {
  constructor(svgContainer, planSpec, planId, options = {}) {
    this.svgContainer = svgContainer;
    this.planSpec     = JSON.parse(JSON.stringify(planSpec));
    this.originalSpec = JSON.parse(JSON.stringify(planSpec));
    this.planId       = planId || planSpec.id || null;
    this.onClose      = options.onClose || null;

    this.changes      = [];
    this.selectedRoom = null;
    this.dragMode     = null;
    this.dragStart    = null;
    this.pendingChange = null; // room awaiting reason input

    // Store bound handlers for proper removeEventListener
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseUp   = this._onMouseUp.bind(this);

    this._init();
  }

  _init() {
    this._injectStyles();
    this._buildPanel();
    this._renderSVG();
  }

  _injectStyles() {
    if (document.getElementById('re-styles')) return;
    const s = document.createElement('style');
    s.id = 're-styles';
    s.textContent = `
      .re-panel {
        position: absolute; right: 0; top: 0; width: 260px; height: 100%;
        background: #161616; border-left: 1px solid #2a2a2a;
        display: flex; flex-direction: column; z-index: 20; overflow: hidden;
      }
      .re-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 12px; background: #1a1a1a; border-bottom: 1px solid #2a2a2a;
      }
      .re-header h3 { font-size: 13px; font-weight: 600; color: #fff; margin: 0; }
      .re-close { background: none; border: none; color: #666; font-size: 18px; cursor: pointer; padding: 0; line-height: 1; }
      .re-close:hover { color: #aaa; }
      .re-toolbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid #2a2a2a; }
      .re-btn { flex: 1; padding: 5px 6px; font-size: 11px; background: #252525; border: 1px solid #333; color: #e8e8e8; border-radius: 4px; cursor: pointer; }
      .re-btn:hover { background: #333; }
      .re-btn.primary { background: #1d4ed8; border-color: #2563eb; color: #fff; }
      .re-btn.primary:hover { background: #2563eb; }
      .re-btn:disabled { opacity: 0.5; cursor: default; }
      .re-status { padding: 8px 10px; font-size: 11px; color: #888; background: #0f0f0f; border-bottom: 1px solid #2a2a2a; min-height: 34px; }
      .re-reason-box { padding: 8px; border-bottom: 1px solid #2a2a2a; background: #1a1a1a; display: none; }
      .re-reason-box.visible { display: block; }
      .re-reason-box label { font-size: 11px; color: #60a5fa; display: block; margin-bottom: 4px; }
      .re-reason-box textarea { width: 100%; padding: 5px 7px; background: #252525; border: 1px solid #444; color: #e8e8e8; font-size: 11px; border-radius: 4px; resize: vertical; min-height: 56px; outline: none; font-family: inherit; }
      .re-reason-box textarea:focus { border-color: #60a5fa; }
      .re-reason-confirm { margin-top: 6px; font-size: 11px; padding: 4px 10px; background: #1d4ed8; border: 1px solid #2563eb; color: #fff; border-radius: 4px; cursor: pointer; }
      .re-reason-confirm:hover { background: #2563eb; }
      .re-log { flex: 1; overflow-y: auto; padding: 8px; }
      .re-log h4 { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
      .re-change { background: #1e1e1e; border: 1px solid #2a2a2a; border-radius: 4px; padding: 7px 8px; margin-bottom: 6px; font-size: 11px; }
      .re-change-action { color: #fbbf24; font-weight: 600; text-transform: uppercase; font-size: 10px; }
      .re-change-room { color: #ccc; margin-top: 2px; }
      .re-change-why { color: #666; margin-top: 2px; font-style: italic; }

      .re-svg-room { cursor: move; }
      .re-svg-room:hover rect.re-bg { fill-opacity: 0.85; }
      .re-svg-room.selected rect.re-bg { stroke: #60a5fa !important; stroke-width: 2.5px !important; }
      .re-resize-handle { cursor: nwse-resize; fill: #60a5fa; opacity: 0; }
      .re-svg-room.selected .re-resize-handle { opacity: 0.7; }
    `;
    document.head.appendChild(s);
  }

  _buildPanel() {
    this.panel = document.createElement('div');
    this.panel.className = 're-panel';
    this.panel.innerHTML = `
      <div class="re-header">
        <h3>Room Editor</h3>
        <button class="re-close" title="Close editor">×</button>
      </div>
      <div class="re-toolbar">
        <button class="re-btn" id="re-undo">↶ Undo</button>
        <button class="re-btn" id="re-reset">⟲ Reset</button>
        <button class="re-btn primary" id="re-save">✓ Save</button>
      </div>
      <div class="re-status" id="re-status">Click a room to select · drag to move · drag corner to resize</div>
      <div class="re-reason-box" id="re-reason-box">
        <label>Why did you make this change?</label>
        <textarea id="re-reason-input" placeholder="e.g. bedroom too small, hallway wastes space…"></textarea>
        <button class="re-reason-confirm" id="re-reason-confirm">Confirm change ↵</button>
      </div>
      <div class="re-log">
        <h4>Changes (<span id="re-change-count">0</span>)</h4>
        <div id="re-changes-list"></div>
      </div>
    `;

    // Insert panel as sibling after svgContainer
    this.svgContainer.parentElement.appendChild(this.panel);
    // Shrink the svg area to make room for panel
    this.svgContainer.style.marginRight = '260px';

    this.panel.querySelector('.re-close').addEventListener('click', () => this.close());
    this.panel.querySelector('#re-undo').addEventListener('click', () => this._undo());
    this.panel.querySelector('#re-reset').addEventListener('click', () => this._reset());
    this.panel.querySelector('#re-save').addEventListener('click', () => this._save());
    this.panel.querySelector('#re-reason-confirm').addEventListener('click', () => this._confirmReason());
    this.panel.querySelector('#re-reason-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this._confirmReason();
    });
  }

  _renderSVG() {
    this.svgContainer.innerHTML = '';
    const levels = this.planSpec.levels || [];
    levels.forEach((level, i) => {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.style.cssText = 'font-size:11px;color:#555;padding:4px 8px;background:#0f0f0f;';
        sep.textContent = `Level ${level.level}`;
        this.svgContainer.appendChild(sep);
      }
      this.svgContainer.appendChild(this._buildLevelSVG(level));
    });
  }

  _buildLevelSVG(level) {
    const W = level.width || 60;
    const H = level.height || 50;
    const scale = Math.min(580 / W, 480 / H, 8); // px per foot, max 8

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width',  W * scale);
    svg.setAttribute('height', H * scale);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.cssText = 'display:block;background:#111;margin:8px auto;border:1px solid #2a2a2a;';

    for (const room of (level.rooms || [])) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-id', room.id);
      g.setAttribute('data-level', level.level);
      g.className = 're-svg-room';

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.className = 're-bg';
      rect.setAttribute('x', room.x);
      rect.setAttribute('y', room.y);
      rect.setAttribute('width',  room.w);
      rect.setAttribute('height', room.h);
      rect.setAttribute('fill',   this._roomColor(room.type));
      rect.setAttribute('fill-opacity', '0.75');
      rect.setAttribute('stroke', '#555');
      rect.setAttribute('stroke-width', '0.4');

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', room.x + room.w / 2);
      label.setAttribute('y', room.y + room.h / 2);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('font-size', Math.min(room.w, room.h) * 0.22);
      label.setAttribute('fill', '#fff');
      label.setAttribute('pointer-events', 'none');
      label.textContent = room.label || room.type.replace(/_/g, ' ');

      const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      handle.className = 're-resize-handle';
      handle.setAttribute('x', room.x + room.w - 1.5);
      handle.setAttribute('y', room.y + room.h - 1.5);
      handle.setAttribute('width',  3);
      handle.setAttribute('height', 3);
      handle.setAttribute('rx', 0.5);

      g.addEventListener('mousedown', (e) => {
        if (e.target === handle) return; // handled by handle listener
        this._startDrag(e, room, level, 'move');
      });
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this._startDrag(e, room, level, 'resize');
      });

      g.appendChild(rect);
      g.appendChild(label);
      g.appendChild(handle);
      svg.appendChild(g);
    }

    return svg;
  }

  _startDrag(e, room, level, mode) {
    if (e.button !== 0) return;
    e.preventDefault();

    // Deselect previous
    this.svgContainer.querySelectorAll('.re-svg-room.selected').forEach(el => el.classList.remove('selected'));

    // Select this room
    const g = e.currentTarget.closest ? e.currentTarget.closest('.re-svg-room') || e.currentTarget : e.currentTarget;
    g.classList.add('selected');

    this.selectedRoom = { room, level, el: g };
    this.dragMode  = mode;
    this.dragStart = {
      clientX: e.clientX, clientY: e.clientY,
      roomX: room.x, roomY: room.y, roomW: room.w, roomH: room.h,
    };

    document.addEventListener('mousemove', this._boundMouseMove);
    document.addEventListener('mouseup',   this._boundMouseUp);

    this._setStatus(`${mode === 'move' ? 'Moving' : 'Resizing'}: ${room.label || room.type}`);
  }

  _onMouseMove(e) {
    if (!this.selectedRoom || !this.dragStart) return;

    const { room, level } = this.selectedRoom;
    const svgEl = this.svgContainer.querySelector('svg');
    if (!svgEl) return;

    // Compute scale: how many SVG units per CSS pixel
    const svgW = parseFloat(svgEl.getAttribute('width'));
    const vbW  = parseFloat((svgEl.getAttribute('viewBox') || '').split(' ')[2] || svgW);
    const scale = vbW / svgEl.getBoundingClientRect().width;

    const dx = (e.clientX - this.dragStart.clientX) * scale;
    const dy = (e.clientY - this.dragStart.clientY) * scale;
    const snap = 2; // snap to 2ft grid

    if (this.dragMode === 'move') {
      const lW = level.width || 60;
      const lH = level.height || 50;
      room.x = Math.round(Math.max(0, Math.min(this.dragStart.roomX + dx, lW - room.w)) / snap) * snap;
      room.y = Math.round(Math.max(0, Math.min(this.dragStart.roomY + dy, lH - room.h)) / snap) * snap;
    } else {
      room.w = Math.round(Math.max(snap * 2, this.dragStart.roomW + dx) / snap) * snap;
      room.h = Math.round(Math.max(snap * 2, this.dragStart.roomH + dy) / snap) * snap;
    }

    this._updateRoomInSVG(room, level);
  }

  _onMouseUp() {
    document.removeEventListener('mousemove', this._boundMouseMove);
    document.removeEventListener('mouseup',   this._boundMouseUp);

    if (!this.selectedRoom) return;

    const { room, level } = this.selectedRoom;
    const orig = this._findOrig(room.id, level.level);

    if (orig && (orig.x !== room.x || orig.y !== room.y || orig.w !== room.w || orig.h !== room.h)) {
      // Store pending change, ask for reason inline
      this.pendingChange = {
        action: this._action(orig, room),
        id:     room.id,
        levelLevel: level.level,
        before: { x: orig.x, y: orig.y, w: orig.w, h: orig.h },
        after:  { x: room.x, y: room.y, w: room.w, h: room.h },
      };
      this._showReasonBox(room.label || room.type);
    }

    this.dragMode  = null;
    this.dragStart = null;
    this.selectedRoom = null;
  }

  _action(orig, room) {
    const moved   = (orig.x !== room.x || orig.y !== room.y);
    const resized = (orig.w !== room.w || orig.h !== room.h);
    if (moved && resized) return 'resize_and_move';
    if (resized) return 'resize';
    return 'move';
  }

  _showReasonBox(roomName) {
    const box = document.getElementById('re-reason-box');
    const inp = document.getElementById('re-reason-input');
    box.querySelector('label').textContent = `Why did you change ${roomName}?`;
    inp.value = '';
    box.classList.add('visible');
    inp.focus();
    this._setStatus('Enter a reason for your change, then click Confirm.');
  }

  _confirmReason() {
    if (!this.pendingChange) return;
    const inp = document.getElementById('re-reason-input');
    const reason = inp.value.trim() || 'No reason provided';

    this.pendingChange.reason = reason;
    this.changes.push(this.pendingChange);
    this.pendingChange = null;

    document.getElementById('re-reason-box').classList.remove('visible');
    this._updateLog();
    this._setStatus(`Recorded change (${this.changes.length} total). Click another room or save.`);
  }

  _updateRoomInSVG(room, level) {
    // Find the g element for this room on this level's SVG
    const g = this.svgContainer.querySelector(`g[data-id="${room.id}"][data-level="${level.level}"]`);
    if (!g) return;
    const rect = g.querySelector('rect.re-bg');
    const text = g.querySelector('text');
    const handle = g.querySelector('rect.re-resize-handle');

    if (rect) {
      rect.setAttribute('x', room.x); rect.setAttribute('y', room.y);
      rect.setAttribute('width', room.w); rect.setAttribute('height', room.h);
    }
    if (text) {
      text.setAttribute('x', room.x + room.w / 2);
      text.setAttribute('y', room.y + room.h / 2);
      text.setAttribute('font-size', Math.min(room.w, room.h) * 0.22);
    }
    if (handle) {
      handle.setAttribute('x', room.x + room.w - 1.5);
      handle.setAttribute('y', room.y + room.h - 1.5);
    }
  }

  _updateLog() {
    document.getElementById('re-change-count').textContent = this.changes.length;
    document.getElementById('re-changes-list').innerHTML = this.changes.map((c, i) => `
      <div class="re-change">
        <div class="re-change-action">${i + 1}. ${c.action}</div>
        <div class="re-change-room">${c.id}</div>
        <div class="re-change-why">${c.reason}</div>
      </div>
    `).join('');
  }

  _setStatus(msg) {
    const el = document.getElementById('re-status');
    if (el) el.textContent = msg;
  }

  _findOrig(roomId, levelNum) {
    const lvl = this.originalSpec.levels.find(l => l.level === levelNum);
    return lvl ? lvl.rooms.find(r => r.id === roomId) : null;
  }

  _roomColor(type) {
    const map = {
      living_room:'#4f46e5', kitchen:'#d97706', dining_room:'#7c3aed',
      bedroom:'#059669', primary_bedroom:'#0891b2', bathroom:'#db2777',
      primary_bathroom:'#e11d48', hallway:'#4b5563', stairs:'#7c3aed',
      garage:'#57534e', entry:'#2563eb', laundry:'#0d9488',
      mudroom:'#92400e', storage:'#475569', office:'#1d4ed8',
      study:'#0369a1', gym:'#15803d',
    };
    return map[type] || '#374151';
  }

  _undo() {
    if (this.pendingChange) {
      // Cancel pending change first
      document.getElementById('re-reason-box').classList.remove('visible');
      this.pendingChange = null;
      this._setStatus('Cancelled pending change.');
      return;
    }
    if (this.changes.length === 0) { this._setStatus('Nothing to undo.'); return; }
    this.changes.pop();
    // Replay from original
    this.planSpec = JSON.parse(JSON.stringify(this.originalSpec));
    for (const c of this.changes) {
      const lvl = this.planSpec.levels.find(l => l.level === c.levelLevel);
      const room = lvl?.rooms.find(r => r.id === c.id);
      if (room) Object.assign(room, c.after);
    }
    this._renderSVG();
    this._updateLog();
    this._setStatus('Undone last change.');
  }

  _reset() {
    if (this.changes.length === 0 && !this.pendingChange) return;
    if (!confirm('Reset all changes?')) return;
    this.changes = [];
    this.pendingChange = null;
    this.planSpec = JSON.parse(JSON.stringify(this.originalSpec));
    document.getElementById('re-reason-box').classList.remove('visible');
    this._renderSVG();
    this._updateLog();
    this._setStatus('Reset to original plan.');
  }

  async _save() {
    if (this.changes.length === 0) { this._setStatus('No changes to save.'); return; }
    const btn = this.panel.querySelector('#re-save');
    btn.disabled = true;
    btn.textContent = '…';

    try {
      const res = await fetch('/api/training/annotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: this.planId, changes: this.changes, timestamp: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._setStatus(`✓ Saved ${this.changes.length} change(s).`);
      setTimeout(() => this.close(), 800);
    } catch (err) {
      this._setStatus(`✗ Save failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '✓ Save';
    }
  }

  close() {
    document.removeEventListener('mousemove', this._boundMouseMove);
    document.removeEventListener('mouseup',   this._boundMouseUp);
    if (this.panel) this.panel.remove();
    if (this.svgContainer) this.svgContainer.style.marginRight = '';
    if (typeof this.onClose === 'function') this.onClose();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = RoomEditor;
