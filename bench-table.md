| Scenario | Measure | main | this branch |
|---|---|---|---|
| Return | Catalogue reply, ms | 512 (504 to 657) | 38 (34 to 56) |
| Return | Channel guide reply, ms | 526 (520 to 533) | 20 (17 to 24) |
| Return | What is on (/now) reply, ms | 18 (13 to 26) | 49 (20 to 54) |
| Return | Row redraws (render calls) | 4 (4 to 6) | 3 (2 to 4) |
| Return | Time in render, ms | 46 (44 to 156) | 50 (22 to 127) |
| Return | luna-send started (all, background included) | 24 (23 to 26) | 22 (13 to 23) |
| Return | Worst frame, ms | 17 (17 to 100) | 33 (17 to 83) |
| Cold start | Navigation to first frame, ms | 360 (333 to 530) | 320 (307 to 367) |
| Cold start | First render, ms | 104 (92 to 112) | 102 (93 to 128) |
| Cold start | Rows replaced after first paint | 10 (5 to 10) | 2 |
| Cold start | Longest task, ms | 141 (125 to 160) | 61 (52 to 86) |
| Cold start | Frames over 33 ms | 2 (2 to 3) | 1 |
| Cold start | Worst frame, ms | 167 (133 to 250) | 117 (100 to 167) |
| Recent apps | Frames over 33 ms | 6 | 7 (3 to 8) |
| Recent apps | Worst frame, ms | 100 (100 to 133) | 117 (100 to 117) |
| Change rows | Frames over 33 ms | 3 (1 to 3) | 2 (0 to 4) |
| Change rows | Worst frame, ms | 50 (50 to 83) | 50 (17 to 67) |
| Change rows | applyFocus longest, ms | 30 (19 to 38) | 26 (1 to 34) |
| Scroll (36 keys) | Frames over 33 ms | 0 | 0 (0 to 1) |
| Scroll (36 keys) | Worst frame, ms | 17 | 17 (17 to 67) |
| Scroll (36 keys) | applyFocus average, ms | 5.6 (5.4 to 5.6) | 5.3 (5.1 to 5.5) |
| Single steps | Worst frame, ms | 17 (17 to 33) | 17 (17 to 67) |

runs: scroll 5/5, steps 5/5, rows 7/5, recents 5/5, return 5/5, cold 5/5
