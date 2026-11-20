# Editor Lukisan Elektrik

Editor web untuk mengubah lukisan skematik elektrik (contoh: QLWB) tanpa AutoCAD. Buka dalam Chrome/Edge, tiada pemasangan.

## Cara buka
- **Dalam talian:** https://azimcimaperlis.github.io/electrical-drawing-editor/ (GitHub Pages).
- **Luar talian:** muat turun `dist/editor-lukisan.html` dan dwi-klik. Satu fail, berfungsi tanpa internet (kecuali import PDF baru).
- Atau buka `index.html` dari folder repo ini.

Pengguna baru bermula dengan kanvas kosong. Butang **Baru** mengosongkan kanvas bila-bila masa.

## Apa boleh buat
- Tukar teks: dwi-klik teks, atau Cari & ganti (panel kanan).
- Lukis/padam garisan, kotak, bulatan, teks. Snap ke hujung/tengah/pusat, Ortho (F8, atau tahan Ctrl / Shift).
- Simbol elektrik: kontak NO/NC, gegelung, timer, butang tekan, suis pemilih, suis apung, fius, MCB, MCCB 3P, kontaktor 3P, overload, motor 3~, lampu, transformer, bumi, terminal.
- Pilih, alih, salin (dengan titik asas), putar 90°, cermin, kumpul/leraikan, undo/redo.
- **Buka** PDF AutoCAD lain (vektor) — ditukar automatik kepada objek boleh edit.
- **Pustaka simbol:** setiap kali PDF/projek dibuka, simbol elektrik di dalamnya dikesan automatik (bentuk sama dalam mana-mana putaran dikira sekali) dan dicadang untuk disimpan dengan nama + kategori. Simpan sendiri dengan pilih objek → **Simpan pilihan**. Cari ikut nama/kategori; ✎ untuk tukar nama, kategori atau padam.
- Kategori: Suis & kontak, Kontaktor & relay, Perlindungan, Motor & beban, Lampu & penunjuk, Transformer & bekalan, Bumi & terminal, Teks & label, Lain-lain — atau taip kategori sendiri.
- **Eksport PDF** (cetak) dan **Eksport DXF** (R12, buka terus dalam AutoCAD; teks guna `simplex.shx`).
- Kerja dan pustaka simbol disimpan automatik dalam pelayar. Guna **Simpan projek** (.json) untuk simpan fail dan sambung kemudian; **Eksport/Import pustaka** untuk pindah simbol ke komputer lain.

## Pustaka bersama (untuk semua pengguna)
`library/simbol.js` dimuat oleh setiap pengguna. Untuk tambah simbol: **Eksport pustaka** dalam editor, kemudian
`node tools/build_library.js pustaka-simbol.json` dan commit. Simbol berulang dilangkau.

## Pintasan
V pilih · L garis · B kotak · C bulatan · T teks · M alih · Ctrl+D salin · R putar · Delete padam · Ctrl+Z/Y undo/redo · Ctrl+C/V · Ctrl+G kumpul · F zum penuh · F3 snap · F7 grid · F8 ortho · roda tetikus zum · Space/butang tengah pan.

## Struktur
- `index.html`, `css/`, `js/app.js` (editor + pustaka), `js/importer.js` (PDF → objek), `js/capture.js` (kesan simbol), `js/symbols.js` (simbol terbina), `js/exporters.js` (DXF/PDF/ZIP)
- `library/simbol.js` — pustaka simbol bersama; `tools/build_library.js` — gabung/kemas kini pustaka bersama
- `drawings/qlwb.js|json` — lukisan QLWB yang telah ditukar; `source/QLWB.pdf` — PDF asal
- `tools/convert.js` — tukar PDF ke lukisan (`npm i pdfjs-dist@3.11.174` dahulu); `tools/build_single.py` — bina `dist/editor-lukisan.html`

## Had
- Unit mm, skala 1:1 dengan kertas A3. Logo dieksport ke DXF sebagai garisan halus (tanpa isian warna).
- Fon teks dipaparkan sebagai Helvetica/Times; dalam DXF tinggi teks = 0.75 × saiz fon.
