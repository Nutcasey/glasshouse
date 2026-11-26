| Scenario | Measure | main | this branch |
|---|---|---|---|
| Return | Catalogue reply, ms | 512 (504 to 657) | 35 (33 to 39) |
| Return | Channel guide reply, ms | 526 (520 to 533) | 24 (18 to 31) |
| Return | What is on (/now) reply, ms | 18 (13 to 26) | 55 (48 to 64) |
| Return | Row redraws (render calls) | 4 (4 to 6) | 2 (1 to 2) |
| Return | Time in render, ms | 46 (44 to 156) | 28 (14 to 78) |
| Return | luna-send started (all, background included) | 24 (23 to 26) | 20 (14 to 22) |
| Return | Worst frame, ms | 17 (17 to 100) | 33 (17 to 50) |
| Cold start | Navigation to first frame, ms | 360 (333 to 530) | 296 (283 to 350) |
| Cold start | First render, ms | 104 (92 to 112) | 100 (89 to 118) |
| Cold start | Rows replaced after first paint | 10 (5 to 10) | 2 |
| Cold start | Longest task, ms | 141 (125 to 160) | 74 (52 to 82) |
| Cold start | Frames over 33 ms | 2 (2 to 3) | 1 (1 to 2) |
| Cold start | Worst frame, ms | 167 (133 to 250) | 117 (83 to 150) |
| Recent apps | Frames over 33 ms | 6 | 4 (3 to 7) |
| Recent apps | Worst frame, ms | 100 (100 to 133) | 100 (100 to 117) |
| Change rows | Frames over 33 ms | 3 (1 to 3) | 2 (0 to 4) |
| Change rows | Worst frame, ms | 50 (50 to 83) | 67 (17 to 83) |
| Change rows | applyFocus longest, ms | 30 (19 to 38) | 24 (0 to 35) |
| Scroll (36 keys) | Frames over 33 ms | 0 | 0 (0 to 2) |
| Scroll (36 keys) | Worst frame, ms | 17 | 17 (17 to 83) |
| Scroll (36 keys) | applyFocus average, ms | 5.6 (5.4 to 5.6) | 5.4 (5.2 to 5.9) |
| Single steps | Worst frame, ms | 17 (17 to 33) | 25 (17 to 50) |

runs: scroll 5/5, steps 5/4, rows 7/5, recents 5/5, return 5/5, cold 5/5
