// Client-safe constants only — no Prisma/bcrypt/Node imports here, since
// components/student-login-form.tsx (a client component) needs these for
// input maxLength. lib/student-auth.ts (server-only: Prisma, bcrypt) is the
// one place that actually generates/verifies codes against these lengths.
export const STUDENT_CODE_LENGTH = 6;
// Raised from 4 — now that lib/student-auth.ts's exponential backoff, not a
// hard account lock, is the main defence against guessing, a larger PIN
// space is a genuine complementary improvement (more guesses needed before
// backoff's growing delay makes brute-forcing impractical). Only affects
// *newly issued* passwords (lib/student-auth.ts's generatePassword()) —
// verifyStudentLogin compares against a bcrypt hash, which has no opinion
// on the plaintext's length, so an existing 4-digit PIN keeps working
// exactly as issued; nothing needs a migration/backfill for this.
export const STUDENT_PASSWORD_LENGTH = 6;
