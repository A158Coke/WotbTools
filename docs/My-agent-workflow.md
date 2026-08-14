1. 你的需求
   ↓
2. plan-designer
   ↓
3. grill-me
   与你反复确认：
    - business behavior
    - UX
    - edge cases
    - authoritative data source
    - out of scope
      ↓

   ┌──────────────────────────────────────┐
   │ 如果是 UI / UX / BattlePlayback任务    │
   │                                      │
   │ Open Design                          │
   │ → prototype / visual contract        │
   │ → interaction contract               │
   │ → responsive states                  │
   │ → visual invariants                  │
   └──────────────────────────────────────┘
   ↓
4. 写入 current-plan.md
   ↓
5. plan-executor
   ↓
6. 读取 current-plan.md
   ↓
7. 执行真实代码修改
   ↓

   [UI任务]
   Vision Toolkit
   → screenshot verification
   → pixel / alignment / scaling / state verification

   ↓
8. review-with-docs
   ↓
9. 修复内部 review 问题
   ↓
10. blocker = 0
    ↓
11. 开 PR
    ↓
12. ChatGPT / GPT-5.6 Sol 外部 Review
    ↓
    PASS ──────────────→ merge
    │
    FAIL
    ↓
13. GPT 输出针对性 repair prompt
    ↓
14. 贴回 DSH
    ↓
15. DSH 修复 + tests + commit + push
    ↓
16. GPT 再 review
    ↓
17. 重复直到 PASS -> PR合并
    ↓
18. 执行 finish-task skill，清理current-plan.md，切到main分支并更新
    ↓
19. 进入下一个周期    