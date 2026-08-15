---
name: change-logger
description: Single-file living change log manager for the STRK20 Privacy Wallet. Use whenever changes, updates, refactors, bug fixes, or new features are made to the codebase. Enforces appending chronologically to WHAT_WE_HAVE_DONE_SO_FAR.md with exact local date, time, and day, categorizing entries as [BIG CHANGE] (with thorough technical explanation) or [SMALL CHANGE].
---

# Change Logger Skill for STRK20 Privacy Wallet

This skill governs how changes are recorded in the repository to maintain an immutable, clear, and comprehensive progress record.

## Non-Negotiable Rules

1. **Single File Only**: All changes MUST be recorded exclusively in `WHAT_WE_HAVE_DONE_SO_FAR.md` at the repository root. Never create duplicate log files (e.g. `CHANGELOG_v2.md`, `updates.md`, etc.).
2. **Chronological Advancement (Append-Only)**: Always append new updates to the **end (bottom)** of `WHAT_WE_HAVE_DONE_SO_FAR.md`. Never overwrite or delete prior historical entries.
3. **Mandatory Header Format**: Every new session or update block must open with the day, date, and local time:
   ```markdown
   ## 📅 <Day>, <Month> <Date>, <Year> — <HH:MM:SS> <Timezone>
   ### <Session or Feature Title>
   ```
4. **Classification & Explanation Requirements**:
   - **`#### 🔴 [BIG CHANGE] — <Title>`**: Used for architectural shifts, new components/services, external SDK integrations, contract updates, security changes, and new features. **MUST include a "Detailed Technical Explanation" section** outlining what changed, why, and how it fits into the STRK20/Starknet system.
   - **`#### 🟢 [SMALL CHANGE] — <Title>`**: Used for minor UI tweaks, typo fixes, small dependency updates, or straightforward styling adjustments.
5. **Always Keep In Sync**: Every code change made in a session must be logged in `WHAT_WE_HAVE_DONE_SO_FAR.md` and committed alongside the code.
