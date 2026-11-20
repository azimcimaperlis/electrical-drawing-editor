/* Electrical symbol library (IEC style). Units mm, Y up.
 * Each symbol: pins on the Y axis, top pin at (0,0), body extends downwards. */
(function (root) {
  'use strict';
  const L = (x1, y1, x2, y2, o) => Object.assign({ t: 'line', x1, y1, x2, y2 }, o || {});
  const C = (cx, cy, r, o) => Object.assign({ t: 'circle', cx, cy, r }, o || {});
  const A = (cx, cy, r, a1, a2) => ({ t: 'arc', cx, cy, r, a1, a2 });
  const T = (x, y, s, h, o) => Object.assign({ t: 'text', x, y, s, h: h || 2.33, rot: 0 }, o || {});
  const R = (x0, y0, x1, y1) => ({ t: 'pline', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
  const D = { dash: true };
  const lbl = (s, y) => T(-2.6, y == null ? -5.8 : y, s, 2.33, { align: 'right' });

  // building blocks
  const no = (x) => [L(x, 0, x, -3), L(x, -7, x, -10), L(x, -7, x - 1.7, -2.6)];
  const nc = (x) => [L(x, 0, x, -3), L(x, -3, x + 2, -3), L(x, -7, x, -10), L(x, -7, x + 2.3, -2.5)];
  const pbHead = (y) => [L(-0.9, y, -5, y, D), L(-5, y + 1.1, -5, y - 1.1)];

  const list = [
    { id: 'no', cat: 'Suis & kontak', name: 'Kontak NO', draw: () => [...no(0), lbl('K1')] },
    { id: 'nc', cat: 'Suis & kontak', name: 'Kontak NC', draw: () => [...nc(0), lbl('K1')] },
    { id: 'coil', cat: 'Kontaktor & relay', name: 'Gegelung kontaktor / relay', draw: () => [L(0, 0, 0, -3.25), R(-3, -3.25, 3, -6.75), L(0, -6.75, 0, -10), T(-3.6, -5.8, 'K1', 2.33, { align: 'right' })] },
    { id: 'timer', cat: 'Kontaktor & relay', name: 'Gegelung pemasa (timer)', draw: () => [L(0, 0, 0, -3.25), R(-3, -3.25, 3, -6.75), L(-3, -3.25, -1.6, -6.75), L(-1.6, -3.25, -3, -6.75), L(0, -6.75, 0, -10), T(-3.6, -5.8, 'T1', 2.33, { align: 'right' })] },
    { id: 'pbno', cat: 'Suis & kontak', name: 'Butang tekan ON (NO)', draw: () => [...no(0), ...pbHead(-4.8), T(-5.6, -8.2, 'ON', 2.33, { align: 'right' })] },
    { id: 'pbnc', cat: 'Suis & kontak', name: 'Butang tekan OFF (NC)', draw: () => [...nc(0), L(1.2, -4.8, -5, -4.8, D), L(-5, -3.7, -5, -5.9), T(-5.6, -8.2, 'OFF', 2.33, { align: 'right' })] },
    { id: 'sel', cat: 'Suis & kontak', name: 'Suis pemilih', draw: () => [...no(0), L(-0.9, -4.8, -5, -4.8, D), L(-5, -4.8, -5.8, -3.6), L(-5, -4.8, -5.8, -6), T(-6.4, -8.2, 'S1', 2.33, { align: 'right' })] },
    { id: 'float', cat: 'Suis & kontak', name: 'Suis apung (float)', draw: () => [...no(0), L(-0.9, -4.8, -4.2, -4.8, D), C(-5.2, -4.8, 1), T(-6.6, -8.2, 'FS1', 2.33, { align: 'right' })] },
    { id: 'fuse', cat: 'Perlindungan', name: 'Fius', draw: () => [L(0, 0, 0, -10), R(-1, -2.5, 1, -7.5), lbl('F1')] },
    { id: 'mcb', cat: 'Perlindungan', name: 'MCB 1 kutub', draw: () => [L(0, 0, 0, -3), L(-0.6, -2.4, 0.6, -3.6), L(-0.6, -3.6, 0.6, -2.4), L(0, -7, 0, -10), L(0, -7, -1.7, -2.6), lbl('Q1')] },
    { id: 'mccb3', cat: 'Perlindungan', name: 'MCCB / pemencil 3 kutub', draw: () => {
      const e = [];
      for (const x of [0, 4, 8]) e.push(L(x, 0, x, -3), L(x - 0.6, -2.4, x + 0.6, -3.6), L(x - 0.6, -3.6, x + 0.6, -2.4), L(x, -7, x, -10), L(x, -7, x - 1.7, -2.6));
      e.push(L(-0.85, -4.8, 7.15, -4.8, D), lbl('Q01', -5.8));
      return e;
    } },
    { id: 'cont3', cat: 'Kontaktor & relay', name: 'Kontaktor 3 kutub', draw: () => {
      const e = [];
      for (const x of [0, 4, 8]) e.push(L(x, 0, x, -3), A(x + 0.6, -3, 0.6, 180, 360), L(x, -7, x, -10), L(x, -7, x - 1.7, -2.6));
      e.push(L(-0.85, -4.8, 7.15, -4.8, D), lbl('C01', -5.8));
      return e;
    } },
    { id: 'ol3', cat: 'Perlindungan', name: 'Overload terma 3 kutub', draw: () => {
      const e = [R(-1.5, -3, 9.5, -7)];
      for (const x of [0, 4, 8]) e.push(L(x, 0, x, -3.8), L(x, -3.8, x + 1, -3.8), L(x + 1, -3.8, x + 1, -6.2), L(x + 1, -6.2, x, -6.2), L(x, -6.2, x, -10));
      e.push(lbl('F01', -5.8));
      return e;
    } },
    { id: 'olnc', cat: 'Perlindungan', name: 'Kontak overload (NC)', draw: () => [...nc(0), L(1.2, -4.8, -2.5, -4.8, D), L(-2.5, -4.8, -2.5, -4), L(-2.5, -4, -3.5, -4), L(-3.5, -4, -3.5, -5.6), L(-3.5, -5.6, -4.5, -5.6), L(-4.5, -5.6, -4.5, -4.8), T(-5.2, -8.2, 'F01', 2.33, { align: 'right' })] },
    { id: 'motor', cat: 'Motor & beban', name: 'Motor 3 fasa', draw: () => [L(-3, 0, -3, -4.3), L(0, 0, 0, -3), L(3, 0, 3, -4.3), C(0, -8, 5), T(0, -8, 'M', 3.5, { align: 'center' }), T(0, -11, '3~', 2.33, { align: 'center' }), T(0, -15.5, 'MOTOR', 2.33, { align: 'center' })] },
    { id: 'lamp', cat: 'Lampu & penunjuk', name: 'Lampu penunjuk', draw: () => [L(0, 0, 0, -3), C(0, -5, 2), L(-1.414, -3.586, 1.414, -6.414), L(-1.414, -6.414, 1.414, -3.586), L(0, -7, 0, -10), T(-2.6, -5.8, 'H1', 2.33, { align: 'right' })] },
    { id: 'trafo', cat: 'Transformer & bekalan', name: 'Transformer', draw: () => [L(0, 0, 0, -2), C(0, -4.6, 2.6), C(0, -8.4, 2.6), L(0, -11, 0, -13), T(-3.2, -7, 'TR1', 2.33, { align: 'right' })] },
    { id: 'earth', cat: 'Bumi & terminal', name: 'Bumi (earth)', draw: () => [L(0, 0, 0, -3), L(-2, -3, 2, -3), L(-1.3, -3.8, 1.3, -3.8), L(-0.6, -4.6, 0.6, -4.6)] },
    { id: 'term', cat: 'Bumi & terminal', name: 'Terminal', draw: () => [C(0, 0, 0.6)] },
    { id: 'dot', cat: 'Bumi & terminal', name: 'Titik sambungan', draw: () => [C(0, 0, 0.5, { fill: '#000000' })] },
    { id: 'label', cat: 'Teks & label', name: 'Nombor wayar', draw: () => [T(0.8, 0, '1101', 2.33)] }
  ];
  root.Symbols = list;
})(window);
