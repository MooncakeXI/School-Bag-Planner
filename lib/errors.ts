import type { Action, Resource } from "./policy";

function describe(resource: Resource): string {
  switch (resource.type) {
    case "classroom":
      return `classroom:${resource.classroomId}`;
    case "student":
      return `student:${resource.studentId}`;
    case "school":
      return `school:${resource.schoolId}`;
    case "catalog":
      return `catalog in school:${resource.schoolId}`;
    case "item_copy":
      return `item_copy in classroom:${resource.classroomId} subject:${resource.subjectId}`;
    case "homework":
      return `homework in classroom:${resource.classroomId} subject:${resource.subjectId}`;
  }
}

export class ForbiddenError extends Error {
  constructor(action: Action, resource: Resource) {
    super(`Forbidden: cannot ${action} on ${describe(resource)}`);
    this.name = "ForbiddenError";
  }
}

/** Thrown by lib/packing.ts when a scanned QR code cannot be used to record a check. */
export class InvalidScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScanError";
  }
}
