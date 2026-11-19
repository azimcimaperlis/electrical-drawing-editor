# Editor Lukisan Elektrik

Editor web untuk mengubah lukisan skematik elektrik (contoh: QLWB) tanpa AutoCAD. Buka dalam Chrome/Edge, tiada pemasangan.

## Cara buka
- **Paling mudah:** muat turun `dist/editor-lukisan.html` dan dwi-klik. Satu fail, berfungsi tanpa internet (kecuali import PDF baru).
- Atau buka `index.html` dari folder repo ini.

## Apa boleh buat
- Tukar teks: dwi-klik teks, atau Cari & ganti (panel kanan).
- Lukis/padam garisan, kotak, bulatan, teks. Snap ke hujung/tengah/pusat, Ortho (F8 / tahan Shift).
- Simbol elektrik: kontak NO/NC, gegelung, timer, butang tekan, suis pemilih, suis apung, fius, MCB, MCCB 3P, kontaktor 3P, overload, motor 3~, lampu, transformer, bumi, terminal.
- Pilih, alih, salin (dengan titik asas), putar 90°, cermin, kumpul/leraikan, undo/redo.
- **Buka** PDF AutoCAD lain (vektor) — ditukar automatik kepada objek boleh edit.
- **Eksport PDF** (cetak) dan **Eksport DXF** (R12, buka terus dalam AutoCAD; teks guna `simplex.shx`).
- Kerja disimpan automatik dalam pelayar. Guna **Simpan projek** (.json) untuk simpan fail dan sambung kemudian.

## Pintasan
V pilih · L garis · B kotak · C bulatan · T teks · M alih · Ctrl+D salin · R putar · Delete padam · Ctrl+Z/Y undo/redo · Ctrl+C/V · Ctrl+G kumpul · F zum penuh · F3 snap · F7 grid · F8 ortho · roda tetikus zum · Space/butang tengah pan.

## Struktur
- `index.html`, `css/`, `js/app.js` (editor), `js/importer.js` (PDF → objek), `js/symbols.js`, `js/exporters.js` (DXF/PDF/ZIP)
- `drawings/qlwb.js|json` — lukisan QLWB yang telah ditukar; `source/QLWB.pdf` — PDF asal
- `tools/convert.js` — tukar PDF ke lukisan (`npm i pdfjs-dist@3.11.174` dahulu); `tools/build_single.py` — bina `dist/editor-lukisan.html`

## Had
- Unit mm, skala 1:1 dengan kertas A3. Logo dieksport ke DXF sebagai garisan halus (tanpa isian warna).
- Fon teks dipaparkan sebagai Helvetica/Times; dalam DXF tinggi teks = 0.75 × saiz fon.
