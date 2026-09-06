-- Rename, not drop+add: preserves any existing value (a past hard-lock
-- timestamp is still harmless under the new cooldown semantics — it's
-- already in the past, so it never blocks a login).
ALTER TABLE "students" RENAME COLUMN "lockedUntil" TO "nextLoginAttemptAt";
