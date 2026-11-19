/* Editor Lukisan Elektrik — core editor */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const wrap = $('#canvasWrap');
  const STORE_KEY = 'elec-editor-doc-v1';
  const FONT_SANS = 'Helvetica, Arial, "Liberation Sans", sans-serif';
  const FONT_SERIF = '"Times New Roman", Times, "Liberation Serif", serif';
  const SEL_COLOR = '#1f6feb', SNAP_COLOR = '#0a8f3c', HOVER_COLOR = '#e8590c';

  // ---------------- state ----------------
  let doc = null;
  let nextId = 1, nextGid = 1;
  const byId = new Map();
  let sel = new Set();
  let undoStack = [], redoStack = [];
  let view = { s: 2, ox: 0, oy: 0 };
  let dpr = window.devicePixelRatio || 1;
  let W = 0, H = 0;
  let mouse = { sx: 0, sy: 0, x: 0, y: 0 };
  let snapPt = null, hoverId = null;
  let opt = { snap: true, ortho: false, grid: false, gridStep: 2.5, textH: 2.33, color: '#000000' };
  let tool = { name: 'select' };
  let clipboard = null;
  let spaceDown = false, pan = null;

  const clone = o => JSON.parse(JSON.stringify(o));

  function setDoc(d, keepView) {
    doc = d;
    doc.entities = doc.entities || [];
    nextId = 1; nextGid = 1;
    for (const e of doc.entities) {
      if (e.id) nextId = Math.max(nextId, e.id + 1);
      if (e.gid) { const n = parseInt(String(e.gid).replace(/\D/g, ''), 10); if (!isNaN(n)) nextGid = Math.max(nextGid, n + 1); }
    }
    for (const e of doc.entities) if (!e.id) e.id = nextId++;
    reindex();
    sel = new Set();
    undoStack = []; redoStack = [];
    $('#docName').value = doc.name || '';
    if (!keepView) zoomFit();
    changed(true);
  }
  function reindex() { byId.clear(); for (const e of doc.entities) byId.set(e.id, e); }
  function newGid() { return 'g' + (nextGid++); }

  function snapshot() { return JSON.stringify(doc.entities); }
  function pushUndo(snap) {
    undoStack.push(snap);
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
  }
  function mutate(fn) { const s = snapshot(); fn(); pushUndo(s); reindex(); changed(); }
  function undo() {
    if (!undoStack.length) return toast('Tiada lagi untuk undo');
    redoStack.push(snapshot());
    doc.entities = JSON.parse(undoStack.pop());
    reindex(); sel = new Set([...sel].filter(id => byId.has(id))); changed();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    doc.entities = JSON.parse(redoStack.pop());
    reindex(); sel = new Set([...sel].filter(id => byId.has(id))); changed();
  }

  let saveTimer = null;
  function changed(noSave) {
    updatePanel();
    draw();
    if (!noSave) { clearTimeout(saveTimer); saveTimer = setTimeout(autosave, 600); }
  }
  function autosave() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); $('#saveState').textContent = 'Disimpan dalam pelayar ' + new Date().toLocaleTimeString(); } catch (e) { $('#saveState').textContent = 'Autosimpan tidak tersedia'; }
  }

  // ---------------- geometry ----------------
  const mctx = document.createElement('canvas').getContext('2d');
  const wcache = new Map();
  function fontCss(e, px) {
    return (e.italic ? 'italic ' : '') + (e.bold ? 'bold ' : '') + px + 'px ' + (e.font === 'serif' ? FONT_SERIF : FONT_SANS);
  }
  function textWidth(e) {
    const k = (e.font || '') + (e.bold ? 'b' : '') + (e.italic ? 'i' : '') + '|' + e.s;
    let w = wcache.get(k);
    if (w == null) { mctx.font = fontCss(e, 100); w = mctx.measureText(e.s).width / 100; wcache.set(k, w); }
    return w * e.h;
  }
  function textCorners(e) {
    const w = textWidth(e);
    const x0 = e.align === 'center' ? -w / 2 : e.align === 'right' ? -w : 0;
    const a = (e.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[x0, -0.22 * e.h], [x0 + w, -0.22 * e.h], [x0 + w, 0.78 * e.h], [x0, 0.78 * e.h]].map(p => [e.x + p[0] * c - p[1] * s, e.y + p[0] * s + p[1] * c]);
  }
  const bbCache = new WeakMap();
  function bbox(e) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
    switch (e.t) {
      case 'line': add(e.x1, e.y1); add(e.x2, e.y2); break;
      case 'circle': add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); break;
      case 'arc': { add(e.cx + e.r * cosd(e.a1), e.cy + e.r * sind(e.a1)); add(e.cx + e.r * cosd(e.a2), e.cy + e.r * sind(e.a2)); for (const q of [0, 90, 180, 270]) if (angIn(q, e.a1, e.a2)) add(e.cx + e.r * cosd(q), e.cy + e.r * sind(q)); break; }
      case 'pline': for (const p of e.pts) add(p[0], p[1]); break;
      case 'path': { let c = bbCache.get(e); if (!c) { for (let i = 0; i < e.segs.length; i += 2) add(e.segs[i], e.segs[i + 1]); c = [x0, y0, x1, y1]; bbCache.set(e, c); } return c; }
      case 'text': for (const p of textCorners(e)) add(p[0], p[1]); break;
    }
    return [x0, y0, x1, y1];
  }
  const cosd = a => Math.cos(a * Math.PI / 180), sind = a => Math.sin(a * Math.PI / 180);
  const norm = a => ((a % 360) + 360) % 360;
  function angIn(a, a1, a2) { a = norm(a); a1 = norm(a1); a2 = norm(a2); return a1 <= a2 ? a >= a1 && a <= a2 : a >= a1 || a <= a2; }
  function dSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
    let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
  }
  function inPoly(x, y, pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if ((pts[i][1] > y) !== (pts[j][1] > y) && x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c;
    }
    return c;
  }
  function dist(e, x, y) {
    switch (e.t) {
      case 'line': return dSeg(x, y, e.x1, e.y1, e.x2, e.y2);
      case 'circle': { const d = Math.hypot(x - e.cx, y - e.cy); return e.fill && e.fill !== 'none' && d < e.r ? 0 : Math.abs(d - e.r); }
      case 'arc': {
        const d = Math.hypot(x - e.cx, y - e.cy), a = Math.atan2(y - e.cy, x - e.cx) * 180 / Math.PI;
        if (angIn(a, e.a1, e.a2)) return Math.abs(d - e.r);
        return Math.min(Math.hypot(x - e.cx - e.r * cosd(e.a1), y - e.cy - e.r * sind(e.a1)), Math.hypot(x - e.cx - e.r * cosd(e.a2), y - e.cy - e.r * sind(e.a2)));
      }
      case 'pline': {
        if (e.fill && e.fill !== 'none' && inPoly(x, y, e.pts)) return 0;
        let m = Infinity; const p = e.pts, n = p.length;
        for (let i = 0; i < n - 1 + (e.closed ? 1 : 0); i++) { const a = p[i], b = p[(i + 1) % n]; m = Math.min(m, dSeg(x, y, a[0], a[1], b[0], b[1])); }
        return m;
      }
      case 'path': {
        const b = bbox(e); if (x < b[0] - 2 || x > b[2] + 2 || y < b[1] - 2 || y > b[3] + 2) return Infinity;
        let m = Infinity; const s = e.segs;
        for (let i = 0; i < s.length; i += 4) { const d = dSeg(x, y, s[i], s[i + 1], s[i + 2], s[i + 3]); if (d < m) m = d; }
        return m;
      }
      case 'text': return inPoly(x, y, textCorners(e)) ? 0 : Infinity;
    }
    return Infinity;
  }
  function snapsOf(e) {
    const r = [];
    switch (e.t) {
      case 'line': r.push([e.x1, e.y1, 'end'], [e.x2, e.y2, 'end'], [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2, 'mid']); break;
      case 'circle': r.push([e.cx, e.cy, 'cen'], [e.cx + e.r, e.cy, 'qua'], [e.cx - e.r, e.cy, 'qua'], [e.cx, e.cy + e.r, 'qua'], [e.cx, e.cy - e.r, 'qua']); break;
      case 'arc': r.push([e.cx + e.r * cosd(e.a1), e.cy + e.r * sind(e.a1), 'end'], [e.cx + e.r * cosd(e.a2), e.cy + e.r * sind(e.a2), 'end'], [e.cx, e.cy, 'cen']); break;
      case 'pline': {
        const p = e.pts, n = p.length;
        p.forEach(q => r.push([q[0], q[1], 'end']));
        for (let i = 0; i < n - 1 + (e.closed ? 1 : 0); i++) { const a = p[i], b = p[(i + 1) % n]; r.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'mid']); }
        break;
      }
      case 'text': r.push([e.x, e.y, 'ins']); break;
    }
    return r;
  }
  function nearestOn(e, x, y) {
    if (e.t === 'line') {
      const dx = e.x2 - e.x1, dy = e.y2 - e.y1, l = dx * dx + dy * dy;
      let t = l ? ((x - e.x1) * dx + (y - e.y1) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
      return [e.x1 + t * dx, e.y1 + t * dy];
    }
    if (e.t === 'circle' || e.t === 'arc') { const a = Math.atan2(y - e.cy, x - e.cx); return [e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]; }
    return null;
  }

  // transforms
  function xform(e, f, rotDeg, mirror) { // f: point fn
    switch (e.t) {
      case 'line': { const a = f(e.x1, e.y1), b = f(e.x2, e.y2); e.x1 = a[0]; e.y1 = a[1]; e.x2 = b[0]; e.y2 = b[1]; break; }
      case 'circle': { const c = f(e.cx, e.cy); e.cx = c[0]; e.cy = c[1]; break; }
      case 'arc': {
        const c = f(e.cx, e.cy); e.cx = c[0]; e.cy = c[1];
        if (mirror) { const a1 = 180 - e.a2, a2 = 180 - e.a1; e.a1 = norm(a1); e.a2 = norm(a2); }
        if (rotDeg) { e.a1 = norm(e.a1 + rotDeg); e.a2 = norm(e.a2 + rotDeg); }
        break;
      }
      case 'pline': e.pts = e.pts.map(p => f(p[0], p[1])); break;
      case 'path': { const s = e.segs; for (let i = 0; i < s.length; i += 2) { const p = f(s[i], s[i + 1]); s[i] = p[0]; s[i + 1] = p[1]; } bbCache.delete(e); break; }
      case 'text': {
        const p = f(e.x, e.y); e.x = p[0]; e.y = p[1];
        if (rotDeg) e.rot = norm((e.rot || 0) + rotDeg);
        if (mirror) { if (e.align === 'right') e.align = 'left'; else if (e.align !== 'center') e.align = 'right'; }
        break;
      }
    }
    roundEnt(e);
  }
  const rr = v => Math.round(v * 1000) / 1000;
  function roundEnt(e) {
    for (const k of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'x', 'y', 'a1', 'a2']) if (typeof e[k] === 'number') e[k] = rr(e[k]);
    if (e.pts) e.pts = e.pts.map(p => [rr(p[0]), rr(p[1])]);
    if (e.segs) for (let i = 0; i < e.segs.length; i++) e.segs[i] = rr(e.segs[i]);
  }
  const moveEnt = (e, dx, dy) => xform(e, (x, y) => [x + dx, y + dy]);
  function rotEnt(e, cx, cy, deg) {
    const c = cosd(deg), s = sind(deg);
    xform(e, (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c], deg);
  }
  const mirrorEnt = (e, cx) => xform(e, (x, y) => [2 * cx - x, y], 0, true);

  function selBBox(ids) {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of ids) { const e = byId.get(id); if (!e) continue; const q = bbox(e); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }
    return b;
  }

  // ---------------- view ----------------
  const toS = (x, y) => [view.ox + x * view.s, view.oy - y * view.s];
  const toW = (sx, sy) => [(sx - view.ox) / view.s, (view.oy - sy) / view.s];
  function resize() {
    const r = wrap.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    draw();
  }
  function zoomTo(b, pad) {
    pad = pad == null ? 0.06 : pad;
    const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
    view.s = Math.min(W * (1 - 2 * pad) / bw, H * (1 - 2 * pad) / bh);
    view.s = Math.max(0.2, Math.min(200, view.s));
    view.ox = W / 2 - (b[0] + bw / 2) * view.s;
    view.oy = H / 2 + (b[1] + bh / 2) * view.s;
    draw();
  }
  function zoomFit() { if (doc) zoomTo([0, 0, doc.sheet.w, doc.sheet.h], 0.03); }
  function zoomAt(sx, sy, f) {
    const ns = Math.max(0.2, Math.min(300, view.s * f));
    const [wx, wy] = toW(sx, sy);
    view.s = ns; view.ox = sx - wx * ns; view.oy = sy + wy * ns;
    draw();
  }

  // ---------------- rendering ----------------
  let css = {};
  function readCss() {
    const s = getComputedStyle(document.documentElement);
    css.bg = s.getPropertyValue('--canvas-bg').trim() || '#d9dde3';
    css.shadow = s.getPropertyValue('--sheet-shadow').trim() || 'rgba(0,0,0,.25)';
  }
  function pathEnt(c, e, T) {
    const P = (x, y) => [T.ox + x * T.s, T.oy - y * T.s];
    c.beginPath();
    switch (e.t) {
      case 'line': { const a = P(e.x1, e.y1), b = P(e.x2, e.y2); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); break; }
      case 'circle': { const a = P(e.cx, e.cy); c.arc(a[0], a[1], Math.max(0.5, e.r * T.s), 0, Math.PI * 2); break; }
      case 'arc': { const a = P(e.cx, e.cy); c.arc(a[0], a[1], Math.max(0.5, e.r * T.s), -e.a1 * Math.PI / 180, -e.a2 * Math.PI / 180, true); break; }
      case 'pline': { e.pts.forEach((p, i) => { const q = P(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); if (e.closed) c.closePath(); break; }
      case 'path': { const s = e.segs; for (let i = 0; i < s.length; i += 4) { const a = P(s[i], s[i + 1]), b = P(s[i + 2], s[i + 3]); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } break; }
    }
  }
  function drawEnt(c, e, T, override) {
    const col = override || (e.color && e.color !== 'none' ? e.color : '#000000');
    if (e.t === 'text') {
      const px = e.h * T.s;
      const [sx, sy] = [T.ox + e.x * T.s, T.oy - e.y * T.s];
      c.fillStyle = col;
      if (px < 2.5) { // too small: draw a bar
        const cs = textCorners(e).map(p => [T.ox + p[0] * T.s, T.oy - p[1] * T.s]);
        c.globalAlpha = 0.35; c.beginPath(); cs.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.fill(); c.globalAlpha = 1;
        return;
      }
      c.save(); c.translate(sx, sy); if (e.rot) c.rotate(-e.rot * Math.PI / 180);
      c.font = fontCss(e, px); c.textAlign = e.align || 'left'; c.textBaseline = 'alphabetic';
      c.fillText(e.s, 0, 0); c.restore();
      return;
    }
    pathEnt(c, e, T);
    const hasFill = e.fill && e.fill !== 'none';
    if (hasFill) { c.fillStyle = override || e.fill; c.fill(); }
    if (!hasFill || (e.color && e.color !== 'none') || override) {
      c.strokeStyle = col;
      if (e.dash) c.setLineDash([Math.max(2, 1.5 * T.s), Math.max(1.5, 0.75 * T.s)]);
      c.stroke();
      if (e.dash) c.setLineDash([]);
    }
  }
  function visible(e) {
    const b = bbox(e);
    const [x0, y1] = toS(b[0], b[1]), [x1, y0] = toS(b[2], b[3]);
    return !(x1 < -20 || x0 > W + 20 || y1 < -20 || y0 > H + 20);
  }
  function draw() {
    if (!doc) return;
    const c = ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = css.bg; c.fillRect(0, 0, W, H);
    // sheet
    const [sx0, sy0] = toS(0, doc.sheet.h), [sx1, sy1] = toS(doc.sheet.w, 0);
    c.save(); c.shadowColor = css.shadow; c.shadowBlur = 12; c.fillStyle = '#ffffff'; c.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0); c.restore();
    if (opt.grid && opt.gridStep * view.s >= 6) {
      c.fillStyle = 'rgba(0,0,0,.18)';
      const [wx0, wy1] = toW(Math.max(0, sx0), Math.max(0, sy0)), [wx1, wy0] = toW(Math.min(W, sx1), Math.min(H, sy1));
      const st = opt.gridStep;
      for (let x = Math.ceil(wx0 / st) * st; x <= wx1; x += st) for (let y = Math.ceil(wy0 / st) * st; y <= wy1; y += st) { const p = toS(x, y); c.fillRect(p[0] - 0.5, p[1] - 0.5, 1, 1); }
    }
    const T = view;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = Math.max(1, 0.25 * view.s * 0.7);
    for (const e of doc.entities) if (visible(e)) drawEnt(c, e, T);
    // hover
    if (hoverId && byId.has(hoverId) && !sel.has(hoverId)) {
      c.lineWidth = 2; c.globalAlpha = 0.85;
      for (const e of groupOf(byId.get(hoverId))) drawEnt(c, e, T, HOVER_COLOR);
      c.globalAlpha = 1;
    }
    // selection
    if (sel.size) {
      c.lineWidth = 2;
      for (const id of sel) { const e = byId.get(id); if (e) drawEnt(c, e, T, SEL_COLOR); }
      if (sel.size > 1 || [...sel].some(id => byId.get(id) && byId.get(id).gid)) {
        const b = selBBox(sel); const [a0, a1] = toS(b[0], b[3]), [b0, b1] = toS(b[2], b[1]);
        c.setLineDash([4, 3]); c.strokeStyle = SEL_COLOR; c.lineWidth = 1; c.strokeRect(a0 - 4, a1 - 4, b0 - a0 + 8, b1 - a1 + 8); c.setLineDash([]);
      }
      for (const g of grips()) { const p = toS(g.x, g.y); c.fillStyle = '#ffffff'; c.strokeStyle = SEL_COLOR; c.lineWidth = 1.5; c.fillRect(p[0] - 4, p[1] - 4, 8, 8); c.strokeRect(p[0] - 4, p[1] - 4, 8, 8); }
    }
    // ghost / preview
    const gh = ghost();
    if (gh.length) { c.lineWidth = 1.5; c.globalAlpha = 0.8; for (const e of gh) drawEnt(c, e, T, SEL_COLOR); c.globalAlpha = 1; }
    // selection box
    if (tool.box) {
      const b = tool.box; const crossing = mouse.sx < b.sx;
      c.fillStyle = crossing ? 'rgba(10,143,60,.10)' : 'rgba(31,111,235,.10)';
      c.strokeStyle = crossing ? SNAP_COLOR : SEL_COLOR; c.lineWidth = 1;
      if (crossing) c.setLineDash([5, 4]);
      c.fillRect(b.sx, b.sy, mouse.sx - b.sx, mouse.sy - b.sy); c.strokeRect(b.sx, b.sy, mouse.sx - b.sx, mouse.sy - b.sy); c.setLineDash([]);
    }
    // snap marker
    if (snapPt) {
      const p = toS(snapPt[0], snapPt[1]); c.strokeStyle = SNAP_COLOR; c.lineWidth = 2;
      c.beginPath();
      if (snapPt[2] === 'mid') { c.moveTo(p[0], p[1] - 6); c.lineTo(p[0] + 6, p[1] + 5); c.lineTo(p[0] - 6, p[1] + 5); c.closePath(); }
      else if (snapPt[2] === 'cen' || snapPt[2] === 'qua') c.arc(p[0], p[1], 6, 0, Math.PI * 2);
      else if (snapPt[2] === 'near') { c.moveTo(p[0] - 5, p[1] - 5); c.lineTo(p[0] + 5, p[1] + 5); c.moveTo(p[0] + 5, p[1] - 5); c.lineTo(p[0] - 5, p[1] + 5); }
      else c.rect(p[0] - 5, p[1] - 5, 10, 10);
      c.stroke();
    }
    // status
    $('#coords').textContent = 'X ' + mouse.x.toFixed(2) + '  Y ' + mouse.y.toFixed(2) + ' mm';
    $('#zoomLbl').textContent = Math.round(view.s / 2 * 100) + '%';
  }

  // ---------------- selection helpers ----------------
  function groupOf(e) { return e.gid && !tool.alt ? doc.entities.filter(x => x.gid === e.gid) : [e]; }
  function pick(x, y) {
    const tol = 6 / view.s;
    let best = null, bd = Infinity;
    for (let i = doc.entities.length - 1; i >= 0; i--) {
      const e = doc.entities[i];
      const b = bbox(e);
      if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
      let d = dist(e, x, y);
      if (e.t === 'text' && d === 0) d = tol * 0.4; // prefer geometry exactly under cursor
      if (d < bd) { bd = d; best = e; }
    }
    return bd <= tol ? best : null;
  }
  function findSnap(x, y, exclude) {
    if (!opt.snap) return null;
    const tol = 10 / view.s;
    let best = null, bd = tol;
    let near = null, nd = 6 / view.s;
    for (const e of doc.entities) {
      if (exclude && exclude.has(e.id)) continue;
      if (e.t === 'path') continue;
      const b = bbox(e);
      if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
      for (const s of snapsOf(e)) { const d = Math.hypot(s[0] - x, s[1] - y); if (d < bd) { bd = d; best = s; } }
      if (!best) { const n = nearestOn(e, x, y); if (n) { const d = Math.hypot(n[0] - x, n[1] - y); if (d < nd) { nd = d; near = [n[0], n[1], 'near']; } } }
    }
    return best || near;
  }
  // point the tool should use: snap > ortho > grid > raw
  function toolPoint(base, exclude) {
    let [x, y] = toW(mouse.sx, mouse.sy);
    const s = findSnap(x, y, exclude);
    const straight = base && (opt.ortho || tool.shift);
    const horiz = straight && Math.abs(x - base[0]) > Math.abs(y - base[1]);
    snapPt = s;
    if (s) {
      if (!straight) return [s[0], s[1]];
      // keep the line straight, but line its end up with the snapped point
      const p = horiz ? [s[0], base[1]] : [base[0], s[1]];
      snapPt = [p[0], p[1], s[2]];
      return [rr(p[0]), rr(p[1])];
    }
    if (opt.grid) { x = Math.round(x / opt.gridStep) * opt.gridStep; y = Math.round(y / opt.gridStep) * opt.gridStep; }
    if (straight) { if (horiz) y = base[1]; else x = base[0]; }
    return [rr(x), rr(y)];
  }

  function grips() {
    if (sel.size !== 1) return [];
    const e = byId.get([...sel][0]);
    if (!e) return [];
    switch (e.t) {
      case 'line': return [{ x: e.x1, y: e.y1, k: 1 }, { x: e.x2, y: e.y2, k: 2 }];
      case 'pline': return e.pts.map((p, i) => ({ x: p[0], y: p[1], k: i }));
      case 'circle': return [{ x: e.cx + e.r, y: e.cy, k: 'r' }];
      case 'arc': return [];
      default: return [];
    }
  }
  function gripAt(sx, sy) { for (const g of grips()) { const p = toS(g.x, g.y); if (Math.abs(p[0] - sx) < 7 && Math.abs(p[1] - sy) < 7) return g; } return null; }

  // ---------------- tools ----------------
  const HINTS = {
    select: 'Klik objek untuk pilih · Seret untuk alih · Seret kotak di ruang kosong · Dwi-klik teks untuk edit',
    line: 'Klik titik mula, kemudian klik titik seterusnya · Klik kanan / Esc untuk berhenti · Tahan Ctrl atau Shift = garis lurus',
    rect: 'Klik satu bucu, kemudian bucu bertentangan',
    circle: 'Klik pusat, kemudian klik untuk jejari',
    text: 'Klik di mana teks hendak diletak, taip, tekan Enter',
    symbol: 'Klik untuk letak simbol · R = putar 90° · Esc = batal',
    move: 'Klik titik asas, kemudian klik destinasi · Tahan Ctrl = lurus',
    copy: 'Klik titik asas, kemudian klik destinasi (boleh berulang) · Esc untuk tamat',
    paste: 'Klik untuk tampal · Esc untuk tamat'
  };
  function setTool(name, extra) {
    if (inlineEd) commitInline();
    if ((name === 'move' || name === 'copy') && !sel.size) { toast('Pilih objek dahulu, kemudian tekan ' + (name === 'move' ? 'Alih' : 'Salin')); name = 'select'; }
    tool = Object.assign({ name }, extra || {});
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === name));
    document.querySelectorAll('.sym').forEach(b => b.classList.toggle('on', name === 'symbol' && b.dataset.sym === (extra && extra.symId)));
    $('#hint').textContent = HINTS[name] || '';
    cv.style.cursor = name === 'select' ? 'default' : 'crosshair';
    snapPt = null;
    draw();
  }
  function ghost() {
    const t = tool;
    const p = t.cur;
    if (!p) return [];
    if (t.name === 'line' && t.p1) return [{ t: 'line', x1: t.p1[0], y1: t.p1[1], x2: p[0], y2: p[1] }];
    if (t.name === 'rect' && t.p1) return [rectEnt(t.p1, p)];
    if (t.name === 'circle' && t.p1) return [{ t: 'circle', cx: t.p1[0], cy: t.p1[1], r: Math.hypot(p[0] - t.p1[0], p[1] - t.p1[1]) }];
    if (t.name === 'symbol') return placed(t.ents, p, t.rot || 0);
    if ((t.name === 'move' || t.name === 'copy') && t.base) return t.ents.map(e => { const c = clone(e); moveEnt(c, p[0] - t.base[0], p[1] - t.base[1]); return c; });
    if (t.name === 'paste') return t.ents.map(e => { const c = clone(e); moveEnt(c, p[0] - t.base[0], p[1] - t.base[1]); return c; });
    return [];
  }
  function rectEnt(a, b) { return { t: 'pline', pts: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]], closed: true }; }
  function placed(ents, p, rot) {
    return ents.map(e => { const c = clone(e); if (rot) rotEnt(c, 0, 0, rot); moveEnt(c, p[0], p[1]); return c; });
  }
  function addEnts(list, select) {
    const ids = [];
    for (const e of list) { e.id = nextId++; if (opt.color !== '#000000' && !e.color && e.t !== 'path') e.color = opt.color; doc.entities.push(e); ids.push(e.id); }
    if (select) sel = new Set(ids);
    return ids;
  }

  // ---------------- pointer handling ----------------
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', ev => {
    cv.setPointerCapture(ev.pointerId);
    updateMouse(ev);
    if (ev.button === 1 || (ev.button === 0 && spaceDown) || tool.name === 'pan') { pan = { sx: ev.clientX, sy: ev.clientY, ox: view.ox, oy: view.oy }; cv.style.cursor = 'grabbing'; return; }
    if (ev.button === 2) { rightClick(); return; }
    if (ev.button !== 0) return;
    if (inlineEd) commitInline();
    tool.shift = ev.shiftKey || ev.ctrlKey || ev.metaKey; tool.alt = ev.altKey;
    const t = tool;
    const p = toolPoint(t.p1 || t.base);
    switch (t.name) {
      case 'select': {
        const g = gripAt(mouse.sx, mouse.sy);
        if (g) { t.grip = { g, id: [...sel][0], snap: snapshot(), moved: false }; return; }
        const hit = pick(mouse.x, mouse.y);
        if (hit) {
          const grp = groupOf(hit);
          if (ev.shiftKey) { const has = sel.has(hit.id); for (const e of grp) has ? sel.delete(e.id) : sel.add(e.id); }
          else if (!sel.has(hit.id)) sel = new Set(grp.map(e => e.id));
          const base = findSnap(mouse.x, mouse.y);
          t.drag = { base: base ? [base[0], base[1]] : [mouse.x, mouse.y], applied: [0, 0], snap: snapshot(), moved: false, sx: mouse.sx, sy: mouse.sy };
        } else {
          if (!ev.shiftKey) sel = new Set();
          t.box = { sx: mouse.sx, sy: mouse.sy, x: mouse.x, y: mouse.y };
        }
        updatePanel(); draw();
        break;
      }
      case 'line':
        if (!t.p1) t.p1 = p;
        else if (Math.hypot(p[0] - t.p1[0], p[1] - t.p1[1]) > 1e-6) { mutate(() => addEnts([{ t: 'line', x1: t.p1[0], y1: t.p1[1], x2: p[0], y2: p[1] }])); t.p1 = p; }
        break;
      case 'rect':
        if (!t.p1) t.p1 = p; else { mutate(() => addEnts([rectEnt(t.p1, p)])); t.p1 = null; }
        break;
      case 'circle':
        if (!t.p1) t.p1 = p; else { const r = Math.hypot(p[0] - t.p1[0], p[1] - t.p1[1]); if (r > 0) mutate(() => addEnts([{ t: 'circle', cx: t.p1[0], cy: t.p1[1], r: rr(r) }])); t.p1 = null; }
        break;
      case 'text':
        openInline(null, p);
        break;
      case 'symbol': {
        const gid = newGid();
        const list = placed(t.ents, p, t.rot || 0).map(e => Object.assign(e, { gid }));
        mutate(() => addEnts(list, true));
        break;
      }
      case 'move': case 'copy':
        if (!t.base) { t.base = p; t.ents = [...sel].map(id => clone(byId.get(id))); }
        else {
          const dx = p[0] - t.base[0], dy = p[1] - t.base[1];
          if (t.name === 'move') { mutate(() => { for (const id of sel) moveEnt(byId.get(id), dx, dy); }); setTool('select'); }
          else { const gmap = {}; const list = t.ents.map(e => { const c = clone(e); delete c.id; if (c.gid) c.gid = gmap[c.gid] || (gmap[c.gid] = newGid()); moveEnt(c, dx, dy); return c; }); mutate(() => addEnts(list)); }
        }
        break;
      case 'paste': {
        const dx = p[0] - t.base[0], dy = p[1] - t.base[1];
        const gmap = {};
        const list = t.ents.map(e => { const c = clone(e); delete c.id; if (c.gid) c.gid = gmap[c.gid] || (gmap[c.gid] = newGid()); moveEnt(c, dx, dy); return c; });
        mutate(() => addEnts(list, true));
        break;
      }
    }
    draw();
  });
  cv.addEventListener('pointermove', ev => {
    updateMouse(ev);
    if (pan) { view.ox = pan.ox + ev.clientX - pan.sx; view.oy = pan.oy + ev.clientY - pan.sy; draw(); return; }
    tool.shift = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    const t = tool;
    if (t.name === 'select') {
      if (t.grip) {
        const p = toolPoint(null, new Set([t.grip.id]));
        const e = byId.get(t.grip.id), k = t.grip.g.k;
        if (e.t === 'line') { if (k === 1) { e.x1 = p[0]; e.y1 = p[1]; } else { e.x2 = p[0]; e.y2 = p[1]; } }
        else if (e.t === 'pline') e.pts[k] = [p[0], p[1]];
        else if (e.t === 'circle') e.r = rr(Math.max(0.05, Math.hypot(p[0] - e.cx, p[1] - e.cy)));
        t.grip.moved = true; t.grip.g = Object.assign({}, t.grip.g, { x: p[0], y: p[1] });
        draw(); return;
      }
      if (t.drag) {
        if (!t.drag.moved && Math.hypot(mouse.sx - t.drag.sx, mouse.sy - t.drag.sy) < 4) return;
        t.drag.moved = true;
        const p = toolPoint(t.drag.base, sel);
        const dx = p[0] - t.drag.base[0], dy = p[1] - t.drag.base[1];
        const ddx = dx - t.drag.applied[0], ddy = dy - t.drag.applied[1];
        if (ddx || ddy) { for (const id of sel) moveEnt(byId.get(id), ddx, ddy); t.drag.applied = [dx, dy]; }
        draw(); return;
      }
      if (t.box) { draw(); return; }
      const h = pick(mouse.x, mouse.y);
      const hid = h ? h.id : null;
      if (hid !== hoverId) { hoverId = hid; }
      snapPt = null;
      draw();
      return;
    }
    const exclude = (t.name === 'move' || t.name === 'copy') ? sel : null;
    t.cur = toolPoint(t.p1 || t.base, exclude);
    if (t.name === 'paste' || t.name === 'symbol') t.cur = toolPoint(null);
    draw();
  });
  cv.addEventListener('pointerup', ev => {
    if (pan) { pan = null; cv.style.cursor = tool.name === 'select' ? 'default' : 'crosshair'; return; }
    const t = tool;
    if (t.grip) { if (t.grip.moved) { pushUndo(t.grip.snap); roundEnt(byId.get(t.grip.id)); changed(); } t.grip = null; }
    if (t.drag) { if (t.drag.moved) { pushUndo(t.drag.snap); changed(); } t.drag = null; snapPt = null; }
    if (t.box) {
      const b = t.box, crossing = mouse.sx < b.sx;
      const x0 = Math.min(b.x, mouse.x), x1 = Math.max(b.x, mouse.x), y0 = Math.min(b.y, mouse.y), y1 = Math.max(b.y, mouse.y);
      if (Math.abs(mouse.sx - b.sx) > 3 || Math.abs(mouse.sy - b.sy) > 3) {
        for (const e of doc.entities) {
          const q = bbox(e);
          let ok;
          if (!crossing) ok = q[0] >= x0 && q[2] <= x1 && q[1] >= y0 && q[3] <= y1;
          else {
            ok = !(q[2] < x0 || q[0] > x1 || q[3] < y0 || q[1] > y1);
            if (ok && e.t === 'line') ok = segRect(e.x1, e.y1, e.x2, e.y2, x0, y0, x1, y1);
          }
          if (ok) for (const g of groupOf(e)) sel.add(g.id);
        }
      }
      t.box = null; updatePanel();
    }
    draw();
  });
  function segRect(ax, ay, bx, by, x0, y0, x1, y1) {
    const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    if (inside(ax, ay) || inside(bx, by)) return true;
    const cr = (p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) => {
      const d = (p2x - p1x) * (p4y - p3y) - (p2y - p1y) * (p4x - p3x); if (!d) return false;
      const u = ((p3x - p1x) * (p4y - p3y) - (p3y - p1y) * (p4x - p3x)) / d, v = ((p3x - p1x) * (p2y - p1y) - (p3y - p1y) * (p2x - p1x)) / d;
      return u >= 0 && u <= 1 && v >= 0 && v <= 1;
    };
    return cr(ax, ay, bx, by, x0, y0, x1, y0) || cr(ax, ay, bx, by, x1, y0, x1, y1) || cr(ax, ay, bx, by, x0, y1, x1, y1) || cr(ax, ay, bx, by, x0, y0, x0, y1);
  }
  cv.addEventListener('dblclick', () => {
    const tol = 6 / view.s;
    let hit = null;
    for (let i = doc.entities.length - 1; i >= 0; i--) { const e = doc.entities[i]; if (e.t === 'text' && dist(e, mouse.x, mouse.y) <= tol) { hit = e; break; } }
    if (hit) { sel = new Set([hit.id]); openInline(hit); }
  });
  cv.addEventListener('wheel', ev => {
    ev.preventDefault();
    const r = cv.getBoundingClientRect();
    if (ev.ctrlKey || Math.abs(ev.deltaY) >= Math.abs(ev.deltaX)) zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)));
    else { view.ox -= ev.deltaX; draw(); }
  }, { passive: false });
  function updateMouse(ev) {
    const r = cv.getBoundingClientRect();
    mouse.sx = ev.clientX - r.left; mouse.sy = ev.clientY - r.top;
    [mouse.x, mouse.y] = toW(mouse.sx, mouse.sy);
  }
  function rightClick() {
    if (tool.name === 'line' && tool.p1) { tool.p1 = null; draw(); return; }
    if (tool.name !== 'select') { setTool('select'); return; }
    sel = new Set(); updatePanel(); draw();
  }

  // ---------------- inline text editor ----------------
  let inlineEd = null;
  function openInline(ent, p) {
    const inp = $('#inlineText');
    const e = ent || { t: 'text', x: p[0], y: p[1], h: opt.textH, rot: 0, s: '' };
    const px = Math.max(12, e.h * view.s);
    const [sx, sy] = toS(e.x, e.y);
    inp.style.left = (sx - 2) + 'px'; inp.style.top = (sy - px * 1.05) + 'px';
    inp.style.fontSize = px + 'px'; inp.style.fontFamily = e.font === 'serif' ? FONT_SERIF : FONT_SANS;
    inp.value = e.s; inp.hidden = false;
    inp.style.width = Math.max(80, (ent ? textWidth(e) * view.s : 0) + px * 3) + 'px';
    inlineEd = { ent, e };
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }
  function commitInline(cancel) {
    if (!inlineEd) return;
    const inp = $('#inlineText');
    const v = inp.value;
    const { ent, e } = inlineEd;
    inlineEd = null; inp.hidden = true;
    if (cancel) { draw(); return; }
    if (ent) {
      if (v.trim() === '') mutate(() => { doc.entities = doc.entities.filter(x => x !== ent); sel.delete(ent.id); });
      else if (v !== ent.s) mutate(() => { ent.s = v; });
    } else if (v.trim()) mutate(() => addEnts([Object.assign(e, { s: v })], true));
    cv.focus();
  }
  $('#inlineText').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitInline(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); commitInline(true); }
    ev.stopPropagation();
  });
  $('#inlineText').addEventListener('input', ev => { ev.target.style.width = Math.max(80, ev.target.value.length * parseFloat(ev.target.style.fontSize) * 0.65 + 30) + 'px'; });
  $('#inlineText').addEventListener('blur', () => commitInline());

  // ---------------- commands ----------------
  function delSel() {
    if (!sel.size) return;
    mutate(() => { doc.entities = doc.entities.filter(e => !sel.has(e.id)); sel = new Set(); });
  }
  function rotateSel(deg) {
    if (tool.name === 'symbol') { tool.rot = norm((tool.rot || 0) + deg); draw(); return; }
    if (tool.name === 'paste' && tool.ents) { tool.ents.forEach(e => rotEnt(e, tool.base[0], tool.base[1], deg)); draw(); return; }
    if (!sel.size) return toast('Pilih objek dahulu');
    const b = selBBox(sel), cx = rr((b[0] + b[2]) / 2), cy = rr((b[1] + b[3]) / 2);
    mutate(() => { for (const id of sel) rotEnt(byId.get(id), cx, cy, deg); });
  }
  function mirrorSel() {
    if (!sel.size) return toast('Pilih objek dahulu');
    const b = selBBox(sel), cx = (b[0] + b[2]) / 2;
    mutate(() => { for (const id of sel) mirrorEnt(byId.get(id), cx); });
  }
  function copySel() {
    if (!sel.size) return;
    clipboard = [...sel].map(id => clone(byId.get(id)));
    toast(sel.size + ' objek disalin ke papan klip');
  }
  function pasteClip() {
    if (!clipboard) return toast('Papan klip kosong');
    const ents = clone(clipboard);
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const e of ents) { const q = bbox(e); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }
    setTool('paste', { ents, base: [b[0], b[3]], cur: [mouse.x, mouse.y] });
  }
  function groupSel() {
    if (sel.size < 2) return toast('Pilih sekurang-kurangnya 2 objek');
    const gid = newGid();
    mutate(() => { for (const id of sel) byId.get(id).gid = gid; });
    toast('Dikumpulkan sebagai satu kumpulan');
  }
  function ungroupSel() {
    if (!sel.size) return;
    mutate(() => { for (const id of sel) delete byId.get(id).gid; });
    toast('Kumpulan dileraikan');
  }
  function nudge(dx, dy) { if (!sel.size) return; mutate(() => { for (const id of sel) moveEnt(byId.get(id), dx, dy); }); }

  // ---------------- keyboard ----------------
  document.addEventListener('keydown', ev => {
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey;
    if (k === 'Control' || k === 'Shift' || k === 'Meta') { setStraight(true); return; }
    if (k === ' ') { spaceDown = true; cv.style.cursor = 'grab'; ev.preventDefault(); return; }
    if (ctrl && k.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if (ctrl && k.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if (ctrl && k.toLowerCase() === 'c') { ev.preventDefault(); copySel(); return; }
    if (ctrl && k.toLowerCase() === 'v') { ev.preventDefault(); pasteClip(); return; }
    if (ctrl && k.toLowerCase() === 'a') { ev.preventDefault(); sel = new Set(doc.entities.map(e => e.id)); updatePanel(); draw(); return; }
    if (ctrl && k.toLowerCase() === 's') { ev.preventDefault(); saveProject(); return; }
    if (ctrl && k.toLowerCase() === 'd') { ev.preventDefault(); setTool('copy'); return; }
    if (ctrl && k.toLowerCase() === 'g') { ev.preventDefault(); ev.shiftKey ? ungroupSel() : groupSel(); return; }
    if (ctrl && k.toLowerCase() === 'f') { ev.preventDefault(); $('#findTxt').focus(); return; }
    if (ctrl) return;
    if (k === 'Escape') { if (tool.name === 'line' && tool.p1) { tool.p1 = null; draw(); } else if (tool.name !== 'select') setTool('select'); else { sel = new Set(); updatePanel(); draw(); } return; }
    if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); delSel(); return; }
    if (k === 'F8') { ev.preventDefault(); toggle('ortho'); return; }
    if (k === 'F3') { ev.preventDefault(); toggle('snap'); return; }
    if (k === 'F7') { ev.preventDefault(); toggle('grid'); return; }
    const step = ev.shiftKey ? 5 : 0.5;
    if (k === 'ArrowLeft') { ev.preventDefault(); nudge(-step, 0); return; }
    if (k === 'ArrowRight') { ev.preventDefault(); nudge(step, 0); return; }
    if (k === 'ArrowUp') { ev.preventDefault(); nudge(0, step); return; }
    if (k === 'ArrowDown') { ev.preventDefault(); nudge(0, -step); return; }
    const map = { v: 'select', l: 'line', b: 'rect', c: 'circle', t: 'text', m: 'move', h: 'pan' };
    if (map[k.toLowerCase()]) { setTool(map[k.toLowerCase()]); return; }
    if (k.toLowerCase() === 'r') { rotateSel(90); return; }
    if (k.toLowerCase() === 'f') { zoomFit(); return; }
  });
  function setStraight(on) {
    if (tool.shift === on) return;
    tool.shift = on;
    if (tool.name !== 'select' && tool.cur) { tool.cur = toolPoint(tool.p1 || tool.base, (tool.name === 'move' || tool.name === 'copy') ? sel : null); draw(); }
  }
  document.addEventListener('keyup', ev => { if (ev.key === 'Control' || ev.key === 'Shift' || ev.key === 'Meta') setStraight(false); });
  window.addEventListener('blur', () => setStraight(false));
  document.addEventListener('keyup', ev => { if (ev.key === ' ') { spaceDown = false; cv.style.cursor = tool.name === 'select' ? 'default' : 'crosshair'; } });

  function toggle(k) {
    opt[k] = !opt[k];
    const b = $('#tg-' + k); if (b) b.classList.toggle('on', opt[k]);
    toast({ snap: 'Snap', ortho: 'Ortho (garis lurus)', grid: 'Grid' }[k] + (opt[k] ? ' HIDUP' : ' MATI'));
    draw();
  }

  // ---------------- properties panel ----------------
  const COLORS = [['#000000', 'Hitam'], ['#d00000', 'Merah'], ['#0040ff', 'Biru'], ['#00a000', 'Hijau'], ['#e07000', 'Oren'], ['#b000b0', 'Magenta'], ['#808080', 'Kelabu']];
  const TNAME = { line: 'Garisan', circle: 'Bulatan', arc: 'Lengkok', pline: 'Polyline', path: 'Logo/grafik', text: 'Teks' };
  function updatePanel() {
    const box = $('#props');
    $('#selCount').textContent = sel.size ? sel.size + ' dipilih' : '';
    if (!sel.size) {
      box.innerHTML = '<p class="muted">Tiada objek dipilih. Klik objek pada lukisan untuk lihat dan ubah butirannya.</p>' +
        '<label class="fld"><span>Saiz teks baru (mm)</span><input id="pDefH" type="number" step="0.1" min="0.5" value="' + opt.textH + '"></label>' +
        '<label class="fld"><span>Warna objek baru</span><select id="pDefC">' + COLORS.map(c => '<option value="' + c[0] + '"' + (opt.color === c[0] ? ' selected' : '') + '>' + c[1] + '</option>').join('') + '</select></label>';
      $('#pDefH').onchange = e => { opt.textH = Math.max(0.5, parseFloat(e.target.value) || 2.33); };
      $('#pDefC').onchange = e => { opt.color = e.target.value; };
      return;
    }
    const ents = [...sel].map(id => byId.get(id)).filter(Boolean);
    const texts = ents.filter(e => e.t === 'text');
    let h = '';
    const kinds = {};
    ents.forEach(e => kinds[TNAME[e.t]] = (kinds[TNAME[e.t]] || 0) + 1);
    h += '<p class="kinds">' + Object.entries(kinds).map(([k, v]) => '<span class="chip">' + k + ' ×' + v + '</span>').join(' ') + '</p>';
    if (texts.length === 1) {
      const e = texts[0];
      h += '<label class="fld"><span>Teks</span><input id="pS" type="text" value="' + esc(e.s) + '"></label>';
    }
    if (texts.length) {
      const hs = [...new Set(texts.map(e => e.h))];
      const rs = [...new Set(texts.map(e => e.rot || 0))];
      h += '<div class="row2"><label class="fld"><span>Saiz (mm)</span><input id="pH" type="number" step="0.1" min="0.3" value="' + (hs.length === 1 ? hs[0] : '') + '" placeholder="pelbagai"></label>' +
        '<label class="fld"><span>Sudut (°)</span><input id="pR" type="number" step="90" value="' + (rs.length === 1 ? rs[0] : '') + '" placeholder="pelbagai"></label></div>';
      const al = [...new Set(texts.map(e => e.align || 'left'))];
      h += '<label class="fld"><span>Jajaran</span><select id="pA"><option value="">' + (al.length > 1 ? 'pelbagai' : '') + '</option>' + [['left', 'Kiri'], ['center', 'Tengah'], ['right', 'Kanan']].map(a => '<option value="' + a[0] + '"' + (al.length === 1 && al[0] === a[0] ? ' selected' : '') + '>' + a[1] + '</option>').join('') + '</select></label>';
    }
    if (ents.length === 1) {
      const e = ents[0];
      const num = (id, lbl, v) => '<label class="fld"><span>' + lbl + '</span><input id="' + id + '" type="number" step="0.5" value="' + rr(v) + '"></label>';
      if (e.t === 'line') {
        h += '<div class="row2">' + num('pX1', 'X1', e.x1) + num('pY1', 'Y1', e.y1) + '</div><div class="row2">' + num('pX2', 'X2', e.x2) + num('pY2', 'Y2', e.y2) + '</div>';
        h += '<p class="muted">Panjang ' + Math.hypot(e.x2 - e.x1, e.y2 - e.y1).toFixed(2) + ' mm</p>';
      } else if (e.t === 'circle') h += '<div class="row2">' + num('pCX', 'Pusat X', e.cx) + num('pCY', 'Pusat Y', e.cy) + '</div>' + num('pRad', 'Jejari', e.r);
      else if (e.t === 'text') h += '<div class="row2">' + num('pTX', 'X', e.x) + num('pTY', 'Y', e.y) + '</div>';
    }
    const cols = [...new Set(ents.map(e => e.color || '#000000'))];
    h += '<label class="fld"><span>Warna</span><select id="pC"><option value="">' + (cols.length > 1 ? 'pelbagai' : '') + '</option>' + COLORS.map(c => '<option value="' + c[0] + '"' + (cols.length === 1 && cols[0] === c[0] ? ' selected' : '') + '>' + c[1] + '</option>').join('') + '</select></label>';
    const lines = ents.filter(e => e.t === 'line' || e.t === 'pline' || e.t === 'arc' || e.t === 'circle');
    if (lines.length) h += '<label class="chk"><input id="pD" type="checkbox"' + (lines.every(e => e.dash) ? ' checked' : '') + '> Garis putus-putus</label>';
    if (ents.some(e => e.gid)) h += '<p class="muted">Sebahagian daripada kumpulan. Tahan Alt sambil klik untuk pilih satu bahagian sahaja.</p>';
    box.innerHTML = h;
    const on = (id, fn) => { const el = $('#' + id); if (el) el.onchange = () => fn(el); };
    on('pS', el => mutate(() => { texts[0].s = el.value; }));
    on('pH', el => { const v = parseFloat(el.value); if (v > 0) mutate(() => texts.forEach(e => e.h = v)); });
    on('pR', el => { const v = parseFloat(el.value); if (!isNaN(v)) mutate(() => texts.forEach(e => e.rot = norm(v))); });
    on('pA', el => { if (el.value) mutate(() => texts.forEach(e => { if (el.value === 'left') delete e.align; else e.align = el.value; })); });
    on('pC', el => { if (el.value) mutate(() => ents.forEach(e => { if (el.value === '#000000') delete e.color; else if (e.t !== 'path' || true) e.color = el.value; })); });
    on('pD', el => mutate(() => lines.forEach(e => { if (el.checked) e.dash = true; else delete e.dash; })));
    const setN = (id, k) => on(id, el => { const v = parseFloat(el.value); if (!isNaN(v)) mutate(() => { ents[0][k] = v; }); });
    setN('pX1', 'x1'); setN('pY1', 'y1'); setN('pX2', 'x2'); setN('pY2', 'y2'); setN('pCX', 'cx'); setN('pCY', 'cy'); setN('pRad', 'r'); setN('pTX', 'x'); setN('pTY', 'y');
    const pS = $('#pS'); if (pS) pS.addEventListener('keydown', ev => { if (ev.key === 'Enter') pS.blur(); });
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  // ---------------- find & replace ----------------
  function findText() {
    const q = $('#findTxt').value;
    if (!q) return;
    const ql = q.toLowerCase();
    const hits = doc.entities.filter(e => e.t === 'text' && e.s.toLowerCase().includes(ql));
    sel = new Set(hits.map(e => e.id));
    updatePanel();
    if (hits.length) { const b = selBBox(sel); zoomTo([b[0] - 15, b[1] - 15, b[2] + 15, b[3] + 15]); }
    toast(hits.length ? hits.length + ' teks dijumpai' : 'Tiada teks "' + q + '"');
    draw();
  }
  function replaceText() {
    const q = $('#findTxt').value, r = $('#replTxt').value;
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let n = 0;
    mutate(() => { for (const e of doc.entities) if (e.t === 'text' && re.test(e.s)) { re.lastIndex = 0; e.s = e.s.replace(re, r); n++; } re.lastIndex = 0; });
    toast(n + ' teks diganti');
  }

  // ---------------- files ----------------
  let dlCap;
  async function getDownloads() {
    if (dlCap !== undefined) return dlCap;
    try { dlCap = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dlCap = null; }
    return dlCap;
  }
  async function saveFile(name, data, mime) {
    const dl = await getDownloads();
    if (dl) {
      try { await dl.save({ filename: name, data: data instanceof Blob ? data : new Blob([data], { type: mime }) }); toast('Disimpan: ' + name); }
      catch (e) { if (e && e.code !== 'declined') toast('Tidak dapat simpan (' + (e.code || 'ralat') + ')'); }
      return;
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Dimuat turun: ' + name);
  }
  const baseName = () => (doc.name || 'lukisan').replace(/[^\w\- ]+/g, '').trim() || 'lukisan';
  function saveProject() {
    const out = { version: 1, name: doc.name, sheet: doc.sheet, entities: doc.entities.map(e => { const c = Object.assign({}, e); delete c.id; return c; }) };
    saveFile(baseName() + '.json', JSON.stringify(out), 'application/json');
  }
  const measure = e => textWidth(e);
  function exportPDF() { saveFile(baseName() + '.pdf', Exporters.toPDF(doc, measure), 'application/pdf'); }
  async function exportDXF() {
    const dxf = Exporters.toDXF(doc, measure);
    const dl = await getDownloads();
    if (dl) saveFile(baseName() + '-dxf.zip', Exporters.zip([{ name: baseName() + '.dxf', data: dxf }]), 'application/zip');
    else saveFile(baseName() + '.dxf', dxf, 'application/dxf');
  }
  function openFile(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (/\.pdf$/i.test(file.name)) {
      toast('Membaca PDF…', 8000);
      file.arrayBuffer().then(async buf => {
        const lib = await loadPdfJs();
        const d = await PdfImport.importPdf(lib, new Uint8Array(buf), { name });
        setDoc(d); autosave();
        toast('PDF diimport: ' + d.entities.length + ' objek');
      }).catch(err => { console.error(err); toast('Gagal baca PDF: ' + err.message, 6000); });
    } else {
      file.text().then(t => {
        let d = JSON.parse(t);
        if (!d.entities || !d.sheet) throw new Error('Bukan fail projek editor');
        setDoc(d); autosave(); toast('Projek dibuka: ' + (d.name || name));
      }).catch(err => toast('Gagal buka fail: ' + err.message, 6000));
    }
  }
  let pdfjsPromise = null;
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Tidak dapat muat ' + src)); document.head.appendChild(s); });
  }
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromise) {
      const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
      pdfjsPromise = loadScript(base + 'pdf.worker.min.js').then(() => loadScript(base + 'pdf.min.js')).then(() => {
        const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
        lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
        return lib;
      });
    }
    return pdfjsPromise;
  }

  async function loadDefault() {
    if (window.DEFAULT_DRAWING) return clone(window.DEFAULT_DRAWING);
    try { const r = await fetch('drawings/qlwb.json'); if (r.ok) return await r.json(); } catch (e) { /* offline */ }
    return null;
  }

  // ---------------- UI wiring ----------------
  let toastT = null;
  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 2200);
  }
  function buildSymbols() {
    const box = $('#symList');
    for (const s of Symbols) {
      const b = document.createElement('button');
      b.className = 'sym'; b.dataset.sym = s.id; b.title = s.name; b.type = 'button';
      const c = document.createElement('canvas'); c.width = 96; c.height = 96;
      const ents = s.draw();
      let bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const e of ents) { const q = bbox(e); bb = [Math.min(bb[0], q[0]), Math.min(bb[1], q[1]), Math.max(bb[2], q[2]), Math.max(bb[3], q[3])]; }
      const bw = bb[2] - bb[0], bh = bb[3] - bb[1], sc = Math.min(80 / Math.max(bw, 1), 80 / Math.max(bh, 1), 9);
      const T = { s: sc, ox: 48 - (bb[0] + bw / 2) * sc, oy: 48 + (bb[1] + bh / 2) * sc };
      const g = c.getContext('2d'); g.lineWidth = 2; g.lineCap = 'round';
      const col = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#111';
      for (const e of ents) drawEnt(g, e, T, e.fill ? null : col);
      const sp = document.createElement('span'); sp.textContent = s.name;
      b.append(c, sp);
      b.onclick = () => setTool('symbol', { symId: s.id, ents: s.draw(), rot: 0 });
      box.appendChild(b);
    }
  }
  function wire() {
    document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
    const act = { undo, redo, del: delSel, rot: () => rotateSel(90), mirror: mirrorSel, copyc: () => setTool('copy'), fit: zoomFit, group: groupSel, ungroup: ungroupSel,
      zin: () => zoomAt(W / 2, H / 2, 1.4), zout: () => zoomAt(W / 2, H / 2, 1 / 1.4),
      open: () => $('#fileIn').click(), save: saveProject, pdf: exportPDF, dxf: exportDXF,
      reset: () => { const b = $('[data-act="reset"]'); if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Asal'; loadDefault().then(dd => { if (dd) { setDoc(dd); autosave(); toast('Lukisan asal dimuat semula'); } }); } else { b.dataset.armed = '1'; b.textContent = 'Pasti? Klik lagi'; toast('Semua perubahan akan hilang. Klik "Pasti?" sekali lagi untuk teruskan.', 3500); setTimeout(() => { delete b.dataset.armed; b.textContent = 'Asal'; }, 3500); } },
      help: () => { $('#help').hidden = !$('#help').hidden; },
      find: findText, repl: replaceText };
    document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act[b.dataset.act]());
    ['snap', 'ortho', 'grid'].forEach(k => { const b = $('#tg-' + k); b.classList.toggle('on', opt[k]); b.onclick = () => toggle(k); });
    $('#fileIn').onchange = e => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; };
    $('#docName').onchange = e => { doc.name = e.target.value; autosave(); };
    $('#findTxt').addEventListener('keydown', e => { if (e.key === 'Enter') findText(); });
    $('#helpClose').onclick = () => { $('#help').hidden = true; try { localStorage.setItem('elec-editor-help-seen', '1'); } catch (e) { /* ignore */ } };
    wrap.addEventListener('dragover', e => e.preventDefault());
    wrap.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
    new ResizeObserver(resize).observe(wrap);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const re = () => { readCss(); draw(); };
    mq.addEventListener && mq.addEventListener('change', re);
    new MutationObserver(re).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  // ---------------- boot ----------------
  function boot() {
    readCss();
    wire();
    buildSymbols();
    resize();
    let d = null;
    try { const s = localStorage.getItem(STORE_KEY); if (s) d = JSON.parse(s); } catch (e) { d = null; }
    setDoc({ version: 1, name: 'Lukisan baru', sheet: { w: 420, h: 297 }, entities: [] });
    if (d && d.entities) { setDoc(d); toast('Kerja terakhir dimuat semula dari pelayar'); }
    else loadDefault().then(dd => { if (dd) setDoc(dd); });
    let seen = false; try { seen = !!localStorage.getItem('elec-editor-help-seen'); } catch (e) { /* ignore */ }
    $('#help').hidden = seen;
    setTool('select');
  }
  window.ElecEditor = { get doc() { return doc; }, setDoc, select: ids => { sel = new Set(ids); updatePanel(); draw(); }, view: () => view, toPDF: () => Exporters.toPDF(doc, measure), toDXF: () => Exporters.toDXF(doc, measure) };
  boot();
})();
