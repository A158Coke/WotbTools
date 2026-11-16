### follow-mid x1（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before_r1_example_follow-mid_x1 | 2318 | 7.0 | 146 | 243 | 88 | 4 | 0 | 100 | 130 | - | sync | 819 |
| before_r2_example_follow-mid_x1 | 2060 | 7.0 | 188 | 313 | 84 | 19 | 0 | 96 | 144 | - | sync | 819 |
| before_r3_example_follow-mid_x1 | 2066 | 7.0 | 167 | 327 | 99 | 10 | 0 | 99 | 123 | - | sync | 819 |
极差：>100=84–99，>200=4–19，terrain-build=96–100

### follow-mid x6（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before_r1_example_follow-mid_x6 | 75 | 180.5 | 1521 | 1618 | 44 | 37 | 34 | 34 | 696 | - | sync | 819 |
| before_r2_example_follow-mid_x6 | 68 | 111.1 | 1965 | 2798 | 35 | 31 | 29 | 28 | 744 | - | sync | 819 |
| before_r3_example_follow-mid_x6 | 60 | 236.1 | 1361 | 1451 | 43 | 31 | 29 | 28 | 904 | - | sync | 819 |
极差：>100=35–44，>200=31–37，terrain-build=28–34

### rec-ex x1（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before_r1_example_rec-ex_x1 | 1305 | 20.4 | 146 | 250 | 52 | 4 | 0 | 53 | 123 | - | sync | 903 |
| before_r2_example_rec-ex_x1 | 1081 | 20.8 | 222 | 563 | 53 | 16 | 1 | 51 | 122 | - | sync | 911 |
| before_r3_example_rec-ex_x1 | 1066 | 20.8 | 236 | 583 | 50 | 16 | 2 | 48 | 141 | - | sync | 897 |
极差：>100=50–53，>200=4–16，terrain-build=48–53

### rec-ex x6（3 次）
| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before_r1_example_rec-ex_x6 | 120 | 117.9 | 1722 | 1743 | 72 | 34 | 17 | 15 | 852 | - | sync | 899 |
| before_r2_example_rec-ex_x6 | 138 | 76.3 | 1715 | 1826 | 63 | 34 | 18 | 16 | 1215 | - | sync | 904 |
| before_r3_example_rec-ex_x6 | 142 | 76.5 | 1681 | 1910 | 65 | 35 | 17 | 16 | 1029 | - | sync | 902 |
极差：>100=63–72，>200=34–35，terrain-build=15–16

