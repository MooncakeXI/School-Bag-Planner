# Architecture

Deep technical reference for School Bag Planner. `CLAUDE.md` is the terse operating
contract (invariants, conventions, roadmap) — read it first. This document is the
exhaustive companion: every database model and field, every authorization rule, every
route, and every exported function in `lib/`, as they exist on disk today.

## 1. Project Overview

School Bag Planner is a web app that helps Thai elementary school students pack their
school bag correctly, based on their class timetable. One shared timetable, three roles:

- **Student** — sees "what do I need tomorrow", scans a QR sticker on each book/item to
  confirm it's packed, earns points, redeems rewards for physical prizes.
- **Teacher** — manages required items and QR-bound copies for the subject(s) they teach;
  views the timetable (read-only, §6.4/§10) and manages day-to-day `ScheduleException`s
  (holidays, swapped periods, exam days) for their classrooms. The classroom's homeroom
  teacher additionally manages guardianships and student login credentials and sees every
  subject's items, not just their own. Marks which workbooks are collected for grading.
  Spot-checks students' claimed packing each morning.
- **Parent** — read-only monitoring of their own children. Never ticks anything on their
  child's behalf (CLAUDE.md invariant 7 has no student- or parent-facing override path).

Target users are ~8–12-year-olds, usually on a parent's phone. The whole student-facing
surface is built around **few taps, large touch targets, no typing** — the student login
itself is a numeric code + PIN (§5) precisely to avoid requiring an email address or a
keyboard.

**Phase status** (see `CLAUDE.md` §Roadmap for the authoritative statement): Phase 0
(auth, RBAC, timetable, "tomorrow"/weekly views, teacher data management, dashboards) is
done. Phases 1–3 were pulled forward at explicit user request: QR bind/rebind/void +
printable sheet + camera scanning (Phase 1); `PackingSession` anti-cheat + `PointLedger`
+ teacher morning spot-check (Phase 2); `Reward`/`Redemption` (Phase 3). Real Web Push
(VAPID) for the evening reminder was added beyond any phase. Phase 4 (replacing QR
scanning with computer-vision item recognition) has **not started**, but every packing
scan already captures and stores a labeled training photo for it (§8.6) — do not attempt
CV work before that dataset exists, and do not remove the capture.

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), TypeScript strict | Server Components + Server Actions let `lib/` stay the single source of business logic; route files stay thin (CLAUDE.md convention). |
| Database | PostgreSQL | Relational integrity for the roster/enrollment/QR state machine; append-only ledger semantics (§3.9) need real transactions. |
| ORM | Prisma 7, `@prisma/adapter-pg` driver adapter | Migrations checked into `prisma/migrations/`, never `db push` on shared branches. The driver-adapter pattern (`lib/prisma.ts`) is required by Prisma 7's engine model. |
| Auth | Auth.js v5 (`next-auth@beta`) + `@auth/prisma-adapter`, **database session strategy** | See §5 — JWT-only would lose the stable user id across logins. |
| QR scanning | `@zxing/browser` | Decodes in the browser via `components/qr-scanner.tsx`, shared by the student packing scan (§6.2's `ScanView`, §8.3) and the teacher's scan-to-bind/rapid-bind flows (§6.4, §8.2); the decoded string is still sent to the server to resolve/record — a client-reported result is never trusted directly (CLAUDE.md). |
| QR generation | `qrcode` | Server-side SVG generation for the printable sticker sheet (`app/teacher/classrooms/[id]/print-qr`), for both spare codes and print-and-bind codes; `<StickerSheet>` (`components/sticker-sheet.tsx`) handles the millimetre-exact print layout, `app/globals.css`'s `@media print` block owns `@page` sizing and the break-inside-avoid rule Tailwind can't express. |
| Push | `web-push` (VAPID) + `public/sw.js` | Real push notifications for the evening reminder; sending is triggered by an external scheduler hitting `/api/cron/reminders`, not an in-process cron. |
| Photo storage | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, behind `lib/photo-storage.ts`'s `PhotoStorage` interface | Packing-scan photos for future CV (§8.6). Local disk (default) for dev; S3-compatible object storage (AWS S3, Cloudflare R2, GCS's S3-interop mode) via `PHOTO_STORAGE_DRIVER=s3` for anywhere the data needs to actually survive a redeploy. |
| Password hashing | `bcryptjs` | Hashes the student PIN and (indirectly, via Auth.js) nothing else — Google OAuth needs no local password. |
| Dates | `luxon` | All school-day arithmetic goes through `lib/time.ts`; native `Date` local-time arithmetic is explicitly banned (CLAUDE.md). |
| Styling | Tailwind CSS v4 | Utility-first; `lib/utils.ts`'s `cn()` composes `clsx` + `tailwind-merge`, the standard shadcn helper. |
| UI primitives | `@base-ui/react` + `class-variance-authority` + `components/ui/*` | A shadcn-style component library generated on top of Base UI (not Radix). Only the primitives actually used ship in the repo — `badge`, `button`, `card`, `input`, `label`, `table` — unused generated files (`dialog`, `dropdown-menu`, `select`, `tabs`, `separator`, `textarea`, `skeleton`) were deleted as dead code. |
| Testing | Vitest | `tests/integration/*` run against a real, migrated, truncate-per-test Postgres database (`TEST_DATABASE_URL`), not mocks — this is deliberate given how much of the logic is authorization + transactional correctness (§9). |
| PWA delivery | Installable manifest + `public/sw.js`, camera via `navigator.mediaDevices` | No React Native; the "app" is the installed PWA. |

## 3. Database Architecture

`prisma/schema.prisma` is the single source of truth. All models below are grouped by
concern; `onDelete` behavior is called out because in this schema it's never arbitrary —
each choice enforces one of CLAUDE.md's invariants.

### 3.1 Auth.js adapter tables

Shape mandated by `@auth/prisma-adapter` — do not rename these without checking the
adapter's expectations.

- **`User`** (`users`) — the actual authenticated identity. `email` unique, nullable
  (a student created before ever logging in has no email). Has at most one each of
  `Teacher`, `Parent`, `Student` pointing back at it (§4.1: no `role` column — a user's
  roles are *derived* from which profile rows reference their id).
- **`Account`** (`accounts`) — one row per linked OAuth provider account (`provider` +
  `providerAccountId` composite PK). Only Google is configured today. `onDelete: Cascade`
  from `User` — deleting a user removes their linked accounts.
- **`Session`** (`sessions`) — `sessionToken` (unique), `userId`, `expires`. This is the
  **database session strategy** table (§5.1); it's also where the student code+PIN login
  path writes its own session rows directly (§5.2), so both login methods resolve through
  the exact same table and the exact same `auth()` call.
- **`VerificationToken`** (`verification_tokens`) — required by the adapter shape;
  unused today since there's no magic-link/email provider configured.

### 3.2 School / roster models

- **`School`** (`schools`) — top-level tenant. Owns `Classroom[]`, school-wide
  `ScheduleException[]`, and school-wide `Reward[]`. Also carries the anti-cheat/points
  tuning that used to be hardcoded module constants in `lib/packing.ts`/`lib/points.ts`:
  `packingWindowStartHour`/`packingWindowEndHour` (default `18`/`24`, unchanged) — the
  *evening* window, `sessionTtlMinutes` (default **20**, raised from the old hardcoded `10`
  — a 10-minute window mostly punished slow honest kids searching the house for items, not
  the rare cheater who finishes in well under a minute either way), and `pointsPerCompletion`
  (default `20`, unchanged). Also `morningWindowStartMinute`/`morningWindowEndMinute`
  (default `300`/`450`, i.e. 05:00-07:30) — a second, independent *morning* window, added
  because many Thai families pack the bag the morning of rather than the night before; a
  scan in this window targets *today*, not tomorrow (§7.8, §8.3). These two are
  minutes-since-midnight rather than hour integers like the evening pair, since 07:30 needs
  half-hour precision the evening window never did. No admin UI to edit any of this yet —
  same out-of-band precedent as `Term` (§7.20/§10): a school that wants different values
  gets them via script or Prisma Studio. `lib/school-settings.ts`'s `schoolSettingsForStudent`
  is the one place that reads them (§7.8a).
- **`Classroom`** (`classrooms`) — `schoolId` (`Cascade` — a school's classrooms don't
  outlive the school), `name` (e.g. "ป.4/1"). **`homeroomTeacherId`** (nullable,
  `onDelete: SetNull`) is the newest field: the one teacher — of possibly several subject
  teachers assigned here — who is ครูประจำชั้น (homeroom teacher). `SetNull` rather than
  `Cascade`/`Restrict` because a teacher leaving the school must not delete the classroom;
  it just becomes homeroom-less until reassigned. Indexed on both `schoolId` and
  `homeroomTeacherId` since both are queried directly by `lib/policy.ts`.
- **`Student`** (`students`) — `userId` nullable+unique (a student may have no login at
  all, or may later log in via Google if they happen to have a linked account — the
  schema doesn't forbid it, though the product's designed path is code+PIN). `studentCode`
  (nullable, unique) + `passwordHash` (nullable) + `failedLoginAttempts` + `nextLoginAttemptAt`
  are the code+PIN credential (§5.2) — `passwordHash` is bcrypt, the plaintext is *never*
  persisted anywhere, shown to the issuing teacher exactly once. `nextLoginAttemptAt`
  (`DateTime?`, renamed from `lockedUntil` in migration `20260903120149_student_login_backoff`
  — a `RENAME COLUMN`, not drop+add, so any existing value survived) backs exponential
  backoff on wrong passwords rather than a hard account lock — see §7.12 for why the old
  name stopped being accurate (it no longer locks anything a correct password can't
  immediately bypass).
- **`Enrollment`** (`enrollments`) — a student's classroom membership *over time*:
  `studentId`, `classroomId`, `startDate` (`@db.Date`), `endDate` (nullable `@db.Date`).
  This is what lets `requiredItemsFor()` (§7.7) resolve the *correct* classroom for a
  student who transferred mid-year — the "active" enrollment for a date is the row whose
  `[startDate, endDate]` (or open-ended) span contains it. `onDelete: Cascade` from both
  `Student` and `Classroom`.
- **`Parent`** (`parents`) — `userId` nullable+unique, `email` unique (the bootstrap key:
  a teacher creates this row, with only an email, before the parent has ever logged in;
  `auth.ts`'s `events.signIn` links `userId` on first matching Google sign-in — §5.1).
- **`Guardianship`** (`guardianships`) — join table, `parentId` + `studentId`,
  `@@unique([parentId, studentId])` so `linkParent()` (§7.3) can `upsert` idempotently.
  `onDelete: Cascade` both directions.
- **`Teacher`** (`teachers`) — same email-bootstrap shape as `Parent`. Has both
  `teachingAssignments: TeachingAssignment[]` (which subject, in which classroom) and
  `homeroomClassrooms: Classroom[]` (the reverse of `Classroom.homeroomTeacherId`, named
  relation `"HomeroomTeacher"`) — a teacher can simultaneously be a subject teacher in
  several classrooms and the homeroom teacher of (at most, by convention, though the
  schema doesn't enforce a cardinality limit) one.
- **`TeachingAssignment`** (`teaching_assignments`) — the row `lib/policy.ts` actually
  queries for almost every authorization decision: `teacherId` + `classroomId` +
  `subjectId`, `@@unique([teacherId, classroomId, subjectId])`. This is what makes
  teachers *subject-specific*: a teacher assigned to teach only PE in a classroom has no
  row for Math there, and `can()`'s subject-scoped checks (§4) key directly off this
  table. `onDelete: Cascade` from all three parents.

### 3.3 Curriculum / item models

- **`Subject`** (`subjects`) — per-school curriculum catalog (e.g. "คณิตศาสตร์"),
  `schoolId` FK (`onDelete: Cascade` from `School`, indexed) — the one deliberate
  coarse-grained exception to per-*classroom* scoping (any teacher at the school may
  manage its catalog, not just ones teaching a given classroom, `lib/catalog.ts`), but
  **not** cross-school. `archivedAt` (nullable) — see below.

  This field was added in migration `20260902182728_subject_school_scoping_and_archive`
  to close a real multi-tenancy hole: `Subject` cascades to `TimetableSlot`, and
  `SubjectItem` cascades to `ItemCopy`, which itself cascades to `PackingCheck`. With no
  `schoolId` and `edit_catalog` granting *any* teacher full access, a teacher at school A
  deleting a subject would have silently destroyed the timetables, item copies and entire
  packing history of every other school's use of that subject — invisible with one school
  in production, guaranteed to fire the moment a second school exists. The migration
  backfills every existing `Subject` row to the single school present at migration time
  (see the migration's own comment for why that backfill is only valid once, at the point
  per-school scoping is introduced — replaying it against a database that already has
  multiple schools would be wrong).

- **`SubjectItem`** (`subject_items`) — **invariant 1**: the *abstract* item a subject
  requires, e.g. "Math P.4 workbook" (`name`), `subjectId` FK. Never merge this with
  `ItemCopy` — grading state and QR binding belong to the physical copy, not the abstract
  item definition. `archivedAt` (nullable) — see below. `forExam` (boolean, default
  `false`, migration `20260903075846_subject_item_for_exam`) — see "Exam-day items" below.

  **Exam-day items — why `forExam` on `SubjectItem`, not a school-level exam kit.**
  `lib/schedule.ts`'s `applyExceptions` already tagged an `EXAM` exception's slot with
  `source: "exam"`, distinct from `source: "swap"` — but `requiredItemsFor` used to treat
  them identically, resolving the same subject's *normal* items either way. That's usually
  exactly wrong: an exam period needs a different set (2B pencil, eraser, ruler) and
  specifically **not** the workbook, which the teacher does not want in the room. Two
  designs were considered:
  - **(a) — chosen.** Add `forExam: Boolean` to `SubjectItem`. A subject declares which of
    its own items are exam items; on an exam-day slot for that subject,
    `requiredItemsFor`/`assembleItems` (§7.7) selects only the `forExam` items for that
    subject, never the normal ones (and, symmetrically, `forExam` items never appear on a
    non-exam day for that subject — see the code comment on `assembleItems`).
  - **(b) — not chosen.** A school-level exam kit: a fixed item set added on any exam
    period, plus suppression of that subject's normal items. Closer to how it actually
    works in a school (the same pencil/eraser/ruler apply across every subject's exam, not
    a separate set per subject) — but `SubjectItem.subjectId` is a required, non-nullable
    FK, so a school-level item belonging to no subject is a **real schema change**, not a
    query-level workaround: either `subjectId` becomes nullable (weakening invariant 1's
    "every item belongs to a subject" and complicating every existing `subjectId`-keyed
    query/authorization check — `item_copy`'s `edit_item_copy` policy resource is
    `{classroomId, subjectId}`, so a subject-less item copy has no clear subject-teacher
    owner, only ambiguity about who may bind/rebind/void its QR code) or a wholly new
    `ExamKit`/`ExamKitItem` model scoped to `School` directly, its own `ItemCopy`-equivalent
    tracking, and a new `Resource` variant in `lib/policy.ts` to authorize it.

  (a) was chosen because it costs one boolean column and stays entirely inside the
  existing `SubjectItem`/`ItemCopy`/`item_copy`-policy machinery — no new authorization
  question, no new model, no change to how a QR sticker gets bound to an exam-kit item
  copy. Its real limitation is the one (b) would have solved: a genuinely subject-agnostic
  exam kit (one physical pencil case, reused across every subject's exam) has to be
  declared once *per subject* under this design — a school that wants one shared kit
  creates one `forExam` `SubjectItem` per subject and tracks a separate `ItemCopy` of it
  under each, which is some duplication but not a correctness problem, and is a
  straightforward follow-up (option (b), fully scoped above) if that duplication ever
  becomes the actual complaint from a real school, rather than a hypothetical one.

- **Archiving, not deleting** — `deleteSubject`/`deleteSubjectItem` (`lib/catalog.ts`)
  default to setting `archivedAt = now()` rather than removing the row. A hard delete
  (`{ hard: true }`) is only permitted when nothing depends on the row: for `Subject`,
  zero `TimetableSlot`, `ScheduleException`, and (via its `SubjectItem`s) `ItemCopy` rows;
  for `SubjectItem`, zero `ItemCopy` rows. Otherwise it throws, naming exactly what still
  references it, rather than silently cascading through a child's classroom timetable or
  packing history. `restoreSubject`/`restoreSubjectItem` clear `archivedAt` — archiving
  without a way back would be no safer in practice than the delete it replaces.

  **Design decision — what "archived" means for `requiredItemsFor`.** An archived
  `Subject`/`SubjectItem` disappears from the catalog UI (`app/teacher/subjects/page.tsx`
  filters `archivedAt: null`) and can no longer be attached to anything new — a new
  `ScheduleException` (`createScheduleException`) or a new `ItemCopy` (`createItemCopy`)
  both reject an archived id server-side, not just hide it in a picker (the timetable
  itself has no runtime write path at all any more — §7.17 — so there's no equivalent
  check to make there; a real import/seed writing `TimetableSlot` rows directly is
  expected to keep them in sync with the catalog on its own). But
  `requiredItemsFor`/`requiredItemsForWeek` (§7.7) apply **no**
  `archivedAt` filter at all, deliberately: a student who already has a live `ItemCopy`
  pointing at an archived item must keep being told to bring it. Archiving retires a
  *definition* going forward; it is not retroactive surgery on what a student already
  owns and is still expected to pack. The one asymmetry this leaves open: nothing stops
  a *new* `SubjectItem` being created under an archived `Subject` — not blocked, because
  nothing in the app currently offers that path from the UI, but worth knowing if a
  future catalog-management screen adds one.
- **`ItemCopy`** (`item_copies`) — the physical object owned by one student:
  `subjectItemId` + `studentId` + `state` (`ItemCopyState`: `WITH_STUDENT` | `GRADING` |
  `LOST` | `RETIRED`, default `WITH_STUDENT`). `@@unique([subjectItemId, studentId])` — a
  student has at most one tracked copy per abstract item. **Invariant 5**: when
  `state = GRADING`, `requiredItemsFor()` drops this item from the packing list entirely
  — this is "the single most valuable behaviour in the app" per CLAUDE.md, and is
  covered by tests (§9). The currently-bound QR sticker is *not* a column here — it's
  whichever child `QRCode` row has `state = ASSIGNED` (at most one, enforced by
  transaction logic in `lib/qr.ts`, not a DB constraint) — see invariant 3 below.
  `onDelete: Cascade` from both `SubjectItem` and `Student`.
- **`QRCode`** (`qr_codes`) — `code` (opaque string, PK — see §7.5's `generateCode()`),
  `state` (`QRCodeState`: `UNASSIGNED` | `ASSIGNED` | `VOID`, default `UNASSIGNED`),
  `itemCopyId` (nullable), `boundAt` (nullable). **Invariant 2**: the code carries no
  data — never student id, subject, or anything guessable; codes are pre-printed as
  `UNASSIGNED` and bound to an `ItemCopy` at scan/bind time. **Invariant 3**: a code is
  *replaceable*, an `ItemCopy` is not — `rebindCode()` sets the old code's state to
  `VOID` rather than deleting it or reusing it, and critically **leaves `itemCopyId` set**
  on the voided row, so a historical `PackingCheck` referencing that code's item copy
  still resolves correctly even after the sticker was replaced. This is *why* `QRCode` is
  its own table with its own state machine rather than a column on `ItemCopy`.
  `onDelete: SetNull` from `ItemCopy` (not `Cascade`) — deleting an item copy must not
  silently delete QR-code history; the code just becomes orphaned (`itemCopyId = null`,
  `state` unchanged). The dev seed script explicitly has to wipe this table itself for
  exactly this reason (a reseed's `ItemCopy` wipe doesn't cascade-clean `QRCode`).

### 3.4 Timetable / exception models

- **`Term`** (`terms`) — one academic term for a school: `schoolId` + `name` (e.g.
  "ปีการศึกษา 2569") + `startDate`/`endDate` (both `@db.Date`, both required — a term's
  boundaries are planned in advance, unlike `Enrollment.endDate` which is null until a
  student actually leaves). `@@index([schoolId, startDate])`. `onDelete: Cascade` from
  `School`. **Terms for one school must not overlap.** Postgres has no simple
  non-overlapping-range constraint without an exclusion constraint using `btree_gist`,
  which this project doesn't otherwise need, so this is enforced in application code
  instead: every path that creates a `Term` goes through `lib/terms.ts`'s `createTerm`,
  which checks for an overlapping row of the same school before inserting (`assertNoOverlap`,
  a private helper — there is deliberately no way to create a `Term` that skips this
  check). Overlap across *different* schools is fine and expected.

- **`TimetableSlot`** (`timetable_slots`) — the *recurring* weekly slot, scoped to a
  **term**: `termId` + `classroomId` + `subjectId` + `weekday` (`Weekday` enum,
  `MON`–`SUN`) + `period` (1-based int). `@@unique([termId, classroomId, weekday, period])`
  — a classroom can't double-book a period *within one term* (the same classroom+weekday+
  period combination can legitimately hold a different subject in a different term).
  `onDelete: Cascade` from `Term`, `Classroom`, and `Subject`.

  **Why `termId`, not `effectiveFrom`/`effectiveTo` on the slot itself.** Before migration
  `term_scoped_timetable`, this table had no time dimension at all — `requiredItemsFor()`
  always read whatever the *current* timetable said, so a teacher editing term 2's
  timetable would silently change the answer for every already-past term-1 date. There
  was no way to ask "what was this child actually supposed to bring on that Tuesday" and
  get a historically-correct answer, even though `PackingCheck`/spot-check records from
  that date still existed. `Enrollment` already modeled exactly this kind of thing
  correctly (a date-ranged relationship, resolved per-date); `TimetableSlot` did not.
  Two ways to fix it: a `termId` FK to a shared `Term` row, or `effectiveFrom`/`effectiveTo`
  dates on each slot directly. `termId` was chosen because it matches how a real school's
  timetable actually behaves — the *entire* timetable is authored per term and changes as
  a whole at term boundaries, not slot-by-slot on arbitrary dates. `termId` makes "which
  slots are in effect on date D" a direct two-step resolution — find the `Term` covering
  D, then look up its slots — the same shape `enrollmentFor(date)` (§7.7) already uses for
  enrollments, and keeps the existing `@@unique` constraint meaningful (just extended with
  `termId`) instead of needing per-slot range-overlap validation, which nothing in this
  domain actually requires (individual slots don't change independently of a term
  boundary).
- **`ScheduleException`** (`schedule_exceptions`) — **invariant 6**: a deviation from the
  recurring timetable for one calendar date; every "what's needed on date D" query must
  apply these, not just weekday+period — holidays, swaps, and exams are the *normal*
  case, not an edge case. `schoolId` + `classroomId` (nullable: null = school-wide, e.g.
  a national holiday; set = one classroom only) + `date` (`@db.Date`) + `kind`
  (`ExceptionKind`: `HOLIDAY` | `PERIOD_SWAP` | `EXAM` | `CANCELLED_PERIOD`) + `period`
  (nullable) + `subjectId` (nullable) + `note`. `period`/`subjectId` are the payload for
  `PERIOD_SWAP`/`EXAM` (the substituted period + subject); unused for `HOLIDAY`;
  `CANCELLED_PERIOD` wipes just the given period. `classroom`'s FK is `onDelete: Cascade`
  but `subject`'s is `onDelete: SetNull` — deleting a subject shouldn't delete the
  exception record of "there was an exam that day," just drop which subject it was for.

### 3.5 Packing / anti-cheat models

- **`PackingSession`** (`packing_sessions`) — one packing attempt for one date:
  `studentId`, `forDate` (`@db.Date` — tomorrow's date if started during the evening
  window, today's if started during the morning window, §8.3), `status`
  (`PackingSessionStatus`: `ACTIVE` | `COMPLETED` | `EXPIRED`),
  `startedAt` (explicit app-clock timestamp, not the DB default — see §7.8's note on why
  both the create and the expiry check must read the same clock), `completedAt`
  (nullable), `pointsAwarded` (boolean, guards against double-award on a race — it is not
  itself a business fact, just an idempotency flag), `continuous` (boolean, default
  `true` — `false` when this session's checks include ones carried forward from an
  earlier session that expired for the same `forDate`; see `getOrStartSession`, §7.8),
  `startedByUserId` (nullable `String`, **loose reference, not a Prisma relation** — same
  audit pattern as `PointLedger.actorUserId` below and `Consent.grantedByParentId`/
  `recordedByUserId`: this session's history must survive that `User` row's own lifecycle
  untouched. `null` for the ordinary student-run flow; set to the homeroom teacher's
  `userId` only by `recordTeacherScan` (§7.8/§8.3a) — the teacher-run packing flow for
  students with no phone/camera at home in the evening. The presence of a value is itself
  the record of "an adult, not the student, drove this scan," satisfying invariant 7's
  audit-trail requirement for a teacher-facing override).
  Indexed on `[studentId, forDate]`. `onDelete: Cascade` from `Student`.
- **`PackingCheck`** (`packing_checks`) — one item confirmed packed by scanning its QR
  code: `sessionId` + `itemCopyId` + `method` (`PackingCheckMethod`, currently only
  `SCAN`) + `photoPath` (nullable — a private on-disk filename, never a public URL,
  CLAUDE.md "Privacy"; this is the unused-today CV training-data capture, §8.6).
  `@@unique([sessionId, itemCopyId])` — scanning the same item twice in one session is an
  upsert no-op, not a duplicate row. `onDelete: Cascade` from both `PackingSession` and
  `ItemCopy`.

### 3.6 Points / rewards models

- **`PointLedger`** (`point_ledger`) — **invariant 4**: append-only, balance is always
  `SUM(delta)`; never a `points` integer column on `Student`. `studentId` + `delta`
  (signed int) + `reason` (`PointReason`: `PACKING_COMPLETE` | `REDEMPTION` |
  `MORNING_CHECK_FAIL` | `MANUAL_ADJUST`) + `refId` (nullable — points at the
  session/redemption/item-copy that caused this row) + `actorUserId` (nullable) + `note`
  (nullable `String`, migration `20260904053842_point_ledger_manual_adjust_note` — freeform
  text, set only by `manualAdjustPoints` alongside `MANUAL_ADJUST`; every other reason
  leaves it `null`, since none of them involve a human-authored explanation).
  `actorUserId` is **invariant 7**'s audit trail: set to the acting teacher's user id for
  a manual override (`MORNING_CHECK_FAIL`, `MANUAL_ADJUST`), left `null` for a
  system-awarded row (`PACKING_COMPLETE`) — this is deliberately *instead of* a
  `verifiedBy` column on `PackingCheck` itself; the audit trail lives on the ledger entry
  that resulted from the override, not on the check. `onDelete: Cascade` from `Student`.
- **`Reward`** (`rewards`) — `schoolId` + `name` + `cost` + `stock` (`Int?`, migration
  `20260903111338_reward_stock_and_redemption_restrict` — `null` means unlimited; a
  physical-inventory count, decremented by `redeem()` inside its own transaction, never
  allowed below `0`) + `active` (boolean, soft-hide without deleting redemption history).
  School-wide catalog, same coarse-grained shape as `Subject`. `onDelete: Cascade` from
  `School`.
- **`Redemption`** (`redemptions`) — `studentId` + `rewardId` + `pointsSpent` (frozen at
  redemption time, so a later cost change doesn't rewrite history) + `status`
  (`RedemptionStatus`: `PENDING` | `FULFILLED`) + `fulfilledAt`/`fulfilledByTeacherId`
  (both nullable, set together by `fulfillRedemption()`). `onDelete: Cascade` from
  `Student`, but **`onDelete: Restrict` from `Reward`** (changed in the same migration as
  `stock`, from `Cascade`) — a `PointLedger` `REDEMPTION` row's `refId` points at a
  `Redemption`, and `PointLedger` only cascades from `Student`, never from `Reward`. With `Redemption`
  cascading from `Reward`, deleting a `Reward` used to silently delete its `Redemption`
  rows while every `PointLedger` row that referenced them survived — a dangling `refId`,
  breaking invariant 4 (the ledger as the auditable record of every point change).
  `Restrict` makes the database refuse that delete outright; `lib/rewards.ts`'s
  `deleteReward` refuses it first, with a message pointing at `active: false` (the
  soft-hide field that already existed for exactly this).
- **`PushSubscription`** (`push_subscriptions`) — `studentId` + `endpoint` (unique — the
  browser's push endpoint URL doubles as the natural key for `upsert`) + `p256dh` +
  `auth` (the two Web Push encryption keys). `onDelete: Cascade` from `Student`.

### 3.6a Consent model

Migration `20260903121850_photo_capture_consent`. Closes a real gap this file used to
list under §10 "known limitations": the photo-capture pipeline (`lib/packing.ts`'s
`savePhoto`, running since Phase 2) had been writing a child's photo to disk on every
packing scan with nothing checking for any lawful basis at all, despite CLAUDE.md
"Privacy" already stating the requirement ("no feature should be built that assumes
consent has been obtained") — a case of the doc being right and the code not enforcing it.

- **`Consent`** (`consents`) — `studentId` + `scope` (`ConsentScope`, currently just
  `PHOTO_CAPTURE` — modeled per-scope from day one, not a single blanket flag, since a
  real PDPA lawful-basis record is inherently purpose-specific) + `version` (`String`) +
  `method` (`ConsentMethod`: `ONLINE` | `PAPER`) + `grantedByParentId`/`recordedByUserId`
  (both nullable) + `grantedAt` + `revokedAt` (nullable). `onDelete: Cascade` from
  `Student` (a consent record for a student that no longer exists has nothing left to be
  about). `grantedByParentId`/`recordedByUserId` are **loose references, not Prisma
  relations** — same pattern as `PointLedger.actorUserId` (invariant 7's audit trail):
  deliberately not an FK, so this record's history survives the referenced `Parent`/`User`
  row's own lifecycle untouched.
- **"Active" is a precise, narrow definition — not "a row exists."** `lib/consent.ts`'s
  `hasActiveConsent(studentId, scope)` is the *only* place allowed to answer this
  question: a row counts only when `revokedAt` is `null` **and** `version` matches
  `CURRENT_CONSENT_VERSION[scope]` (a plain in-code map, one entry today:
  `{PHOTO_CAPTURE: "1"}`). Bumping that version string the moment a privacy notice changes
  invalidates every prior consent for that scope without touching a single historical row
  — re-granting always inserts a fresh `Consent` row, never updates an old one (append-only,
  same spirit as invariant 4's ledger and for the same reason: a consent record's entire
  point is being an honest history of what was agreed to and when, not just a current
  flag). This is also why nothing outside `lib/consent.ts` is allowed to query `Consent`
  directly to decide whether something is permitted — the "and version matches" half is
  easy to forget if reimplemented ad hoc at a second call site.
- **`revokeConsent`** doesn't just flip a flag going forward — it deletes every
  already-stored photo for that student and nulls each `PackingCheck.photoPath`
  immediately (`lib/photo-storage.ts`'s `deletePhotosForChecks`, shared with
  `scripts/purge-old-photos.ts`'s age-based retention purge — same operation, different
  `where` clause). CLAUDE.md "Privacy" doesn't say this explicitly, but a lawful basis
  that's been withdrawn stops being lawful for data already collected under it too, not
  just for future collection.

### 3.7 Migration history

Eight migrations, applied in order, each a real step in the product's build-out:

1. **`init_phase0`** — the entire Phase 0 shape in one migration: Auth.js adapter tables,
   `School`/`Classroom`/`Student`/`Enrollment`/`Parent`/`Guardianship`/`Teacher`/
   `TeachingAssignment`/`Subject`/`SubjectItem`/`TimetableSlot`/`ScheduleException`, plus
   the enums `Weekday`/`ExceptionKind`. No `ItemCopy`/`QRCode`/packing/points/rewards yet
   — those are all later phases.
2. **`teacher_parent_email_bootstrap`** — adds `email` (unique) to both `Teacher` and
   `Parent` and makes their `userId` nullable, enabling the create-before-first-login
   bootstrap pattern (§3.2, §5.1). Before this migration those rows presumably required
   a `userId` up front, which doesn't work for "the school sets this up before the
   teacher/parent has ever signed in."
3. **`qr_codes`** — Phase 1: adds `ItemCopy`, `QRCode`, `ItemCopyState` and `QRCodeState`
   enums. This is the migration that makes invariants 1–3 (item/copy separation, opaque
   codes, replaceable codes) real at the schema level.
4. **`packing_points_rewards_push`** — Phase 2 + Phase 3 + beyond-phase, landed together:
   `PackingSession`, `PackingCheck`, `PointLedger`, `Reward`, `Redemption`,
   `PushSubscription`, plus `PackingSessionStatus`/`PackingCheckMethod`/`PointReason`/
   `RedemptionStatus` enums. The anti-cheat session shape, the append-only ledger, the
   reward catalog, and Web Push subscriptions all arrived in one migration because they
   were built in the same session.
5. **`student_login_credentials`** — adds `studentCode`/`passwordHash`/
   `failedLoginAttempts`/`lockedUntil` to `Student`, enabling the code+PIN login path
   (§5.2) that deliberately bypasses Auth.js's Credentials provider.
6. **`classroom_homeroom_teacher`** — adds `Classroom.homeroomTeacherId` (nullable,
   `SetNull`) and the reverse `Teacher.homeroomClassrooms` relation. The schema-level
   support for the homeroom-vs-subject-teacher authorization split described in §4.
7. **`subject_school_scoping_and_archive`** — adds the required `Subject.schoolId`
   (backfilled to the single existing school, then locked `NOT NULL`; see §3.3's design
   note on why that backfill only holds at this point in time) and `archivedAt` on both
   `Subject` and `SubjectItem`. Closes the cross-school delete-cascade hole described in
   §3.3 and backs the archive-instead-of-delete behavior in `lib/catalog.ts`.
8. **`term_scoped_timetable`** — the newest migration: adds `Term` and the required
   `TimetableSlot.termId` (backfilled by creating one `Term` per school that had any
   `TimetableSlot` at all, covering "the current academic year," then attaching every
   existing slot to its classroom's school's new term before locking `termId` `NOT NULL`
   and replacing the old `@@unique([classroomId, weekday, period])` with
   `@@unique([termId, classroomId, weekday, period])`). Closes the modelling bug described
   in §3.4: `requiredItemsFor()` always reading the *current* timetable regardless of the
   requested date.

Several further migrations landed after this list was last kept in lockstep with
`prisma/migrations/` and are not individually numbered above — each is small and
self-explanatory from its name and the schema section it backs (per-school anti-cheat
settings + `continuous`, the morning window, exam-day `forExam` items, reward stock,
login backoff, photo/consent, `PackingSession.startedByUserId` for the teacher-run packing
flow, §3.5/§8.3a). The newest, **`point_ledger_manual_adjust_note`**, adds
`PointLedger.note` (§3.6) — a plain `ALTER TABLE ... ADD COLUMN`, nullable, no backfill
needed since every existing row is a reason that predates `MANUAL_ADJUST` having a code
path at all (§7.9/§8.4) and correctly has no note to record.

## 4. Authorization Architecture

CLAUDE.md's rule, verbatim: access is **relationship-based, not role-based**. There is no
`role` column anywhere. `lib/policy.ts` is the *only* place that is allowed to branch on
`actor.teacherId`/`actor.studentId`/`actor.parentId` directly — every other file calls
`can()` or one of the two `visible*Where()` scoping helpers.

### 4.1 `Actor`

```ts
type Actor = { userId: string; teacherId: string | null; parentId: string | null; studentId: string | null };
```

Built by `lib/actor.ts`'s `resolveActor(userId)`, which does three parallel `findUnique`
lookups (Teacher/Parent/Student `where: { userId }`) and returns whichever ids exist. A
single logged-in user can hold more than one non-null id at once (e.g. a teacher who is
also a parent) — nothing in the schema or the policy layer prevents this, and
`app/page.tsx`'s landing logic (§5.3) is built around exactly that possibility.

### 4.2 `Resource` and `Action`

```ts
type Resource =
  | { type: "classroom"; classroomId: string }
  | { type: "student"; studentId: string }
  | { type: "school"; schoolId: string }
  | { type: "catalog"; schoolId: string }
  | { type: "item_copy"; classroomId: string; subjectId: string };

type Action =
  | "view_timetable" // no edit_timetable — the timetable has no runtime write path (§6.4/§7.17)
  | "view_exceptions" | "edit_exceptions"
  | "view_student"
  | "edit_roster"
  | "edit_catalog"
  | "edit_rewards"
  | "edit_item_copy"
  | "edit_student_account" // homeroom-only: link a parent, (re)issue login credentials
  | "spot_check" // homeroom-only: morning bag-check (deliberately not edit_item_copy's
                  // subject-scoping — see §6.4/§10)
  | "edit_consent"; // a guardian's own decision, or homeroom-only for a paper form —
                    // deliberately NOT the student's own, even for their own record
                    // (CLAUDE.md "Privacy": a minor's consent needs a guardian) — §3.6a
```

### 4.3 The helper predicates

Every branch in `can()` delegates to one of these (all in `lib/policy.ts`, all private):

| Helper | Query | Used for |
|---|---|---|
| `teachesClassroom(teacherId, classroomId)` | `TeachingAssignment.count({teacherId, classroomId})` | Coarse "does this teacher have *any* assignment here" — exceptions/roster edit, and the read fallback for view actions. |
| `teachesClassroomSubject(teacherId, classroomId, subjectId)` | same, `+subjectId` | The subject-scoped check — a PE-only teacher fails this for a Math item copy. |
| `isHomeroomTeacherOf(teacherId, classroomId)` | `Classroom.count({id, homeroomTeacherId: teacherId})` | The homeroom bypass/extra-privilege check. |
| `teachesInSchool(teacherId, schoolId)` | `TeachingAssignment.count({teacherId, classroom:{schoolId}})` | School-level actions (create classrooms, manage the reward catalog, school-wide exceptions). |
| `isEnrolledInClassroom(studentId, classroomId)` | `Enrollment.count` with `activeEnrollmentFilter()` | Student's own classroom view. |
| `guardianOfStudentInClassroom(parentId, classroomId)` | `Guardianship.count` joined through active enrollment | Parent's view of their child's classroom. |
| `isGuardianOf(parentId, studentId)` | `Guardianship.count({parentId, studentId})` | Parent viewing their own child directly. |
| `teachesStudent(teacherId, studentId)` | `Enrollment.count` joined through `TeachingAssignment` | Teacher viewing a specific student (any subject teacher in that student's classroom, not subject-scoped — this is a *view*, not an edit). |
| `isHomeroomTeacherOfStudent(teacherId, studentId)` | `Enrollment.count` joined through `Classroom.homeroomTeacherId`, via active enrollment | `edit_consent`'s homeroom check — same shape as `isHomeroomTeacherOf`, but resolved from a `studentId` (there's no `classroomId` on the `student` resource to work from directly). |

`activeEnrollmentFilter()` is the shared "enrollment active as of today" `WHERE` fragment
(`startDate <= today AND (endDate IS NULL OR endDate >= today)`) reused by several of the
above.

### 4.4 `can()`'s decision table, by resource type

**`classroom`** — `edit_student_account` and `spot_check` → homeroom teacher only
(`isHomeroomTeacherOf`) — the same predicate, two different actions, because they're the
same *shape* of privilege (a homeroom-only override on a classroom) even though they mean
unrelated things: linking a parent/resetting a login vs. checking a bag. `spot_check` is
kept as its own `Action` rather than reusing `edit_student_account` specifically so
`can(actor, "spot_check", ...)` reads correctly at its call site — `edit_student_account`
would be a misleading name for "may morning-check this classroom's bags" even though the
check underneath is identical. `edit_exceptions`/`edit_roster` → any
teacher assigned to the classroom, any subject (`teachesClassroom`). Everything else
(`view_timetable`/`view_exceptions`, the implicit fallthrough) → true if the actor
teaches the classroom, is enrolled in it as a student, or is a guardian of an enrolled
student — the three "may look at this classroom's schedule" relationships.

**`school`** — `edit_exceptions`/`edit_roster`/`edit_rewards` → any teacher who teaches
somewhere in that school (`teachesInSchool`). (Historically `edit_roster` at school scope
meant "may create classrooms here"; classroom creation itself was later removed from the
product entirely — §6.4 — so today this school-level `edit_roster` grant is exercised
only for `createUnassignedCodes()`'s school-wide QR-printing permission, which reuses
`edit_exceptions` at classroom scope but `edit_roster`... — see `lib/qr.ts`'s actual call,
which checks `edit_exceptions` at `school` scope, not `edit_roster`.) `edit_catalog` is
**not** handled here — see `catalog` below.

**`student`** — `edit_consent` → a guardian (`isGuardianOf`) or the homeroom teacher
(`isHomeroomTeacherOfStudent`) — deliberately **not** `actor.studentId === studentId`,
unlike every other branch here: a minor can't consent to their own data collection
(CLAUDE.md "Privacy"), and consent isn't a per-subject concern so no non-homeroom teacher
gets it either. Everything else — true if `actor.studentId === studentId` (self), or the
actor is a guardian (`isGuardianOf`), or the actor teaches that student (`teachesStudent`,
any subject). No other `edit_*` action variant exists for this resource type — nothing
else mutates a `Student` row through this pathway; roster mutations go through the
`classroom`/`item_copy` resources instead. `Consent` itself is a separate table gated by
this one action, not a `Student` column.

**`catalog`** — `edit_catalog` → any teacher who teaches somewhere in that
`schoolId` (`teachesInSchool`). Coarser than per-classroom on purpose — subjects/
subject-items are a shared curriculum catalog within a school (matching how the Thai
national curriculum actually works), not owned by any one classroom — but **not**
cross-school. Until migration `subject_school_scoping_and_archive`, this resource had no
`schoolId` at all and the check was "any teacher, full stop" — a real multi-tenancy hole,
since `Subject` cascades to `TimetableSlot` and (via `SubjectItem`) to `ItemCopy` and
`PackingCheck`; see §3.3 for the full incident description and the fix.

**`item_copy`** — `edit_item_copy` → true if the actor is the classroom's homeroom
teacher (bypasses the subject check entirely — they see and manage every subject's
items), **or** they specifically teach that `subjectId` in that `classroomId`
(`teachesClassroomSubject`). This is the split described in the project's most recent
change: a subject teacher covering only PE in a classroom cannot see, bind/rebind/void
QR codes for, or toggle the `GRADING` state of that classroom's Math items — only the
Math teacher (or the homeroom teacher) can.

### 4.5 Why `linkParent`/`issueStudentCredentials` are homeroom-only but `createStudent` isn't

`lib/roster.ts` has two internal gate functions built on one shared primitive:

```ts
requireClassroomAccessForStudent(actor, studentId, action: "edit_roster" | "edit_student_account")
```

which resolves the student's active enrollment → classroom, then calls `can()` with the
given action. `requireRosterAccessForStudent` (used by `createStudent`,
`createItemCopy`'s coarse pre-check) passes `"edit_roster"` — any subject teacher in the
classroom. `requireHomeroomAccessForStudent` (used by `linkParent`,
`issueStudentCredentials`, `lib/packing.ts`'s `recordTeacherScan` (§8.3a), and —
the newest consumer — `lib/points.ts`'s `manualAdjustPoints` (§7.9)) passes
`"edit_student_account"` — homeroom teacher only. The
design reasoning, verbatim from the user request that produced it: creating/enrolling a
student is a shared classroom-roster action any subject teacher can reasonably do, but
linking a parent's contact info, resetting a student's login credential, running the
teacher-side packing flow, or manually adjusting a student's points on their behalf is
sensitive enough that only the one
teacher formally responsible for that classroom should be able to.

`lib/packing.ts`'s `spotCheck` is homeroom-gated the same way, but for a different reason
than "sensitive": morning bag-checking isn't sensitive data like a login credential, it's
just realistically a whole-bag, whole-classroom job that ครูประจำชั้น does once, not a job
subject teachers each do a slice of — subject-scoping it (the way `edit_item_copy` scopes
bind/rebind/void) would show each teacher a partial view of one child's bag, which isn't
how any real teacher actually checks bags in the morning. See §6.4/§10 for the fuller
story, including that this was tried the other way first and reversed.

`lib/consent.ts`'s `edit_consent` is homeroom-gated on the teacher side for a third,
distinct reason again: not "sensitive routine data" and not "whole-bag job," but that
consent is fundamentally a **guardian's** decision, and ครูประจำชั้น is the one teacher
already trusted to act as the family's point of contact for exactly this kind of thing
(they're also the only one who can link a parent or reissue a login — §4.4/§4.5 above). A
subject teacher recording consent on a family's behalf, for a subject they may not even
still be teaching that student next term, has no equivalent standing. Unlike
`edit_student_account`/`spot_check`, `edit_consent` also grants the *parent* directly
(`isGuardianOf`) — this is the one homeroom-gated action where the primary actor is
expected to be the guardian, not a teacher at all; the teacher path exists specifically
for "a family who never uses the app online" (paper-form consent), not as the normal case.

### 4.6 List-scoping helpers

CLAUDE.md: "every list query must be scoped at the database level too — never fetch
broadly and filter in the UI." Two helpers build a Prisma `WHERE` fragment directly from
the actor, used anywhere a *list* of students/classrooms is fetched (dashboards, the
classrooms index, the exceptions/timetable/rewards classroom pickers):

- **`visibleStudentWhere(actor)`** — `OR`s together: `id = actor.studentId` (self),
  `guardianships.some({parentId})` (parent's children), `enrollments.some(active AND
  classroom.teachingAssignments.some({teacherId}))` (any student in any classroom the
  teacher has *any* assignment in — not subject-scoped; this is a visibility list, not an
  item-copy edit). An actor with no linked profile at all gets a `WHERE id =
  '__no_profile__'` sentinel — Prisma has no literal "match nothing," so this fakes one.
- **`visibleClassroomWhere(actor)`** — same shape: teacher → any classroom they have an
  assignment in; student → their actively-enrolled classroom; parent → their child's
  actively-enrolled classroom. Same `__no_profile__` sentinel for the empty case.
- **`manageableSubjectsInClassroom(actor, classroomId)`** — not a where-fragment but a
  direct query, returning `{id, name}[]`: the subjects this actor may manage *item copies*
  for in this classroom (homeroom → every subject taught there; subject teacher → only
  their own), i.e. the same scoping `can()`'s `item_copy` case applies, but enumerated
  rather than checked one subject at a time. Exists so two call sites don't duplicate the
  homeroom-vs-subject-teacher branch: print-qr's "narrow to one subject" `<select>`
  (§6.4) and `generateAndBindCodesForClassroom`'s default scope when no subject is chosen
  (§7.5, §8.2).

## 5. Auth Architecture — Three Login Paths

### 5.1 Google OAuth (teacher / parent)

`auth.ts` configures `NextAuth` with `PrismaAdapter(prisma)` and `session: { strategy:
"database" }`. **This is deliberate and non-negotiable per CLAUDE.md**: under a JWT-only
strategy, `@auth/core` regenerates `profile.sub` via `crypto.randomUUID()` on *every*
login, so the "stable" user id silently changes across sessions — anything keyed off it
(every `Teacher.userId`/`Parent.userId`/`Student.userId` foreign key in this schema)
would break. Database sessions instead persist a real `Session` row keyed by a random
`sessionToken`, read back by `auth()` on every request — the `userId` inside it never
regenerates.

The `events.signIn` hook is the bootstrap-linking mechanism: `Teacher`/`Parent` rows are
created ahead of time (by the school/seed script) with only an `email`, no `userId` —
whoever sets up the school knows people's emails before those people have ever logged in.
On first Google sign-in with a matching, Google-verified email, the hook runs two
`updateMany({ where: { email, userId: null } })` calls (one for `Teacher`, one for
`Parent`) that link `userId`. It's an idempotent no-op on every subsequent login (the
`userId: null` guard means an already-linked row is never touched again).

### 5.2 Student code + PIN (deliberately not Auth.js Credentials, not Google)

Most students have no Gmail. Auth.js's built-in `Credentials` provider is **JWT-only by
design** — there's no OAuth `Account` row for the database adapter to persist a session
against, so wiring it up here would silently force the entire student login path onto
JWT and reintroduce exactly the stable-id bug §5.1 exists to avoid. Instead:

- **`lib/student-auth.ts`**'s `verifyStudentLogin(studentCode, password)` looks up the
  student by `studentCode`, **always runs `bcrypt.compare`** (never short-circuited by any
  pending cooldown — see §7.12 for why), and on a match **writes a real row directly into
  the `sessions` table** — the exact same table `@auth/prisma-adapter` itself writes to
  for Google logins — with a `randomUUID()` token and a 30-day expiry
  (`STUDENT_SESSION_DAYS`). If the student has never logged in before (`student.userId` is
  null), it first creates a bare `User` row (name only, no email) to hang the session off
  of. A wrong password is throttled by exponential backoff (§7.12), not a hard account
  lock — the earlier design (5 failed attempts → 15-minute lock) was reversed because it
  locked out the *legitimate* student, not an attacker: student codes are 6 digits and
  children share them with each other routinely, so any classmate could deny a real
  classmate access to the app for 15 minutes just by mashing the wrong PIN five times.
- **`app/login/student-actions.ts`**'s `studentLoginAction` (a `useActionState`-driven
  Server Action, see `components/student-login-form.tsx`) first checks a per-IP rate
  limit (`lib/rate-limit.ts`'s `checkRateLimit`, §7.11a — independent of
  `verifyStudentLogin`'s per-student backoff, throttling how many *different* codes one
  source can try, not just repeated guesses against one) before calling
  `verifyStudentLogin`, then sets the cookie **by hand** via `cookies().set(...)`, using
  `studentSessionCookie(secure)` to pick the exact cookie name Auth.js v5's database
  strategy expects (`authjs.session-token`, or `__Secure-authjs.session-token` when
  `NODE_ENV === "production"`).

Because both the session row and the cookie exactly match what the Prisma adapter itself
would have produced, `auth()` — and therefore `currentActor()`/`requireActor()` — resolve
a student session identically to a Google session, with zero special-casing anywhere else
in the app. **Do not "fix" this by wiring up next-auth's Credentials provider** — that
would be the regression this design works around.

### 5.3 Landing logic — no role picker

`app/page.tsx` (`HomePage`) is the only place that ever asks "which of this actor's
non-null role ids do I use." There is **no role picker UI**: if `actor.studentId` is set,
redirect to `/student/tomorrow`; else if `actor.teacherId`, `/teacher`; else if
`actor.parentId`, `/parent`. Fixed priority **student > teacher > parent**, chosen
explicitly to keep login at zero extra taps for the overwhelmingly common single-role
case, at the cost of a genuinely multi-role account (e.g. a teacher whose Google account
also happens to be linked as a student) always landing on the higher-priority role's
page first — reachable manually by navigating directly to `/teacher` or `/parent`, since
each area's own `layout.tsx` checks its own `actor.*Id`, not "is this the actor's
top-priority role."

## 6. API / Route Surface

No `middleware.ts` exists — every route does its own `requireActor()`/`can()` check at
the top. Grouped by area; every Server Action file is enumerated.

### 6.1 Auth & top-level routes

- **`app/api/auth/[...nextauth]/route.ts`** — re-exports `handlers.GET`/`handlers.POST`
  from `auth.ts`. This is the entire Auth.js HTTP surface (OAuth start/callback, session
  endpoint, sign-out).
- **`app/page.tsx`** (`/`) — landing redirect logic, §5.3. No data mutation.
- **`app/login/page.tsx`** (`/login`) — renders `LoginTabs` (client component, plain
  `useState` tab switch) with two slots: a `teacherParent` slot containing an inline
  `"use server"` form action that calls `signIn("google", { redirectTo: "/" })`, and a
  `student` slot rendering `<StudentLoginForm />`.
- **`app/login/student-actions.ts`** — `studentLoginAction(prevState, formData)`: reads
  `studentCode`/`password`, calls `verifyStudentLogin`, sets the session cookie by hand
  on success (§5.2), and `redirect("/")`. Returns `{ error: string | null }` for
  `useActionState` to render inline.

### 6.2 `/student/*`

- **`app/student/layout.tsx`** — `requireActor()`; redirects to `/` if not a student.
  Renders the sign-out button and bottom nav.
- **`/student/tomorrow`** (`page.tsx`) — renders `<TomorrowView>` (a shared server
  component, also used by the parent view) plus `<NotificationOptIn>`. No page-local
  action file logic beyond the imported `subscribeAction`. Despite the route/file/component
  name, `<TomorrowView>` no longer always shows tomorrow: it resolves
  `packingFocusDate(settings)` (§7.8) itself and switches every "พรุ่งนี้" (tomorrow)
  string to "วันนี้" (today) — the header, the holiday message, the empty-list message,
  and the completion message — whenever that resolves to `schoolToday()` (i.e. during the
  morning window). The route/file/component names were left as-is; only the copy and the
  date fed to `getPackingStatus` changed, to keep this diff to what was actually asked.
  - **`actions.ts`**: `subscribeAction(subscription: PushSubscriptionJSON)` — calls
    `requireActor()` then `subscribe(actor, subscription)` (`lib/push.ts`). Called
    directly from `<NotificationOptIn>` (a client component), not a `<form>`, since it
    takes a structured object from the browser's Push API rather than form fields.
- **`/student/week`** (`page.tsx`) — renders `<WeekView>`. Read-only, no actions file.
- **`/student/scan`** (`page.tsx`) — `requireActor()`, redirects home if not a student;
  resolves `schoolSettingsForStudent` then `packingFocusDate(settings)` (same resolution
  `<TomorrowView>` uses — today during the morning window, tomorrow otherwise) and fetches
  `getPackingStatus` for that date; redirects to `/student/tomorrow` if already complete or
  nothing is due. Renders `<ScanView>` (client component owning packing-scan-specific
  behavior — photo capture, the remaining-items list, `recordScanAction` — built on top
  of the shared `<QRScanner>` camera/decoder component also used by the teacher's
  scan-to-bind flow, §6.4/§8.2). Note this page's own date resolution is only for fetching
  the right *list* to show — the actual scan, once submitted, resolves its own window
  independently and authoritatively inside `recordScan` (§7.8), so a page left open across
  a window boundary can't scan against a stale date.
  - **`actions.ts`**: `recordScanAction({ code, photoDataUrl? })` — calls
    `recordScan(actor, params)` (`lib/packing.ts`), catches the three expected error
    types (`PackingWindowClosedError`, `InvalidScanError`, `ForbiddenError`) and converts
    each to a `{ ok: false, error }` result the client renders inline rather than an
    unhandled exception; any other error rethrows.
- **`/student/rewards`** (`page.tsx`) — reads `balance()` + the student's school's active
  `Reward`s (via their current enrollment → classroom → school), renders a shop list. Each
  reward's "แลก" (redeem) button is disabled — showing "หมดแล้ว" (sold out) instead of
  "ยังไม่พอ" (not enough points) — when `stock !== null && stock <= 0`, the same way it was
  already disabled for insufficient balance; this is a UI convenience only; `redeem()`
  itself re-checks stock authoritatively, so a race (two students tapping the last unit at
  once) is still resolved correctly even if this check is stale by the time the tap lands.
  - **`actions.ts`**: `redeemAction(formData)` — `redeem(actor, rewardId)`
    (`lib/rewards.ts`), then `revalidatePath("/student/rewards")`. A rejection (insufficient
    balance, out of stock, or a losing race) throws and is caught by `app/error.tsx`, same
    as before `stock` existed — this page has no inline error handling for `redeem()`.

### 6.3 `/parent/*`

- **`app/parent/layout.tsx`** — `requireActor()`; redirects to `/` if not a parent.
- **`/parent`** (`page.tsx`) — lists the parent's children (`guardianships.some`),
  each with a deterministic hash-based avatar color.
- **`/parent/[studentId]`** (`page.tsx`) — `can(actor, "view_student", {studentId})` gate
  (`notFound()` if denied — a 404, not a 403, to avoid confirming the id exists to an
  unauthorized actor), then renders `<TomorrowView ... readOnly />` — the *exact same*
  component the student uses, with `readOnly` suppressing the "สแกนหนังสือ" scan link.
  No page here or anywhere else lets a parent tick an item — CLAUDE.md invariant 7 has no
  parent-facing override.
- **`/parent/[studentId]/week`** (`page.tsx`) — same `can()` gate, renders `<WeekView>`.
- **`/parent/[studentId]/consent`** (`page.tsx`) — same `can(actor, "view_student", ...)`
  gate as the two pages above (reading consent status is a *view*, not an `edit_consent`
  action — only granting/revoking needs that). Shows whether `PHOTO_CAPTURE` consent is
  currently active (`hasActiveConsent`, §7.8c) and what's stored right now
  (`photoStorageSummary`, §7.8b — a count and date range, never the photos themselves),
  with a single button that grants or revokes depending on current state. Linked from
  `/parent/[studentId]` as a small "ความยินยอมถ่ายรูป" row below `<TomorrowView>`.
  - **`actions.ts`**: `grantConsentAction`/`revokeConsentAction(formData: {studentId})` →
    `grantConsentOnline`/`revokeConsent` (`lib/consent.ts`), then
    `revalidatePath("/parent/[studentId]/consent")`.

### 6.4 `/teacher/*`

- **`app/teacher/layout.tsx`** — `requireActor()`; redirects to `/` if not a teacher.
  Fetches `pendingRedemptionCountForTeacher(actor)` for the nav badge (a deliberately
  lightweight standalone query, §7.14, so every teacher page doesn't pay for the full
  dashboard query just to render the badge), plus a cheap `{id, name}`-only list of the
  actor's visible classrooms (`visibleClassroomWhere`) for the sidebar's nested section
  (below). Renders the same 6 destinations two ways, never both at once: `<TeacherTabBar>`
  (`md:hidden` — phone) and `<TeacherSidebar>` (`hidden md:flex` — tablet/desktop, the
  primary device teachers actually use per CLAUDE.md).
- **`components/teacher-sidebar.tsx`** — **one persistent sidebar, same shape on every
  `/teacher/*` page** (§8.9). This replaced an earlier design that swapped in an entirely
  different "classroom-contextual" sidebar (a second component, rendered by a since-deleted
  `app/teacher/classrooms/[id]/layout.tsx`) while inside a specific classroom's own pages —
  reversed at the user's own explicit instruction ("sidebar should have only 1 format not
  changeable") after it left no way back to the other 5 destinations except the browser
  back button. Now, viewing `/teacher/classrooms/[id]/*` only expands a nested section
  directly under the "ห้องเรียน" link — the classroom's name as a small caption, then วันนี้
  (→ `.../today`), รายชื่อนักเรียน (→ this classroom's roster page), สติกเกอร์ QR (→
  `.../print-qr`) — found via `usePathname()` matching `/teacher/classrooms/([^/]+)` against
  the classroom list passed down from the layout above; the other 5 top-level links are
  never hidden or replaced. `ตารางเรียน` and `รางวัล` aren't duplicated into this nested
  section — both already exist as top-level destinations (`/teacher/timetable` has its own
  in-page classroom picker via `<ClassroomChipTabs>`, §6.4 below; rewards isn't
  classroom-scoped at all) — and the reference mockup's separate "เก็บสมุดตรวจ" nav
  destination isn't reproduced either, since there was no second-page design to build one
  from; that concept lives entirely inside "วันนี้" (§8.8) instead of as its own route.
- **`/teacher`** (`page.tsx`) — the dashboard: `teacherDashboard(actor)`
  (`lib/dashboard.ts`) → stat cards (classroom count, student count, grading count),
  "what's on today per classroom," and upcoming exceptions (14-day horizon).
- **`/teacher/classrooms`** (`page.tsx`) — lists classrooms via `visibleClassroomWhere`.
  **There is no "create classroom" form** — that capability (`createClassroom()`) was
  deliberately removed from the product entirely at user request: classroom setup for a
  term is an out-of-band administrative/seed task, not a teacher-facing runtime feature.
  The empty state points the teacher at "ask your administrator." `renameClassroom`/
  `deleteClassroom`/`transferStudent` (`lib/roster.ts`) were removed the same way, for the
  same reason, once it was decided the reasoning applies to all classroom-administration
  actions consistently, not just creation — none of the three had a UI entry point to begin
  with, so this closed a "half-built feature" gap rather than removing anything reachable.
- **`/teacher/classrooms/[id]`** (`page.tsx`) — the classroom roster page, gated by
  `can(actor, "edit_roster", {classroom})`. Computes `isHomeroomTeacher` by comparing
  `classroom.homeroomTeacherId === actor.teacherId`; the visible subject set (and
  therefore which students' item-copy rows even get fetched) is *all* subjects taught
  here if homeroom, else only the actor's own `TeachingAssignment` rows.

  **`?myOnly=true` — a display filter, not a policy change.** A homeroom teacher who is
  *also* one classroom's subject teacher (a real seeded case now: DEV_LOGIN_EMAIL teaches
  คณิตศาสตร์ in ป.4/1 and is also its homeroom) sees every subject's "อุปกรณ์การเรียน" by
  default, per the design above — raised by the user as confusing when they think of
  themselves as "just the math teacher" on that page. Rather than narrowing homeroom's
  real scope (explicitly rejected — that's the exact regression §10 already warns against
  "fixing back": a homeroom teacher genuinely needs to manage every subject's equipment,
  not just their own), a `?myOnly=true` query param — read server-side as
  `showMyItemsOnly = isHomeroomTeacher && myOnly === "true"` — narrows only the
  `subjectsHere` query (and everything derived from it: `subjectItemsHere`,
  `missingSubjectItems`, each student's `itemCopies`, the `<BulkAddItemsButton>` list) down
  to the actor's own `TeachingAssignment` rows for this render, exactly like a non-homeroom
  teacher already sees — never touches `can()`/`edit_item_copy`, and every other
  homeroom-only section (login credentials, parent linking, consent, points) is unaffected,
  since none of them are subject-specific. A `<SegmentedControl>`-styled pair of `<Link>`s
  ("ทุกวิชา"/"วิชาของฉัน", only rendered for `isHomeroomTeacher` — a subject-only teacher has
  nothing to toggle, they already only ever see their own) switches it; plain navigation,
  no Server Action, since it's just re-rendering the same page with a different filter. The
  "issue/reissue login credentials" button, the "link a parent" form, and the "ความยินยอม
  ถ่ายรูป" (photo consent) section are only rendered at all when `isHomeroomTeacher` is
  true — a non-homeroom teacher never sees controls that would just fail server-side. The
  consent section's own status (`hasActiveConsent`, §7.8c) is fetched via one
  `Promise.all` across the homeroom teacher's students only — never queried at all for a
  subject teacher, who wouldn't see the section anyway — and shows either a "บันทึกความ
  ยินยอม (แบบฟอร์มกระดาษ)" button (→ `recordPaperConsentAction`) or a "ยกเลิกความยินยอม"
  one (→ `revokeConsentAction`) depending on current status; this is the homeroom-teacher
  path for a family who never uses the app online (§3.6a/§4.5/§7.8c), a mirror of the
  parent-facing `/parent/[studentId]/consent` screen (§6.3) for the family that does.
  A homeroom-only "แต้มสะสม" (points) section, same rendering condition as the two above,
  shows the student's current `balance()` (§7.9) and a small inline form (`delta` + `note`
  inputs) → `manualAdjustPointsAction` → `manualAdjustPoints` (§7.9/§8.4) — the
  `MANUAL_ADJUST` correction path. The balance is fetched (another `Promise.all` across
  the homeroom teacher's own students, same pattern as consent) specifically so the
  teacher sees the current number before choosing a correction, rather than adjusting
  blind. Each student's `itemCopies` query has an
  explicit `orderBy: { createdAt: "asc" }` — a *stable* order, because rapid-bind (below)
  walks this same sequence to pick "the next unbound item" and it must not reshuffle
  between renders or scans.

  **QR binding, three ways** (all three ultimately call the identical `bindCode()` in
  `lib/qr.ts` — see §8.2's "Real setup at classroom volume" for why there are three):
  1. **Manual typed code** — the original `<form action={bindCodeAction}>`, kept as the
     fallback for when the camera is unavailable, per explicit design decision.
  2. **Scan to bind** — a `<ScanBindButton itemCopyId label>` next to the manual field
     opens `<BindScannerModal>` with a single-item target list; pointing the camera at a
     printed sticker calls `scanBindAction` for that one `ItemCopy`.
  3. **Rapid bind** — a `<RapidBindButton targets>` in the "อุปกรณ์การเรียน" `ListGroup`'s
     header (disabled once every item is already bound) opens the same
     `<BindScannerModal>` with *all* of that student's items as targets (already-bound
     ones included, shown checked off) — each successful scan advances to the next
     unbound target automatically, so a teacher can do a whole student's ~8 items without
     returning to a form between scans. Both modes are the *same* component; scan-to-bind
     is just rapid-bind given a one-item target list, so there is no second implementation
     to keep in sync.

  **Bulk item-copy creation** — a `<BulkAddItemsButton classroomId items>` above the
  student list ("เพิ่มเล่มทั้งห้อง") expands into a multi-select checklist of
  `subjectItemsHere` (the same actor-scoped item list the per-student "เพิ่มเล่ม" prompt
  already uses) and an "เพิ่มเข้าทั้งห้อง" action that calls
  `createItemCopiesForClassroomAction` directly (not a `<form>`, so the
  `{created, skipped}` summary can be shown inline) → `createItemCopiesForClassroom()`
  (`lib/roster.ts`, §7.6). This exists because real onboarding is ~40 students × 8 items
  per classroom — creating each `ItemCopy` one at a time through `createItemCopyAction`
  does not scale to that volume, the same problem manual QR typing had before scan-to-bind.

  `<BindScannerModal>` (`components/bind-scanner-modal.tsx`) owns the modal chrome, local
  `targets` state (mutated only by marking a target bound/unbound — never re-sorted, so
  the stable order holds for the whole session), inline success/error feedback per scan,
  an "เลิกทำล่าสุด" (undo last) button, and a bound-count footer. It renders
  `<QRScanner>` (`components/qr-scanner.tsx`) for the camera itself — the same component
  `<ScanView>` uses on the student side (§6.2), extracted specifically so this teacher
  flow didn't need a second camera/decoder implementation. Every scan is still only a
  *claim*: `<QRScanner>`'s `onDecode` callback just reports the decoded string, and
  `<BindScannerModal>` sends it to a server action that re-verifies it from scratch —
  no client-trusted result, no new authorization path.
  - **`actions.ts`**:
    - `createStudentAction(formData: {classroomId, name})` → `createStudent()`.
    - `linkParentAction(formData: {classroomId, studentId, email, name})` →
      `linkParent()` (homeroom-only server-side, §4.5).
    - `setItemCopyStateAction(formData: {classroomId, itemCopyId, state})` →
      `setItemCopyState()` (subject/homeroom-scoped, §4.4).
    - `createItemCopyAction(formData: {classroomId, studentId, subjectItemId})` →
      `createItemCopy()`.
    - `createItemCopiesForClassroomAction(classroomId, subjectItemIds)` — not a `<form>`
      action; called directly from `<BulkAddItemsButton>` so the `{created, skipped}`
      result can be shown inline. Thin `requireActor()` + delegate to
      `createItemCopiesForClassroom()` (§7.6); a rejection (subject-scoped denial) just
      throws and is caught client-side, unlike the scan actions above — there's no
      per-scan camera loop to keep alive here, so a thrown error is enough.
    - `bindCodeAction`/`rebindCodeAction`/`voidCodeAction` (all `{classroomId, ...}`) →
      `bindCode()`/`rebindCode()`/`voidCode()` (`lib/qr.ts`) — the manual-entry `<form>` path.
    - `issueStudentCredentialsAction(studentId)` — **not** a `<form>` action; called
      directly from the client component `<IssueCredentialsButton>` via `useTransition`,
      because its plaintext-password return value must reach the screen exactly once — a
      redirect-based form action would discard the return value entirely.
    - `scanBindAction(itemCopyId, code)` / `scanUndoBindAction(code)` — also not `<form>`
      actions; called directly from `<BindScannerModal>` between camera frames. Each is a
      thin `requireActor()` + delegate to `lib/qr.ts`'s `bindCodeWithResult`/
      `voidCodeWithResult` (§7.5) — a result object instead of a thrown-and-redirected
      error, so the modal can show inline feedback and keep the camera running.
    - `recordPaperConsentAction`/`revokeConsentAction(formData: {classroomId, studentId})`
      → `recordPaperConsent()`/`revokeConsent()` (`lib/consent.ts`, §7.8c) — the
      teacher-side halves of the same two functions the parent consent screen's actions
      call; the access check inside each (homeroom-only for a teacher actor) is what
      actually enforces the split, not anything in this file.
    - All the `<form>`-bound actions share a `backToClassroom(classroomId)` helper that
      just `redirect()`s back to the roster page, forcing a fresh server render.
- **`/teacher/classrooms/[id]/print-qr`** (`page.tsx`) — `can(edit_roster)` gate. Two
  independent ways to end up with codes to print, unified by one query-string contract:
  1. **Spare/unassigned** (original flow) — the print-hidden "สร้างรหัสเปล่า" form calls
     `generateCodesAction` → `createUnassignedCodes(actor, {schoolId, count})`, which
     bulk-inserts N fresh `UNASSIGNED` codes not yet attached to anyone.
  2. **Print-and-bind** — the "สร้างพร้อมผูกให้ทั้งห้อง" form calls
     `generateAndBindCodesAction` → `lib/qr.ts`'s `generateAndBindCodesForClassroom()`
     (§7.5, §8.2), which finds every `ItemCopy` in the classroom (optionally narrowed to
     one subject via a `<select>` populated from `manageableSubjectsInClassroom`, §7.4)
     that has no `ASSIGNED` code, generates and binds a fresh one to each via `bindCode()`
     itself — no shortcut — and skips (never rebinds) any copy that already has one.

     Both actions redirect back to this same page with `?codes=<comma-joined codes>` —
     the page doesn't need to know which flow produced them. It looks each code up
     (`QRCode.findMany` joined to `itemCopy.student`/`itemCopy.subjectItem`) and passes
     the result to `<StickerSheet labels>` (`components/sticker-sheet.tsx`): a code with
     an attached `ItemCopy` renders the student's name and item name on the label; a
     still-unbound spare code falls back to printing the raw code, exactly as before —
     one render path for both flows, no branching on which action was used.
  - `<StickerSheet>` (client) also owns the print layout: a `<select>` between the two
    sticker-sheet presets in its `PRESETS` config (`24up`: 3 cols × 70×37mm; `12up`: 2
    cols × 105×48mm — add another entry to match whatever sheet stock the school buys)
    drives an inline `grid-template-columns`/label `width`/`height` in millimetres, and a
    `<Printer>` button (`window.print()`). The exact `@page { size: A4 }` rule and the
    `.sticker-label { break-inside: avoid }` guard (a label must never be split across a
    page) live in `app/globals.css`'s `@media print` block — Tailwind utilities can't
    express either.
  - **`actions.ts`**:
    - `generateCodesAction(formData: {classroomId, schoolId, count})` → `createUnassignedCodes()`.
    - `generateAndBindCodesAction(formData: {classroomId, subjectId?})` → thin
      `requireActor()` + delegate to `generateAndBindCodesForClassroom()`.
- **`/teacher/classrooms/[id]/today`** (`page.tsx`) — the per-classroom "today" dashboard
  (§8.8), rebuilt from a homeroom-only spot-check-only view into the combined dashboard
  from the user's own tablet reference mockup: stat cards, a colored-by-status student
  avatar grid, a workbook-collection panel, and (unchanged) the spot-check list. Backed
  entirely by `classroomTodayDashboard` (`lib/dashboard.ts`, §7.14) — the page itself does
  no authorization or data-shaping, just renders what that function returns.

  **The gate changed from `spot_check` to `edit_roster` — this is not a reversal of "do not
  subject-scope this page" (§10).** That guidance is specifically about the whole-bag
  packing/spot-check view, and it still holds exactly as before: `classroomTodayDashboard`
  returns `packing: null` for anyone but the homeroom teacher, and this page renders
  nothing from it in that case — a subject teacher still cannot see who packed, cannot
  spot-check, sees no per-student names or avatars. What changed is that the *page itself*
  is no longer gated out entirely for a subject teacher, because it now also carries the
  workbook-collection panel (`collectibleItems`), which — like every other item-copy
  action — is correctly subject-scoped, not homeroom-only. Reusing `spot_check`'s
  classroom-wide gate would have blocked subject teachers from that panel too; reusing
  `edit_item_copy` at the page level would have blocked homeroom-only stat cards from
  rendering for a homeroom teacher who happens to have no `TeachingAssignment` of their
  own. `edit_roster` (any subject teacher in the classroom) is the loosest gate that lets
  both sections decide their own visibility independently, exactly the same pattern the
  roster page already uses for its homeroom-only sections (§6.4 above).

  The whole-bag section, when `packing` is non-null, is otherwise unchanged in substance:
  a student's avatar tints by status (`complete`/`partial`/`not_started` — solid fill,
  `components/student-avatar.tsx`'s `status` variant, deliberately a different visual
  language from that component's name-hash tint, since this reads as *state* not
  *identity*), an "ไม่ต่อเนื่อง" badge appears when `continuous` is `false` (unchanged
  meaning, §7.8/§8.3), and a separate "ตรวจของที่นักเรียนสแกนไว้" section — filtered to only
  students with something checked — renders each checked item with a "ของไม่อยู่จริง"
  button exactly as the old page did; this is CLAUDE.md's actual anti-cheat mechanism and
  was preserved unchanged, not folded into the avatar grid, which is purely a visual
  summary.

  The collection panel lists `collectibleItems`, each with its period(s), a `เก็บแล้ว` /
  `ยังไม่เก็บ` toggle (→ `bulkCollectAction` → `bulkSetItemCopyStateForClassroom`, §7.6) —
  "เก็บแล้ว" only once *every* tracked copy is `GRADING` — and a "สมุดที่เก็บแล้ว" stat card
  summing `collectedCount` across all of them, shown to every viewer regardless of
  homeroom status (it's subject-scoped, same as the panel it summarizes). The reference
  mockup's two toolbar buttons ("ส่งเตือนทั้งห้อง", "แก้รายการพรุ่งนี้") aren't reproduced —
  neither corresponds to a real feature (no manual per-classroom push trigger, no "edit
  tomorrow's list" concept exists) and a decorative dead button would be worse than no
  button.
  - **`actions.ts`**: `spotCheckAction(formData: {classroomId, itemCopyId})` →
    `spotCheck(actor, {itemCopyId, actuallyPacked: false})` — the UI only ever sends
    `actuallyPacked: false` (there's no positive-confirmation button; confirming a match
    is simply *not clicking anything*, per `lib/packing.ts`'s "no positive ledger entry
    for checked-out-fine" design, §7.11), then `revalidatePath`. `bulkCollectAction(formData:
    {classroomId, subjectItemId, collected})` → `bulkSetItemCopyStateForClassroom(actor,
    {classroomId, subjectItemId, state: collected ? "GRADING" : "WITH_STUDENT"})` — the
    collection panel's toggle, one call either direction, then the same `revalidatePath`.
- **`/teacher/classrooms/[id]/pack/[studentId]`** (`page.tsx`) — the teacher-run packing
  flow, §8.3a: gated by `requireHomeroomAccessForStudent(actor, studentId)` (`lib/roster.ts`,
  §7.6) inside a `try`/`catch` → `notFound()`, resolved from the *student's own* current
  classroom rather than the URL's `:id` — the URL's `classroomId` is used only for the
  page's own back-link, never for authorization, so a homeroom teacher of classroom A
  can't view classroom B's student by editing the URL's `studentId` while leaving their own
  `classroomId` in place. Fetches the student's name and
  `getPackingStatus(studentId, schoolTomorrow())` (always tomorrow — matching
  `recordTeacherScan`'s own fixed `forDate`, §7.8) and renders `<TeacherScanView>`
  (`components/teacher-scan-view.tsx`) — a near-duplicate of `<ScanView>` (§6.2) sharing the
  same `<QRScanner>` decode loop, parameterized by `studentId` and calling
  `recordTeacherScanAction` instead of `recordScanAction`. Already-complete (or nothing
  required) short-circuits to a plain "done" message instead of opening the camera. The
  roster page (`/teacher/classrooms/[id]`) links here per-student, homeroom-only, via a
  "จัดกระเป๋าให้" (pack for them) button next to each student's name.
  - **`actions.ts`**: `recordTeacherScanAction(params: {studentId, code, photoDataUrl?})` →
    `recordTeacherScan` — mirrors `/student/scan/actions.ts`'s `recordScanAction`, catching
    `InvalidScanError`/`ForbiddenError` the same way; no `PackingWindowClosedError` branch,
    since `recordTeacherScan` never throws it (§7.8).
- **`/teacher/exceptions`** (`page.tsx`) — classroom-picker tabs (via `visibleClassroomWhere`)
  + `listScheduleExceptions()` for the next 3 months + an add form.
  - **`actions.ts`**: `createExceptionAction`/`deleteExceptionAction` →
    `createScheduleException()`/`deleteScheduleException()` (`lib/timetable.ts`).
- **`/teacher/rewards`** (`page.tsx`) — lists the schools the actor's visible classrooms
  belong to, that school's `Reward`s, and `PENDING` `Redemption`s to fulfill. Each reward
  row shows its cost and stock (`เหลือ N ชิ้น`, or `ไม่จำกัด` for `null`), an inline
  restock control (a number input pre-filled with the current stock, empty = unlimited,
  plus a "บันทึก" button — the only UI path to `updateReward`'s `stock` field), an
  active/inactive toggle (`"ปิดรับแลก"`/`"เปิดรับแลก"` — the UI path to `active`, which
  `deleteReward`'s error message points a teacher at when it refuses to delete a reward
  with redemption history, §3.6/§7.10), and the delete button. The "add reward" form has a
  third "จำนวนที่มี" (stock) field alongside name/cost, blank for unlimited.
  - **`actions.ts`**: `createRewardAction` (now also reads `stock`, blank → `null`) /
    `restockRewardAction`/`toggleRewardActiveAction` (both thin wrappers around
    `updateReward`) / `deleteRewardAction`/`fulfillRedemptionAction` → the matching
    `lib/rewards.ts` functions. A `deleteRewardAction` rejection (redemption history
    exists) throws and is caught by `app/error.tsx` like any other `lib/*.ts` error — no
    inline handling here, matching `deleteSubjectAction`'s equivalent archive-blocked case.
- **`/teacher/subjects`** (`page.tsx`) — the per-school curriculum catalog editor
  (`edit_catalog`'s coarse-but-not-cross-school design, §4.4). Resolves the actor's
  school(s) from their `TeachingAssignment`s the same way classroom creation used to
  (§6.4's note below on that removed feature) and lists only that school's `Subject`s,
  filtered to `archivedAt: null` — archived subjects/items never appear here even though
  they still resolve for students (§3.3). Each item row shows a "ชุดสอบ" (exam kit) badge
  when `forExam` is true, next to a toggle button that flips it; the "add item" form has a
  "สำหรับวันสอบ" checkbox so a new item can be created already flagged (§3.3's exam-day
  items design decision).
  - **`actions.ts`**: `createSubjectAction(schoolId, name)` (the form includes a hidden
    `schoolId` field, or a `<select>` if the teacher has more than one school) /
    `deleteSubjectAction` (now archives — see §3.3/§7.18) / `createSubjectItemAction`
    (now also reads a `forExam` checkbox) / `deleteSubjectItemAction` (also archives) /
    `setSubjectItemForExamAction(subjectItemId, forExam: "true" | "false")` → `lib/catalog.ts`.
    `restoreSubject`/`restoreSubjectItem` exist in `lib/catalog.ts` but have no wired-up
    button yet.
- **`/teacher/timetable`** (`page.tsx`) — **read-only**: classroom-picker tabs + a
  weekday×period grid of colored subject blocks (`<SubjectChip>`, §3.3/§7.5's same
  deterministic-by-name palette used on the student scan view and roster page). No edit
  path — the timetable itself has none, anywhere (§10). Cells whose subject is in
  `manageableSubjectsInClassroom(actor, classroomId)` (§4.3/§7.6 — homeroom sees every
  subject taught here, a subject teacher only their own) render highlighted (a tinted
  background + ring, bold label) against the plain/muted treatment for every other
  subject, with a small legend above the grid — "which of these periods are mine," the
  thing a subject teacher scanning their own weekly schedule actually wants at a glance.
  Shows the current term's name in the page subtitle (`termFor(classroom.schoolId,
  schoolToday())`) — this page always shows "the term covering today," there's no term
  picker (§10) — and shows a message instead of the grid if no term currently covers
  today for that school.

### 6.5 Non-page API routes

- **`app/api/cron/reminders/route.ts`** (`POST /api/cron/reminders`) — the only route in
  the app authenticated by a shared bearer secret (`CRON_SECRET`) rather than a user
  session, because its caller is an external scheduler, not a browser. Rejects with 401
  if the `Authorization: Bearer <secret>` header doesn't match. Calls
  `sendEveningReminders()` and returns its `{sent, pruned, failed}` counts as JSON —
  `200` unless `sent === 0 && failed > 0` (every attempted delivery failed and nothing at
  all got through), in which case `502`. Deliberately **not** `sent === 0` alone — a quiet
  evening where every subscribed student is already fully packed also has `sent === 0`,
  and that's a healthy run, not a failure.
- **`app/api/photos/[checkId]/route.ts`** (`GET /api/photos/:checkId`) — the *only* way a
  packing-check photo is ever served; there is no public/static path to one (CLAUDE.md
  "Privacy"). `requireActor()`, look up the `PackingCheck`'s `photoPath` and owning
  student, then `can(actor, "view_student", {studentId})` — the same check a parent's
  dashboard view uses — **before** ever calling `photoStorage.read(...)` (§7.8b). What
  happens after that check passes depends on the configured storage backend, but the
  check itself is identical either way: `PhotoReadResult.kind === "bytes"` (local disk)
  streams the bytes back with `Cache-Control: private, max-age=3600`;
  `kind === "redirect"` (S3-compatible) instead 302-redirects to the freshly-minted
  60-second presigned URL with `Cache-Control: private, no-store` (a cached redirect to
  an already-expired signed URL would just be a dead link — every request re-authorizes
  and gets its own fresh one).

## 7. `lib/` Function Reference

Every exported function, file by file.

### 7.1 `lib/actor.ts`

- **`resolveActor(userId: string): Promise<Actor>`** — three parallel `findUnique`s
  (Teacher/Parent/Student by `userId`), assembles the `Actor` shape (§4.1). No
  authorization check itself — it's the thing authorization checks are built from.

### 7.2 `lib/session.ts`

- **`currentActor(): Promise<Actor | null>`** — calls Auth.js's `auth()`; if there's no
  session, returns `null`; else resolves the actor via `resolveActor`.
- **`requireActor(): Promise<Actor>`** — `currentActor()`, and `redirect("/login")` if
  null. The standard guard called at the top of every protected page/layout/action.

### 7.3 `lib/errors.ts`

- **`ForbiddenError`** (class) — constructed with `(action, resource)`; the message is
  built by a private `describe(resource)` switch that stringifies each `Resource` variant
  (including `item_copy`, which describes both its classroom and subject). This is the
  error every `lib/*.ts` authorization failure throws.
- **`PackingWindowClosedError`** — thrown by `lib/packing.ts` when a scan lands outside
  both configured windows (morning and evening, §7.8/§8.3); carries the Thai user-facing
  message directly, which is already window-neutral ("ยังไม่ถึงเวลาจัดกระเป๋า" — "not packing
  time yet") rather than naming either window.
- **`InvalidScanError`** — thrown by `lib/packing.ts` for a scan that can't be resolved
  to a checkable item (unknown code, unassigned code, nothing scanned yet at spot-check
  time). Takes a caller-supplied message rather than a fixed one, since it covers several
  distinct situations.

### 7.4 `lib/prisma.ts`

- **`prisma`** (the singleton `PrismaClient`, constructed with `PrismaPg` driver adapter
  over `DATABASE_URL`) — cached on `globalThis.__prisma` outside production, so Next.js
  dev-mode HMR reloads reuse the same client instead of exhausting Postgres's connection
  pool by creating a fresh one on every hot reload.

### 7.4a `lib/db-retry.ts`

- **`isSerializationFailure(err): boolean`** (private) — Postgres SQLSTATE 40001
  (`serialization_failure`), the expected, correct outcome of two transactions racing
  under `isolationLevel: "Serializable"` — not a bug, but a real database error that
  shouldn't reach a caller as-is. Checked two ways, both verified against this project's
  actual `@prisma/adapter-pg` setup (a throwaway probe script triggering a real two-way
  race, not a guess): primarily `err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === "P2034"` (what a Serializable write conflict actually surfaces as here —
  the raw SQLSTATE arrives nested inside `err.meta.driverAdapterError.cause.originalCode`),
  with a substring check of the stringified message+meta for `"40001"` as a fallback for
  any other shape (Prisma error code, wrapping layer) that same conflict could plausibly
  surface as. Anything else — including a deliberate `Error` thrown inside the wrapped
  transaction body ("แต้มไม่พอ", "ของรางวัลหมดแล้ว") — returns `false`: a business
  rejection, not a race, and retrying it would just throw the same thing again.
- **`withSerializableRetry<T>(fn: () => Promise<T>): Promise<T>`** — runs `fn` (meant to
  be a `prisma.$transaction(..., {isolationLevel: "Serializable"})` call); on a
  serialization failure, retries with short jittered backoff (`20 * attempt + up to 30ms`
  random) up to 3 times before giving up and rethrowing; any non-serialization error
  rethrows immediately, no retry. Deliberately generic — takes an arbitrary thunk, not a
  `Prisma.TransactionClient` or anything reward-specific — so it's reusable by any future
  Serializable transaction in this codebase. The only caller today is `lib/rewards.ts`'s
  `redeem()` (§7.10); `lib/points.ts`'s `awardPenaltyCappedAtZero` also runs at
  Serializable isolation but was not wrapped — not because it's exempt, just because
  wrapping it wasn't asked for when this helper was introduced (see §10).

### 7.5 `lib/qr.ts`

- **`generateCode(): string`** — 12 random bytes mapped through a 33-character alphabet
  (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, deliberately excluding `0`/`O`/`1`/`I` to avoid
  human misreading on a printed sticker), prefixed `bk_`. Invariant 2: opaque, no
  embedded data.
- **`createUnassignedCodes(actor, {schoolId, count}): Promise<string[]>`** — checks
  `can(actor, "edit_exceptions", {school})` (school-wide, any teacher there — printing
  spare stickers isn't classroom- or subject-scoped), validates `1 <= count <= 200`,
  bulk-inserts `count` fresh `UNASSIGNED` codes, returns them.
- **`requireTeacherAccessForItemCopy(actor, itemCopyId): Promise<void>`** — the shared
  authorization gate for every QR/item-copy mutation: loads the item copy's `studentId`
  and `subjectItem.subjectId`, resolves the student's active enrollment → classroom, then
  `can(actor, "edit_item_copy", {classroomId, subjectId})`. Throws `ForbiddenError` on
  denial, or a plain `Error` if the student has no active enrollment at all. Reused by
  `bindCode`/`rebindCode`/`voidCode` here and by `lib/roster.ts`'s `setItemCopyState` and
  `lib/packing.ts`'s `spotCheck`.
- **`bindCode(actor, {code, itemCopyId})`** — authorization via the above, then inside a
  transaction: loads the code, throws if it isn't `UNASSIGNED`, else updates it to
  `ASSIGNED` with `itemCopyId` and `boundAt: now`.
- **`generateAndBindCodesForClassroom(actor, {classroomId, subjectId?}): Promise<string[]>`**
  — the print-and-bind flow (§6.4, §8.2). Resolves which subjects to cover: an explicit
  `subjectId` is checked with `can(actor, "edit_item_copy", {classroomId, subjectId})` and
  rejected outright if the actor may not manage it (a deliberate, explicit reject — this
  is a caller-named subject, not an enumeration); omitted, it narrows to
  `manageableSubjectsInClassroom(actor, classroomId)` (§4.6) instead, so a subject teacher
  naturally gets stickers only for their own subject with no per-item rejection needed.
  Queries every `ItemCopy` in scope (active enrollment in the classroom, subject in the
  resolved set) with no `ASSIGNED` `QRCode` (`qrCodes: { none: { state: "ASSIGNED" } }` —
  an already-bound copy is excluded entirely, never touched). For each: `generateCode()`,
  insert it as a fresh `UNASSIGNED` row, then bind it via **`bindCode()` itself** — not an
  inlined copy of its logic — so every guarantee `bindCode` enforces (subject/homeroom
  authorization, the code must be `UNASSIGNED`) applies exactly as it would to a manual
  bind. Returns the bound codes in the order processed; the caller (`generateAndBindCodesAction`)
  redirects with them the same way `createUnassignedCodes` already does.
- **`rebindCode(actor, {itemCopyId, newCode})`** — invariant 3 in code: inside one
  transaction, sets every currently-`ASSIGNED` code for that item copy to `VOID` (its
  `itemCopyId` is left untouched — history preserved), then binds `newCode` the same way
  `bindCode` does (throwing if it isn't `UNASSIGNED`).
- **`voidCode(actor, code)`** — if the code is currently bound to an item copy, authorizes
  via `requireTeacherAccessForItemCopy` (classroom+subject-scoped); if it was never bound
  to anyone (a spare printed sticker), any teacher may void it (a plain `actor.teacherId`
  check — voiding an unbound sticker isn't tied to any classroom/subject to scope
  against). Sets `state: VOID` either way.
- **`currentCodeForItemCopy(itemCopyId)`** — `findFirst` where `itemCopyId` matches and
  `state = ASSIGNED`. No auth check — a read helper, callers scope visibility themselves.
- **`friendlyQrError(err): string`** (private) — maps a `bindCode`/`voidCode` failure to a
  short Thai message for the scan-flow UI: `ForbiddenError` → a permission message,
  Prisma's `PrismaClientKnownRequestError` code `P2025` (the code doesn't exist at all) →
  a "not found, did you print this sticker?" message, the literal
  `"is not available to bind"` substring `bindCode`/`rebindCode` throw → an
  already-used/voided message, anything else → the raw error message. Introduces no new
  rejection logic — every branch here is a failure `bindCode`/`voidCode` already produce.
- **`bindCodeWithResult(actor, {code, itemCopyId}): Promise<QrScanResult>`** — calls
  `bindCode` exactly as-is (same authorization, same transaction, same invariants) and
  catches its throw into `{ ok: false, error: friendlyQrError(err) }` instead of letting
  it propagate; success returns `{ ok: true, itemCopyId, code }`. Exists so the
  camera-driven scan-to-bind/rapid-bind UI (§6.4) can show inline feedback and keep the
  camera open across many scans, rather than each scan tearing down the page via a
  thrown-and-redirected (or `error.tsx`-boundary-caught) error. **No new authorization
  path** — this is a result-shaped wrapper around the identical `bindCode`, not a second
  way to bind a code.
- **`voidCodeWithResult(actor, code): Promise<{ok:true} | {ok:false; error}>`** — same
  relationship to `voidCode` that `bindCodeWithResult` has to `bindCode`; backs the scan
  flows' "เลิกทำล่าสุด" (undo last) button, reverting a mis-scanned bind so the item can
  be scanned again.

### 7.6 `lib/roster.ts`

- **`createStudent(actor, classroomId, name)`** — `can(edit_roster, {classroom})`, then a
  transaction: create the `Student`, create an `Enrollment` starting today. Classroom-wide
  (any subject teacher).
- **`requireClassroomAccessForStudent(actor, studentId, action)`** (private) — resolves
  the student's active enrollment → classroom, then `can(actor, action, {classroom})`.
  The shared primitive behind the next two.
- **`requireRosterAccessForStudent(actor, studentId)`** (private) — thin wrapper passing
  `"edit_roster"`.
- **`requireHomeroomAccessForStudent(actor, studentId)`** (exported) — thin wrapper
  passing `"edit_student_account"` — homeroom-only (§4.5). Exported specifically so
  `lib/packing.ts`'s `recordTeacherScan` (§7.8/§8.3a) and the page that gates access to it
  (`/teacher/classrooms/[id]/pack/[studentId]`, §6.4) can reuse this exact check — resolved
  from the student's own current classroom via the private `requireClassroomAccessForStudent`
  it wraps, not any classroom id a caller might otherwise supply, so neither the page nor
  the mutation can be pointed at the wrong classroom by editing a URL.
- **`linkParent(actor, studentId, {email, name})`** — homeroom-gated. `upsert`s the
  `Parent` by email (create-or-reuse) then `upsert`s the `Guardianship` — both idempotent,
  so re-linking the same email twice doesn't duplicate anything.
- **`setItemCopyState(actor, itemCopyId, state: ItemCopyState)`** — delegates its entire
  authorization to `qr.ts`'s `requireTeacherAccessForItemCopy` (subject/homeroom-scoped),
  then a plain `update`. This is the GRADING toggle button's server-side handler.
- **`bulkSetItemCopyStateForClassroom(actor, {classroomId, subjectItemId, state})`** — the
  classroom-wide counterpart, behind the "today" dashboard's collection panel (§7.14/§8.8):
  sets every currently-enrolled student's copy of one `SubjectItem` to `GRADING` (collected)
  or `WITH_STUDENT` (returned) in a single `updateMany`, instead of one student at a time on
  the roster page. Same subject-scoped `edit_item_copy` check as every other item-copy
  action — inlined the same way `createItemCopy` inlines it, since there's no single
  `itemCopyId` yet to resolve the subject from (resolved from `subjectItemId` instead). A
  withdrawn student's copy is excluded by the same active-enrollment filter used throughout
  (`createItemCopiesForClassroom` above, `classroomTodayDashboard`, §7.14). Introduces no
  new state — this is a bulk way to set the same `ItemCopy.state` invariant 5 already
  defines, never a second "collected" concept.
- **`createItemCopy(actor, {studentId, subjectItemId})`** — resolves the classroom via
  the coarse `requireRosterAccessForStudent` first, looks up the new copy's `subjectId`
  and `archivedAt` from `subjectItemId`, rejects if archived (§3.3 — no new copy of a
  retired item), then does the *same* `edit_item_copy` check `qr.ts` would (there's
  no existing `itemCopyId` yet to delegate to, so the check is inlined here instead),
  before creating the copy with `state: WITH_STUDENT`.
- **`createItemCopiesForClassroom(actor, {classroomId, subjectItemIds})`** — bulk
  onboarding: creates one `ItemCopy` (`WITH_STUDENT`) per (active student in the
  classroom) × (given subject item). Unlike `createItemCopy`, authorization is checked
  *per subject item* up front — for each id, resolve its `subjectId` and require
  `edit_item_copy` on `{classroomId, subjectId}` — and if any single item fails, the
  whole call throws before anything is written (no partial application; a subject
  teacher can't smuggle in another subject's items by bundling them with their own).
  Only students with an active enrollment (`endDate: null` or in the future) get copies.
  Writes via a single `createMany({ skipDuplicates: true })` against the existing
  `@@unique([subjectItemId, studentId])` constraint, so re-running the same call is
  always a safe no-op — returns `{created, skipped}` rather than throwing on overlap.
  Called from the roster page's "เพิ่มเล่มทั้งห้อง" (add to whole class) control, which
  only offers the subject items the current actor may already manage in that classroom
  (the same `subjectItemsHere` the per-student "เพิ่มเล่ม" prompt uses).
- **`issueStudentCredentials(actor, studentId)`** — homeroom-gated. Reuses the student's
  existing `studentCode` if one exists (a reset keeps the same code, only rotates the
  PIN) or generates a fresh one; always generates a fresh password; hashes it with
  `bcrypt` (cost 10); persists the hash and clears any lockout state; **returns the
  plaintext once** — this return value is the only place the plaintext PIN ever exists
  outside the teacher's screen and the student's memory.

### 7.7 `lib/required-items.ts`

- **`assembleItems(effective, subjectItems, copyBySubjectItem)`** (private, pure) — the
  core invariant-5 logic: for each `SubjectItem` whose subject is actually scheduled
  today (per `effective`, the exception-resolved slot list from `lib/schedule.ts`),
  first partitions by exam status — a subject counts as "exam today" if *any* of its
  `effective` slots has `source: "exam"`; an item is kept only when its own `forExam`
  matches that (§3.3's "Exam-day items" design decision) — then looks up the student's
  tracked, non-`GRADING` copy of whichever items survived that filter; if there isn't
  one, silently drop the item (no copy tracked, or it's with the teacher for grading —
  either way, nothing to tell the student to bring). Sorted by each item's earliest
  period. A plain `PERIOD_SWAP` slot (`source: "swap"`) is not exam status — only an
  actual `EXAM` exception's `source: "exam"` triggers the exam-item selection.
- **`requiredItemsFor(studentId, date): Promise<RequiredItemsResult>`** — the single most
  invariant-dense function in the codebase. Resolves the student's enrollment active *on
  that date* (not "today" — this matters for the week view's future dates), resolves
  which `Term` covers that date via `lib/terms.ts`'s `termFor` (§7.20), fetches that
  term's `TimetableSlot`s for that weekday and that exact date's `ScheduleException`s
  (both classroom- and school-scoped) — if no term covers the date, treated the same as
  "no timetable" (empty slots), not an error — reconciles them via `applyExceptions`
  (§7.15), short-circuits to an empty holiday result if the day is wiped, otherwise
  fetches the relevant `SubjectItem`s and the student's matching non-`GRADING` `ItemCopy`s,
  and hands off to `assembleItems`. Neither this `SubjectItem` fetch nor the `ItemCopy`
  fetch filters on `archivedAt` — deliberately: see §3.3's design decision. An archived
  item is invisible to the catalog UI and can't be assigned to anyone new, but a student
  who already has a live `ItemCopy` of it keeps being told to bring it, because this
  function never checks whether the definition behind that copy is still "active."
- **`requiredItemsForWeek(studentId, weekStart): Promise<WeekDayResult[]>`** — the same
  computation for Mon–Fri from `weekStart`, batched into a handful of queries instead of
  calling `requiredItemsFor` five times. Fetches *all* of the student's enrollments
  overlapping the week range (not just one), *all* terms overlapping the range across
  those enrollments' schools (`termsCoveringRange`, §7.20), and *all* `TimetableSlot`s
  for the relevant classrooms — then resolves each day of the week independently:
  `enrollmentFor(target)` picks the enrollment whose span actually contains that day
  (handling a mid-week classroom transfer), and `termForSchoolOn(terms, schoolId, target)`
  picks the term covering that day for that enrollment's school (handling a week that
  spans a term boundary — each day's slots are filtered to that specific term's `termId`,
  so Monday and Thursday in the same requested week can legitimately resolve against two
  different terms with two different timetables).

### 7.8 `lib/packing.ts`

- **No more module-level constants.** `PACKING_WINDOW_START_HOUR`/`PACKING_WINDOW_END_HOUR`/
  `SESSION_TTL_MINUTES` (and `POINTS_PER_COMPLETION`, used here for the completion award)
  moved to per-school columns on `School` — see `lib/school-settings.ts` below and §3.2.
  CLAUDE.md anti-cheat still holds: every bound is a server-side value checked against
  `schoolNow()`/`Date.now()`, never anything client-supplied — it's just resolved per
  school now instead of hardcoded.
- **`minutesSinceMidnight()`** (private) — `schoolNow().hour * 60 + schoolNow().minute`,
  the shared unit both window checks compare against.
- **`isInMorningWindow(settings)` / `isInEveningWindow(settings)`** (private) —
  `minutesSinceMidnight()` inside `[morningWindowStartMinute, morningWindowEndMinute)` /
  `[packingWindowStartHour * 60, packingWindowEndHour * 60)` respectively. Two independent
  checks, not an else-branch of each other, since a school could in principle configure
  overlapping or adjacent windows — resolution order (morning checked first) is
  `resolveOpenWindow`'s job, not these.
- **`resolveOpenWindow(settings): SchoolDate | null`** (private) — the server-side answer
  to "which date is `schoolNow()` open to pack for right now, if any": the morning window
  → `schoolToday()`, else the evening window → `schoolTomorrow()`, else `null`. This is the
  one place that decides "today or tomorrow," entirely from `schoolNow()` — `recordScan`
  never takes a date from the client. Because `schoolToday() != schoolTomorrow()` always,
  the two windows can never resolve to the same `PackingSession` row on a given calendar
  day; see `getOrStartSession` for why that still doesn't allow a double-award across the
  two mornings/evenings that *do* share a `forDate` (yesterday evening and this morning
  both target today's actual calendar date once the calendar rolls over).
- **`packingFocusDate(settings): SchoolDate`** (exported) — the date the student's *own
  screen* frames itself around even when browsing outside an active window: `schoolToday()`
  while the morning window is open, `schoolTomorrow()` the rest of the time (unchanged
  default). Used by `/student/scan` and `<TomorrowView>` instead of a hardcoded
  `schoolTomorrow()`, so the student's screen actually says "today" during the morning
  window (§6.2) rather than always "tomorrow."
- **`isExpired(session, sessionTtlMinutes)`** (private) — `Date.now() -
  session.startedAt.getTime() > sessionTtlMinutes * 60_000`. Note both this and session
  creation read `Date.now()`, not a DB-generated timestamp, deliberately — the code
  comment calls out that they must read the *same* clock.
- **`getOrStartSession(studentId, forDate, settings, startedByUserId)`** (private) —
  `forDate` arrives already resolved by the caller (`resolveOpenWindow` for `recordScan`,
  always `schoolTomorrow()` for `recordTeacherScan`) to whichever window is currently open,
  or explicitly bypassed; this function only manages session continuity for that date, not
  window logic. `startedByUserId` (§3.5) is stamped only on the session row created *here*
  — `null` from `recordScan`, the acting teacher's `userId` from `recordTeacherScan` — and
  only on a freshly-created row: if this call is really a carry-forward from an expired
  prior session, that prior session's own `startedByUserId` is left untouched, since this
  parameter only describes who initiated the fresh row, not who owns the whole history.
  Finds the most recent session for that date; if `COMPLETED`, returns it as-is — this is
  what stops a student's evening scan from re-completing (and re-awarding) a date already
  finished that morning, or vice versa: both windows key sessions purely by `forDate`, so
  "yesterday evening's session for tomorrow" and "this morning's session for today" are
  literally the same row once the calendar date in question arrives, and this check makes
  reaching it via either window idempotent. If `ACTIVE` and not expired, reuses it; if
  `ACTIVE` and expired, marks it `EXPIRED` first. **The TTL no longer discards progress**:
  if there was a prior (now `EXPIRED`) session for the same date, its `PackingCheck` rows
  are moved (`updateMany`, in the same transaction as the new session's `create`) onto the
  fresh session's id instead of being left behind, and the fresh session is created with
  `continuous: mostRecent == null` — `false` whenever it's picking up after an earlier
  expiry. This is what makes the TTL "reset the clock, not the student's progress": the
  timer restarts, but nothing already scanned has to be re-scanned. A student who expires
  twice in one window still ends up with one session holding every check, chained through
  however many expiries it took.
- **`savePhoto`/`photoFilePath` moved to `lib/photo-storage.ts`** (§7.8b) — pulled out of
  this file specifically to break a circular import: `recordScan` (below) needs
  `hasActiveConsent` from `lib/consent.ts`, and `lib/consent.ts`'s `revokeConsent` needs to
  delete photo files, which needs the same path-resolution logic `savePhoto` uses. Neither
  of those two could import the other, so the shared photo-file mechanics live in a third,
  lower-level module both depend on instead.
- **`tryCompleteSession(sessionId, studentId, forDate, settings)`** (private) — loads
  what's required for `forDate`; if every required item's copy has a `PackingCheck` under
  *this specific session* — which, thanks to the carry-forward above, now means "checked
  at any point during this window's session, across however many expiries it took" —
  transitions the session to `COMPLETED` and awards `settings.pointsPerCompletion` inside
  one transaction that re-checks `status === "ACTIVE" && !pointsAwarded` and re-checks
  expiry, so a race between two near-simultaneous last-item scans can't double-award.
- **`performScan(studentId, code, photoDataUrl, forDate, settings, startedByUserId)`**
  (private) — the scan mechanics shared by `recordScan` and `recordTeacherScan` (§8.3a):
  code resolution, ownership, session continuity, the photo consent+sampling gate, and
  completion all live here exactly once, so a teacher-run scan completes/awards/streaks
  identically to a student-run one downstream. Resolves the code → must be `ASSIGNED` with
  a bound item copy, else `InvalidScanError`. Verifies the item copy actually belongs to
  `studentId` (`ForbiddenError` otherwise — the ownership check that stops scanning someone
  else's book, whoever is holding the phone). Starts/reuses the given `forDate`'s session
  via `getOrStartSession`. The photo is saved (`savePhoto`, §7.8b) only when
  `photoDataUrl` is present **and** `hasActiveConsent(studentId, "PHOTO_CAPTURE")`
  (§3.6a/§7.8c) **and** `shouldCapturePhoto(studentId, itemCopy.subjectItemId)` (§7.8b/§8.6's
  sampling) — all three checked here, server-side, every time, regardless of which caller
  is scanning; a client that sends a photo frame despite having no consent on file, or
  landing outside this scan's sample, just has it silently discarded, never stored,
  `PackingCheck.photoPath` stays `null`. Scanning itself (item verification, session
  progress, completion) is entirely unaffected either way. Upserts the `PackingCheck`
  (idempotent re-scan) with whatever `photoPath` resulted, then attempts completion. What
  differs between the two callers — authorization, which date is targeted, and who (if
  anyone) is recorded as having started the session — is resolved by each caller *before*
  this runs, never inside it.
- **`recordScan(actor, {code, photoDataUrl?}): Promise<{itemCopyId}>`** — the ordinary,
  student-run QR-scan entry point. Requires `actor.studentId`. Resolves
  `schoolSettingsForStudent` once, then `resolveOpenWindow(settings)` —
  `PackingWindowClosedError` if neither window is open right now — then delegates to
  `performScan(actor.studentId, params.code, params.photoDataUrl, forDate, settings, null)`
  — always `null` for `startedByUserId`.
- **`recordTeacherScan(actor, {studentId, code, photoDataUrl?}): Promise<{itemCopyId}>`**
  — the teacher-run counterpart, §8.3a. Authorizes via
  `requireHomeroomAccessForStudent(actor, params.studentId)` (`lib/roster.ts`, §7.6) —
  homeroom teacher of the student's own current classroom only, resolved from the
  student's actual active enrollment, never from a classroom id a caller might otherwise
  supply, so it can't be pointed at the wrong classroom; a subject teacher assigned to the
  same classroom but not homeroom is denied exactly like `linkParent`/
  `issueStudentCredentials` (§4.5). **Never calls `resolveOpenWindow`/`withinPackingWindow`
  at all** — the window bypass is the fact that this is an entirely separate, gated entry
  point, not a flag `recordScan` could be called with (this codebase's established idiom
  for a teacher-only bypass — compare `bindCode`/`rebindCode`/`voidCode`, or
  `grantConsentOnline`/`recordPaperConsent`, each separate functions rather than one
  function with a boolean parameter). `forDate` is unconditionally `schoolTomorrow()` —
  matching the evening flow this substitutes for at the end of the school day, regardless
  of what time of day the teacher actually runs it. Delegates to
  `performScan(params.studentId, params.code, params.photoDataUrl, forDate, settings,
  actor.userId)` — `actor.userId` is what lands in `PackingSession.startedByUserId`
  (§3.5), the audit trail invariant 7 requires of a teacher-facing override.
- **`getPackingStatus(studentId, forDate): Promise<PackingStatus>`** — the read-side view
  behind both the student's own screen and the teacher's spot-check list. Computes
  `requiredItemsFor` and `schoolSettingsForStudent` together, finds the most recent session
  for the date, reads its checks (scoped to that one session — which, again, already holds
  everything carried forward from any earlier expiry), and returns each item annotated
  `checked`, plus `packedCount`/`total`/`isComplete`/`pointsAwarded`/`pointsPerCompletion`
  (the resolved per-school value, for `<TomorrowView>`'s "+N คะแนน" display), `continuous`
  (`session?.continuous ?? true` — the flag surfaced to the teacher, §6.4/§8.3), and an
  `activeSession` window (`startedAt`/`expiresAt`, using the school's own
  `sessionTtlMinutes`) if one is currently live. This function itself has no concept of
  "morning" or "evening" — it just answers "what's the status for this `forDate`," and the
  caller (the teacher's page always passes `schoolToday()`; the student's own screen passes
  `packingFocusDate(settings)`) is what makes a morning-window session show up correctly on
  the morning spot-check page — no special-casing needed here for that to work.
- **`requireHomeroomAccessForItemCopyOwner(actor, studentId)`** (private) — resolves the
  student's active enrollment → classroom, then `can(actor, "spot_check", {classroom})`
  (homeroom-only). Deliberately its own function, not a reuse of `lib/qr.ts`'s
  `requireTeacherAccessForItemCopy` — that one is subject-scoped by design (§4.4), and
  spot-checking is the one item-copy action that is homeroom-only instead (§6.4/§10).
- **`spotCheck(actor, {itemCopyId, actuallyPacked})`** — invariant 7's teacher-override
  path. Authorizes via `requireHomeroomAccessForItemCopyOwner` above — **homeroom-only**,
  unlike every other item-copy action in this codebase. If `actuallyPacked` is true, does
  nothing and returns `null` — there is *no* positive
  ledger entry for "checked out fine," only ever a negative one for a catch. If false,
  verifies a check actually exists for that item today (either window — else
  `InvalidScanError`, nothing to contest), resolves the student's school settings, then
  calls `awardPenaltyCappedAtZero(studentId, settings.pointsPerCompletion,
  "MORNING_CHECK_FAIL", {refId, actorUserId})` (§7.9) — the penalty is exactly that
  school's completion award, floored at the student's current balance, with
  `actorUserId: actor.userId` as the invariant-7 audit trail.

### 7.8b `lib/photo-storage.ts`

Extracted out of `lib/packing.ts` (§7.8) specifically to break a circular import between
it and `lib/consent.ts` (§7.8c) — see that section's own note. Owns everything about
photo files as files; nothing here knows what a `PackingSession` or a `Consent` is.

- **`PhotoStorage` interface** — `save(filename, bytes, contentType)`, `delete(filename)`,
  `read(filename): Promise<PhotoReadResult>`. Two implementations, chosen by
  `PHOTO_STORAGE_DRIVER` and constructed once as the `photoStorage` singleton (module
  load, mirroring `lib/prisma.ts`'s eager-singleton style, though without its HMR-caching
  concern — an `S3Client` isn't a connection pool the way `pg` is):
  - **`LocalDiskPhotoStorage`** (`driver: "local"`, the default) — `var/packing-photos/`
    on disk, exactly the pre-existing behavior. Fine for dev; **lost on every
    redeploy/serverless cold start, with no backup**, which used to be this project's
    only storage option despite the photo pipeline existing specifically to accumulate a
    term's worth of CV training data — the storage choice directly contradicted the
    stated purpose (§8.6).
  - **`S3PhotoStorage`** (`driver: "s3"`) — any S3-compatible object storage (AWS S3,
    Cloudflare R2, or GCS's S3-interop mode; `@aws-sdk/client-s3` +
    `@aws-sdk/s3-request-presigner`), configured via `PHOTO_STORAGE_BUCKET` +
    `PHOTO_STORAGE_REGION` (default `"auto"`, works for R2) + `PHOTO_STORAGE_ENDPOINT`
    (required for R2/GCS, left unset for real AWS S3) + access key/secret. `read()`
    returns a short-lived (60s) presigned `GetObjectCommand` URL instead of bytes —
    never a public or permanent one, and never generated before the caller's own
    authorization check has already run (§6.5).
- **`PhotoReadResult`** — `{kind: "bytes", bytes, contentType}` (local disk) or
  `{kind: "redirect", url}` (S3) — the photo-serving route branches on `kind` to decide
  whether to stream bytes itself or redirect the browser, but its authorization check
  (§6.5) runs identically either way, before `read()` is ever called.
- **`localPhotoFilePath(filename): string`** (exported, but deliberately *not* part of
  the `PhotoStorage` interface) — resolves a filename to its on-disk path assuming the
  local driver; only meaningful when `PHOTO_STORAGE_DRIVER=local` (the dev/test default).
  Exists purely so tests can assert a file was actually written to or removed from disk;
  production code always goes through `photoStorage` instead, which behaves the same
  regardless of backend.
- **`savePhoto(dataUrl): Promise<string | null>`** — parses a
  `data:image/{png,jpeg,webp};base64,...` URL via regex, generates a `<uuid>.<ext>`
  filename, and calls `photoStorage.save(...)` — the storage backend is an implementation
  detail from here down. Returns `null` for a malformed/missing data URL rather than
  throwing — a scan without a usable frame still records the check.
- **`deletePhotosForChecks(checks): Promise<number>`** — given `{id, photoPath}` rows,
  calls `photoStorage.delete(...)` for each one (local disk tolerates a missing file;
  S3-compatible `DeleteObject` is already idempotent for a missing key, so no special
  casing is needed there) and nulls its `PackingCheck.photoPath`, returning the count
  actually deleted. One operation, two callers with two different `where` clauses:
  `scripts/purge-old-photos.ts` (age-based — everything past the retention window) and
  `lib/consent.ts`'s `revokeConsent` (student-based — everything for one student,
  regardless of age, the moment consent is withdrawn). Neither caller changed when the
  storage backend became pluggable — both already went through this function rather than
  touching files directly.
- **`photoStorageSummary(studentId): Promise<{count, earliest, latest}>`** — a
  `packingCheck.aggregate` over that student's non-null `photoPath` rows: a count and a
  date range, never the images themselves. Backs the parent consent screen's "see what's
  currently stored" requirement (§6.3/§8.6) — CLAUDE.md "Privacy": photos stay private by
  default, so even the guardian's own view of "what's stored" defaults to a summary, not a
  gallery.
- **`shouldCapturePhoto(studentId, subjectItemId): Promise<boolean>`** (§8.6) — the
  sampling decision: below `PHOTO_MIN_SAMPLES_PER_ITEM` (env, default `5`) already-stored
  photos for this exact `(studentId, subjectItemId)` pair, always `true`; past that floor,
  `Math.random() < PHOTO_SAMPLE_RATE` (env, default `0.1`). The floor is what keeps
  coverage *even* across items — a rarely-scanned item still reaches its baseline instead
  of only ever getting the same ~10% chance as a heavily-scanned one — and it's keyed by
  `(studentId, subjectItemId)`, not just `subjectItemId`, specifically so the baseline
  captures variance across different students/lighting/angles for the *same* item type,
  which is the actual training-data value, not raw photo count. Called from
  `lib/packing.ts`'s `recordScan`, only after `hasActiveConsent` already passed — a
  student with no consent never reaches this check at all.

### 7.8c `lib/consent.ts`

PDPA lawful-basis logic (CLAUDE.md "Privacy", §3.6a). Closes a gap that had existed since
Phase 2: the photo pipeline ran with no consent check of any kind until this was added.

- **`CURRENT_CONSENT_VERSION: Record<ConsentScope, string>`** (exported) — the version a
  scope's consent must match to count as active; one entry today, `{PHOTO_CAPTURE: "1"}`.
  Bump the value here (and update whatever actually shows the privacy-notice text)
  whenever that notice changes — every existing consent for that scope stops counting as
  active immediately, without touching a single historical row.
- **`hasActiveConsent(studentId, scope): Promise<boolean>`** — the *only* place allowed to
  answer "does this student have valid consent right now." `true` iff a `Consent` row
  exists with `revokedAt: null` **and** `version` equal to `CURRENT_CONSENT_VERSION[scope]`
  — never just "a row exists." The one caller today is `lib/packing.ts`'s `recordScan`.
- **`requireConsentAccess(actor, studentId)`** (private) — `can(actor, "edit_consent",
  {student, studentId})` or throws `ForbiddenError`. Shared by all three mutating
  functions below; each additionally narrows *which* half of that check applies to it (see
  next three entries), since `can()`'s `edit_consent` branch itself grants both a guardian
  and the homeroom teacher, but a given real-world action (an online grant vs. a paper-form
  record) only ever makes sense for one of the two.
- **`grantConsentOnline(actor, {studentId, scope})`** — requires `actor.parentId` (narrows
  past `requireConsentAccess`'s broader grant), then inserts a new `Consent` row:
  `method: "ONLINE"`, `version: CURRENT_CONSENT_VERSION[scope]`,
  `grantedByParentId: actor.parentId`. Always a fresh row — re-granting after a revocation
  or a version bump is a new grant, never a resurrection of an old one.
- **`recordPaperConsent(actor, {studentId, scope})`** — requires `actor.teacherId` (and,
  via `requireConsentAccess`, that they're specifically the homeroom teacher), inserts a
  `Consent` row the same way but `method: "PAPER"`, `recordedByUserId: actor.userId`
  instead of `grantedByParentId`. For a family who never uses the app online at all — a
  signed paper form collected in person.
- **`revokeConsent(actor, {studentId, scope})`** — same access as the two grant paths (a
  guardian, or the homeroom teacher acting on a family's behalf). Marks every currently
  non-revoked row for that student+scope as revoked (`updateMany`, `revokedAt: new Date()`
  — never deleted, the historical record survives) — idempotent, a no-op if nothing was
  active. For `scope: "PHOTO_CAPTURE"` specifically, also finds every `PackingCheck` with a
  non-null `photoPath` under that student and runs them through
  `deletePhotosForChecks` (§7.8b) — **revocation deletes what's already stored, not just
  stops future capture.** CLAUDE.md "Privacy" doesn't spell this out explicitly, but a
  withdrawn lawful basis isn't lawful for data already collected under it either.

### 7.8a `lib/school-settings.ts`

- **`SchoolSettings`** (type) — `{packingWindowStartHour, packingWindowEndHour,
  morningWindowStartMinute, morningWindowEndMinute, sessionTtlMinutes,
  pointsPerCompletion}`, one-to-one with the columns added to `School` (§3.2).
- **`schoolSettingsForStudent(studentId): Promise<SchoolSettings>`** — resolves the
  student's currently-active enrollment → classroom → school and reads its six settings
  columns; if the student has no active enrollment at all (mirrors
  `lib/required-items.ts`'s "no enrollment" case), returns a hardcoded fallback equal to
  the columns' own DB defaults rather than throwing. The only consumer today is
  `lib/packing.ts`, at the top of `recordScan`, `getPackingStatus`, and `spotCheck`.

### 7.9 `lib/points.ts`

- **`POINTS_PER_COMPLETION = 20`** — no longer the live value a completion actually
  awards; that's the per-school `pointsPerCompletion` column (§3.2), resolved via
  `lib/school-settings.ts`. `components/tomorrow-view.tsx`'s "+N คะแนน" display reads
  `status.pointsPerCompletion` (the resolved value) instead of this constant, so the
  number shown always matches what was actually awarded. This constant remains only as
  the schema column's own default and a convenience for tests that don't override it.
- **`balance(studentId, db?): Promise<number>`** — `pointLedger.aggregate({_sum:
  {delta}})`, `?? 0`. Takes an optional `db` (a `Prisma.TransactionClient`) so callers
  like `redeem()` (and `awardPenaltyCappedAtZero`, below) can read the balance *inside*
  their own transaction. **Never clamped** — invariant 4 requires balance to be exactly
  `SUM(delta)`, so the zero-floor (below) is enforced only on the size of a new penalty
  row at insertion time, never here.
- **`award(studentId, delta, reason, opts?, db?)`** — the single append-only insert every
  point change goes through. `opts.actorUserId` is the invariant-7 audit trail for a
  teacher override; omitted for system-awarded rows. `opts.note` (§3.6) is set only by
  `manualAdjustPoints` below — every other caller omits it.
- **`awardPenaltyCappedAtZero(studentId, maxPenalty, reason, opts?)`** — same append-only
  insert as `award()`, for a penalty that must never drive the ledger sum negative:
  inside its own `Serializable` transaction (same reasoning as `redeem()`'s — two
  concurrent penalties can't both read the same balance and jointly overshoot zero), reads
  the current balance and inserts `-Math.min(maxPenalty, Math.max(current, 0))` — i.e. the
  full `maxPenalty` when the balance can absorb it, otherwise just enough to bring the
  balance to exactly `0`, or a `0`-delta row (still an auditable record) if it's already
  there. The only caller today is `lib/packing.ts`'s `spotCheck`.
- **`manualAdjustPoints(actor, {studentId, delta, note})`** — the `MANUAL_ADJUST` path,
  invariant 7's other manual-override case (alongside `spotCheck`'s `MORNING_CHECK_FAIL`)
  and the resolution of a formerly-dead enum value (§10 used to list `MANUAL_ADJUST` as
  reserved but untriggered). Authorizes via `requireHomeroomAccessForStudent` (`lib/roster.ts`,
  §7.6/§4.5) — homeroom teacher of the student's own classroom only, same gate as
  `linkParent`/`issueStudentCredentials`/`recordTeacherScan`. Requires a non-blank `note`
  (trimmed; throws otherwise) and a nonzero `delta` (throws on `0` — a zero-delta manual
  entry has no meaning, unlike `awardPenaltyCappedAtZero`'s automatic `0`-delta audit row).
  Unlike `awardPenaltyCappedAtZero`, **there is no zero-floor here** — `delta` is inserted
  exactly as given, positive or negative, even past `0`: this is a deliberate, human-
  reviewed correction (e.g. reversing a mistaken award), not an automatic penalty computed
  from a suspected cheat, so the invariant that motivates capping the automatic penalty
  doesn't apply. Calls `award(studentId, delta, "MANUAL_ADJUST", {actorUserId: actor.userId,
  note})` — `note` (§3.6) is the one case `PointLedger.note` is ever set.
- **`computeStreak(studentId, asOf): Promise<number>`** — days since the most recent
  `MORNING_CHECK_FAIL` (or since the student's own `createdAt` if there's never been one).
  Deliberately **not** "consecutive fully-packed days" — a missed or incomplete evening
  does not break the streak by design; only a teacher catching a faked scan does. Reading
  this off the ledger directly (rather than maintaining a separate mutable counter) means
  there's nothing to keep in sync.
- **`addOneDay(d)` / `daysBetween(from, toMidnight)`** (private) — both instants are
  first normalized to a `SCHOOL_TZ` calendar date (never diffed as raw UTC instants),
  then compared as UTC-midnight markers, which is then safe integer millisecond math.

### 7.10 `lib/rewards.ts`

- **`requireTeacherAtSchool(actor, schoolId)`** (private) — `can(edit_rewards,
  {school})`.
- **`createReward(actor, {schoolId, name, cost, stock?})`** — rejects `cost < 1` and a
  negative `stock`. `stock` is optional/nullable — omit or pass `null` for unlimited.
- **`updateReward(actor, rewardId, {name?, cost?, stock?, active?})`** — resolves
  `schoolId` from the existing row, then a plain `update` with whichever fields are given.
  The only way to restock a reward (set `stock` back up) or retire one with redemption
  history (`active: false`) — see `deleteReward` below for why the latter matters.
- **`deleteReward(actor, rewardId)`** — resolves `schoolId` from the row, authorizes, then
  **counts `Redemption` rows referencing it and throws if any exist**, naming the count
  and pointing at `active: false` as the alternative, before ever calling
  `prisma.reward.delete`. This is the application-level half of the invariant-4 fix (§3.6):
  `Redemption.reward` is now `onDelete: Restrict`, so even a caller that bypassed this
  function (a script, Prisma Studio) would have the database itself refuse the delete —
  this check exists to fail with a clear, actionable message before that happens, not to
  be the only thing preventing it.
- **`redeem(actor, rewardId): Promise<Redemption>`** — requires `actor.studentId`. Wraps
  a transaction opened with **`isolationLevel: "Serializable"`** in `withSerializableRetry`
  (§7.4a) — Serializable, explicitly *not* Postgres's default READ COMMITTED, because two
  concurrent redemption attempts both reading the same balance before either commits could
  otherwise both pass the "can afford it" check and both succeed, overspending the
  student's balance; Postgres aborts one of the two transactions instead. That abort is
  the *correct* outcome, but it's a raw database error, not a business rejection — without
  the retry wrapper it used to reach the losing student as an unhandled serialization
  failure via `app/error.tsx`'s generic modal. `withSerializableRetry` re-runs the whole
  transaction against the now-committed state instead, so the loser almost always lands on
  a clean, expected rejection (see the concurrency tests, §9) rather than a raw one. Inside
  the transaction itself: load the reward (must be `active`), reject if `stock` is
  non-null and `<= 0` ("ของรางวัลหมดแล้ว"), read the balance, reject if insufficient
  ("แต้มไม่พอ"), and — only if `stock` isn't `null` — decrement it (`{decrement: 1}`)
  *inside this same transaction* before creating the `Redemption` and its ledger row. That
  decrement is what makes the last-unit race a genuine Serializable conflict in the first
  place: two concurrent redemptions of a `stock: 1` reward both read-then-write the
  identical `Reward` row, so Postgres's Serializable isolation aborts one with a
  serialization failure — the same mechanism the balance check already relied on, just now
  also covering stock for free, and now also retried the same way.
- **`fulfillRedemption(actor, redemptionId)`** — resolves the reward's `schoolId`,
  authorizes, then stamps `status: FULFILLED`, `fulfilledAt: now`,
  `fulfilledByTeacherId: actor.teacherId` (re-checked non-null after the `can()` call
  purely so TypeScript can narrow it, since `can()`'s return type doesn't itself prove
  `teacherId` is set to the type checker).

### 7.11 `lib/push.ts`

- Module-level: reads `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` from env; if both are set,
  calls `webpush.setVapidDetails(...)` once at import time.
- **`subscribe(actor, subscription: PushSubscriptionJSON)`** — requires
  `actor.studentId` (a student subscribes only for themselves — the same direct-equality
  ownership shape as `recordScan`'s check). `upsert`s on `endpoint` (the browser's push
  endpoint is the natural idempotency key — re-subscribing the same device is a no-op
  update).
- **`sendEveningReminders(): Promise<{sent, pruned, failed}>`** — throws only for the
  one genuine whole-run precondition: VAPID keys not configured, which means nothing
  could be sent to anyone regardless of subscriptions. Everything else is scoped to one
  subscription and never aborts the run. Groups all subscriptions by `studentId` first
  (a `Map<studentId, subscription[]>`), so a student with two devices (phone + tablet,
  both subscribed) computes `getPackingStatus` **once**, not once per subscription — the
  original code called it once per row, redoing the full `requiredItemsFor` query
  redundantly for multi-device students. For each student with something still missing
  (fully-packed students are skipped entirely — no repeat nagging), builds one Thai
  message (listing up to 3 missing item names by name, else just a count) and sends it to
  every one of that student's subscriptions individually. Each individual
  `webpush.sendNotification` call has its own `try/catch`: a `404`/`410` (the push
  endpoint is dead — browser unsubscribed, uninstalled, etc.) deletes the stale
  subscription row and counts it as `pruned`, exactly as before; anything else (a `500`
  from the push service, a network error, a malformed subscription) is counted in
  `failed` and logged (`console.error`, endpoint + status code) — **not rethrown**. Before
  this, any non-404/410 failure rethrew and aborted the entire run, so one dead or
  misbehaving endpoint meant every remaining student in that batch got no reminder that
  evening, and *which* students were skipped depended on non-deterministic iteration/
  `Map` order — a real reliability bug, not a hypothetical one.

### 7.11a `lib/rate-limit.ts`

- **`checkRateLimit(key, {max, windowMs}): RateLimitResult`** — a small in-memory
  fixed-window rate limiter, `{allowed, retryAfterSeconds}`. Deliberately not persisted to
  Postgres — this is ephemeral security bookkeeping, not a business record, with no
  invariant-4-style need for durability or an audit trail. In-memory and per-process:
  correct at this app's current single-instance scale; a horizontally-scaled deployment
  would need a shared store (Redis, etc.) instead, since each instance would otherwise
  count independently and the effective limit would multiply by instance count (§10).
  Generic and reusable by key — the only consumer today is
  `app/login/student-actions.ts`'s per-IP login throttle, but nothing about this function
  is student-login-specific; a `key` is just whatever namespace the caller chooses
  (`"student-login:<ip>"` today), and different keys never affect each other's buckets.

### 7.12 `lib/student-auth.ts`

- **Constants**: `BACKOFF_MAX_SECONDS = 60`, `BACKOFF_DECAY_MINUTES = 10`,
  `STUDENT_SESSION_DAYS = 30`.
- **`backoffSeconds(attempts)`** (private) — `min(BACKOFF_MAX_SECONDS, 2^(attempts-1))`:
  1s, 2s, 4s, 8s, 16s, 32s, then capped at 60s.
- **`randomDigits(length)`** (private) — `crypto.randomInt(0,10)` repeated, joined.
- **`generateUniqueStudentCode(): Promise<string>`** — generates a random
  `STUDENT_CODE_LENGTH`-digit code, retries up to 20 times against a DB uniqueness check,
  throws if it can't find a free one (astronomically unlikely at 6 digits / current
  student counts).
- **`generatePassword(): string`** — a random `STUDENT_PASSWORD_LENGTH`-digit PIN, no
  uniqueness constraint (PINs aren't a lookup key, codes are).
- **`verifyStudentLogin(studentCode, password): Promise<LoginResult>`** — §5.2's core
  login logic, rewritten from a hard lockout to exponential backoff (migration
  `20260903120149_student_login_backoff`) because the lockout protected the wrong party:
  student codes are 6 digits and children share them with each other routinely, so any
  classmate who knows a code could lock its real owner out for 15 minutes just by
  submitting 5 wrong PINs — a denial-of-service tool aimed at the legitimate user, not an
  attacker.
  - Generic error message on an unknown code or a wrong password (never reveals which —
    unchanged, still the same base string either way).
  - `bcrypt.compare` runs **unconditionally**, even while a cooldown (`nextLoginAttemptAt`)
    is active — a correct password always succeeds immediately and clears all backoff
    state, regardless of how many prior wrong attempts or how soon after the last one.
    Only a *wrong* password is ever throttled.
  - On a wrong password: if `nextLoginAttemptAt` is still in the future, rejects
    immediately with the remaining wait appended to the generic message
    (`"...ลองใหม่ใน N วินาที"`) **without** writing to the database or advancing the
    backoff level — hammering during an active cooldown can't buy a shorter effective
    wait than waiting it out once would. Otherwise (no active cooldown — either the first
    wrong attempt ever, or a fresh one after the previous cooldown elapsed): if it's been
    more than `BACKOFF_DECAY_MINUTES` since `nextLoginAttemptAt` (approximated from that
    field alone, not a separate "last failed at" column — off by at most one backoff
    interval, negligible against a multi-minute decay window), the attempt counter decays
    back to 0 first; either way, increments `failedLoginAttempts`, computes the new delay
    via `backoffSeconds`, sets `nextLoginAttemptAt = now + delay`, and returns the generic
    message with that delay appended.
  - On success: lazily creates a `User` row if the student never had one, clears
    `failedLoginAttempts`/`nextLoginAttemptAt` to `0`/`null`, creates the `Session` row,
    returns the token + expiry.
  - **Known residual signal, not fully closed**: the very first wrong password against an
    *existing* code produces `"...ลองใหม่ใน 1 วินาที"`, while any attempt against a
    *nonexistent* code always produces the bare generic message with no suffix — a
    one-guess oracle for "does this exact code exist" for anyone willing to spend one
    throttled attempt on it. Not eliminated, because doing so would mean fabricating
    identical backoff state for codes that resolve to no `Student` row at all (no natural
    place to store it without inventing a second, code-keyed tracking mechanism) — judged
    not worth building for what it would close: the *practical* enumeration risk (probing
    many candidate codes to find live ones, cheaply, at scale) is what
    `app/login/student-actions.ts`'s per-IP `checkRateLimit` actually throttles; this
    residual signal only helps an attacker who already has a *specific* code worth
    checking, at a cost of one rate-limited attempt per code.
- **`studentSessionCookie(secure): string`** — returns the exact cookie name Auth.js v5's
  database strategy expects, so `auth()` reads this hand-written session back
  transparently.

### 7.13 `lib/student-code.ts`

- **`STUDENT_CODE_LENGTH = 6`**, **`STUDENT_PASSWORD_LENGTH = 6`** (raised from `4` —
  now that backoff, not a hard lock, is the main defense against guessing, a larger PIN
  space is a genuine complementary improvement) — plain constants, deliberately isolated
  in their own file with zero Node/Prisma/bcrypt imports, because
  `components/student-login-form.tsx` (a client component) needs them for input
  `maxLength` and importing `lib/student-auth.ts` directly would pull server-only code
  into the client bundle. Only affects *newly issued* passwords
  (`generatePassword()`, §7.12) — `verifyStudentLogin` compares against a bcrypt hash,
  which has no opinion on the plaintext's original length, so an existing 4-digit PIN
  keeps working exactly as issued; no migration/backfill needed for this.

### 7.14 `lib/dashboard.ts`

- **`pendingRedemptionCountForTeacher(actor): Promise<number>`** — resolves the actor's
  visible classrooms → their school ids → a `Redemption.count({status: PENDING, reward:
  {schoolId: in}})`. Deliberately separated from the full dashboard query so the teacher
  layout's nav badge doesn't pay for everything `teacherDashboard` computes on every
  single page navigation.
- **`teacherDashboard(actor): Promise<TeacherDashboard>`** — first resolves, via
  `termsCoveringRange` (§7.20), which term is in effect *today* for each of the actor's
  classrooms' schools, then a `Promise.all` of six queries (student count, today's slots
  — scoped to `termId: {in: <today's term ids>}`, today's exceptions, next-14-days
  exceptions, GRADING count, pending-redemption count), all pre-scoped to
  `visibleClassroomWhere`. Reconciles each classroom's today-slots against today's
  exceptions via `applyExceptions` to build the "what's on today" summary, and formats
  the upcoming exceptions list. This is a read model, not something other code calls
  into — it exists purely to back the one dashboard page.
- **`classroomTodayDashboard(actor, classroomId): Promise<ClassroomTodayDashboard>`** —
  the per-classroom "today" dashboard behind `/teacher/classrooms/[id]/today` (§6.4/§8.8),
  combining two differently-scoped views on one page:
  - **`packing`** — whole-bag status (complete/partial/not-started counts, and each
    student's status + their currently-checked items for spot-checking) — `null` unless
    `isHomeroom`, same reasoning as `spot_check`'s existing homeroom-only gate (§4.5/§10):
    this is the "whole bag" view a subject teacher must not get a partial slice of. Built
    from `getPackingStatus` (`lib/packing.ts`, §7.8) per enrolled student, exactly like the
    page's own previous implementation did inline — moved here so it's one read model
    instead of page-embedded logic.
  - **`collectibleItems`** — which subjects' ordinary (non-`forExam`) items have a period
    today, scoped to `manageableSubjectsInClassroom(actor, classroomId)` (§7.6's exact
    scoping, not a new authorization shape: homeroom sees every subject, a subject teacher
    only their own). Resolved the same way `lib/required-items.ts` resolves a single
    student's day — `termFor` + today's `TimetableSlot`s + `applyExceptions` — but at
    classroom granularity, with no student involved. A `HOLIDAY` exception empties it; an
    `EXAM` exception on a subject excludes that subject entirely (its ordinary item was
    never required to be packed that day either, so there's nothing to collect). Each
    entry's `collectedCount`/`totalStudents` counts currently-enrolled students' `ItemCopy`
    rows by `state` — **introduces no new state or schema field**: "collected" is exactly
    invariant 5's existing `GRADING`, this is only a classroom-wide read over it.
  Authorized once, at the top, via `edit_roster` on the classroom (the loosest thing every
  caller already needs — matches the roster page's own gate); `packing`'s extra
  homeroom-only restriction and `collectibleItems`' subject-scoping are applied inside,
  not as a second `can()` call.

### 7.15 `lib/schedule.ts`

- **`applyExceptions(slots, exceptions): EffectiveSlot[]`** — pure, no DB access (callers
  fetch already-scoped slots/exceptions and pass them in). If *any* exception for the day
  is `HOLIDAY`, returns `[]` immediately regardless of other exceptions. Otherwise starts
  from the recurring `TimetableSlot`s keyed by period, then applies each exception in
  turn: `CANCELLED_PERIOD` deletes that period's entry; `PERIOD_SWAP`/`EXAM` (each with a
  `subjectId`) overwrite that period's entry, tagging the result's `source` as `"swap"`
  or `"exam"` respectively. That `source` tag sat unused by any caller until §3.3's
  exam-day items design decision — `lib/required-items.ts`'s `assembleItems` (§7.7) is
  now the consumer, selecting a subject's `forExam` items instead of its normal ones on a
  `source: "exam"` day. This function itself needed no change to support that — the
  distinction it already made was exactly what was missing downstream. This one function
  is invariant 6 made real.

### 7.16 `lib/time.ts`

- **`SCHOOL_TZ = "Asia/Bangkok"`** — the one place the timezone is named.
- **`schoolNow(): DateTime`** — `luxon` "now," zoned to `SCHOOL_TZ`.
- **`schoolToday()` / `schoolTomorrow(): SchoolDate`** — today's/tomorrow's calendar date
  in `SCHOOL_TZ`, as a `YYYY-MM-DD` string (the `SchoolDate` type — deliberately a string,
  not a `Date`, so it can't accidentally carry a timezone-ambiguous instant).
- **`toSchoolDate(instant: Date): SchoolDate`** — which `SCHOOL_TZ` calendar date a UTC
  instant falls on (used by `points.ts`'s streak math to normalize `createdAt`/ledger
  timestamps before diffing).
- **`weekdayOf(date: SchoolDate): Weekday`** — maps luxon's 1–7 weekday number to the
  Prisma `Weekday` enum via a lookup table.
- **`schoolDateToUtcMidnight(date: SchoolDate): Date`** — the critical boundary function:
  a Postgres `@db.Date` column stores a bare calendar date with no timezone; Prisma
  represents it client-side as a JS `Date` at UTC midnight. This builds/reads dates that
  way specifically so a school day never shifts by whatever the server process's local
  offset happens to be.
- **`addSchoolDays(date, days): SchoolDate`** — calendar-day arithmetic on a `SchoolDate`
  string, via luxon, never via raw millisecond math on a `Date`.
- **`mondayOf(date): SchoolDate`** — the Monday of the `SCHOOL_TZ` week containing `date`
  (used by the week view to anchor Mon–Fri).
- **`isoDate(dt)`** (private) — formats a `DateTime` as `YYYY-MM-DD`, throwing if luxon
  couldn't produce one (an invalid `DateTime`).

### 7.17 `lib/timetable.ts`

**No runtime write path for `TimetableSlot` at all — read-only.** There used to be
`setTimetableSlot`/`clearTimetableSlot` behind a per-cell `<select>` on `/teacher/timetable`
(§6.4); removed outright once it was raised that a real school's actual weekly schedule
isn't something any assigned teacher should be able to freely rewrite at runtime — it's set
up out-of-band (imported, or seeded — `prisma/seed.ts` writes `TimetableSlot` rows directly
via Prisma, the same way it always has, never through this file) and only ever *deviates*
day to day through a `ScheduleException` (holiday/swap/exam), which stays fully editable
below. Matches the precedent already set for classroom creation/rename/delete (§10) — an
administrative capability with no real in-app UI is removed, not left half-wired.

- **`resolveTermId(classroomId, explicitTermId?)`** (private) — the teacher UI has no
  term picker yet, so `listTimetableSlots` accepts an optional `termId` and falls back
  to "the term covering today for this classroom's school" (`termFor`, §7.20) when
  omitted. Returns `null` if no term covers today (nothing has been set up yet).
- **`listTimetableSlots(actor, classroomId, termId?)`** — `can(view_timetable, {classroom})`,
  resolves the term, and returns `[]` (not an error) if none applies; otherwise all slots
  for that classroom *and term*, ordered by weekday/period, subject included.
- **`listScheduleExceptions(actor, classroomId, {from, to})`** — `can(view_exceptions,
  {classroom})`, then all exceptions in the date range that are either specific to this
  classroom or school-wide (`classroomId: null`) for its school.
- **`createScheduleException(actor, params)`** — resource is `{classroom}` if
  `params.classroomId` is set, else `{school}` (a school-wide exception is authorized at
  school scope, not against any one classroom) — `can(edit_exceptions, resource)`, then
  (if `params.subjectId` is set — a `PERIOD_SWAP`/`EXAM`) rejects an archived subject,
  then creates the row.
- **`deleteScheduleException(actor, exceptionId)`** — loads the exception first to
  determine which resource type to check (same classroom-vs-school branching as create),
  then deletes.

### 7.18 `lib/catalog.ts`

- **`requireCatalogAccess(actor, schoolId)`** (private) —
  `can(edit_catalog, {catalog, schoolId})`. Per-school, not global (§4.4).
- **`createSubject(actor, schoolId, name)`** — caller supplies `schoolId` directly (there's
  no existing row to resolve it from); `can()` still verifies the actor actually teaches
  at that school, so a caller can't launder access by naming a school they don't belong to.
- **`createSubjectItem(actor, subjectId, name, forExam = false)`** — same shape as
  `createSubject`, plus the new `forExam` flag (§3.3), defaulted `false` so every existing
  call site (and every pre-migration row) is unaffected.
- **`setSubjectItemForExam(actor, subjectItemId, forExam)`** — flips an *existing* item's
  `forExam` flag; same authorization shape as `renameSubjectItem` below (resolves the
  parent `Subject`'s `schoolId`, not a caller-supplied one). The only mutation this
  function performs; unlike delete/restore there's no archive-style history concern here —
  `forExam` isn't destructive, so a plain `update` is enough.
- **`renameSubject`/`deleteSubject`/`restoreSubject`** and
  **`renameSubjectItem`/`deleteSubjectItem`/`restoreSubjectItem`** —
  all operate on an *existing* id, so each first `findUniqueOrThrow`s the row (or its
  parent `Subject`, for the `SubjectItem` variants) to read the real `schoolId` off it,
  then authorizes against that — never a caller-supplied value, so renaming/deleting
  can't be pointed at a different school's row by passing a mismatched id.
- **`deleteSubject`/`deleteSubjectItem`** default to archiving (`archivedAt: new Date()`
  on the target row only — no cascade, nothing else touched). Passing `{ hard: true }`
  instead counts dependent rows first (`TimetableSlot`+`ScheduleException`+`ItemCopy` via
  its `SubjectItem`s, for `deleteSubject`; `ItemCopy` directly, for `deleteSubjectItem`)
  and throws a message naming each nonzero count if any exist, otherwise performs the
  real Prisma `delete` (which does cascade, per §3.3/§3.4's `onDelete` choices — safe here
  precisely because the counts just proved nothing is there to cascade *into*).
  `restoreSubject`/`restoreSubjectItem` just clear `archivedAt`.

### 7.19 `lib/utils.ts`

- **`cn(...inputs: ClassValue[])`** — `twMerge(clsx(inputs))`, the standard shadcn
  Tailwind class-merging helper.

### 7.20 `lib/terms.ts`

- **`termFor(schoolId, date): Promise<Term | null>`** — the term covering one school on
  one date, or `null` if none does (a school break, or terms not set up for that period).
  The single-date resolution primitive `requiredItemsFor` and `lib/timetable.ts` use.
- **`termsCoveringRange(schoolIds, from, to): Promise<Term[]>`** — every term (across
  possibly several schools) overlapping a date range, fetched once instead of calling
  `termFor` per day — paired with `termForSchoolOn` to resolve one specific school+date
  against the batch locally. The same batch-then-resolve-locally shape `requiredItemsForWeek`
  already used for `Enrollment` (`enrollmentFor`), applied to `Term` too.
- **`termForSchoolOn(terms, schoolId, target): Term | undefined`** (pure) — picks the one
  term (if any) in a `termsCoveringRange` batch that covers `target` for `schoolId`.
- **`assertNoOverlap(schoolId, startDate, endDate, excludeTermId?)`** (private) — the
  no-overlap invariant's actual enforcement point: throws, naming the conflicting term
  and its dates, if any other term of the same school overlaps `[startDate, endDate]`.
  `excludeTermId` exists for a future "edit an existing term's dates" path (not built —
  no code updates a `Term`'s dates today) so that path could exclude the term being
  edited from its own overlap check without duplicating this logic.
- **`createTerm({schoolId, name, startDate, endDate})`** — out-of-band, admin-managed,
  same precedent as classroom creation (§10): no `actor` parameter, no `can()` check,
  matching `prisma/seed.ts`'s and this file's own scripts' direct trusted access — an
  academic calendar is set by school administration, not through a teacher-facing UI.
  Validates `startDate < endDate`, calls `assertNoOverlap`, then creates the row. Always
  routes through here (never a bare `prisma.term.create`) is what makes the no-overlap
  invariant actually hold regardless of caller.
- **`rolloverTerm({schoolId, endingTermId, newTerm, classroomPromotions, copyTimetable?})`**
  — the academic-year rollover, backing `scripts/rollover-term.ts` (§8.7). Creates the new
  term via `createTerm`; for each `oldClassroomId -> newClassroomId` pair in
  `classroomPromotions` (`newClassroomId` may be `null`, meaning those students are
  leaving/graduating), ends every active `Enrollment` in the old classroom (`endDate` =
  the day before the new term starts) and — unless `null` — opens a new one in the new
  classroom starting on the new term's first day; retires (`state: RETIRED`) every
  non-`RETIRED` `ItemCopy` belonging to a rolled-over student, regardless of which
  classroom they move into; and, only if `copyTimetable` is true, copies each old
  classroom's `TimetableSlot`s (same weekday/period/subject) into the new term for its
  mapped new classroom — appropriate for a same-grade section reshuffle, usually wrong
  for a grade promotion with a different curriculum, which is exactly why it's a flag the
  caller sets rather than automatic. There is no schema concept of "which classroom
  follows which" (real schools reshuffle sections yearly, not just promote 1:1), so
  `classroomPromotions` is always a required, explicit input, never inferred from
  classroom names or anything else.

## 8. Core Workflows

### 8.1 "What do I need today/tomorrow"

`requiredItemsFor(studentId, date)` (§7.7), where `date` is `packingFocusDate(settings)`
(§7.8) — `schoolToday()` during the morning window, `schoolTomorrow()` otherwise — resolves
the student's enrollment active on that date → resolves which `Term` covers that date for
the enrollment's school (`termFor`, §7.20 — not "whatever the timetable currently says,"
see §3.4) → fetches that term's `TimetableSlot`s for the classroom+weekday + that date's
`ScheduleException`s (classroom-specific and school-wide) → `applyExceptions` (§7.15)
reconciles them into the day's effective slot list (empty if it's a holiday) → for each
subject actually scheduled, looks up the student's tracked `ItemCopy` whose state isn't
`GRADING` → assembles into `RequiredItem[]`, sorted by earliest period. Both
`/student/tomorrow` (via `TomorrowView` → `getPackingStatus` → this — despite the name,
now "today" during the morning window, §6.2) and `/parent/[studentId]` (the same
`TomorrowView`, `readOnly`) render the same result — and, because it's term-resolved, the
same result they would have gotten had they looked on that actual date, even if asked long
after that term ended and the timetable has since changed.

### 8.2 QR sticker lifecycle

**Print**: teacher hits "สร้าง" on `/teacher/classrooms/[id]/print-qr` →
`createUnassignedCodes` bulk-inserts N fresh `UNASSIGNED` codes → page re-renders with
each as an SVG + plaintext code, printable.

**Print-and-bind — the same setup problem, solved before the sticker leaves the
printer.** Even with scan-to-bind (below), setup was still two passes: print a sheet of
opaque codes, then walk the room binding each one. Teacher instead hits
"สร้างและผูกรหัส" (optionally narrowed to one subject) →
`generateAndBindCodesForClassroom` (§7.5) finds every `ItemCopy` in scope with no
currently-`ASSIGNED` code, generates a fresh code for each, and binds it via `bindCode`
itself — same authorization, same `UNASSIGNED`-only guard, no shortcut. A copy that
already has an `ASSIGNED` code is left alone entirely — invariant 3 makes rebinding a
deliberate, separate action ("เปลี่ยนสติกเกอร์"), never an implicit side effect of a bulk
sweep. The resulting sheet already carries each student's name and item name
(`<StickerSheet>`, §6.4) — for a copy created this way there is no separate binding step
left to do at all.

**Bind — real setup at classroom volume, for whatever wasn't covered by print-and-bind
(a copy added after the initial sheet, a printer that jammed mid-run, etc).** Real
onboarding is roughly 40 students × 8 items = 320 bindings per classroom; typing a
12-character opaque code that many times isn't something a teacher will actually do, so
binding also has three narrower entry points, all converging on the identical `bindCode`
(§7.5, subject/homeroom-scoped) — none is a separate authorization path, they differ only
in how the code reaches the server:
  1. **Manual** (original, kept as the camera-unavailable fallback): teacher types a
     printed code into an item copy's "พิมพ์รหัส QR" field on the roster page →
     `bindCodeAction` → `bindCode`.
  2. **Scan to bind**: teacher taps "สแกน" next to one item copy → `<BindScannerModal>`
     opens with that one item as its target → pointing the camera at the sticker decodes
     it → `scanBindAction` → `bindCodeWithResult` → `bindCode`.
  3. **Rapid bind**: teacher taps "สแกนต่อเนื่องทั้งหมด" for one student → the same modal
     opens with *all* of that student's items as targets, in the stable order the roster
     page already renders them in → each scan binds to whichever target is still unbound
     first, advances to the next one automatically, and shows what was just bound — a
     whole student's items in one continuous scanning motion, no form between scans, with
     an "undo last" (`scanUndoBindAction` → `voidCodeWithResult` → `voidCode`) for a
     mis-scanned sticker.

Every path — print-and-bind included — ends the same way: code transitions `UNASSIGNED →
ASSIGNED`, `itemCopyId` set, via the one `bindCode` function. A decoded/generated code is
only ever a claim until `bindCode` (or `voidCode`) re-verifies it against the database
from scratch, regardless of which entry point produced it.

**Scan (student packing)**: student's camera decodes the sticker → `recordScan` resolves
the code (must be `ASSIGNED`, must belong to the scanning student) → records a
`PackingCheck`. **Rebind (lost/torn sticker)**: teacher enters a fresh unassigned code in
"เปลี่ยนสติกเกอร์" (manual only today — not one of the three bind paths above) →
`rebindCode` voids the old `ASSIGNED` code (keeping its `itemCopyId` for history) and
binds the new one — every historical `PackingCheck` still resolves through the *item
copy*, which never changed identity, only its sticker did. **Void**: "ยกเลิก" marks a
code `VOID` directly, whether it was bound (classroom/subject-scoped) or a never-bound
spare (any teacher).

### 8.3 Morning/evening packing + anti-cheat

Two independent windows, both per-school-configurable, both resolved purely from
`schoolNow()` server-side — never anything the client sends (`resolveOpenWindow`, §7.8):

- **Evening** (default 18:00–23:59 `SCHOOL_TZ`) — the original window. A scan here targets
  *tomorrow*'s date.
- **Morning** (default 05:00–07:30 `SCHOOL_TZ`) — added because many Thai families pack
  the bag the morning of, not the night before. A scan here targets *today*'s date. Because
  it's a genuinely separate window rather than a special case of the evening one, a family
  that packs only in the morning, only in the evening, or splits across both (finishes most
  of it the night before, confirms the rest before leaving for school) is all supported by
  the same machinery below.

A student's first scan inside either window calls `getOrStartSession` with that window's
resolved date, which creates an `ACTIVE` `PackingSession` for it (or, if a prior session
already expired past its `sessionTtlMinutes` TTL — default **20**, raised from an original
hardcoded 10 — reuses/continues it, see below). Outside both windows, `recordScan` rejects
with `PackingWindowClosedError` before `getOrStartSession` is even called. Each subsequent
scan upserts a `PackingCheck` against the current session. After every scan,
`tryCompleteSession` checks whether *every* required item for that date now has a check
under *this session* — if so, and the session hasn't already expired or been awarded, it
flips to `COMPLETED` and awards that school's `pointsPerCompletion` atomically.

Sessions are keyed purely by `(studentId, forDate)`, with no concept of which window
created them — so a session started the evening before (targeting tomorrow) and completed
the next morning within the morning window (which, by then, targets that same now-current
date) are, from the system's point of view, the same session continuing, not two separate
completions. `getOrStartSession`'s own `COMPLETED`-returns-as-is short-circuit is what
makes reaching an already-finished date idempotent regardless of which window's scan
triggers the lookup — this is the mechanism that guarantees a date can never be
double-awarded across the two windows.

**The TTL resets the clock, not the student's progress.** A session that outlives its TTL
before all items are scanned is marked `EXPIRED`, but its `PackingCheck` rows move onto
the next session `getOrStartSession` creates (§7.8) rather than being discarded — so a
child who has to stop mid-task (searching another room, a parent reclaiming the phone) and
comes back later doesn't lose what they already scanned. The only real cost of an expiry
is that the completing session is marked `continuous: false`, surfaced to the teacher on
the morning spot-check page (§6.4) as a hint, not a verdict — the actual anti-cheat check
this system relies on is the human one, next:

The next morning, a teacher can spot-check any item the student claims to have packed
(`spotCheck`); if it wasn't actually in the bag, a `MORNING_CHECK_FAIL` ledger row
(`awardPenaltyCappedAtZero`, §7.9) deducts exactly that school's `pointsPerCompletion` —
never more than one completion's award, so one catch can't erase several days of honest
behavior — floored so the deduction never pushes the ledger sum below zero, and, because
`computeStreak` reads its baseline from the most recent such row, resets the streak to
zero as of that morning regardless of how much (or how little) it could actually deduct.

### 8.3a Teacher-run packing, for students without a phone at home

The entire flow above assumes a smartphone is available at home in the evening. A real
Thai primary classroom always has some children for whom that isn't true, and those
children earning no points at all makes the reward system *visibly* single out exactly
that inequality inside the classroom — worse than not having a reward system. This
workflow is the fix: a homeroom-teacher-run substitute for the evening scan, at the end of
the school day, using the teacher's own device and camera.

**Design intent, load-bearing, not a suggestion**: this is not a way to tick a child's
items without the child present. The sanctioned flow, and the only one this UI supports,
is the child physically holding the book while the teacher's camera scans its sticker —
exactly the same physical act as a student scanning their own book, just with the teacher
holding the phone. Nothing in `recordTeacherScan` lets a teacher mark an item packed from
memory or from a class list; a real `QRCode` on a real book still has to be decoded by
`<QRScanner>` (§6.2) before anything is recorded, the same as the student path. CLAUDE.md
invariant 7 forbids student- and parent-facing "just tick the box" overrides — this is
deliberately not that: it is a teacher-only path, homeroom-gated (not any subject teacher
assigned to the classroom), and every session it touches is attributable via
`PackingSession.startedByUserId` (§3.5) — the same audit reasoning invariant 7 already
requires of `PointLedger.actorUserId` (§7.9).

Mechanically, `recordTeacherScan` (§7.8) is `recordScan`'s scan logic (`performScan`,
shared by both, §7.8) reached through a different front door:

- **Authorization**: `requireHomeroomAccessForStudent` (§7.6) — homeroom teacher of the
  student's own classroom only, resolved from the student's actual active enrollment. A
  subject teacher assigned to the same classroom, but not homeroom, is denied — same shape
  as `linkParent`/`issueStudentCredentials` (§4.5).
- **Window bypass, explicit, not a weakened check**: `recordTeacherScan` never calls
  `resolveOpenWindow`/`isInMorningWindow`/`isInEveningWindow` at all. The bypass is
  structural — a separate, gated function — rather than a `bypassWindow: boolean` argument
  `recordScan` could be called with by mistake, matching this codebase's established
  pattern of separate named functions for separate real-world actions. `forDate` is always
  `schoolTomorrow()`, matching the evening window this substitutes for, regardless of what
  wall-clock time the teacher actually runs it at during the school day.
- **Attribution**: `actor.userId` is passed through to `getOrStartSession` and lands in
  `PackingSession.startedByUserId` on the session row it creates or continues; `recordScan`
  always passes `null`. Consent gating (`hasActiveConsent`) and photo sampling
  (`shouldCapturePhoto`) apply exactly as they do for a student-run scan — it's still the
  student's own data and consent record being checked, regardless of who's holding the
  camera.

Because completion, point award, streak, and the evening push reminder all key off
`PackingSession`/`PackingCheck` rows the same way regardless of `startedByUserId`, none of
that downstream machinery needed to change at all — a teacher-run session that completes
awards points exactly like a student-run one, and shows up identically on the morning
spot-check page (§6.4), `startedByUserId` included only in the raw row, not surfaced as a
distinct UI state there today.

### 8.4 Points ledger and rewards redemption

Every point change is one `pointLedger` insert — `PACKING_COMPLETE` (+`pointsPerCompletion`,
system, via `award()`, `refId` = session id), `MORNING_CHECK_FAIL` (−`pointsPerCompletion`,
floored at the current balance, via `awardPenaltyCappedAtZero()`, `actorUserId` = the
checking teacher, `refId` = item copy id), `REDEMPTION` (−cost, via `award()`, `refId` =
redemption id), `MANUAL_ADJUST` (any signed, non-`0` delta a homeroom teacher chooses, via
`manualAdjustPoints()`, `actorUserId` = that teacher, `note` = the required reason string,
no `refId` — not tied to any other row — and, unlike `MORNING_CHECK_FAIL`, **not** floored
at the current balance, §7.9). Balance is always `SUM(delta)`, computed fresh on
every read, never cached on the student row. Redemption (`redeem()`) runs inside a
`Serializable`-isolation transaction specifically to prevent two concurrent redemption
requests from both reading a stale balance and both succeeding past what the student
could actually afford — Postgres aborts one of the two under contention. The same
transaction, same isolation level, now also decrements `Reward.stock` (when it isn't
`null`) before creating the `Redemption`, so a `stock: 1` reward's last-unit race resolves
the identical way: two concurrent redemptions both read-then-write that one `Reward` row,
Postgres aborts one. That abort no longer reaches the caller raw: `redeem()` wraps the
whole transaction in `withSerializableRetry` (§7.4a), which retries the loser (short
jittered backoff, up to 3 times) against whatever committed in the meantime — the loser
ends up either succeeding for real or hitting the same clean "แต้มไม่พอ"/"ของรางวัลหมดแล้ว"
rejection an honestly-insufficient balance or empty stock would produce, rather than a raw
Postgres serialization-failure error. Deleting a `Reward` with any `Redemption` history is
refused — first
by `deleteReward` itself (a clear message pointing at `active: false`), and, since
`Redemption.reward` is `onDelete: Restrict` (not `Cascade`, as of the same migration that
added `stock`), by the database underneath it too — because a `PointLedger` `REDEMPTION`
row's `refId` points at the `Redemption`, and `PointLedger` never cascades from `Reward`;
losing the `Redemption` out from under it would leave that `refId` dangling, breaking
invariant 4. `computeStreak`
counts calendar days (via `SCHOOL_TZ`-normalized comparisons) since the most recent
`MORNING_CHECK_FAIL`, or since the student's account was created if there's never been
one — an incomplete or skipped evening does *not* reset it, only a teacher-caught fake
does.

### 8.5 Push reminder pipeline

A student opts in via `<NotificationOptIn>` → browser `Notification.requestPermission()`
→ `navigator.serviceWorker.register("/sw.js")` → `pushManager.subscribe` with the VAPID
public key → the resulting subscription (`endpoint`, `p256dh`, `auth`) is sent to
`subscribeAction` → `subscribe()` upserts a `PushSubscription` row. Twice daily (18:30
and 20:00 `SCHOOL_TZ`), an **external scheduler this repo does not control** issues
`POST /api/cron/reminders` with `Authorization: Bearer <CRON_SECRET>` → the route calls
`sendEveningReminders()`, which groups subscriptions by student (one `getPackingStatus`
per student, not per device), skips a student entirely if already fully packed, else sends
a Thai-language `web-push` payload naming up to 3 missing items to each of that student's
subscriptions independently. A `404`/`410` from the push service (dead endpoint) prunes
that one subscription row; any other per-subscription failure is counted in `failed` and
logged, never aborting the batch — only a missing VAPID configuration (nothing could be
sent to *anyone*) throws and stops the run. The route reports `502` only when nothing at
all got through (`sent === 0 && failed > 0`); a quiet, healthy evening (`sent === 0,
failed === 0`) still reports `200`. `public/sw.js` handles the resulting `push` event by
showing a notification, and
`notificationclick` by focusing an existing tab on `/student/tomorrow` or opening a new
one. `scripts/send-reminders-once.ts` is a manual/local trigger of the exact same code
path, for testing without waiting for the schedule or standing up a real scheduler.

### 8.6 Photo capture for future CV, gated by PDPA consent and sampled

Every successful `recordScan` optionally receives a `photoDataUrl` (a JPEG frame the
client's `<QRScanner>`/`<ScanView>` captures from the live camera feed at the moment of
decode, downscaled and compressed client-side — see "Client-side capture" below). Whether
it's actually kept now depends on two independent, server-side checks, both re-verified on
every scan regardless of what the client sends:

1. **Consent** (§3.6a/§7.8c, migration `20260903121850_photo_capture_consent`) —
   `recordScan` calls `hasActiveConsent(studentId, "PHOTO_CAPTURE")`; without it, the frame
   is discarded outright and none of what follows even runs. This did not always exist —
   the pipeline ran with no consent check at all from Phase 2 until it was added, despite
   CLAUDE.md already stating the requirement.
2. **Sampling** (`shouldCapturePhoto`, §7.8b) — even with consent, most scans still don't
   keep a photo, on purpose. The dataset Phase 4 actually needs is a few hundred *varied*
   photos per item — different students, different lighting, different times of day — not
   tens of thousands of near-identical shots of the same eight books a whole term of
   capturing *every* scan would produce, for enormous storage and privacy exposure and
   almost no additional training value past the first few hundred. Default: 10%
   (`PHOTO_SAMPLE_RATE`), except a `(studentId, subjectItemId)` pair below
   `PHOTO_MIN_SAMPLES_PER_ITEM` (default `5`) stored photos is always captured regardless —
   the floor that keeps coverage even across items instead of only the heavily-scanned ones
   accumulating data.

Only past both checks does `savePhoto` (§7.8b) actually persist the frame — through
whichever `PhotoStorage` backend is configured (below), storing just the filename on the
`PackingCheck` row either way. `photoPath` stays `null`, and the scan itself proceeds
identically, whenever either check fails.

**Client-side capture.** `<QRScanner>`'s `captureFrame` (`components/qr-scanner.tsx`)
downscales to 640px on the longest edge before encoding as JPEG at quality 0.7 — not
purely a bandwidth optimization: a raw phone-camera frame (often 1920×1080 or higher) can
exceed Next.js Server Actions' 1MB default body limit even at that same JPEG quality
un-resized, so `recordScanAction` would simply fail for exactly the photos this feature
exists to collect. The fixed 640px target is also a better shape for the eventual training
set on its own merits — uniform input dimensions, not whatever resolution each student's
device happens to report.

**Storage backend** (`lib/photo-storage.ts`, §7.8b) is pluggable via `PHOTO_STORAGE_DRIVER`
— `"local"` (dev default, `var/packing-photos/` on disk) or `"s3"` (any S3-compatible
object storage: AWS S3, Cloudflare R2, GCS's S3-interop mode). This used to be
disk-only, unconditionally — a real problem given the whole point of this pipeline is
accumulating data *across a term*: local disk is lost on every redeploy and on any
serverless host, with no backup, directly contradicting that purpose. Production
deployments are expected to set `PHOTO_STORAGE_DRIVER=s3`.

A guardian grants or revokes consent from `/parent/[studentId]/consent`
(`grantConsentOnline`/`revokeConsent`); the homeroom teacher can record a paper form, for
a family that never signs in at all, from the classroom roster page
(`recordPaperConsent`) — both write the same `Consent` row shape, just a different
`method`/actor-attribution pair. **Revoking deletes what's already stored**, not just
future capture: every existing photo for that student is deleted from storage (whichever
backend is configured) and every `PackingCheck.photoPath` referencing one is nulled,
immediately (`deletePhotosForChecks`, §7.8b) — a withdrawn lawful basis isn't lawful for
data already collected under it either.

This data is otherwise **unused today** — CLAUDE.md is explicit that Phase 4 (replacing
QR scanning with image recognition) must not be attempted before enough of it
accumulates, since this now yields a modest, sampled set of real photos of real books
under real classroom lighting, each with a 100%-correct label because it came directly
from the QR code that resolved the scan, not from any manual annotation — a training set
built only from consented, sampled photos, not everyone's, every time, by default. Photos
are served exclusively through the authorization-checked `/api/photos/[checkId]` route
(§6.5) — never a public or guessable URL either way, whichever storage backend is
configured — and `scripts/purge-old-photos.ts` deletes both the stored object and the
`photoPath` reference for any check older than a 90-day retention window (CLAUDE.md
"Privacy"), run via the same kind of external scheduler as the reminder push, sharing
`deletePhotosForChecks` with `revokeConsent` (same operation, an age-based `where` clause
instead of a student-based one) — this script needed no changes at all when the storage
backend became pluggable, since it already went through that shared function rather than
touching files directly.

### 8.7 Academic-year rollover

`scripts/rollover-term.ts` (a thin CLI wrapper, matching `send-reminders-once.ts`'s
relationship to `lib/push.ts`) reads a JSON config file path from `argv` and calls
`lib/terms.ts`'s `rolloverTerm` (§7.20) — no UI, run manually once a year (or whenever a
school's term actually ends), same out-of-band trust level as classroom creation and
`createTerm` itself. The config supplies the new term's dates/name and an explicit
`classroomPromotions` map (old classroom → new classroom, or `null` for a student who is
leaving/graduating) — there's no schema concept of grade progression to infer this from,
real schools reshuffle sections yearly rather than promoting everyone 1:1. In order: the
new `Term` is created (through `createTerm`, so its dates are checked against the
no-overlap invariant same as anywhere else); every active `Enrollment` in each mapped old
classroom is ended (the day before the new term starts) and, unless mapped to `null`, a
new one opens in the new classroom starting on the new term's first day; every
non-`RETIRED` `ItemCopy` belonging to a rolled-over student becomes `RETIRED` — last
year's workbooks are done regardless of which room the student moves into next, and
onboarding this year's new copies is a separate step through the classroom roster page's
"เพิ่มเล่มทั้งห้อง" bulk control (§6.4, §7.6) or its per-item "add missing item" prompts;
and, only if the config's
`copyTimetable` is true, each old classroom's timetable is duplicated into the new term
for its mapped new classroom.

### 8.8 The per-classroom "today" dashboard

`/teacher/classrooms/[id]/today` (§6.4), backed by `classroomTodayDashboard` (`lib/
dashboard.ts`, §7.14), replaced a homeroom-only spot-check list with a combined dashboard
matching a tablet-first reference the user supplied directly (a screenshot, not written
requirements) — stat cards, a colored student-status avatar grid, and a workbook-collection
panel, laid out for the wider screen a tablet actually has (§8.9's sidebar is the other half
of that same "teachers mostly use this on a tablet" brief).

The collection panel is the one genuinely new idea here: "which subjects' workbooks are due
for collection today, and has this whole class's copy of it been collected yet." Before
committing to a design, this was flagged back to the user as new functionality rather than
a visual mockup to fake — the answer was to build it for real, so it introduces no shortcut
and no `Coming soon` placeholder. Two design decisions made it a genuinely small addition
rather than a new subsystem:

1. **"Collected" is invariant 5's existing `ItemCopy.state = GRADING`, not a new field.**
   A teacher has always been able to mark one student's copy `GRADING` on the roster page;
   this panel is a classroom-wide read over the same field (`collectedCount`/`totalStudents`
   per `SubjectItem`, §7.14) plus a classroom-wide bulk write over it
   (`bulkSetItemCopyStateForClassroom`, §7.6). No migration, because no schema changed.
2. **"Which subjects are due today" reuses `lib/required-items.ts`'s own resolution
   machinery** (`termFor` + today's `TimetableSlot`s + `applyExceptions`, §6/§7.15) at
   classroom granularity instead of duplicating that logic. The exact same rules apply:
   a holiday collects nothing, an `EXAM` exception excludes that subject entirely (its
   ordinary item was never required to be packed that day either).

Authorization deliberately splits two ways on one page, reusing existing scoping rather
than inventing new: the whole-bag `packing` section stays exactly as homeroom-only as the
spot-check view it replaced (§10's "do not subject-scope this page" guidance is unchanged
and still enforced — see §6.4's note on why the *page's* own gate nonetheless changed from
`spot_check` to `edit_roster`), while `collectibleItems` is subject-scoped via the same
`manageableSubjectsInClassroom` (§7.6) every other item-copy surface already uses. A subject
teacher who isn't homeroom gets a real, useful page — their own subject's collection panel —
instead of the previous flat 404.

### 8.9 Responsive nav: one sidebar on tablet/desktop, tab bar on phone

Also from the same tablet-dashboard reference: `components/teacher-tab-bar.tsx` (phone,
bottom, `md:hidden`) and `components/teacher-sidebar.tsx` (tablet/desktop, left, `hidden
md:flex`) render the same 6 top-level destinations two different ways, switched purely by
CSS breakpoint — never both visible at once, and no JS media-query or layout duplication
needed, since Tailwind's responsive display classes handle it.

**`<TeacherSidebar>` is a single component with one fixed shape everywhere** — this was
the second iteration of this feature, not the first. The first attempt swapped in a wholly
separate "classroom-contextual" sidebar (`<ClassroomSidebar>`, and a matching
`app/teacher/classrooms/[id]/layout.tsx` to render it — both since deleted) while viewing
any `/teacher/classrooms/[id]/*` page: different header, different link set, no way back
to the other 5 top-level destinations except the browser back button. The user's own
correction was explicit — "the flow of using is not make sense and sidebar should have
only 1 format not changeable" — and pointed at exactly that: a sidebar that changes shape
mid-navigation breaks the mental model of "where am I, what else can I reach," regardless
of how faithfully either individual shape matched the reference screenshot.

The fix keeps the sidebar's top-level structure constant and expands a *nested* section
under "ห้องเรียน" instead: `app/teacher/layout.tsx` fetches the actor's visible classrooms
(`{id, name}` only — cheap) once, passes them to `<TeacherSidebar classrooms>`, and the
component itself (`usePathname()`, matching `/teacher/classrooms/([^/]+)`) looks up which
one — if any — is current and renders its short sub-nav indented beneath, without hiding
or replacing anything else. No second layout, no padding-breakout hack (the deleted
classroom layout's `md:-m-6` trick is gone with it) — every `/teacher/classrooms/[id]/*`
page now sits under the same single `app/teacher/layout.tsx` content wrapper as every other
teacher page. The sidebar uses the `--sidebar*` color tokens already defined in
`app/globals.css` — present since the original design reference but unused by any
component until this feature.

## 9. Testing Strategy

`tests/global-setup.ts` runs once per Vitest process, applying checked-in migrations to
`TEST_DATABASE_URL` (never the dev database) via `prisma migrate deploy`.
`tests/setup-env.ts` then repoints `process.env.DATABASE_URL` at the test database for
every test file. `tests/db-utils.ts`'s `resetDb()` — called from a `beforeEach` in nearly
every integration suite — `TRUNCATE ... CASCADE`s every application table (listed in
dependency order) between tests, so each test starts from a genuinely empty database
rather than a mocked one; this is a deliberate choice given how much of the logic under
test *is* real transactional/authorization behavior that a mock would hide bugs in.

- **`tests/unit/schedule.test.ts`** — `applyExceptions` in isolation: the plain-day case,
  a holiday wiping everything regardless of other same-day exceptions, a period swap, a
  cancelled period, an exam (tagged distinctly from a swap), and multiple exceptions
  combined on one day.
- **`tests/unit/time.test.ts`** — `weekdayOf` against a known date, `toSchoolDate`'s
  Bangkok-day rollover right after UTC midnight, and `schoolDateToUtcMidnight` round-
  tripping through `toSchoolDate`.
- **`tests/integration/required-items.test.ts`** — `requiredItemsFor`: normal-day
  listing, the invariant-5 GRADING suppression, a subject with no tracked copy at all
  being omitted, a school-wide holiday returning nothing, a period swap substituting the
  right item, a student with no active enrollment on the date returning nothing, and —
  the term-scoping fix's own regression test — editing a later term's timetable does not
  change what an earlier, still-`requiredItemsFor`-relevant date returns. Exam-day items
  (§3.3): an `EXAM` exception requires the subject's `forExam` items instead of its normal
  item, never both; a `forExam` item never appears on an ordinary (non-exam) day even with
  a tracked copy; and a plain `PERIOD_SWAP` on the same date behaves exactly as before —
  seeded with its own `forExam` item on the swapped-in subject specifically to prove a
  swap never triggers exam-item selection, only an actual `EXAM` exception's
  `source: "exam"` does. Also
  `requiredItemsForWeek`: a week whose Mon–Wed falls in one term and Thu–Fri in the next
  resolves each day against its own term's timetable independently, not one or the other
  for the whole week.
- **`tests/integration/qr.test.ts`** — `generateCode`'s opacity/format and
  non-predictability; then the full lifecycle: create-unassigned scoped to a teacher's
  own school, bind (and rejecting a re-bind of an already-assigned code), denial for a
  teacher outside the classroom, rebind preserving history (invariant 3) while assigning
  exactly one current `ASSIGNED` code, void, denial for a teacher outside the classroom,
  and denial for a teacher who teaches *that classroom* but not *that item's subject*,
  proving the subject-scoped `edit_item_copy` check independently of classroom-level
  access. A separate `describe` block covers `bindCodeWithResult`/`voidCodeWithResult` —
  the scan-to-bind entry path — proving the exact same two rejections (an already-`ASSIGNED`
  code, and the PE-teacher-binding-a-Math-item subject mismatch) hold there too, as
  `{ ok: false }` instead of a thrown error, plus that a failed scan-path bind attempt
  leaves the code untouched (still `UNASSIGNED`) and that undo (`voidCodeWithResult`)
  actually frees an item copy up for a fresh bind. A third `describe` block covers
  `generateAndBindCodesForClassroom` (print-and-bind): it binds exactly the copies that
  had no `ASSIGNED` code and leaves an already-bound copy's exact original code
  untouched (never rebound); a subject teacher given no explicit `subjectId` gets codes
  only for their own subject's items, the other subject's copy staying unbound; and an
  explicit `subjectId` the teacher doesn't teach is rejected outright (nothing created
  for it), rather than silently skipped.
- **`tests/integration/roster.test.ts`** — student creation with correct enrollment;
  `linkParent`'s idempotency; `setItemCopyState`'s GRADING toggle and denial to an
  outside-classroom teacher; `createItemCopy`'s subject-scoped denial (a same-classroom
  teacher who teaches a *different* subject); and the homeroom-vs-subject split
  end-to-end — a non-homeroom subject teacher is denied `linkParent`, the homeroom
  teacher in the same classroom succeeds; `createItemCopiesForClassroom`'s subject-scoped
  denial rejecting the whole batch (nothing created, even for the subject the teacher
  does teach), idempotency on re-run (`{created, skipped}` counts, no duplicate rows),
  and that a student whose enrollment already ended gets no copy. `bulkSetItemCopyStateForClassroom`
  (§7.6/§8.8): sets `GRADING` across every currently-enrolled student's copy of one item
  and reports the count, toggling back with the same call; leaves a withdrawn student's
  copy untouched; denied for a teacher who doesn't teach that subject even within a
  classroom they do teach; the homeroom teacher can bulk-collect a subject's item they
  don't personally teach (the same homeroom bypass `edit_item_copy` grants everywhere
  else).
- **`tests/integration/dashboard.test.ts`** — `classroomTodayDashboard` (§7.14/§8.8): the
  homeroom teacher sees correct complete/partial/not-started counts derived from real
  `PackingCheck` state (a scanned item via `recordScan`, an untouched student); a
  non-homeroom subject teacher gets `packing: null` while `collectibleItems` is correctly
  scoped to only their own subject, even when another subject also has a period that day;
  a `HOLIDAY` exception empties `collectibleItems` and sets `isHoliday`; an `EXAM`
  exception excludes that subject's ordinary item entirely (never both, matching
  `requiredItemsFor`'s own forExam split, §7.7); `collectedCount` reflects exactly how
  many tracked copies are currently `GRADING` against how many exist; and denial for a
  teacher with no relationship to the classroom at all.
- **`tests/integration/student-auth.test.ts`** — code/password generation (format,
  non-collision); `issueStudentCredentials` (hash-only persistence, single-use plaintext
  return, code stability across a reset, homeroom-style classroom-scoped denial); and
  `verifyStudentLogin`'s exponential backoff (unknown code; successful login creating a
  real `Session` row; the wait growing 1s→2s→4s→8s across successive wrong attempts with
  *no* point at which the account locks outright — a correct password still succeeds
  right after; a wrong attempt made while still inside an active cooldown doesn't advance
  the backoff level further; a correct password succeeds immediately even mid-cooldown
  and clears all backoff state; the backoff level decays back to 1s after a quiet period
  past `BACKOFF_DECAY_MINUTES`; failed-attempt counter reset on success).
- **`tests/integration/rate-limit.test.ts`** — `checkRateLimit` in isolation: allows up to
  `max` requests in a window then rejects with a positive `retryAfterSeconds`; resets once
  the window fully elapses; and — the property `app/login/student-actions.ts`'s per-IP
  login throttle actually relies on — two different keys (standing in for two different
  IPs, or the per-student backoff's own keys) never affect each other's buckets, proving
  the per-IP limit is structurally independent of `lib/student-auth.ts`'s per-student one,
  not just coincidentally non-interfering.
- **`tests/integration/packing.test.ts`** — the full anti-cheat + completion flow: a scan
  completing a session and awarding points exactly once; GRADING exclusion holding inside
  the live packing flow too; rejection of another student's item; rejection of an
  unknown/unassigned code; a TTL-expired session carrying its checks forward onto the next
  one instead of losing them, completing once the total is met and marked `continuous:
  false` (plus the check rows themselves having actually moved, not duplicated) — and,
  separately, that a session completed without ever expiring stays `continuous: true`.
  The two-window resolution added for the morning window: a scan at 06:00 targets *today*
  (`PackingSession.forDate` equals `schoolToday()` at that instant); a scan at 19:00 still
  targets tomorrow (unchanged); a scan at 15:00, between both windows, is rejected with
  `PackingWindowClosedError`; and — the double-award guard — a date completed via an
  evening scan the night before is not re-completed or re-awarded by a morning scan that
  resolves to the same now-current date (still exactly one `PackingSession` row, one
  award). Separately, `computeStreak`'s three states (no fail ever, an
  incomplete-but-not-failed evening not resetting it, resetting after a real fail) and
  `spotCheck`'s deduction (exactly reversing that day's completion award, with audit
  trail), the zero-floor (a second catch once the balance is already `0` costs nothing
  further — a `0`-delta row, still recorded — rather than going negative), an outsider
  teacher with no relationship to the classroom denied, **and its homeroom-only gate**: the
  homeroom teacher can spot-check a subject's item they have no `TeachingAssignment` for at
  all (proving it's not secretly still subject-scoped), while a genuine subject teacher of
  that same classroom — who isn't homeroom — is denied the exact same call that used to be
  allowed before this was reversed. A separate `describe("recordTeacherScan")` block
  (§8.3a) covers: a homeroom teacher's scan completing the session and awarding points to
  the student, run at an instant between both windows to prove the bypass is real (an
  ordinary `recordScan` at the same kind of instant is rejected, per the earlier test);
  `startedByUserId` recorded as the acting teacher's `userId` on a teacher-run session
  versus `null` on an ordinary student-run one; and a subject teacher assigned to the same
  classroom, but not homeroom, denied. A further `describe("manualAdjustPoints")` block
  (§7.9/§8.4) covers: a homeroom teacher's positive adjustment recorded with its `note` and
  `actorUserId`, and added to the balance; a negative adjustment allowed to push the
  balance below `0` (proving there's no zero-floor, unlike `awardPenaltyCappedAtZero`); a
  blank (whitespace-only) reason rejected; a zero delta rejected; and a subject teacher who
  isn't homeroom denied.
- **`tests/integration/rewards.test.ts`** — insufficient-balance rejection, a successful
  redemption's ledger row, two concurrent redemptions racing past the same balance
  (proving the `Serializable` isolation actually prevents overspend, and — since
  `withSerializableRetry` was introduced — that the loser's rejection is the clean
  `"แต้มไม่พอ"` a genuinely-insufficient balance would produce, not a raw serialization
  error), an outside-school teacher denied reward creation, and `fulfillRedemption`'s audit
  stamping. Stock (§3.6): redeeming a `stock: 0` reward is rejected even with plenty of
  balance and spends nothing; a `null`-stock reward stays unlimited (and stays `null`)
  across repeated redemptions; two concurrent redemptions of a `stock: 1` reward — exactly
  one succeeds, stock ends at `0`, exactly one `Redemption` row exists, and the loser's
  rejection is the clean `"ของรางวัลหมดแล้ว"` (same retry-then-clean-rejection proof as the
  balance race, mirrored for stock). `deleteReward`: throws, naming `active: false`, when
  redemption history exists — and the reward, the `Redemption`, and the `PointLedger`
  row's `refId` all still resolve afterward, proving nothing was destroyed — while a
  reward with no history still deletes cleanly.
- **`tests/integration/db-retry.test.ts`** — `withSerializableRetry` in isolation, against
  fake errors shaped like what this project's actual Prisma + `@prisma/adapter-pg` setup
  throws (verified with a throwaway probe script, not assumed): retries a `P2034` failure
  and returns the eventual success; also retries the SQLSTATE-40001-in-`meta`-without-P2034
  shape (the "or a transaction API error" case); gives up and rethrows after exactly 3
  retries (4 total attempts) if every attempt fails; rethrows a non-serialization error
  (a plain `Error`, e.g. what `redeem()`'s own business rejections look like) immediately,
  with no retry at all.
- **`tests/integration/push.test.ts`** — `sendEveningReminders` with `web-push`'s
  `sendNotification`/`setVapidDetails` mocked (`vi.mock("web-push", ...)`, VAPID keys
  themselves come from `.env` via `tests/setup-env.ts` like every other test process, so
  the whole-run precondition never trips here): a `500` from one endpoint doesn't stop
  delivery to a different student's endpoint in the same run — collected into `failed`,
  the call never throws — and neither subscription is deleted (a `500` isn't a dead
  endpoint); a `410` still deletes exactly that subscription row and counts it as
  `pruned`; and, spying on `lib/packing.ts`'s `getPackingStatus` (`vi.spyOn`, real
  implementation, not replaced) rather than re-deriving it indirectly, a student with two
  `PushSubscription` rows (phone + tablet) triggers exactly one `getPackingStatus` call
  and still sends to both devices.
- **`tests/integration/consent.test.ts`** — two `describe` blocks, against the default
  local-disk storage backend (each test is a single scan for a fresh student/item, always
  well under `shouldCapturePhoto`'s sampling floor, so sampling itself never interferes
  here — that's `photo-storage.test.ts`'s job, below). `recordScan +photo capture consent`:
  with no `Consent` row at all, the scan still succeeds (item verified, session
  progresses) but `PackingCheck.photoPath` stays `null`; with an active (current-version,
  non-revoked) consent, the photo is genuinely written to disk (`localPhotoFilePath`) and
  referenced; a `Consent` row whose `version` doesn't match `CURRENT_CONSENT_VERSION`
  counts as absent the same way no row at all does — `hasActiveConsent` returns `false`
  and the scan behaves identically to the no-consent case. `lib/consent.ts`: a parent can
  grant online consent for their own child and is denied for a child they don't guard; the
  homeroom teacher can record a paper form and a subject teacher who isn't homeroom is
  denied the identical call; and — the destructive half — revoking deletes every stored
  photo file and nulls every `PackingCheck.photoPath` referencing one, while the `Consent`
  row itself is only marked `revokedAt`, never deleted (the historical record survives),
  and revoking with nothing currently active is a no-op, not a thrown error.
- **`tests/integration/photo-storage.test.ts`** — `shouldCapturePhoto` in isolation, with
  `Math.random` mocked so the sample-rate check is deterministic rather than flaky: below
  the default floor of `5` stored photos for a `(student, subjectItem)` pair, always
  captures regardless of a mocked-unfavorable random draw; past the floor, a mocked draw
  below the default `0.1` rate captures and one above it doesn't; and a different
  student's high photo count for the same `subjectItem` doesn't raise *this* student's own
  floor — coverage is scoped per pair, not per item globally.
- **`tests/integration/catalog.test.ts`** — per-school (not global) catalog access: a
  teacher at that school may manage it, a non-teacher is denied, and — the multi-tenancy
  fix's own regression test — a teacher at school B is denied creating, renaming, or
  deleting anything in school A's catalog. Also covers the archive-by-default behavior
  (`deleteSubject` leaves the row and its children intact, just sets `archivedAt`), hard
  delete being blocked with a clear message when an `ItemCopy` still references the
  target and succeeding once nothing does, and the archived-item design decision itself:
  an archived `SubjectItem` is absent from a `archivedAt: null`-filtered catalog query
  but still resolves through `requiredItemsFor` for a student with a live `ItemCopy`.
- **`tests/integration/terms.test.ts`** — `createTerm`'s no-overlap invariant: two
  overlapping terms for the same school rejected, back-to-back non-overlapping terms
  allowed, and identical date ranges across *different* schools allowed. `rolloverTerm`
  end to end: the old enrollment ends and a new one opens in the mapped classroom, a
  classroom mapped to `null` just ends the enrollment (graduating/leaving) with no
  replacement, all of the rolled-over student's `ItemCopy`s become `RETIRED`, and
  `copyTimetable` either duplicates the ending term's slots into the new term/classroom
  or (when omitted) leaves the new term's timetable empty — with the ending term's own
  slots left untouched either way.
- **`tests/integration/policy.test.ts`** — the `can()` matrix directly: a teacher's own
  classroom/school access versus denial elsewhere; a student's own classroom (view-only)
  versus denial of another; a parent's own child versus denial of another family; total
  denial for a logged-in user with no linked profile at all; and both `visibleStudentWhere`
  and `visibleClassroomWhere` scoping list queries correctly per actor type.

## 10. Known Limitations / Open Items

- **Phase 4 (computer vision) has not started.** QR scanning remains the only packing
  check-in method. The photo-capture pipeline (§8.6) has been running since Phase 2, on
  purpose, to accumulate a labeled dataset before this is attempted.
- **The morning spot-check page (`/teacher/classrooms/[id]/today`) is homeroom-only —
  deliberately *not* subject-scoped, the opposite of `edit_item_copy`.** This page used to
  gate on the same coarse `can(actor, "edit_roster", {classroom})` any-subject check used
  before the homeroom/subject split existed, and this section used to record an intent to
  subject-scope it to match the roster page's item-copy actions. That intent was reversed:
  ครูประจำชั้น checks the whole bag every morning, not each subject teacher arriving
  separately to check only their own item — subject-scoping this page would show every
  teacher a partial view of one child's bag, which matches nobody's actual morning routine
  and makes the page harder to reason about for no real gain. It now gates on a dedicated
  `"spot_check"` action (§4.4, `lib/policy.ts`) rather than reusing `edit_student_account`
  — that action's own name ("link a parent, (re)issue login credentials") would read wrong
  at a bag-checking call site — and `spotCheck()` (`lib/packing.ts`) enforces the same
  homeroom check directly via a private `requireHomeroomAccessForItemCopyOwner`, not
  `lib/qr.ts`'s subject-scoped `requireTeacherAccessForItemCopy`. **Do not "fix" this back
  to subject-scoped** — it was tried the other way first and reversed on purpose; see §6.4
  for the full reasoning. This page later (§8.8) grew a second, genuinely subject-scoped
  section (the workbook-collection panel) alongside the still-homeroom-only spot-check
  section, so the *page's* own top-level gate moved to `edit_roster` (any subject teacher)
  — this is not a reversal of the guidance above: `classroomTodayDashboard` still returns
  `packing: null`, and the page still renders nothing from the whole-bag section, for
  anyone who isn't homeroom. Don't read the page-level gate change as license to also
  loosen `spotCheck()` itself or the `packing` section's own internal check — neither
  changed.
- **`ngrok` + Google OAuth**: Google only allows redirecting back to pre-registered
  URIs (`http://localhost:3000/api/auth/callback/google` per `.env.example`); testing the
  teacher/parent Google login flow through an ngrok tunnel requires manually adding that
  session's ngrok URL to the OAuth client's authorized redirect URIs in Google Cloud
  Console every time (free-tier ngrok issues a new random subdomain per session). This
  is an inherent OAuth constraint, not a bug — the student code+PIN login path (§5.2)
  exists precisely so phone-based testing doesn't need Google at all.
- **`next dev` cross-origin dev-resource blocking**: Next.js 15.3+ blocks cross-origin
  requests to `/_next/*` (JS chunks, HMR) by default, which breaks all client
  interactivity when the app is loaded through a tunnel/proxy on a non-localhost origin.
  `next.config.ts` now sets `allowedDevOrigins` to cover common ngrok domain suffixes;
  this requires restarting `next dev` (not just refreshing the browser) after being
  added, since Node caches the config at process start.
- **`restoreSubject`/`restoreSubjectItem` (`lib/catalog.ts`) have no wired-up button.**
  The lib functions exist so archiving isn't a one-way trip, but `/teacher/subjects`
  today only exposes the archive action, not a way to browse and un-archive — reversing
  a mistaken archive currently means calling the function directly (Prisma Studio, a
  script) rather than through the UI.
- **Creating a new `SubjectItem` under an archived `Subject` is not blocked.**
  `createSubjectItem` doesn't check its parent `Subject`'s `archivedAt` — not a
  considered trade-off, just that no UI path currently offers it (the catalog page only
  lists non-archived subjects to add items under in the first place).
- **Consent (§3.6a/§7.8c) covers `PHOTO_CAPTURE` only, by design — not "consent to use
  this app" broadly.** The `ConsentScope` enum has exactly one member today because
  that's the one thing this app actually collects sensitive data about beyond ordinary
  account operation; adding a new scope (a second enum value + a new
  `CURRENT_CONSENT_VERSION` entry) is meant to be cheap if the app ever needs to ask for
  consent to something else, not a sign the one scope is a placeholder.
- **No admin UI to bump `CURRENT_CONSENT_VERSION`, or to see who's missing consent
  school-wide.** Both are a code change / a manual query today, same out-of-band
  precedent as `Term`/school-settings administration (§10, elsewhere in this list) —
  there's no `/teacher/*` screen that lists "students with no active photo consent" for a
  teacher to chase down, only the per-student status on the roster page.
- **The homeroom teacher can revoke consent too, not just record a paper grant.** This
  was a deliberate symmetry choice, not explicitly asked for by the original consent
  requirement (which only named recording a paper *grant*): a family who can ask the
  teacher to collect their paper consent form can reasonably also ask them, in person, to
  withdraw it, and the underlying `revokeConsent` access check already covers the
  homeroom teacher for the same reason `recordPaperConsent` does. Worth knowing if a
  future reviewer expects the teacher-side UI to be grant-only.
- **No term-picker UI.** `/teacher/timetable` always shows "the term covering today"
  (`lib/timetable.ts`'s `resolveTermId` default, §7.17) — there is no way, through the
  app, to view a different term's timetable (a not-yet-started next term, or a past one,
  for reference). `listTimetableSlots` already accepts an explicit `termId`, so a picker
  is additive whenever it's wanted.
- **Per-school anti-cheat/points settings (`School.packingWindowStartHour` etc., §3.2)
  have no admin UI either**, same precedent: a school that wants different values than
  the shipped defaults gets them via script or Prisma Studio, not `/teacher/*`.
- **Term/school administration has no UI**, same precedent as classroom creation just
  above: `createTerm` and `rolloverTerm` (`lib/terms.ts`, §7.20) are only reachable via
  `scripts/rollover-term.ts` or direct script/Prisma-Studio access, never from
  `/teacher/*`. An academic calendar is treated as a school-administration concern, not a
  teacher-facing feature, exactly like classroom setup.
- **`classroomPromotions` (the rollover's old→new classroom map) is a required manual
  input, not inferred.** There is no schema concept of grade progression or which
  classroom "follows" another — real schools reshuffle sections yearly rather than
  promoting everyone 1:1 — so whoever runs a rollover must supply this mapping by hand
  each time (§8.7).
- **`ItemCopyState.RETIRED`** was defined in the schema from Phase 1 but had no code path
  that ever set it until `rolloverTerm` (§7.20) — it's no longer a dead enum value, but
  it's still only reachable through that one rollover path today, not from any
  teacher-facing action.
- **Rebind (replacing a lost/torn sticker) has no scan-based path.** Only initial binding
  got scan-to-bind/rapid-bind (§6.4, §8.2) — "เปลี่ยนสติกเกอร์" is still the manual typed
  form only. A rebind-by-scan mode would reuse the same `<BindScannerModal>`/`<QRScanner>`
  machinery if built; it just wasn't asked for.
- **`generateAndBindCodesForClassroom` (print-and-bind, §7.5/§8.2) does not exclude
  `RETIRED` item copies.** Its only filter is "no currently-`ASSIGNED` code" — a `RETIRED`
  copy (last year's workbook, post-rollover, §7.20) qualifies just like a live one if
  something ever left it without a code, printing a sticker for a book nobody will use
  again. Not a considered trade-off, just outside what was asked; scoping the query to
  `state: { not: "RETIRED" }` would close it whenever it comes up in practice.
- **"Undo" in the scan flows reverts only the single most recent bind**, not an arbitrary
  point in the session's scan history — undoing twice in a row undoes the two most recent
  binds one at a time (each call pops one entry off the modal's local history), there's
  no multi-step redo.
- **`scanBindAction`/`scanUndoBindAction` (`app/teacher/classrooms/[id]/actions.ts`) are
  not unit-tested directly** — they're deliberately thin (`requireActor()` +
  delegate), and `requireActor()` reads the request's session cookie via `next/headers`,
  which has no meaning outside an actual Next.js request. The real behavior they wrap —
  `bindCodeWithResult`/`voidCodeWithResult` in `lib/qr.ts` — takes an explicit `actor`
  and *is* tested directly (§9), the same "thin route handler, tested lib function"
  split this codebase uses everywhere else (CLAUDE.md "Conventions").
- **`lib/points.ts`'s `awardPenaltyCappedAtZero` also runs at `Serializable` isolation
  (§7.9) but is not wrapped in `withSerializableRetry` (§7.4a).** It's just as exposed to
  the same raw-serialization-failure-reaching-the-caller problem `redeem()` had — two
  concurrent `spotCheck` calls against the same student could race the same way. Not
  wrapped because wrapping it wasn't asked for when `withSerializableRetry` was introduced
  (`redeem()` was the one specific complaint), and `withSerializableRetry` was built
  generic specifically so this is a one-line follow-up whenever it is.
- **`lib/rate-limit.ts`'s `checkRateLimit` is in-memory and per-process** (§7.11a) — correct
  at this app's current single-instance deployment, but a horizontally-scaled deployment
  would need a shared store (Redis, etc.): each server instance would otherwise track its
  own independent buckets, so the *effective* per-IP login limit would silently multiply
  by however many instances happen to be running, and a restart resets every bucket to
  zero. Not a concern raised by the task that introduced it, and not worth building ahead
  of an actual multi-instance deployment target this repo doesn't have yet.
- **`verifyStudentLogin`'s exponential backoff (§7.12) has one known, deliberately
  unclosed residual signal**: the very first wrong password against an *existing* student
  code returns a `"...ลองใหม่ใน 1 วินาที"` suffix, while a wrong password against a
  *nonexistent* code always returns the bare generic message — letting anyone willing to
  spend one throttled attempt per code learn whether that exact code exists. Fully closing
  this would mean fabricating identical backoff state for codes that map to no `Student`
  row at all, which has no natural place to live without a second, code-keyed tracking
  mechanism parallel to the per-student one. Judged not worth it: the practical
  enumeration risk this whole feature request was about — cheaply probing many candidate
  codes at scale to find live ones — is what the new per-IP `checkRateLimit` in
  `app/login/student-actions.ts` actually throttles; this residual signal only helps
  someone who already has one specific code worth checking.
- **Switching `PHOTO_STORAGE_DRIVER` does not relocate already-stored photos.** A photo
  saved under `"local"` lives only on that server's disk; a photo saved under `"s3"` lives
  only in that bucket. Changing the env var mid-deployment (or between a dev instance and
  production) doesn't migrate anything that was already written under the old driver —
  `photoStorage.read`/`.delete` will simply miss it (a 404/no-op, not a crash, since both
  backends already tolerate a missing object). Not a concern this task raised, and not
  worth a migration tool ahead of an actual driver switch happening in practice — but
  worth knowing before assuming a flipped env var is retroactive.
- **`PHOTO_SAMPLE_RATE`/`PHOTO_MIN_SAMPLES_PER_ITEM` are process-wide env vars, not
  per-school settings** (unlike `packingWindowStartHour` and friends on `School`, §3.2).
  This is a training-data/ops tuning knob, not a school policy choice, so it wasn't given
  the per-school-settings treatment — every school configured against one deployment
  shares the same sampling rate and floor today.
