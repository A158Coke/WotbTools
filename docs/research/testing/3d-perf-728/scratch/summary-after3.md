### follow-mid x1（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after3_r1_example_follow-mid_x1 | 4243 | 6.9 | 14 | 306 | 1 | 1 | 0 | 83 | 103 | 0.20000000298023224 | worker | 819 |
| after3_r2_example_follow-mid_x1 | 4329 | 6.9 | 7 | 243 | 1 | 1 | 0 | 96 | 56 | 0.10000000149011612 | worker | 819 |
| after3_r3_example_follow-mid_x1 | 4332 | 6.9 | 7 | 132 | 1 | 0 | 0 | 99 | 50 | 0.19999999925494194 | worker | 819 |
极差：>100=1–1，>200=0–1，terrain-build=83–99

### follow-mid x6（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after3_r1_example_follow-mid_x6 | 603 | 48.6 | 125 | 320 | 19 | 1 | 0 | 87 | 49 | 1.300000000745058 | worker | 819 |
| after3_r2_example_follow-mid_x6 | 524 | 48.6 | 243 | 410 | 78 | 13 | 1 | 69 | 55 | 1.7000000029802322 | worker | 818 |
| after3_r3_example_follow-mid_x6 | 959 | 27.7 | 111 | 833 | 15 | 2 | 2 | 87 | 41 | 1.5999999977648258 | worker | 819 |
极差：>100=15–78，>200=1–13，terrain-build=69–87

### rec-ex x1（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after3_r1_example_rec-ex_x1 | 3102 | 7.0 | 21 | 153 | 1 | 0 | 0 | 39 | 62 | 0.19999999925494194 | worker | 914 |
| after3_r2_example_rec-ex_x1 | 3092 | 7.0 | 21 | 139 | 1 | 0 | 0 | 39 | 61 | 0.19999999925494194 | worker | 917 |
| after3_r3_example_rec-ex_x1 | 1514 | 20.8 | 42 | 160 | 1 | 0 | 0 | 33 | 123 | 0.20000000298023224 | worker | 914 |
极差：>100=1–1，>200=0–0，terrain-build=33–39

### rec-ex x6（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after3_r1_example_rec-ex_x6 | 426 | 69.4 | 153 | 236 | 44 | 1 | 0 | 33 | 49 | 1 | worker | 917 |
| after3_r2_example_rec-ex_x6 | 590 | 48.6 | 104 | 236 | 7 | 1 | 0 | 42 | 41 | 1.6000000014901161 | worker | 915 |
| after3_r3_example_rec-ex_x6 | 545 | 48.7 | 118 | 347 | 10 | 2 | 0 | 41 | 43 | 1.199999999254942 | worker | 915 |
极差：>100=7–44，>200=1–2，terrain-build=33–42

