### follow-mid x1（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after2_r1_example_follow-mid_x1 | 3369 | 7.0 | 29 | 500 | 1 | 1 | 1 | 48 | 343 | 0.30000000074505806 | worker | 819 |
| after2_r2_example_follow-mid_x1 | 3441 | 7.0 | 28 | 299 | 1 | 1 | 0 | 48 | 347 | 0.3999999985098839 | worker | 819 |
| after2_r3_example_follow-mid_x1 | 4149 | 6.9 | 14 | 583 | 2 | 2 | 1 | 90 | 72 | 0.20000000298023224 | worker | 818 |
极差：>100=1–2，>200=1–2，terrain-build=48–90

### follow-mid x6（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after2_r1_example_follow-mid_x6 | 396 | 55.4 | 361 | 1090 | 110 | 34 | 3 | 41 | 287 | 0.5999999977648258 | worker | 819 |
| after2_r2_example_follow-mid_x6 | 609 | 27.7 | 292 | 1132 | 89 | 19 | 4 | 29 | 646 | 1.1000000014901161 | worker | 819 |
| after2_r3_example_follow-mid_x6 | 420 | 55.6 | 271 | 646 | 79 | 18 | 1 | 74 | 52 | 1.800000000745058 | worker | 819 |
极差：>100=79–110，>200=18–34，terrain-build=29–74

### rec-ex x1（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after2_r1_example_rec-ex_x1 | 775 | 34.8 | 83 | 174 | 4 | 0 | 0 | 26 | 280 | 0.30000000074505806 | worker | 914 |
| after2_r2_example_rec-ex_x1 | 1341 | 20.8 | 56 | 188 | 1 | 0 | 0 | 32 | 155 | 0.20000000298023224 | worker | 913 |
| after2_r3_example_rec-ex_x1 | 1898 | 13.9 | 35 | 160 | 1 | 0 | 0 | 34 | 97 | 0.20000000298023224 | worker | 917 |
极差：>100=1–4，>200=0–0，terrain-build=26–34

### rec-ex x6（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after2_r1_example_rec-ex_x6 | 347 | 69.4 | 431 | 639 | 112 | 28 | 4 | 13 | 880 | 0.30000000074505806 | worker | 905 |
| after2_r2_example_rec-ex_x6 | 281 | 76.4 | 444 | 500 | 98 | 50 | 7 | 20 | 141 | 1.3999999985098839 | worker | 908 |
| after2_r3_example_rec-ex_x6 | 131 | 229.1 | 417 | 688 | 128 | 90 | 4 | 13 | 80 | 1.6000000014901161 | worker | 912 |
极差：>100=98–128，>200=28–90，terrain-build=13–20

