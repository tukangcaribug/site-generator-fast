[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/tukangcaribug/site-generator-fast/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/tukangcaribug/site-generator-fast/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

Built for the [make.fun bounty: Build the fastest static site generator](https://make.fun/bounty/site-generator-speed-01-run-20261122).

# site-generator-speed-01-run-20261122

Implementasi makefun-site 1.0.0 yang lebih cepat: generator situs statis (Markdown + frontmatter + template) yang dioptimasi untuk kecepatan, sekitar 3x lebih cepat dari baseline house — grade-local median sekitar 470.000 µs.

## Menjalankan

```bash
MAKEFUN_INPUT_DIR=<dir input> MAKEFUN_OUTPUT_DIR=<dir output> node main.ts
```

`main.ts` memanggil `solve.js`, yang membaca sumber dari `MAKEFUN_INPUT_DIR` dan menulis situs hasil ke `MAKEFUN_OUTPUT_DIR`.

## Catatan

Baseline house (makefun-site) dibaca dari kit, bukan dari repo ini; seluruh optimasi ada di `solve.js` dan `lib/`.
