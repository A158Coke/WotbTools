### follow-mid x1（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after_r1_example_follow-mid_x1 | 4086 | 7.0 | 14 | 375 | 1 | 1 | 0 | 86 | 104 | 0.20000000018626451 | worker | 819 |
| after_r2_example_follow-mid_x1 | 4150 | 7.0 | 14 | 306 | 1 | 1 | 0 | 87 | 96 | 0.20000000018626451 | worker | 819 |
| after_r3_example_follow-mid_x1 | 3991 | 7.0 | 20 | 306 | 1 | 1 | 0 | 87 | 114 | 0.20000000018626451 | worker | 819 |
极差：>100=1–1，>200=1–1，terrain-build=86–87

### follow-mid x6（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after_r1_example_follow-mid_x6 | 1920 | 7.0 | 118 | 340 | 32 | 3 | 0 | 82 | 83 | 1.7999999998137355 | worker | 819 |
| after_r2_example_follow-mid_x6 | 3094 | 7.0 | 49 | 340 | 9 | 1 | 0 | 93 | 74 | 0.8999999994412065 | worker | 819 |
| after_r3_example_follow-mid_x6 | 2463 | 7.0 | 97 | 257 | 23 | 1 | 0 | 86 | 78 | 1.7999999998137355 | worker | 819 |
极差：>100=9–32，>200=1–3，terrain-build=82–93

### rec-ex x1（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after_r1_example_rec-ex_x1 | 1922 | 13.9 | 41 | 125 | 1 | 0 | 0 | 43 | 86 | 0.20000000018626451 | worker | 913 |
| after_r2_example_rec-ex_x1 | 2109 | 13.9 | 42 | 139 | 1 | 0 | 0 | 45 | 80 | 0.20000000018626451 | worker | 917 |
| after_r3_example_rec-ex_x1 | 2228 | 13.9 | 34 | 174 | 1 | 0 | 0 | 44 | 76 | 0.20000000018626451 | worker | 917 |
极差：>100=1–1，>200=0–0，terrain-build=43–45

### rec-ex x6（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after_r1_example_rec-ex_x6 | 599 | 20.9 | 257 | 333 | 97 | 26 | 0 | 29 | 78 | 3.7000000001862645 | worker | 913 |
| after_r2_example_rec-ex_x6 | 1601 | 14.0 | 76 | 271 | 10 | 2 | 0 | 51 | 76 | 1.5 | worker | 916 |
| after_r3_example_rec-ex_x6 | 560 | 27.9 | 277 | 354 | 90 | 25 | 0 | 25 | 81 | 2.099999999627471 | worker | 914 |
极差：>100=10–97，>200=2–26，terrain-build=25–51

