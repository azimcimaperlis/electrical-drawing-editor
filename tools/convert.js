// Usage: node tools/convert.js input.pdf output.js [VarName]
// Needs: npm i pdfjs-dist@3.11.174
const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { importPdf } = require(path.join(__dirname, '..', 'js', 'importer.js'));

(async () => {
  const [inp, outp] = process.argv.slice(2);
  if (!inp || !outp) { console.error('Usage: node tools/convert.js input.pdf output.js'); process.exit(1); }
  const data = new Uint8Array(fs.readFileSync(inp));
  const name = path.basename(inp, path.extname(inp));
  const d = await importPdf(pdfjs, data, { name });
  const body = JSON.stringify(d).replace(/\{"t":/g, '\n{"t":');
  if (outp.endsWith('.json')) fs.writeFileSync(outp, body);
  else fs.writeFileSync(outp, 'window.DEFAULT_DRAWING = ' + body + ';\n');
  const c = {}; for (const e of d.entities) c[e.t] = (c[e.t] || 0) + 1;
  console.log(outp, JSON.stringify(c));
})().catch(e => { console.error(e); process.exit(1); });
