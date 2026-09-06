"use server";

import { redirect } from "next/navigation";
import type { ItemCopyState } from "@prisma/client";
import { requireActor } from "@/lib/session";
import {
  createItemCopiesForClassroom,
  createItemCopy,
  createStudent,
  issueStudentCredentials,
  linkParent,
  setItemCopyState,
} from "@/lib/roster";
import { bindCode, bindCodeWithResult, rebindCode, voidCode, voidCodeWithResult } from "@/lib/qr";
import { recordPaperConsent, revokeConsent } from "@/lib/consent";
import { manualAdjustPoints } from "@/lib/points";

function backToClassroom(classroomId: string) {
  redirect(`/teacher/classrooms/${classroomId}`);
}

export async function createStudentAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const name = formData.get("name") as string;

  await createStudent(actor, classroomId, name);
  backToClassroom(classroomId);
}

export async function linkParentAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const studentId = formData.get("studentId") as string;
  const email = formData.get("email") as string;
  const name = formData.get("name") as string;

  await linkParent(actor, studentId, { email, name });
  backToClassroom(classroomId);
}

export async function setItemCopyStateAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const itemCopyId = formData.get("itemCopyId") as string;
  const state = formData.get("state") as ItemCopyState;

  await setItemCopyState(actor, itemCopyId, state);
  backToClassroom(classroomId);
}

export async function createItemCopyAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const studentId = formData.get("studentId") as string;
  const subjectItemId = formData.get("subjectItemId") as string;

  await createItemCopy(actor, { studentId, subjectItemId });
  backToClassroom(classroomId);
}

export async function bindCodeAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const itemCopyId = formData.get("itemCopyId") as string;
  const code = (formData.get("code") as string).trim();

  await bindCode(actor, { code, itemCopyId });
  backToClassroom(classroomId);
}

export async function rebindCodeAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const itemCopyId = formData.get("itemCopyId") as string;
  const newCode = (formData.get("newCode") as string).trim();

  await rebindCode(actor, { itemCopyId, newCode });
  backToClassroom(classroomId);
}

export async function voidCodeAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const code = formData.get("code") as string;

  await voidCode(actor, code);
  backToClassroom(classroomId);
}

// Called directly from a client component (components/issue-credentials-button.tsx),
// not a <form>, because the plaintext password it returns must reach the
// screen exactly once — a redirect-based action would discard it.
export async function issueStudentCredentialsAction(studentId: string) {
  const actor = await requireActor();
  return issueStudentCredentials(actor, studentId);
}

// Called directly from components/bind-scanner-modal.tsx (the "scan to
// bind"/"rapid bind" camera flows), not a <form> — the modal needs a result
// per scan to show inline feedback and keep the camera open, not a page
// redirect. Thin: all the actual work (including the authorization check)
// is lib/qr.ts's bindCode itself, via bindCodeWithResult — same as
// bindCodeAction above, just not thrown/redirect-shaped.
export async function scanBindAction(itemCopyId: string, code: string) {
  const actor = await requireActor();
  return bindCodeWithResult(actor, { code, itemCopyId });
}

// Called directly from components/bulk-add-items-button.tsx (a multi-select,
// not a <form>) so the created/skipped counts can be shown inline instead
// of only via a redirect.
export async function createItemCopiesForClassroomAction(classroomId: string, subjectItemIds: string[]) {
  const actor = await requireActor();
  return createItemCopiesForClassroom(actor, { classroomId, subjectItemIds });
}

// "Undo" for the scan flows: voids a just-bound code via the exact same
// lib/qr.ts voidCode the manual "ยกเลิก" button already uses, so a
// mis-scanned sticker can be corrected without leaving the scanner.
export async function scanUndoBindAction(code: string) {
  const actor = await requireActor();
  return voidCodeWithResult(actor, code);
}

// Homeroom-only (lib/consent.ts's requireConsentAccess): records that a
// signed paper consent form was collected for a family that never uses the
// app online at all.
export async function recordPaperConsentAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const studentId = formData.get("studentId") as string;

  await recordPaperConsent(actor, { studentId, scope: "PHOTO_CAPTURE" });
  backToClassroom(classroomId);
}

// Same access as recordPaperConsentAction — a family can ask the homeroom
// teacher to withdraw consent just as they can ask them to record a paper
// grant. Deletes every stored photo immediately (lib/consent.ts's
// revokeConsent), not just future capture.
export async function revokeConsentAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const studentId = formData.get("studentId") as string;

  await revokeConsent(actor, { studentId, scope: "PHOTO_CAPTURE" });
  backToClassroom(classroomId);
}

// Homeroom-only (lib/points.ts's manualAdjustPoints, via
// requireHomeroomAccessForStudent) — the MANUAL_ADJUST correction path,
// invariant 7's manual-override story for the point ledger. A blank note or
// a zero delta is rejected by manualAdjustPoints itself before anything is
// written.
export async function manualAdjustPointsAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const studentId = formData.get("studentId") as string;
  const delta = Number(formData.get("delta"));
  const note = formData.get("note") as string;

  await manualAdjustPoints(actor, { studentId, delta, note });
  backToClassroom(classroomId);
}
