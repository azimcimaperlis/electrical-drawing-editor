/* Symbol capture: finds electrical symbols in an imported drawing and normalises them
 * into reusable library entries. Works in browser (window.SymbolCapture) and Node.
 * Units mm, Y up. A captured symbol's entities are relative to its anchor (0,0). */
(function (root) {
  'use strict';

  const CATEGORIES = [
    'Suis & kontak', 'Kontaktor & relay', 'Perlindungan', 'Motor & beban',
    'Lampu & penunjuk', 'Transformer & bekalan', 'Bumi & terminal', 'Teks & label', 'Lain-lain'
  ];

  const WIRE = 5.2;    // axis-aligned lines longer than this are wires (unless part of a small box)
  const JOIN = 1.0;    // entities closer than this belong to the same symbol
  const LEAD = 3;      // length of wire kept as connection leads around a symbol
  const GAP = 2.2;     // a wire ending this close to a symbol is one of its terminals (open contacts)
  const MAXENTS = 60;
  const MAXSZ = 36, MINSZ = 1.6;

  const r3 = v => Math.round(v * 1000) / 1000;
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- geometry helpers ----------
  function segsOf(e) {
    switch (e.t) {
      case 'line': return [[e.x1, e.y1, e.x2, e.y2]];
      case 'pline': {
        const p = e.pts, n = p.length, r = [];
        for (let i = 0; i < n - 1 + (e.closed ? 1 : 0); i++) { const a = p[i], b = p[(i + 1) % n]; r.push([a[0], a[1], b[0], b[1]]); }
        return r;
      }
      case 'circle': case 'arc': {
        let a1 = 0, a2 = 360;
        if (e.t === 'arc') { a1 = e.a1; a2 = e.a2; if (a2 <= a1) a2 += 360; }
        const N = Math.max(4, Math.ceil((a2 - a1) / 22.5)), r = [];
        for (let i = 0; i < N; i++) {
          const t0 = (a1 + (a2 - a1) * i / N) * Math.PI / 180, t1 = (a1 + (a2 - a1) * (i + 1) / N) * Math.PI / 180;
          r.push([e.cx + e.r * Math.cos(t0), e.cy + e.r * Math.sin(t0), e.cx + e.r * Math.cos(t1), e.cy + e.r * Math.sin(t1)]);
        }
        return r;
      }
    }
    return [];
  }
  function bboxOfSegs(segs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of segs) { x0 = Math.min(x0, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); x1 = Math.max(x1, s[0], s[2]); y1 = Math.max(y1, s[1], s[3]); }
    return [x0, y0, x1, y1];
  }
  function dPtSeg(px, py, s) {
    const dx = s[2] - s[0], dy = s[3] - s[1], l = dx * dx + dy * dy;
    let t = l ? ((px - s[0]) * dx + (py - s[1]) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - s[0] - t * dx, py - s[1] - t * dy);
  }
  function segsCross(a, b) {
    const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    return o(a[0], a[1], a[2], a[3], b[0], b[1]) * o(a[0], a[1], a[2], a[3], b[2], b[3]) < 0 &&
      o(b[0], b[1], b[2], b[3], a[0], a[1]) * o(b[0], b[1], b[2], b[3], a[2], a[3]) < 0;
  }
  function dSegSeg(a, b) {
    if (segsCross(a, b)) return 0;
    return Math.min(dPtSeg(a[0], a[1], b), dPtSeg(a[2], a[3], b), dPtSeg(b[0], b[1], a), dPtSeg(b[2], b[3], a));
  }
  function entDist(A, B) {
    let m = Infinity;
    for (const a of A) for (const b of B) { const d = dSegSeg(a, b); if (d < m) { m = d; if (!m) return 0; } }
    return m;
  }
  const overlap = (a, b, pad) => a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];

  // Liang–Barsky clip of a segment to a box
  function clip(s, b) {
    let t0 = 0, t1 = 1;
    const dx = s[2] - s[0], dy = s[3] - s[1];
    const p = [-dx, dx, -dy, dy], q = [s[0] - b[0], b[2] - s[0], s[1] - b[1], b[3] - s[1]];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    const c = [s[0] + t0 * dx, s[1] + t0 * dy, s[0] + t1 * dx, s[1] + t1 * dy];
    return Math.hypot(c[2] - c[0], c[3] - c[1]) > 0.2 ? c : null;
  }

  function textBox(e) {
    const w = (e.s || '').length * e.h * 0.62;
    const x0 = e.align === 'center' ? e.x - w / 2 : e.align === 'right' ? e.x - w : e.x;
    if (e.rot && Math.round(e.rot) % 180 === 90) return [e.x - e.h, e.y + (x0 - e.x), e.x, e.y + (x0 - e.x) + w];
    return [x0, e.y - 0.2 * e.h, x0 + w, e.y + 0.8 * e.h];
  }

  const isAxis = s => Math.abs(s[0] - s[2]) < 0.05 || Math.abs(s[1] - s[3]) < 0.05;
  const len = s => Math.hypot(s[2] - s[0], s[3] - s[1]);
  const TAG_RE = /^([A-Z]{1,3})\s?-?\d{1,3}[A-Z]?$/i;

  // ---------- detection ----------
  function detect(doc) {
    const ents = doc.entities || [];
    const core = [], wires = [], texts = [];
    const boxSides = findBoxSides(ents);
    for (const e of ents) {
      if (e.t === 'text') { texts.push(e); continue; }
      if (e.t === 'path' || (e.gid && String(e.gid).startsWith('imp'))) continue;
      if (e.fill && e.fill !== 'none' && e.fill !== '#000000') continue; // coloured logo fills
      const segs = segsOf(e);
      if (!segs.length) continue;
      const bb = bboxOfSegs(segs);
      if (e.t === 'line' && isAxis(segs[0]) && len(segs[0]) > WIRE && !boxSides.has(e)) { wires.push({ e, s: segs[0] }); continue; }
      if (Math.max(bb[2] - bb[0], bb[3] - bb[1]) > MAXSZ) continue;
      core.push({ e, segs, bb });
    }

    // union-find over nearby core entities (grid accelerated)
    const n = core.length, par = core.map((_, i) => i);
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const G = 6, grid = new Map();
    core.forEach((c, i) => {
      for (let gx = Math.floor((c.bb[0] - JOIN) / G); gx <= Math.floor((c.bb[2] + JOIN) / G); gx++)
        for (let gy = Math.floor((c.bb[1] - JOIN) / G); gy <= Math.floor((c.bb[3] + JOIN) / G); gy++) {
          const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
        }
    });
    const tested = new Set();
    for (const list of grid.values()) {
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const i = list[a], j = list[b], key = i < j ? i * n + j : j * n + i;
        if (tested.has(key)) continue; tested.add(key);
        if (find(i) === find(j) || !overlap(core[i].bb, core[j].bb, JOIN)) continue;
        if (entDist(core[i].segs, core[j].segs) <= JOIN) par[find(i)] = find(j);
      }
    }
    const comps = new Map();
    core.forEach((c, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(c); });

    const found = [];
    for (const list of comps.values()) {
      let bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const c of list) bb = [Math.min(bb[0], c.bb[0]), Math.min(bb[1], c.bb[1]), Math.max(bb[2], c.bb[2]), Math.max(bb[3], c.bb[3])];
      const w = bb[2] - bb[0], h = bb[3] - bb[1], sz = Math.max(w, h);
      if (sz < MINSZ || sz > MAXSZ || list.length > MAXENTS) continue;
      const hasBody = list.length >= 2 || list.some(c => (c.e.t === 'circle' && c.e.r >= 1.2) || (c.e.t === 'pline' && c.e.closed && !c.e.fill));
      if (!hasBody) continue;
      // reject pure wiring: everything axis-aligned and no closed shapes/circles (wire corners, T-junctions)
      const allSegs = list.flatMap(c => c.segs);
      const shapes = list.some(c => c.e.t !== 'line');
      if (!shapes && allSegs.every(isAxis) && !looksLikeBox(allSegs, bb)) continue;
      // a lone large empty rectangle is a panel outline, not a symbol
      if (!shapes && allSegs.length <= 4 && allSegs.every(isAxis) && sz > 10) continue;
      // reject plain text underlines / dimension ticks: very flat clusters
      if (Math.min(w, h) < 0.25 && !shapes && allSegs.every(isAxis)) continue;

      const out = list.map(c => clone(c.e));
      // leads: wire pieces touching the symbol, clipped to a margin around it
      const touch = [bb[0] - 0.3, bb[1] - 0.3, bb[2] + 0.3, bb[3] + 0.3];
      const area = [bb[0] - LEAD, bb[1] - LEAD, bb[2] + LEAD, bb[3] + LEAD];
      const pins = [];
      const near = [bb[0] - GAP, bb[1] - GAP, bb[2] + GAP, bb[3] + GAP];
      for (const wr of wires) {
        if (!clip(wr.s, near)) continue;
        const ends = [[wr.s[0], wr.s[1]], [wr.s[2], wr.s[3]]];
        const touches = list.some(c => entDist(c.segs, [wr.s]) <= 0.3);
        const endsNear = ends.some(p => list.some(c => c.segs.some(sg => dPtSeg(p[0], p[1], sg) <= GAP)));
        if (!touches && !endsNear) continue;
        const cs = clip(wr.s, area);
        if (!cs) continue;
        const le = { t: 'line', x1: cs[0], y1: cs[1], x2: cs[2], y2: cs[3] };
        if (wr.e.color) le.color = wr.e.color;
        if (wr.e.dash) le.dash = true;
        out.push(le);
        for (const p of [[cs[0], cs[1]], [cs[2], cs[3]]]) {
          const onEdge = Math.abs(p[0] - area[0]) < 0.05 || Math.abs(p[0] - area[2]) < 0.05 || Math.abs(p[1] - area[1]) < 0.05 || Math.abs(p[1] - area[3]) < 0.05;
          if (onEdge) pins.push(p);
        }
      }
      // texts inside the body (e.g. "M", "3~")
      const inner = [];
      for (const t of texts) {
        const tb = textBox(t), cx = (tb[0] + tb[2]) / 2, cy = (tb[1] + tb[3]) / 2;
        if (cx > bb[0] && cx < bb[2] && cy > bb[1] && cy < bb[3] && (tb[2] - tb[0]) <= w + 1) inner.push(t);
      }
      out.push(...inner.map(clone));
      const tag = nearestTag(texts, bb, inner);
      found.push({ ents: out, bb, pins, tag, inner: inner.map(t => t.s) });
    }

    // normalise, classify, de-duplicate
    const bySig = new Map();
    for (const f of found) {
      const anchor = pickAnchor(f.pins, f.bb);
      const ents = f.ents.map(e => { delete e.id; delete e.gid; return shift(e, -anchor[0], -anchor[1]); });
      const kind = classify(f, ents);
      const sig = signature(ents);
      const prev = bySig.get(sig);
      if (prev) { prev.count++; if (f.tag && prev.tags.length < 6 && !prev.tags.includes(f.tag)) prev.tags.push(f.tag); continue; }
      bySig.set(sig, { sig, ents, cat: kind.cat, type: kind.type, tags: f.tag ? [f.tag] : [], count: 1, at: [r3(anchor[0]), r3(anchor[1])] });
    }
    const res = [...bySig.values()];
    for (const s of res) s.name = s.type + (s.tags.length ? ' ' + s.tags[0] : '');
    res.sort((a, b) => CATEGORIES.indexOf(a.cat) - CATEGORIES.indexOf(b.cat) || b.count - a.count);
    return res;
  }

  // Axis-aligned lines that form small closed rectangles (coil, fuse, overload bodies)
  function findBoxSides(ents) {
    const H = [], V = [];
    for (const e of ents) {
      if (e.t !== 'line') continue;
      const l = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
      if (l > 16 || l < 0.8) continue;
      if (Math.abs(e.y1 - e.y2) < 0.05) H.push({ e, y: e.y1, a: Math.min(e.x1, e.x2), b: Math.max(e.x1, e.x2) });
      else if (Math.abs(e.x1 - e.x2) < 0.05) V.push({ e, x: e.x1, a: Math.min(e.y1, e.y2), b: Math.max(e.y1, e.y2) });
    }
    const T = 0.2, out = new Set();
    const vAt = (x, ya, yb) => V.find(v => Math.abs(v.x - x) < T && v.a <= ya + T && v.b >= yb - T);
    for (let i = 0; i < H.length; i++) for (let j = 0; j < H.length; j++) {
      const h1 = H[i], h2 = H[j];
      if (h2.y <= h1.y + 0.8 || h2.y - h1.y > 16) continue;
      if (Math.abs(h1.a - h2.a) > T || Math.abs(h1.b - h2.b) > T) continue;
      const l = vAt(h1.a, h1.y, h2.y), r = vAt(h1.b, h1.y, h2.y);
      if (l && r) { out.add(h1.e); out.add(h2.e); out.add(l.e); out.add(r.e); }
    }
    return out;
  }

  function looksLikeBox(segs, bb) {
    // four sides of a small rectangle drawn as separate lines
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    if (w < 1 || h < 1) return false;
    const near = (a, b) => Math.abs(a - b) < 0.15;
    let l = 0, r = 0, t = 0, b = 0;
    for (const s of segs) {
      if (near(s[0], s[2])) { if (near(s[0], bb[0])) l++; if (near(s[0], bb[2])) r++; }
      if (near(s[1], s[3])) { if (near(s[1], bb[1])) b++; if (near(s[1], bb[3])) t++; }
    }
    return l && r && t && b;
  }

  function nearestTag(texts, bb, inner) {
    let best = null, bd = 9;
    for (const t of texts) {
      if (inner.includes(t)) continue;
      const s = String(t.s).trim();
      const m = TAG_RE.exec(s);
      if (!m || /^(L|N|PE)$/i.test(m[1]) || /^\d+$/.test(s)) continue;
      const tb = textBox(t);
      const dx = Math.max(bb[0] - tb[2], 0, tb[0] - bb[2]), dy = Math.max(bb[1] - tb[3], 0, tb[1] - bb[3]);
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = s.toUpperCase().replace(/\s+/g, ''); }
    }
    return best;
  }

  function pickAnchor(pins, bb) {
    if (pins.length) {
      const p = pins.slice().sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      return [r3(p[0]), r3(p[1])];
    }
    return [r3((bb[0] + bb[2]) / 2), r3((bb[1] + bb[3]) / 2)];
  }

  function shift(e, dx, dy) {
    switch (e.t) {
      case 'line': e.x1 = r3(e.x1 + dx); e.y1 = r3(e.y1 + dy); e.x2 = r3(e.x2 + dx); e.y2 = r3(e.y2 + dy); break;
      case 'circle': case 'arc': e.cx = r3(e.cx + dx); e.cy = r3(e.cy + dy); break;
      case 'pline': e.pts = e.pts.map(p => [r3(p[0] + dx), r3(p[1] + dy)]); break;
      case 'text': e.x = r3(e.x + dx); e.y = r3(e.y + dy); break;
    }
    return e;
  }

  function classify(f, ents) {
    const geo = ents.filter(e => e.t !== 'text');
    const segs = geo.flatMap(segsOf);
    const circles = geo.filter(e => e.t === 'circle');
    const diag = segs.filter(s => !isAxis(s) && len(s) > 2.2);
    const inner = f.inner.map(s => String(s).toUpperCase());
    const tag = f.tag || '';
    const pre = (TAG_RE.exec(tag) || [])[1] || '';
    const P = pre.toUpperCase();
    const bigC = circles.find(c => c.r >= 3);
    if (bigC && inner.some(s => s === 'M' || /~/.test(s))) return { cat: 'Motor & beban', type: 'Motor' };
    if (circles.length && circles.every(c => c.r < 1.2) && diag.length <= circles.length && !inner.length && segs.length - circles.length * 16 <= 6) return { cat: 'Bumi & terminal', type: 'Terminal' };
    const lampC = circles.find(c => c.r >= 1.2 && diag.filter(s => Math.hypot((s[0] + s[2]) / 2 - c.cx, (s[1] + s[3]) / 2 - c.cy) < c.r * 0.5).length >= 2);
    if (lampC || P === 'H' || P === 'HL') return { cat: 'Lampu & penunjuk', type: 'Lampu' };
    if (isEarth(segs) && !circles.length && !diag.length) return { cat: 'Bumi & terminal', type: 'Bumi' };
    if (P === 'TR' || (circles.filter(c => c.r >= 1.5).length === 2 && !diag.length)) return { cat: 'Transformer & bekalan', type: 'Transformer' };
    const box = geo.some(e => e.t === 'pline' && e.closed && !e.fill && e.pts.length === 4) || looksLikeBox(segs.filter(isAxis), bboxOfSegs(segs.filter(isAxis)));
    if (P === 'Q' || P === 'MCB' || P === 'CB') return { cat: 'Perlindungan', type: diag.length ? 'Pemutus litar' : 'Pemutus litar' };
    if (P === 'F' || P === 'FU' || P === 'OL') return { cat: 'Perlindungan', type: diag.length ? 'Kontak overload' : box ? 'Fius / overload' : 'Perlindungan' };
    if (P === 'FS' || P === 'S' || P === 'SB' || P === 'PB' || P === 'SW' || P === 'LS' || P === 'PS') return { cat: 'Suis & kontak', type: P === 'FS' ? 'Suis apung' : 'Suis' };
    if (diag.length) return { cat: 'Suis & kontak', type: 'Kontak' };
    if (box && (P === 'K' || P === 'C' || P === 'KM' || P === 'KA' || P === 'R' || P === 'T')) return { cat: 'Kontaktor & relay', type: P === 'T' ? 'Gegelung pemasa' : 'Gegelung' };
    if (P === 'K' || P === 'C' || P === 'KM' || P === 'R') return { cat: 'Kontaktor & relay', type: 'Kontaktor' };
    if (P === 'X' || P === 'TB' || (circles.length && circles.every(c => c.r < 1.2))) return { cat: 'Bumi & terminal', type: 'Terminal' };
    if (box) return { cat: 'Lain-lain', type: 'Kotak' };
    return { cat: 'Lain-lain', type: 'Simbol' };
  }

  // three or more stacked horizontal bars, centred, getting shorter downwards
  function isEarth(segs) {
    const hor = segs.filter(s => Math.abs(s[1] - s[3]) < 0.05 && len(s) > 0.5)
      .map(s => ({ y: s[1], l: len(s), c: (s[0] + s[2]) / 2 })).sort((a, b) => b.y - a.y);
    if (hor.length < 3 || hor.length > 5) return false;
    for (let i = 1; i < hor.length; i++) {
      if (hor[i].l >= hor[i - 1].l - 0.2 || Math.abs(hor[i].c - hor[0].c) > 0.3 || hor[i - 1].y - hor[i].y > 2.5) return false;
    }
    return true;
  }

  // Orientation-independent fingerprint (8 rotations/mirrors), 0.5 mm grid.
  function signature(ents) {
    const segs = [], circ = [], txt = [];
    for (const e of ents) {
      if (e.t === 'text') txt.push(String(e.s).trim());
      else if (e.t === 'circle') circ.push([e.cx, e.cy, e.r]);
      else segs.push(...segsOf(e));
    }
    const bb = bboxOfSegs(segs.concat(circ.map(c => [c[0] - c[2], c[1] - c[2], c[0] + c[2], c[1] + c[2]])));
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const q = v => Math.round(v * 2);
    const T = [(x, y) => [x, y], (x, y) => [-y, x], (x, y) => [-x, -y], (x, y) => [y, -x], (x, y) => [-x, y], (x, y) => [y, x], (x, y) => [x, -y], (x, y) => [-y, -x]];
    let best = null;
    for (const f of T) {
      const toks = segs.map(s => {
        const a = f(s[0] - cx, s[1] - cy), b = f(s[2] - cx, s[3] - cy);
        const A = q(a[0]) + ',' + q(a[1]), B = q(b[0]) + ',' + q(b[1]);
        return A < B ? A + '-' + B : B + '-' + A;
      });
      for (const c of circ) { const p = f(c[0] - cx, c[1] - cy); toks.push('c' + q(p[0]) + ',' + q(p[1]) + ',' + q(c[2])); }
      const s = [...new Set(toks)].sort().join(';');
      if (best === null || s < best) best = s;
    }
    return best + '|' + txt.sort().join(',');
  }

  function bounds(ents) {
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const e of ents) {
      const b = e.t === 'text' ? textBox(e) : bboxOfSegs(segsOf(e));
      bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])];
    }
    return bb;
  }

  const api = { detect, signature, bounds, CATEGORIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SymbolCapture = api;
})(typeof window !== 'undefined' ? window : globalThis);
