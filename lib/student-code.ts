// Client-safe constants only — no Prisma/bcrypt/Node imports here, since
// components/student-login-form.tsx (a client component) needs these for
// input maxLength. lib/student-auth.ts (server-only: Prisma, bcrypt) is the
// one place that actually generates/verifies codes against these lengths.
export const STUDENT_CODE_LENGTH = 6;
export const STUDENT_PASSWORD_LENGTH = 4;
