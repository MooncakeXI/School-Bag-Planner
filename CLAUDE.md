# CLAUDE.md

Project guidance for Claude Code. Read this before making changes.

## Project

**School Bag Planner** — a web app that helps Thai elementary school students pack their
school bag correctly based on their class timetable.

Three user roles, one shared timetable:

- **Student** — sees "what do I need tomorrow", scans a QR sticker on each book to confirm
  it is packed, earns points, redeems rewards.
- **Teacher** — manages the timetable and required items, marks which workbooks they have
  collected for grading, sees who packed and who did not.
- **Parent** — read-only monitoring of their own children.

Target users are ~8–12 year olds using a parent's phone. Optimise for **few taps, large
touch targets, no typing**.

## Status

Phase 0 complete (auth, RBAC, timetable, "tomorrow"/weekly views, teacher data
management, dashboard). Phases 1–3 were built ahead of schedule at explicit user
request, after the phase-order rule below was raised and the user chose to override
it anyway: QR bind/rebind/void, printable sheet, and camera scanning (Phase 1);
`PackingSession`, anti-cheat, `PointLedger`, teacher spot-check (Phase 2); rewards
and redemption (Phase 3). Parent dashboard and workbook-grading UI predate this and
were already part of Phase 0. Real Web Push (VAPID) was added for the evening
reminder, beyond what any phase specifies. Phase 4 (CV) has not started, but photo
capture for its training set has been running since Phase 2 landed. See
`## Roadmap` at the bottom.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | strict mode on |
| DB | PostgreSQL | |
| ORM | Prisma | migrations checked in, never `db push` on shared branches |
| Auth | Auth.js with a **database adapter** | see warning below |
| Styling | Tailwind | |
| QR scanning | `@zxing/browser` | decodes in the browser; the resolved code is still sent to the server to record the check — never trust a client-reported result as-is |
| QR generation | `qrcode` + PDF layout for printable sheets | |
| Push | `web-push` (VAPID) + a service worker (`public/sw.js`) | evening reminder; sending is triggered by an external scheduler hitting `/api/cron/reminders` |
| Delivery | PWA (installable, camera via `navigator.mediaDevices`) | no React Native for now |

### Auth warning

Use a **database adapter**, not JWT-only sessions. With JWT-only, `@auth/core` regenerates
`profile.sub` with `crypto.randomUUID()` on every login and the stable user ID is lost.
If you must stay JWT-only, source the stable ID from `account.providerAccountId` inside the
`jwt` callback. Do not silently change this setup.

**Student login is not Google, and not Auth.js's Credentials provider either.** Most
students have no Gmail — a teacher issues a short numeric code + PIN instead (roster page,
`lib/roster.ts`'s `issueStudentCredentials`; only bcrypt hashes are ever persisted). Auth.js's
built-in Credentials provider is JWT-only by design (there's no OAuth `Account` row for the
adapter to persist against), so using it here would silently force JWT for that path and
reintroduce the exact bug above. Instead `lib/student-auth.ts`'s `verifyStudentLogin` writes
a row directly into the same `sessions` table the Prisma adapter itself uses, and
`app/login/student-actions.ts` sets the matching `authjs.session-token` cookie by hand — so
`auth()`/`requireActor()` resolve it exactly like a Google-authenticated session, no
special-casing needed anywhere else. Don't "fix" this by wiring up next-auth's Credentials
provider; that's the regression this works around.

## Domain model

```
School ─< Classroom ─< Enrollment >─ Student
Student >─ Guardianship ─< Parent
Teacher ─< TeachingAssignment >─ Classroom, Subject

Subject ─< SubjectItem              # "Math P.4 workbook" — the abstract item
ItemCopy(subject_item_id, student_id, state, active_qr_code)
                                    # the physical copy owned by one student
QRCode(code PK, state, item_copy_id?)

TimetableSlot(classroom_id, subject_id, weekday, period)
ScheduleException(date, kind, ...)  # holiday, swapped period, exam

PackingSession(student_id, for_date, status, started_at, completed_at, points_awarded)
PackingCheck(session_id, item_copy_id, method, photo_path)
                                    # photo_path is private, on-disk, never a public URL

PointLedger(student_id, delta, reason, ref_id, actor_user_id, created_at)
                                    # actor_user_id is the invariant-7 audit trail for a
                                    # teacher override (e.g. MORNING_CHECK_FAIL); null
                                    # for a system-awarded row (e.g. PACKING_COMPLETE) —
                                    # this carries the audit trail instead of a
                                    # verified_by column on PackingCheck itself
Reward, Redemption
PushSubscription(student_id, endpoint, p256dh, auth)  # Web Push, for the evening reminder
```

## Invariants — do not violate these

These are the decisions the whole design rests on. If a change seems to require breaking
one, stop and ask instead of working around it.

1. **`SubjectItem` and `ItemCopy` stay separate.** "Math P.4 workbook" is an item;
   Manee's specific copy is an `ItemCopy`. Grading state and QR codes attach to the copy,
   never to the item. Do not collapse these into one table.

2. **QR codes carry no data.** A code is an opaque random string (`bk_01J8XQF3M2K`).
   Never encode `student_id`, `subject`, or anything guessable. Codes are pre-printed as
   `UNASSIGNED` and bound to an `ItemCopy` at scan time.

3. **A QR code is replaceable; an `ItemCopy` is not.** Stickers get torn, soaked and lost.
   Superseded codes become `VOID` and a new code binds to the same `ItemCopy`. Historical
   `PackingCheck` rows must still resolve to the correct copy. This is why `QRCode` is its
   own table and not a column.

4. **Points are an append-only ledger.** Never store a `points` integer on `Student`.
   Balance is `SUM(delta)`. Every change needs a `reason` and, where applicable, a
   `ref_id`. Reversals are new negative rows, never deletes or updates.

5. **`ItemCopy.state = GRADING` suppresses the item from the packing list.** If the teacher
   has collected a workbook, the app must not tell the student to bring it. This is the
   single most valuable behaviour in the app — protect it with tests.

6. **The timetable is not just weekday + period.** Every query for "what is needed on date
   D" must apply `ScheduleException`. Holidays, swapped periods and exam days are the
   normal case, not an edge case.

7. **Teachers get manual overrides; students never do.** A teacher can confirm packing,
   unbind a mis-bound code, or void a sticker. Every override writes an audit row with the
   acting user. There is no student-facing "just tick the box" path — that was explicitly
   rejected during design.

## Authorization

Access is **relationship-based**, not role-based. A `role === 'teacher'` check is not
sufficient: a teacher may only see classrooms they are assigned to, a parent only their own
children, a student only themselves.

Implement this as one policy layer:

```ts
can(actor, action, resource): boolean
```

All access decisions go through it. Do **not** scatter `if (user.role === ...)` through
route handlers or components. Every list query must be scoped at the database level too —
never fetch broadly and filter in the UI.

## Anti-cheat

Any point system that children can redeem for real items will be gamed. The goal is not
perfect prevention, it is making cheating more effort than complying.

Enforce server-side:

- **Time window** — packing scans only count inside the configured evening window.
- **Single session** — once started, a session must be completed within a few minutes;
  no scanning items one at a time across the whole evening.
- **Random morning verification** — teachers spot-check a few students; a mismatch deducts
  points and breaks the streak.

Never trust a client-supplied timestamp, session ID, or point delta. Points are awarded by
the server on session completion, never sent by the client.

## Data collection for later CV work

On every packing scan, capture one camera frame and store it with the resolved
`item_copy_id`. It is unused today. After one term this yields thousands of real photos of
real books under real classroom lighting, with labels that are 100% correct because they
came from the QR code — the training set for replacing QR with image recognition later.
Do not remove this capture, and do not attempt image recognition before that data exists.

## Privacy (PDPA)

This app handles data about minors, including photographs. Treat it as sensitive.

- Photos are private by default; never expose them on a public URL or a guessable path.
- Retention: packing photos are purged after a configurable period (default 90 days).
- Never log a student's full name together with their photo path.
- Any real-school deployment requires guardian consent records — do not build features
  that assume consent has been given.

## Conventions

- User-facing strings are **Thai**. Code, identifiers, comments, commit messages, and this
  file are English.
- Dates and scheduling use the school's local timezone (`Asia/Bangkok`). Store UTC,
  convert at the boundary. Never do date arithmetic on a `Date` in local time.
- Server logic lives in `lib/` as plain testable functions; route handlers stay thin.
- Prisma migrations are checked in. Do not edit an applied migration — add a new one.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint
npm run typecheck
npm test
npx prisma migrate dev --name <name>
npx prisma studio
```

Run `npm run typecheck` and `npm test` before declaring a task done.

## Testing priorities

Cover these first — they are where the real logic lives:

1. `requiredItemsFor(student, date)` with holidays, swapped periods, and `GRADING` items.
2. QR lifecycle: bind, void, rebind, and that old checks still resolve correctly.
3. Point ledger arithmetic including reversals.
4. `can()` policy matrix for all four roles against another classroom's data.

## Roadmap

- **Phase 0** ✅ — auth + RBAC, timetable CRUD, "what do I need tomorrow" view, teacher
  dashboard, parent dashboard, workbook grading status.
- **Phase 1** ✅ — `QRCode`/`ItemCopy`, sticker bind/rebind/void, printable QR sheet,
  camera scanning (`@zxing/browser`, `/student/scan`).
- **Phase 2** ✅ — `PackingSession` + anti-cheat (`lib/packing.ts`: evening window,
  session TTL), `PointLedger` (`lib/points.ts`), teacher morning spot-check
  (`/teacher/classrooms/[id]/today`).
- **Phase 3** ✅ (redemption slice) — `Reward`/`Redemption`, student shop
  (`/student/rewards`), teacher fulfillment queue (`/teacher/rewards`).
- **Phase 4** — not started. Photo capture for its training set has been running
  since Phase 2 landed (`lib/packing.ts`'s `savePhoto`) — do not attempt image
  recognition before enough of that data exists.
- **Beyond any phase** — real Web Push (VAPID) for the evening reminder
  (`lib/push.ts`, `public/sw.js`, `app/api/cron/reminders/route.ts`); the actual
  18:30/20:00 trigger is an external scheduler this repo doesn't control.

Do not build a later phase before the one before it works end to end — **unless the
user explicitly asks to override this, as happened here.** When that happens, update
this section to reflect it, the same way this entry does.

## Glossary

| Thai | English | Meaning |
|---|---|---|
| ตารางเรียน | timetable | weekly class schedule |
| คาบ | period | one teaching slot in a day |
| แบบฝึกหัด | workbook | exercise book teachers collect and grade |
| จัดกระเป๋า | packing | the nightly bag-packing task |
| แต้ม | points | reward currency |
| ผู้ปกครอง | guardian / parent | |
