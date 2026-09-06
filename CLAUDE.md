# CLAUDE.md

Project guidance for Claude Code. Read this before making changes. `ARCHITECTURE.md` is
the exhaustive companion — every DB model/field, every route and Server Action, every
`lib/` function — read it when you need the detail this file deliberately omits.

## Project

**School Bag Planner** — a web app that helps Thai elementary school students pack their
school bag correctly based on their class timetable.

Three user roles, one shared timetable:

- **Student** — sees "what do I need tomorrow", scans a QR sticker on each book to confirm
  it is packed, earns points, redeems rewards.
- **Teacher** — views the timetable (read-only — see Roadmap) and manages required items,
  marks which workbooks they have collected for grading, sees who packed and who did not.
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
| QR scanning | `@zxing/browser` | decodes in the browser (`components/qr-scanner.tsx`, shared by student packing scan and teacher "scan to bind"); the resolved code is still sent to the server to record/bind — never trust a client-reported result as-is |
| QR generation | `qrcode` + PDF layout for printable sheets | spare codes or print-and-bind (`lib/qr.ts`'s `generateAndBindCodesForClassroom`, always via `bindCode` — no separate authorization path); `components/sticker-sheet.tsx` handles millimetre-exact sticker presets and printing |
| Push | `web-push` (VAPID) + a service worker (`public/sw.js`) | evening reminder; sending is triggered by an external scheduler hitting `/api/cron/reminders` |
| Photo storage | `@aws-sdk/client-s3` behind `lib/photo-storage.ts`'s `PhotoStorage` interface | local disk (dev default) or S3-compatible object storage (`PHOTO_STORAGE_DRIVER=s3` — AWS S3/Cloudflare R2/GCS) for packing-scan photos; local disk does not survive a redeploy, so any real deployment needs `s3` |
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

A wrong password is throttled by **exponential backoff per student** (1s, 2s, 4s, 8s, ...
capped at 60s, decaying after a quiet period), never a hard account lock — student codes
are 6 digits and children share them with classmates as a matter of course, so a hard lock
(the original design: 5 failures → 15-minute lock) let any classmate deny the real owner
access for 15 minutes just by mashing the wrong PIN. A correct password always succeeds
immediately regardless of any pending cooldown. Code enumeration across *different*
accounts is throttled separately, per client IP (`lib/rate-limit.ts`, wired in at
`app/login/student-actions.ts`) — independent of the per-student backoff, since neither
alone stops the other attack shape.

## Domain model

```
School.{packing_window_start_hour, packing_window_end_hour, session_ttl_minutes,
        points_per_completion, morning_window_start_minute,
        morning_window_end_minute} # per-school anti-cheat/points tuning, defaults
                                    # match what was previously hardcoded — see
                                    # "Anti-cheat" below. The morning pair is
                                    # minutes-since-midnight, not an hour, since
                                    # 07:30 needs half-hour precision
School ─< Classroom ─< Enrollment >─ Student
Classroom.homeroom_teacher_id       # nullable; sees every subject in that classroom,
                                    # and is the only one who may link a parent or
                                    # reissue a student's login (others are subject-scoped)
Student >─ Guardianship ─< Parent
Teacher ─< TeachingAssignment >─ Classroom, Subject

School ─< Subject ─< SubjectItem    # "Math P.4 workbook" — the abstract item; catalog is
                                    # per-school, never cross-school (Subject cascades to
                                    # TimetableSlot, SubjectItem cascades to ItemCopy)
                                    # archived_at on both — hidden from the catalog UI and
                                    # from new assignment, but an existing ItemCopy still
                                    # resolves in requiredItemsFor (see ARCHITECTURE.md §3.3)
SubjectItem.for_exam                # this subject's exam-day item (2B pencil, eraser,
                                    # ruler) vs. its normal item (the workbook) — an
                                    # EXAM exception requires the for_exam ones instead
                                    # of the normal ones for that subject that day, never
                                    # both (see ARCHITECTURE.md §3.3 for why this was
                                    # chosen over a school-level exam kit)
ItemCopy(subject_item_id, student_id, state, active_qr_code)
                                    # the physical copy owned by one student
QRCode(code PK, state, item_copy_id?)

School ─< Term(school_id, name, start_date, end_date)
                                    # terms for one school must not overlap (app-enforced,
                                    # lib/terms.ts's createTerm) — resolves via termFor(date)
                                    # exactly like enrollmentFor(date) resolves an Enrollment
Term ─< TimetableSlot(term_id, classroom_id, subject_id, weekday, period)
                                    # scoped to a term, not a bare weekday+period — invariant 6
ScheduleException(date, kind, ...)  # holiday, swapped period, exam

PackingSession(student_id, for_date, status, started_at, completed_at, points_awarded,
               continuous, started_by_user_id)
                                    # continuous: false once this session's checks include
                                    # ones carried forward from an earlier session that
                                    # expired for the same for_date — the TTL resets
                                    # the clock, never discards progress
                                    # started_by_user_id: null for the ordinary student-run
                                    # flow; the homeroom teacher's userId for
                                    # lib/packing.ts's recordTeacherScan — the teacher-run
                                    # packing flow for students with no phone at home
                                    # (invariant 7's audit trail, same pattern as
                                    # PointLedger.actor_user_id below)
PackingCheck(session_id, item_copy_id, method, photo_path)
                                    # photo_path is private, on-disk, never a public URL

PointLedger(student_id, delta, reason, ref_id, actor_user_id, note, created_at)
                                    # actor_user_id is the invariant-7 audit trail for a
                                    # teacher override (e.g. MORNING_CHECK_FAIL,
                                    # MANUAL_ADJUST); null for a system-awarded row (e.g.
                                    # PACKING_COMPLETE) — this carries the audit trail
                                    # instead of a verified_by column on PackingCheck
                                    # itself. note is freeform text, set only alongside
                                    # MANUAL_ADJUST (lib/points.ts's manualAdjustPoints
                                    # requires a homeroom teacher to state a reason)
Reward(stock)                       # nullable Int, null = unlimited; decremented inside
                                    # redeem()'s own transaction, never below 0
Redemption                          # Redemption.reward is onDelete: Restrict, not Cascade
                                    # — a PointLedger REDEMPTION row's ref_id points here,
                                    # and PointLedger only cascades from Student, so
                                    # deleting a Reward's Redemptions out from under it
                                    # would dangle that ref_id (breaks invariant 4)
PushSubscription(student_id, endpoint, p256dh, auth)  # Web Push, for the evening reminder
Consent(student_id, scope, version, method, granted_by_parent_id, recorded_by_user_id,
        granted_at, revoked_at)      # PDPA lawful basis (see "Privacy" below) — "active"
                                    # means revoked_at is null AND version matches the
                                    # scope's current version, never just "a row exists"
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

6. **The timetable is not just weekday + period — it's weekday + period *within a term*.**
   Every query for "what is needed on date D" must apply `ScheduleException`, and must
   resolve the `TimetableSlot`s that were actually in effect on D via whichever `Term`
   covers it — never "whatever the timetable currently says." Editing next term's
   timetable must never change the answer for an already-past date; a week view spanning
   a term boundary must resolve each day against its own term. Holidays, swapped periods,
   exam days, and term boundaries are the normal case, not an edge case. `Enrollment`
   already modeled this correctly (`startDate`/`endDate`, resolved per-date); `TimetableSlot`
   did not until `Term` was added — see ARCHITECTURE.md §3.4.

7. **Teachers get manual overrides; students never do.** A teacher can confirm packing,
   unbind a mis-bound code, void a sticker, or manually adjust a student's points
   (`manualAdjustPoints`, homeroom-only, requires a stated reason — see the domain model's
   `PointLedger.note` above). Every override writes an audit row with the acting user.
   There is no student-facing "just tick the box" path — that was explicitly rejected
   during design. The homeroom teacher's own packing flow (`recordTeacherScan`, for
   students without a phone at home — see "Anti-cheat" below) is not an exception to this:
   it still requires a real QR scan of a real book the child is holding, never a manual
   tick, and is itself audited via `PackingSession.started_by_user_id`.

## Authorization

Access is **relationship-based**, not role-based. A `role === 'teacher'` check is not
sufficient: a teacher may only see classrooms they are assigned to, a parent only their own
children, a student only themselves.

Two scoping levels below "classroom" that are easy to get wrong:

- **The curriculum catalog (`Subject`/`SubjectItem`) is scoped per *school*, not per
  classroom, and never cross-school.** Any teacher at the school may manage it — but
  `Subject` cascades to `TimetableSlot`, and `SubjectItem` cascades to `ItemCopy` (which
  cascades to `PackingCheck`), so an unscoped catalog once meant any teacher at any
  school could delete another school's entire timetable and packing history. Fixed via
  `Subject.schoolId` + a school-scoped `can()` check — see ARCHITECTURE.md §3.3/§4.4.
- **A subject teacher only sees/manages item copies (QR bind/rebind/void, the GRADING
  toggle) for subjects they actually teach in that classroom.** The classroom's homeroom
  teacher (`Classroom.homeroomTeacherId`) is the one exception: they see every subject's
  items, and are additionally the *only* one who may link a parent, reissue a student's
  login, or morning-check the bag (`"spot_check"`, deliberately its own `Action`, not a
  reuse of the parent/login one — see ARCHITECTURE.md §4.4) — a subject teacher who isn't
  homeroom is denied all three. Spot-check is homeroom-only on purpose, unlike item-copy
  actions: ครูประจำชั้น checks the whole bag once, not each subject teacher checking only
  their own item — subject-scoping it would show every teacher a partial view of one
  child's bag. See ARCHITECTURE.md §4.4/§4.5/§6.4/§10 — this was tried subject-scoped
  first and reversed; do not "fix" it back.

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

- **Time window** — packing scans only count inside a configured window: an evening one
  (default 18:00–23:59, pack the night before) and a morning one (default 05:00–07:30,
  pack the morning of — a completely normal Thai household routine this app must not make
  impossible). Both resolved server-side from `schoolNow()`, never the client. A scan in
  the morning window targets *today*; a scan in the evening window targets *tomorrow* —
  and because those are always different dates, the two can never double-award the same
  `PackingSession`.
- **Session timer, but not a punishment** — once started, a session has a TTL (default 20
  minutes); outliving it resets the timer, not the student's progress. A prior session's
  scans carry forward onto the next one rather than being discarded, and the completing
  session is just flagged `continuous: false` for the teacher to see. This exists to
  discourage trickling scans across the whole evening, not to punish a child who genuinely
  needed to pause — the real check against faked scans is the next bullet, not this timer.
- **Random morning verification** — teachers spot-check a few students; a mismatch deducts
  points (exactly that day's completion award, never more, and never below a `0` balance)
  and breaks the streak. This is the actual anti-cheat mechanism; the session timer above
  is a weak proxy for it, not a substitute.

Never trust a client-supplied timestamp, session ID, or point delta. Points are awarded by
the server on session completion, never sent by the client. The window/TTL/award/penalty
values themselves are per-school settings (columns on `School`, `lib/school-settings.ts`),
not hardcoded — see ARCHITECTURE.md §3.2/§7.8a.

**Teacher-run packing, for a child with no phone at home** — the evening window above
assumes a smartphone at home, which some families don't have; those children earning no
points makes the reward system visibly single out that inequality in the classroom, which
is worse than not having one. The homeroom teacher (not any subject teacher — same
`edit_student_account` gate as linking a parent or reissuing a login) can open a packing
session on a named student using their own device/camera at the end of the school day. The
child must be present holding the book; the teacher's camera scans the same real QR
sticker a student's own scan would, there is no manual tick. This bypasses the time window
explicitly, via a wholly separate function (`recordTeacherScan`, never a flag on the normal
`recordScan`), and stamps `PackingSession.started_by_user_id` for the audit trail invariant
7 requires — see ARCHITECTURE.md §8.3a.

## Data collection for later CV work

On a packing scan — subject to consent and sampling, both below — capture one camera
frame and store it with the resolved `item_copy_id`. It is unused today. Given enough
time this yields real photos of real books under real classroom lighting, with labels
that are 100% correct because they came from the QR code — the training set for replacing
QR with image recognition later. Do not remove this capture, and do not attempt image
recognition before that data exists.

Two gates, both server-side, both re-checked on every scan regardless of what the client
sends:

- **Consent** — see "Privacy" below. No active `PHOTO_CAPTURE` consent, no photo, full
  stop.
- **Sampling** — capturing *every* scan was the original design and is wrong: over a term
  that's tens of thousands of near-identical photos of the same handful of books, for
  enormous storage/privacy cost and almost no added training value past the first few
  hundred per item. `lib/photo-storage.ts`'s `shouldCapturePhoto` instead samples at
  `PHOTO_SAMPLE_RATE` (default 10%), except a `(student, subjectItem)` pair below
  `PHOTO_MIN_SAMPLES_PER_ITEM` (default 5) stored photos is always captured — the floor
  that keeps coverage even across items instead of only the heavily-scanned ones
  accumulating data.

Storage is pluggable (`PHOTO_STORAGE_DRIVER`: `local` disk for dev, `s3` for any
S3-compatible object store) — see "Privacy" below for why local disk is not an option for
anything meant to survive a redeploy. A captured frame is also downscaled client-side
(640px long edge, JPEG quality 0.7) before it's ever sent, both to keep it under Server
Actions' request-body limit and for a more uniform training set.

## Privacy (PDPA)

This app handles data about minors, including photographs. Treat it as sensitive.

- Photos are private by default; never expose them on a public URL or a guessable path —
  this holds regardless of storage backend: local disk streams through the
  authorization-checked route, S3-compatible storage redirects to a short-lived (60s)
  presigned URL minted only after that same check passes, never a public/permanent one.
- Storage backend: local disk (`var/packing-photos/`) is a **dev-only default**. It is
  lost on every redeploy and on any serverless host, with no backup — the wrong choice for
  data this project explicitly intends to accumulate across a whole term (see "Data
  collection" above). Any real deployment must set `PHOTO_STORAGE_DRIVER=s3`.
- Retention: packing photos are purged after a configurable period (default 90 days).
- Never log a student's full name together with their photo path.
- **Photo capture requires active `Consent` (`lib/consent.ts`'s `hasActiveConsent`), checked
  server-side inside `recordScan` — never inferred from whether the client happened to send
  a frame.** This used to be an unenforced note in this file while the photo pipeline had
  run since Phase 2 with no consent check of any kind — closed by adding a real `Consent`
  model (studentId + scope + version + method + grantedByParentId/recordedByUserId +
  grantedAt/revokedAt). "Active" means `revokedAt` is null *and* `version` matches the
  scope's current version — a revised privacy notice invalidates every prior consent
  without deleting the historical row (bump `CURRENT_CONSENT_VERSION`, never mutate old
  rows). Granting is a guardian's own decision, or the homeroom teacher recording a signed
  paper form for a family that never uses the app — never the student's own, even for
  their own record (a minor can't consent to their own data collection). **Revoking
  deletes every already-stored photo immediately**, not just future capture — see
  `lib/photo-storage.ts`'s `deletePhotosForChecks`, shared with the retention-purge
  script. See ARCHITECTURE.md §3.6a/§7.8c for the full design.
- When adding a feature that collects anything else sensitive about a student, model it as
  a new `ConsentScope` rather than assuming consent — that's the whole reason `Consent` is
  scoped per-purpose instead of one blanket flag.

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

1. `requiredItemsFor(student, date)` with holidays, swapped periods, exam days (a subject's
   `forExam` items instead of its normal item, never both — a plain period swap must not
   trigger this), `GRADING` items, and term boundaries (editing a later term's timetable
   must not change an earlier date's answer; a week view spanning a term boundary must
   resolve each day against its own term).
2. QR lifecycle: bind, void, rebind, and that old checks still resolve correctly.
3. Point ledger arithmetic including reversals.
4. `can()` policy matrix for all four roles against another classroom's data.
5. Photo consent (`hasActiveConsent`): no consent means `recordScan` still succeeds but
   `photoPath` stays null; a version mismatch counts as absent the same as no row at all;
   revoking actually deletes stored files and nulls references, not just stops future
   capture.
6. `recordTeacherScan`: a homeroom teacher's scan awards points to the student and bypasses
   the time window; a non-homeroom subject teacher in the same classroom is denied;
   `PackingSession.started_by_user_id` is recorded for a teacher-run session and stays
   `null` for an ordinary student-run one.
7. `manualAdjustPoints`: a homeroom teacher's adjustment records the delta, note, and
   audit trail and updates the balance (including a negative delta pushing it below `0` —
   unlike the anti-cheat penalty, there is no floor here); a blank reason or a zero delta
   is rejected; a non-homeroom subject teacher is denied.
8. `classroomTodayDashboard`/`bulkSetItemCopyStateForClassroom`: correct packing-status
   counts; `packing` is `null` for a non-homeroom teacher while `collectibleItems` stays
   correctly subject-scoped; a holiday empties `collectibleItems`; an exam day excludes
   that subject's ordinary item (never both); the bulk toggle only touches currently-
   enrolled students' copies and is denied to a teacher who doesn't teach that subject.

## Roadmap

- **Phase 0** ✅ — auth + RBAC, timetable CRUD, "what do I need tomorrow" view, teacher
  dashboard, parent dashboard, workbook grading status. The timetable's teacher-facing
  *edit* path (CRUD, as shipped in Phase 0) was removed later, beyond any phase — see the
  final entry below.
- **Phase 1** ✅ — `QRCode`/`ItemCopy`, sticker bind/rebind/void, printable QR sheet,
  camera scanning (`@zxing/browser`, `/student/scan`). Camera-based binding for the
  teacher's own setup (scan-to-bind + rapid-bind on `/teacher/classrooms/[id]`, reusing
  the same decoder via `components/qr-scanner.tsx`) followed later, beyond the original
  phase scope, once manual code-typing proved impractical at real classroom volume
  (~40 students × 8 items per classroom). Print-and-bind (generate a fresh code and bind
  it to an `ItemCopy` in the same step, so the printed sticker already carries the
  student/item name and no separate binding pass is needed) followed the same pattern,
  for the same reason, on `/teacher/classrooms/[id]/print-qr`.
- **Phase 2** ✅ — `PackingSession` + anti-cheat (`lib/packing.ts`: evening window,
  session TTL), `PointLedger` (`lib/points.ts`), teacher morning spot-check
  (`/teacher/classrooms/[id]/today`). A second, morning packing window (05:00–07:30
  default, targeting *today* rather than tomorrow) followed later, beyond the original
  phase scope, once it was raised that many families pack the bag the morning of rather
  than the night before — the evening-only window made that ordinary routine impossible.
  The TTL/window/award/penalty values themselves moved to per-school settings in the same
  pass, and the evening TTL's default was raised (10 → 20 minutes) after it was found to
  punish slow honest packing far more than it ever caught a cheater. A teacher-run packing
  flow (`recordTeacherScan`, `/teacher/classrooms/[id]/pack/[studentId]`) followed later
  still, beyond the original phase scope, once it was raised that a child with no phone at
  home earns no points at all under the evening-only design — making the reward system
  visibly single out exactly that inequality in the classroom. Homeroom-only, requires the
  child physically present holding the book (invariant 7 — see "Anti-cheat" above), and
  attributed via the new `PackingSession.started_by_user_id`.
- **Phase 3** ✅ (redemption slice) — `Reward`/`Redemption`, student shop
  (`/student/rewards`), teacher fulfillment queue (`/teacher/rewards`). Finite `stock`
  (nullable, `null` = unlimited) followed later, beyond the original phase scope, once it
  was raised that a reward with real-world limited inventory (e.g. 10 physical pencils)
  could otherwise rack up far more `PENDING` redemptions than a teacher could ever fulfill.
  `Redemption.reward`'s `onDelete` was changed `Cascade` → `Restrict` in the same pass, a
  real invariant-4 fix: deleting a `Reward` used to silently delete its `Redemption` rows
  while the `PointLedger` rows that referenced them survived, leaving a dangling `refId`.
  `redeem()`'s `Serializable` transaction correctly aborts one side of a race — but that
  abort used to reach the losing student as a raw database error; `lib/db-retry.ts`'s
  `withSerializableRetry` (generic, reusable by any future Serializable transaction, not
  redemption-specific) now retries it into a clean "แต้มไม่พอ"/"ของรางวัลหมดแล้ว" instead.
- **Phase 4** — not started. Photo capture for its training set has been running since
  Phase 2 landed (`lib/photo-storage.ts`'s `savePhoto`) — do not attempt image recognition
  before enough of that data exists.
- **Beyond any phase** — real Web Push (VAPID) for the evening reminder
  (`lib/push.ts`, `public/sw.js`, `app/api/cron/reminders/route.ts`); the actual
  18:30/20:00 trigger is an external scheduler this repo doesn't control. PDPA photo
  consent (`Consent` model, `lib/consent.ts`) followed later, beyond any phase, closing a
  gap this file had flagged since Phase 0/2 but never enforced: the photo-capture pipeline
  had been running since Phase 2 with no consent check of any kind. `recordScan` now
  checks `hasActiveConsent` before ever storing a photo, a parent can grant/revoke from
  `/parent/[studentId]/consent`, the homeroom teacher can record a paper form for a family
  that never uses the app, and revoking deletes what's already stored, not just future
  capture. The photo pipeline itself was hardened once more after that, still beyond any
  phase: `savePhoto` used to write unconditionally to local disk (lost on every redeploy,
  the opposite of what a term-spanning training set needs) and capture every single
  consented scan (tens of thousands of near-duplicate photos over a term for almost no
  added training value) with no client-side size limit (a raw phone-camera frame could
  exceed Server Actions' 1MB body limit outright). Storage moved behind a `PhotoStorage`
  interface (`lib/photo-storage.ts`) with a local-disk and an S3-compatible
  implementation; capture is now sampled (`shouldCapturePhoto`, default 10%, with a
  per-`(student, subjectItem)` floor so coverage stays even across items); and captured
  frames are downscaled client-side (640px long edge, JPEG quality 0.7) before upload.
  Manual point correction (`manualAdjustPoints`, `lib/points.ts`) landed later still,
  resolving a loose end flagged in ARCHITECTURE.md's known-limitations list: `MANUAL_ADJUST`
  had existed in the `PointReason` enum since Phase 2/3 with no code path ever triggering
  it. Homeroom-only, requires a stated reason (`PointLedger.note`, a new column — the first
  reason value that carries freeform text), and — unlike the automatic anti-cheat
  penalty — has no zero-floor, since a human-reviewed correction may deliberately need to
  go negative. `renameClassroom`/`deleteClassroom`/`transferStudent` (`lib/roster.ts`),
  a second loose end from the same list, were removed outright instead of built out:
  none had a UI entry point, and classroom creation had already been removed from the
  product on the grounds that classroom administration is an out-of-band task — the same
  reasoning was judged to apply to renaming, deleting, and transferring a classroom's
  roster, so keeping only those three "half-alive" would have been inconsistent.
  A per-classroom "today" dashboard (`/teacher/classrooms/[id]/today`, `lib/dashboard.ts`'s
  `classroomTodayDashboard`) landed later still, beyond any phase, once it was raised that
  the teacher-facing UI read as a plain web form rather than something worth opening on a
  tablet — the device teachers actually use most. Combines the existing homeroom-only
  packing/spot-check view with a new subject-scoped workbook-collection panel ("which
  subjects have a period today, has this whole class's copy been collected") — introduces
  no new schema: "collected" is exactly invariant 5's existing `ItemCopy.state = GRADING`,
  read and bulk-written classroom-wide instead of one student at a time. A responsive
  sidebar nav (tablet/desktop) alongside the existing bottom tab bar (phone) landed in the
  same pass, matching a reference the user supplied directly — its first version swapped
  in a wholly different sidebar while inside a classroom, which the user reversed as
  confusing ("sidebar should have only 1 format not changeable"); the sidebar now has one
  fixed shape everywhere, expanding a small nested section for the current classroom
  instead of replacing itself (ARCHITECTURE.md §8.9).
  `/teacher/timetable`'s edit path — a per-cell `<select>`, shipped as part of Phase 0 —
  was removed outright in the same pass, at explicit user request: a real school's actual
  weekly schedule isn't something any assigned teacher should be able to freely rewrite at
  runtime; it's set up out-of-band (imported, or seeded — `prisma/seed.ts` already writes
  `TimetableSlot` rows directly, never through the now-deleted `setTimetableSlot`/
  `clearTimetableSlot`), same precedent as classroom creation/rename/delete two entries up.
  The page is now a read-only weekly grid of colored subject blocks, highlighting only the
  subjects the viewing teacher is actually responsible for
  (`manageableSubjectsInClassroom`) against a muted treatment for everyone else's —
  ARCHITECTURE.md §6.4/§7.17. The roster page's homeroom-sees-every-subject rule
  (immediately below) got a display-only companion in the same spirit right after: a
  `?myOnly=true` toggle so a homeroom teacher who also teaches one subject there can
  narrow "อุปกรณ์การเรียน" to just their own — raised because a math teacher who's also
  homeroom found seeing every other subject's equipment on their own classroom confusing.
  Explicitly **not** a narrowing of homeroom's real access (that was considered and
  rejected as the actual regression the invariant below warns about) — every other
  homeroom-only section is unaffected, and the full view is still the default.

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
