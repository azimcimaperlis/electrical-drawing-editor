/* PDF (AutoCAD plot) -> editable drawing model.
 * Works in browser (window.PdfImport) and Node (module.exports).
 * Model units: millimetres, Y up, origin = bottom-left of sheet. */
(function (root) {
  'use strict';
  const PT = 25.4 / 72;

  function mul(m, n) { // m then n  (pdf.js Util.transform order: n applied first)
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  async function importPdf(pdfjsLib, data, opts) {
    opts = opts || {};
    const doc = await pdfjsLib.getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
    const page = await doc.getPage(opts.page || 1);
    const vp = page.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height;
    const toMM = (m, x, y) => { const d = ap(mul(vp.transform, m), x, y); return [d[0] * PT, (H - d[1]) * PT]; };
    const OPS = pdfjsLib.OPS;
    const ol = await page.getOperatorList();

    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let gs = { stroke: '#000000', fill: '#000000', lw: 1 };
    let subs = [], cur = null, cx = 0, cy = 0;
    const strokes = [], fills = [];

    const flushCur = () => { if (cur && cur.pts.length > 1) subs.push(cur); cur = null; };
    const moveTo = (x, y) => { flushCur(); cx = x; cy = y; cur = { pts: [toMM(ctm, x, y)], closed: false }; };
    const lineTo = (x, y) => { if (!cur) moveTo(cx, cy); cx = x; cy = y; cur.pts.push(toMM(ctm, x, y)); };
    const bez = (x1, y1, x2, y2, x3, y3) => {
      if (!cur) moveTo(cx, cy);
      const x0 = cx, y0 = cy, N = 10;
      for (let i = 1; i <= N; i++) {
        const t = i / N, u = 1 - t;
        const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        cur.pts.push(toMM(ctm, x, y));
      }
      cx = x3; cy = y3;
    };
    const paint = (doStroke, doFill, close) => {
      flushCur();
      for (const s of subs) {
        if (close) s.closed = true;
        if (doFill) fills.push({ pts: s.pts, color: gs.fill, stroke: doStroke ? gs.stroke : null });
        else if (doStroke) strokes.push({ pts: s.pts, closed: s.closed, color: gs.stroke });
      }
      subs = [];
    };

    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i];
      switch (fn) {
        case OPS.save: stack.push({ ctm: ctm.slice(), gs: Object.assign({}, gs) }); break;
        case OPS.restore: { const s = stack.pop(); if (s) { ctm = s.ctm; gs = s.gs; } break; }
        case OPS.transform: ctm = mul(ctm, a); break;
        case OPS.paintFormXObjectBegin: stack.push({ ctm: ctm.slice(), gs: Object.assign({}, gs) }); if (a[0]) ctm = mul(ctm, a[0]); break;
        case OPS.paintFormXObjectEnd: { const s = stack.pop(); if (s) { ctm = s.ctm; gs = s.gs; } break; }
        case OPS.setLineWidth: gs.lw = a[0]; break;
        case OPS.setStrokeRGBColor: gs.stroke = hex(a[0], a[1], a[2]); break;
        case OPS.setFillRGBColor: gs.fill = hex(a[0], a[1], a[2]); break;
        case OPS.constructPath: {
          const ops = a[0], args = a[1];
          let k = 0;
          for (const op of ops) {
            if (op === OPS.moveTo) { moveTo(args[k], args[k + 1]); k += 2; }
            else if (op === OPS.lineTo) { lineTo(args[k], args[k + 1]); k += 2; }
            else if (op === OPS.curveTo) { bez(args[k], args[k + 1], args[k + 2], args[k + 3], args[k + 4], args[k + 5]); k += 6; }
            else if (op === OPS.curveTo2) { bez(cx, cy, args[k], args[k + 1], args[k + 2], args[k + 3]); k += 4; }
            else if (op === OPS.curveTo3) { bez(args[k], args[k + 1], args[k + 2], args[k + 3], args[k + 2], args[k + 3]); k += 4; }
            else if (op === OPS.rectangle) {
              const x = args[k], y = args[k + 1], w = args[k + 2], h = args[k + 3]; k += 4;
              moveTo(x, y); lineTo(x + w, y); lineTo(x + w, y + h); lineTo(x, y + h); cur.closed = true; flushCur();
            } else if (op === OPS.closePath) {
              if (cur) { cur.closed = true; const p0 = cur.pts[0]; cx = cur._sx; cy = cur._sy; cur.pts.push(p0.slice()); flushCur(); }
            }
            if (op === OPS.moveTo && cur) { cur._sx = args[k - 2]; cur._sy = args[k - 1]; }
          }
          break;
        }
        case OPS.stroke: paint(true, false, false); break;
        case OPS.closeStroke: paint(true, false, true); break;
        case OPS.fill: case OPS.eoFill: paint(false, true, true); break;
        case OPS.fillStroke: case OPS.eoFillStroke: paint(true, true, true); break;
        case OPS.closeFillStroke: case OPS.closeEOFillStroke: paint(true, true, true); break;
        case OPS.endPath: flushCur(); subs = []; break;
      }
    }

    const ents = [];
    // ---- strokes: segments -> chains -> lines / arcs / circles
    const byColor = {};
    for (const s of strokes) (byColor[s.color] = byColor[s.color] || []).push(s);
    for (const color in byColor) {
      for (const e of vectorize(byColor[color])) { if (color !== '#000000') e.color = color; ents.push(e); }
    }
    // ---- fills (logos, solid dots)
    for (const f of fills) {
      const pts = f.pts.slice();
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pts.pop();
      if (pts.length < 3) continue;
      const c = fitCircleAll(pts, true);
      if (c && pts.length >= 12) ents.push({ t: 'circle', cx: r3(c.cx), cy: r3(c.cy), r: r3(c.r), fill: f.color, color: f.stroke || f.color });
      else ents.push({ t: 'pline', pts: pts.map(p => [r3(p[0]), r3(p[1])]), closed: true, fill: f.color, color: f.stroke || 'none' });
    }

    clusterTiny(ents);

    // ---- text
    const tc = await page.getTextContent();
    const fontInfo = {};
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const m = it.transform;
      const o = toMM([1, 0, 0, 1, 0, 0], m[4], m[5]);
      const o2 = toMM([1, 0, 0, 1, 0, 0], m[4] + m[0], m[5] + m[1]);
      const o3 = toMM([1, 0, 0, 1, 0, 0], m[4] + m[2], m[5] + m[3]);
      const rot = Math.atan2(o2[1] - o[1], o2[0] - o[0]) * 180 / Math.PI;
      const size = Math.hypot(o3[0] - o[0], o3[1] - o[1]);
      let fname = '';
      if (!(it.fontName in fontInfo)) {
        try { const f = page.commonObjs.get(it.fontName); fontInfo[it.fontName] = (f && f.name) || ''; } catch (e) { fontInfo[it.fontName] = ''; }
      }
      fname = fontInfo[it.fontName] || ((tc.styles[it.fontName] || {}).fontFamily) || '';
      const isSerif = /times|serif/i.test(fname) && !/sans/i.test(fname);
      const e = { t: 'text', x: r3(o[0]), y: r3(o[1]), h: r3(size), rot: r2(((rot % 360) + 360) % 360), s: it.str.replace(/\s+$/, '') };
      if (isSerif) e.font = 'serif';
      if (/bold/i.test(fname) && isSerif) e.bold = true;
      if (/italic|oblique/i.test(fname)) e.italic = true;
      if (Math.abs(e.rot - 360) < 0.01) e.rot = 0;
      ents.push(e);
    }
    return { version: 1, name: opts.name || 'drawing', sheet: { w: r3(W * PT), h: r3(H * PT) }, entities: ents };
  }

  // Dense clouds of tiny strokes (logos, hatching) -> one 'path' object + group with nearby fills
  function clusterTiny(ents) {
    const tiny = [];
    ents.forEach((e, i) => { if (e.t === 'line' && Math.hypot(e.x2 - e.x1, e.y2 - e.y1) < 0.6) tiny.push(i); });
    if (tiny.length < 30) return;
    const par = new Map(tiny.map(i => [i, i]));
    const find = i => { while (par.get(i) !== i) { par.set(i, par.get(par.get(i))); i = par.get(i); } return i; };
    const grid = new Map(), C = 0.8;
    for (const i of tiny) {
      const e = ents[i];
      const cx = Math.floor((e.x1 + e.x2) / 2 / C), cy = Math.floor((e.y1 + e.y2) / 2 / C);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const l = grid.get((cx + dx) + ',' + (cy + dy));
        if (l) for (const j of l) { const a = find(i), b = find(j); if (a !== b) par.set(a, b); }
      }
      const k = cx + ',' + cy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
    }
    const comps = new Map();
    for (const i of tiny) { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(i); }
    const drop = new Set(); const add = [];
    let g = 1;
    for (const list of comps.values()) {
      if (list.length < 30) continue;
      const segs = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const i of list) {
        const e = ents[i]; drop.add(i); segs.push(e.x1, e.y1, e.x2, e.y2);
        x0 = Math.min(x0, e.x1, e.x2); y0 = Math.min(y0, e.y1, e.y2); x1 = Math.max(x1, e.x1, e.x2); y1 = Math.max(y1, e.y1, e.y2);
      }
      const gid = 'imp' + (g++);
      const pe = { t: 'path', segs, gid };
      if (ents[list[0]].color) pe.color = ents[list[0]].color;
      add.push(pe);
      for (const e of ents) if (e.fill && !e.gid) {
        const pts = e.pts || [[e.cx, e.cy]];
        if (pts.every(p => p[0] >= x0 - 1 && p[0] <= x1 + 1 && p[1] >= y0 - 1 && p[1] <= y1 + 1)) e.gid = gid;
      }
    }
    const keep = ents.filter((e, i) => !drop.has(i));
    ents.length = 0; ents.push(...keep, ...add);
  }

  const r3 = v => Math.round(v * 1000) / 1000;
  const r2 = v => Math.round(v * 100) / 100;

  function vectorize(strokes) {
    const Q = 0.005; // mm
    const key = p => Math.round(p[0] / Q) + ',' + Math.round(p[1] / Q);
    const segs = [], seen = new Set();
    for (const s of strokes) {
      for (let i = 0; i + 1 < s.pts.length; i++) {
        const a = s.pts[i], b = s.pts[i + 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01) continue;
        const ka = key(a), kb = key(b);
        const sk = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        if (seen.has(sk)) continue;
        seen.add(sk);
        segs.push({ a, b, ka, kb, used: false });
      }
    }
    const adj = new Map();
    const addAdj = (k, s) => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(s); };
    for (const s of segs) { addAdj(s.ka, s); addAdj(s.kb, s); }
    const chains = [];
    const other = (s, k) => (s.ka === k ? s.kb : s.ka);
    const ptOf = (s, k) => (s.ka === k ? s.a : s.b);
    for (const s0 of segs) {
      if (s0.used) continue;
      s0.used = true;
      let fwd = [s0.a, s0.b];
      let kEnd = s0.kb, kStart = s0.ka;
      // extend forward
      for (;;) {
        const l = adj.get(kEnd);
        if (l.length !== 2) break;
        const n = l[0].used ? l[1] : l[0];
        if (n.used) break;
        n.used = true;
        const nk = other(n, kEnd);
        fwd.push(ptOf(n, nk));
        kEnd = nk;
        if (kEnd === kStart) break;
      }
      let closed = kEnd === kStart;
      if (!closed) {
        const back = [];
        for (;;) {
          const l = adj.get(kStart);
          if (l.length !== 2) break;
          const n = l[0].used ? l[1] : l[0];
          if (n.used) break;
          n.used = true;
          const nk = other(n, kStart);
          back.push(ptOf(n, nk));
          kStart = nk;
          if (kStart === kEnd) { closed = true; break; }
        }
        fwd = back.reverse().concat(fwd);
      }
      chains.push({ pts: fwd, closed });
    }
    const out = [];
    for (const c of chains) classify(c, out);
    return out;
  }

  function turn(p0, p1, p2) {
    const a1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const a2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function circ3(a, b, c) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
    const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
    const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
  }
  function fitCircleAll(pts, closed) {
    const n = pts.length;
    if (n < 5) return null;
    let c;
    if (closed) {
      let sx = 0, sy = 0; for (const p of pts) { sx += p[0]; sy += p[1]; }
      const cx = sx / n, cy = sy / n; let r = 0; for (const p of pts) r += dist(p, [cx, cy]); r /= n;
      c = { cx, cy, r };
    } else c = circ3(pts[0], pts[n >> 1], pts[n - 1]);
    if (!c || c.r < 0.05 || c.r > 500) return null;
    const tol = Math.max(0.02, c.r * 0.04);
    for (const p of pts) if (Math.abs(dist(p, [c.cx, c.cy]) - c.r) > tol) return null;
    return c;
  }

  function classify(ch, out) {
    let pts = ch.pts;
    if (ch.closed && dist(pts[0], pts[pts.length - 1]) < 0.02) pts = pts.slice(0, -1);
    const n = pts.length;
    // whole closed chain is a circle?
    if (ch.closed && n >= 8) {
      const c = fitCircleAll(pts, true);
      if (c) { out.push({ t: 'circle', cx: r3(c.cx), cy: r3(c.cy), r: r3(c.r) }); return; }
    }
    const P = ch.closed ? pts.concat([pts[0]]) : pts;
    const m = P.length;
    // mark "curvy" vertices
    const isCurveSeg = i => dist(P[i], P[i + 1]) < 2.5;
    let i = 0;
    let lineStart = 0;
    const emitLines = (from, to) => { // straight pieces between P[from]..P[to], merge collinear
      let s = from;
      for (let k = from + 1; k <= to; k++) {
        if (k === to || Math.abs(turn(P[k - 1], P[k], P[k + 1])) > 0.01) {
          if (dist(P[s], P[k]) > 0.01) out.push({ t: 'line', x1: r3(P[s][0]), y1: r3(P[s][1]), x2: r3(P[k][0]), y2: r3(P[k][1]) });
          s = k;
        }
      }
    };
    while (i < m - 1) {
      // try an arc run starting at segment i
      let j = i;
      if (isCurveSeg(i)) {
        let sign = 0;
        while (j + 1 < m - 1 && isCurveSeg(j + 1)) {
          const t = turn(P[j], P[j + 1], P[j + 2]);
          const at = Math.abs(t);
          if (at < 0.004 || at > 0.8) break;
          const sg = Math.sign(t);
          if (sign && sg !== sign) break;
          sign = sg; j++;
        }
      }
      const segCount = j - i + 1;
      if (segCount >= 4) {
        const run = P.slice(i, j + 2);
        const c = fitCircleAll(run, false);
        if (c) {
          if (lineStart < i) emitLines(lineStart, i);
          let a1 = Math.atan2(run[0][1] - c.cy, run[0][0] - c.cx) * 180 / Math.PI;
          let a2 = Math.atan2(run[run.length - 1][1] - c.cy, run[run.length - 1][0] - c.cx) * 180 / Math.PI;
          const ccw = turn(run[0], run[1], run[2]) > 0;
          if (!ccw) { const t = a1; a1 = a2; a2 = t; }
          const sweep = ((a2 - a1) % 360 + 360) % 360;
          if (ch.closed && i === 0 && j === m - 2 || sweep < 0.5 || sweep > 359.5) out.push({ t: 'circle', cx: r3(c.cx), cy: r3(c.cy), r: r3(c.r) });
          else out.push({ t: 'arc', cx: r3(c.cx), cy: r3(c.cy), r: r3(c.r), a1: r2((a1 + 360) % 360), a2: r2((a2 + 360) % 360) });
          i = j + 1; lineStart = i;
          continue;
        }
      }
      i++;
    }
    if (lineStart < m - 1) emitLines(lineStart, m - 1);
  }

  const api = { importPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
