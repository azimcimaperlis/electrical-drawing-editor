/* DXF (R12), PDF and ZIP writers. Model: mm, Y up. */
(function (root) {
  'use strict';
  const MM = 72 / 25.4;
  const DXF_TEXT_RATIO = 0.75; // model text size (em) -> AutoCAD text height

  const ACI = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [7, 0, 0, 0], [8, 128, 128, 128], [30, 255, 127, 0]];
  function aci(hex) {
    if (!hex || hex === 'none') return 7;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    let best = 7, bd = 1e9;
    for (const c of ACI) { const d = (c[1] - r) ** 2 + (c[2] - g) ** 2 + (c[3] - b) ** 2; if (d < bd) { bd = d; best = c[0]; } }
    return best;
  }
  const f = v => (Math.round(v * 10000) / 10000).toString();

  function extents(doc) {
    return { x0: 0, y0: 0, x1: doc.sheet.w, y1: doc.sheet.h };
  }

  function toDXF(doc, measure) {
    const o = [];
    const g = (c, v) => { o.push(String(c)); o.push(String(v)); };
    const ex = extents(doc);
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252');
    g(9, '$INSBASE'); g(10, 0); g(20, 0); g(30, 0);
    g(9, '$EXTMIN'); g(10, f(ex.x0)); g(20, f(ex.y0)); g(30, 0);
    g(9, '$EXTMAX'); g(10, f(ex.x1)); g(20, f(ex.y1)); g(30, 0);
    g(9, '$LIMMIN'); g(10, f(ex.x0)); g(20, f(ex.y0));
    g(9, '$LIMMAX'); g(10, f(ex.x1)); g(20, f(ex.y1));
    g(9, '$LTSCALE'); g(40, 1);
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
    g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __'); g(72, 65); g(73, 2); g(40, 1.5); g(49, 1); g(49, -0.5);
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, 1);
    g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'STYLE'); g(70, 2);
    g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'simplex.shx'); g(4, '');
    g(0, 'STYLE'); g(2, 'TIMES'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'times.ttf'); g(4, '');
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'BLOCKS'); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    const head = (type, e) => { g(0, type); g(8, '0'); if (e.dash) g(6, 'DASHED'); const c = aci(e.color); if (c !== 7) g(62, c); };
    const line = (e, x1, y1, x2, y2) => { head('LINE', e); g(10, f(x1)); g(20, f(y1)); g(30, 0); g(11, f(x2)); g(21, f(y2)); g(31, 0); };
    for (const e of doc.entities) {
      if (e.t === 'line') line(e, e.x1, e.y1, e.x2, e.y2);
      else if (e.t === 'path') { for (let i = 0; i < e.segs.length; i += 4) line(e, e.segs[i], e.segs[i + 1], e.segs[i + 2], e.segs[i + 3]); }
      else if (e.t === 'circle') { head('CIRCLE', e); g(10, f(e.cx)); g(20, f(e.cy)); g(30, 0); g(40, f(e.r)); }
      else if (e.t === 'arc') { head('ARC', e); g(10, f(e.cx)); g(20, f(e.cy)); g(30, 0); g(40, f(e.r)); g(50, f(e.a1)); g(51, f(e.a2)); }
      else if (e.t === 'pline') {
        const ee = Object.assign({}, e, { color: e.color && e.color !== 'none' ? e.color : e.fill });
        head('POLYLINE', ee); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, e.closed ? 1 : 0);
        for (const p of e.pts) { g(0, 'VERTEX'); g(8, '0'); g(10, f(p[0])); g(20, f(p[1])); g(30, 0); }
        g(0, 'SEQEND'); g(8, '0');
      } else if (e.t === 'text') {
        head('TEXT', e);
        g(10, f(e.x)); g(20, f(e.y)); g(30, 0);
        g(40, f(e.h * DXF_TEXT_RATIO));
        g(1, dxfStr(e.s));
        if (e.rot) g(50, f(e.rot));
        if (e.font === 'serif') g(7, 'TIMES');
        const al = e.align === 'center' ? 1 : e.align === 'right' ? 2 : 0;
        if (al) { g(72, al); g(11, f(e.x)); g(21, f(e.y)); g(31, 0); }
      }
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }
  function dxfStr(s) { return String(s).replace(/[^\x20-\xff]/g, '?'); }

  // ---------------- PDF ----------------
  function pdfStr(s) {
    let o = '';
    for (const ch of String(s)) {
      let c = ch.charCodeAt(0);
      if (c > 255 || ch.length > 1) c = 63;
      if (c === 40 || c === 41 || c === 92) o += '\\' + String.fromCharCode(c);
      else if (c < 32) o += ' ';
      else o += String.fromCharCode(c);
    }
    return o;
  }
  function rgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b].map(v => v.toFixed(3)).join(' ');
  }
  function arcBez(cx, cy, r, a1, a2, first) { // degrees CCW, a2 > a1
    let o = '';
    let n = Math.max(1, Math.ceil((a2 - a1) / 90));
    const step = (a2 - a1) / n * Math.PI / 180;
    let a = a1 * Math.PI / 180;
    const k = 4 / 3 * Math.tan(step / 4);
    const P = (x, y) => (x * MM).toFixed(3) + ' ' + (y * MM).toFixed(3);
    if (first) o += P(cx + r * Math.cos(a), cy + r * Math.sin(a)) + ' m\n';
    for (let i = 0; i < n; i++) {
      const b = a + step;
      const x0 = cx + r * Math.cos(a), y0 = cy + r * Math.sin(a), x3 = cx + r * Math.cos(b), y3 = cy + r * Math.sin(b);
      o += P(x0 - k * r * Math.sin(a), y0 + k * r * Math.cos(a)) + ' ' + P(x3 + k * r * Math.sin(b), y3 - k * r * Math.cos(b)) + ' ' + P(x3, y3) + ' c\n';
      a = b;
    }
    return o;
  }
  function toPDF(doc, measure) {
    const P = (x, y) => (x * MM).toFixed(3) + ' ' + (y * MM).toFixed(3);
    let c = '1 J 1 j 0.71 w 0 0 0 RG 0 0 0 rg\n';
    let curStroke = '#000000', dash = false;
    const setS = e => {
      const col = e.color && e.color !== 'none' ? e.color : '#000000';
      if (col !== curStroke) { c += rgb(col) + ' RG\n'; curStroke = col; }
      if (!!e.dash !== dash) { dash = !!e.dash; c += dash ? '[4.25 2.13] 0 d\n' : '[] 0 d\n'; }
    };
    const fonts = { sans: 'F1', 'sans-b': 'F2', serif: 'F3', 'serif-b': 'F4', 'serif-i': 'F5', 'sans-i': 'F6' };
    for (const e of doc.entities) {
      if (e.t === 'line') { setS(e); c += P(e.x1, e.y1) + ' m ' + P(e.x2, e.y2) + ' l S\n'; }
      else if (e.t === 'path') { setS(e); for (let i = 0; i < e.segs.length; i += 4) c += P(e.segs[i], e.segs[i + 1]) + ' m ' + P(e.segs[i + 2], e.segs[i + 3]) + ' l\n'; c += 'S\n'; }
      else if (e.t === 'circle') {
        const path = arcBez(e.cx, e.cy, e.r, 0, 360, true) + 'h\n';
        if (e.fill && e.fill !== 'none') {
          const hasStroke = e.color && e.color !== 'none';
          if (hasStroke) setS(e);
          c += rgb(e.fill) + ' rg\n' + path + (hasStroke ? 'B\n' : 'f\n');
        }
        else { setS(e); c += path + 'S\n'; }
      } else if (e.t === 'arc') {
        let a2 = e.a2; while (a2 <= e.a1) a2 += 360;
        setS(e); c += arcBez(e.cx, e.cy, e.r, e.a1, a2, true) + 'S\n';
      } else if (e.t === 'pline') {
        let p = P(e.pts[0][0], e.pts[0][1]) + ' m\n';
        for (let i = 1; i < e.pts.length; i++) p += P(e.pts[i][0], e.pts[i][1]) + ' l\n';
        if (e.closed) p += 'h\n';
        const hasStroke = e.color !== 'none';
        if (e.fill && e.fill !== 'none') { c += rgb(e.fill) + ' rg\n'; if (hasStroke) setS(e); c += p + (hasStroke ? 'B\n' : 'f\n'); }
        else { setS(e); c += p + 'S\n'; }
      } else if (e.t === 'text') {
        const key = (e.font === 'serif' ? 'serif' : 'sans') + (e.bold ? '-b' : e.italic ? '-i' : '');
        const fk = fonts[key] || 'F1';
        const a = (e.rot || 0) * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
        let x = e.x, y = e.y;
        if (e.align === 'center' || e.align === 'right') {
          const w = measure(e) * (e.align === 'center' ? 0.5 : 1);
          x -= w * cs; y -= w * sn;
        }
        const col = e.color && e.color !== 'none' ? e.color : '#000000';
        c += 'BT ' + rgb(col) + ' rg /' + fk + ' ' + (e.h * MM).toFixed(3) + ' Tf ' + [cs, sn, -sn, cs].map(v => v.toFixed(5)).join(' ') + ' ' + P(x, y) + ' Tm (' + pdfStr(e.s) + ') Tj ET\n';
      }
    }
    const W = (doc.sheet.w * MM).toFixed(2), H = (doc.sheet.h * MM).toFixed(2);
    const fontNames = ['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Times-Bold', 'Times-Italic', 'Helvetica-Oblique'];
    const objs = [];
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    const fontRefs = fontNames.map((n, i) => '/F' + (i + 1) + ' ' + (5 + i) + ' 0 R').join(' ');
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Contents 4 0 R /Resources << /Font << ' + fontRefs + ' >> >> >>');
    objs.push('<< /Length ' + c.length + ' >>\nstream\n' + c + 'endstream');
    for (const n of fontNames) objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /' + n + ' /Encoding /WinAnsiEncoding >>');
    objs.push('<< /Title (' + pdfStr(doc.name || 'drawing') + ') /Producer (Editor Lukisan Elektrik) >>');
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    for (const off of offs) out += String(off).padStart(10, '0') + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info ' + objs.length + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }

  // ---------------- ZIP (store) ----------------
  let crcT = null;
  function crc32(b) {
    if (!crcT) { crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true); cd.setUint32(42, off, true);
      central.push(new Uint8Array(cd.buffer), name);
      off += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  root.Exporters = { toDXF, toPDF, zip, DXF_TEXT_RATIO };
})(window);
