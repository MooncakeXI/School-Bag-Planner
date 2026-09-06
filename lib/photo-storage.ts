import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "./prisma";

// Split out of lib/packing.ts specifically so lib/consent.ts (revoking
// consent deletes stored photos) and lib/packing.ts (recordScan only saves
// a photo when consent is active) can both depend on this without a
// circular import between the two.

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
function contentTypeForFilename(filename: string): string {
  const ext = filename.split(".").pop() ?? "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

export type PhotoReadResult =
  | { kind: "bytes"; bytes: Buffer; contentType: string }
  // S3-backed storage returns a short-lived signed URL instead of bytes —
  // the caller (the /api/photos/[checkId] route) redirects to it rather
  // than streaming through the Next.js server. Never a public/permanent
  // URL either way (CLAUDE.md "Privacy") — the signature expires in
  // minutes, and the route's own auth check still runs before this is
  // ever generated.
  | { kind: "redirect"; url: string };

/**
 * Where packing-scan photos actually live. Two implementations, chosen by
 * `PHOTO_STORAGE_DRIVER`: local disk (dev default — `var/packing-photos/`,
 * lost on every redeploy/serverless cold start, no backup) and S3-compatible
 * object storage (AWS S3, Cloudflare R2, or GCS's S3-interop mode — the
 * actual data this project intends to accumulate across a whole term for
 * Phase 4 has to survive redeploys to be worth collecting at all).
 */
export interface PhotoStorage {
  save(filename: string, bytes: Buffer, contentType: string): Promise<void>;
  delete(filename: string): Promise<void>;
  read(filename: string): Promise<PhotoReadResult>;
}

class LocalDiskPhotoStorage implements PhotoStorage {
  private readonly dir = path.join(process.cwd(), "var", "packing-photos");

  private filePath(filename: string): string {
    return path.join(this.dir, filename);
  }

  async save(filename: string, bytes: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.filePath(filename), bytes);
  }

  async delete(filename: string): Promise<void> {
    try {
      await unlink(this.filePath(filename));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async read(filename: string): Promise<PhotoReadResult> {
    const bytes = await readFile(this.filePath(filename));
    return { kind: "bytes", bytes, contentType: contentTypeForFilename(filename) };
  }
}

const SIGNED_URL_EXPIRY_SECONDS = 60;

class S3PhotoStorage implements PhotoStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = requireEnv("PHOTO_STORAGE_BUCKET");
    this.client = new S3Client({
      region: process.env.PHOTO_STORAGE_REGION || "auto",
      // Unset for real AWS S3 (the SDK resolves the regional endpoint on
      // its own); required for R2/GCS, which speak the S3 API at their own
      // endpoint URL.
      endpoint: process.env.PHOTO_STORAGE_ENDPOINT || undefined,
      credentials: {
        accessKeyId: requireEnv("PHOTO_STORAGE_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("PHOTO_STORAGE_SECRET_ACCESS_KEY"),
      },
    });
  }

  async save(filename: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: filename, Body: bytes, ContentType: contentType }),
    );
  }

  async delete(filename: string): Promise<void> {
    // S3-compatible DeleteObject is idempotent (no error for a missing
    // key), unlike node:fs's unlink — no ENOENT-style handling needed here.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: filename }));
  }

  async read(filename: string): Promise<PhotoReadResult> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: filename });
    const url = await getSignedUrl(this.client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
    return { kind: "redirect", url };
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when PHOTO_STORAGE_DRIVER=s3`);
  return value;
}

function createPhotoStorage(): PhotoStorage {
  const driver = process.env.PHOTO_STORAGE_DRIVER || "local";
  if (driver === "local") return new LocalDiskPhotoStorage();
  if (driver === "s3") return new S3PhotoStorage();
  throw new Error(`Unknown PHOTO_STORAGE_DRIVER "${driver}" (expected "local" or "s3")`);
}

export const photoStorage: PhotoStorage = createPhotoStorage();

/** Local-disk-specific path resolution — only meaningful when
 * `PHOTO_STORAGE_DRIVER=local` (the dev/test default). Exists for tests
 * that need to assert a file was actually written to/removed from disk;
 * production code should go through `photoStorage` instead, which works
 * the same way regardless of which backend is configured. */
export function localPhotoFilePath(filename: string): string {
  return path.join(process.cwd(), "var", "packing-photos", filename);
}

export async function savePhoto(dataUrl: string): Promise<string | null> {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const [, ext, base64] = match;
  const filename = `${randomUUID()}.${ext === "jpg" ? "jpeg" : ext}`;
  await photoStorage.save(filename, Buffer.from(base64, "base64"), contentTypeForFilename(filename));
  return filename;
}

/**
 * Deletes each check's photo (if any) from storage and nulls its
 * `photoPath`. Shared by `scripts/purge-old-photos.ts` (age-based
 * retention) and `lib/consent.ts`'s `revokeConsent` (student-based: every
 * stored photo, regardless of age, the moment consent is withdrawn) — same
 * operation, different `where` clause chosen by the caller. The DB
 * reference is what must end up null either way, regardless of storage
 * backend.
 */
export async function deletePhotosForChecks(checks: { id: string; photoPath: string | null }[]): Promise<number> {
  let deleted = 0;
  for (const check of checks) {
    if (!check.photoPath) continue;
    await photoStorage.delete(check.photoPath);
    await prisma.packingCheck.update({ where: { id: check.id }, data: { photoPath: null } });
    deleted++;
  }
  return deleted;
}

/**
 * What's currently stored for a student — a count and date range, not the
 * images themselves. Backs the parent consent screen's "see what's stored"
 * requirement (CLAUDE.md "Privacy": the images stay private by default).
 */
export async function photoStorageSummary(
  studentId: string,
): Promise<{ count: number; earliest: Date | null; latest: Date | null }> {
  const agg = await prisma.packingCheck.aggregate({
    where: { photoPath: { not: null }, session: { studentId } },
    _count: { _all: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });
  return { count: agg._count._all, earliest: agg._min.createdAt, latest: agg._max.createdAt };
}

// Sampling for the CV training set (§8.6): the dataset Phase 4 needs is a
// few hundred *varied* photos per item — different students, different
// lighting, different times of day — not fifty thousand near-identical
// shots of the same eight books, which is what capturing every single scan
// over a term would produce for enormous storage and privacy exposure with
// almost no additional training value past the first few hundred.
const PHOTO_SAMPLE_RATE = process.env.PHOTO_SAMPLE_RATE ? Number(process.env.PHOTO_SAMPLE_RATE) : 0.1;
const MIN_SAMPLES_PER_STUDENT_ITEM = process.env.PHOTO_MIN_SAMPLES_PER_ITEM
  ? Number(process.env.PHOTO_MIN_SAMPLES_PER_ITEM)
  : 5;

/**
 * Whether this particular scan's photo should actually be kept. Two rules,
 * first one that applies wins: below `MIN_SAMPLES_PER_STUDENT_ITEM` photos
 * already stored for this exact (student, subjectItem) pair, always keep
 * it — this is what keeps coverage *even* across items: an item that's
 * scanned rarely still reaches its baseline instead of only ever getting
 * the same ~10% chance as a heavily-scanned one. Past that floor, keep it
 * with probability `PHOTO_SAMPLE_RATE`. Server-side only, like every other
 * "should this be trusted/kept" decision in this codebase — the client has
 * no say in whether its frame ends up stored.
 */
export async function shouldCapturePhoto(studentId: string, subjectItemId: string): Promise<boolean> {
  const existingCount = await prisma.packingCheck.count({
    where: { photoPath: { not: null }, itemCopy: { studentId, subjectItemId } },
  });
  if (existingCount < MIN_SAMPLES_PER_STUDENT_ITEM) return true;
  return Math.random() < PHOTO_SAMPLE_RATE;
}
