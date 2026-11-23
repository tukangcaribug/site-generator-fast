# site-generator-speed-01-run-20261122

Implementasi makefun-site 1.0.0 yang lebih cepat: generator situs statis (Markdown + frontmatter + template) yang dioptimasi untuk kecepatan, sekitar 3x lebih cepat dari baseline house — grade-local median sekitar 470.000 µs.

## Menjalankan

```bash
MAKEFUN_INPUT_DIR=<dir input> MAKEFUN_OUTPUT_DIR=<dir output> node main.ts
```

`main.ts` memanggil `solve.js`, yang membaca sumber dari `MAKEFUN_INPUT_DIR` dan menulis situs hasil ke `MAKEFUN_OUTPUT_DIR`.

## Catatan

Baseline house (makefun-site) dibaca dari kit, bukan dari repo ini; seluruh optimasi ada di `solve.js` dan `lib/`.
