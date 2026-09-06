import "dotenv/config";
import { readFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { rolloverTerm } from "../lib/terms";

// Academic-year rollover — see lib/terms.ts's rolloverTerm for what this
// actually does. Run manually once a year (or whenever a school's term
// ends), not on any schedule. Takes a JSON config file path as its one
// argument, since the classroom-promotion mapping is inherently specific
// to one school's actual sections and can't be a hardcoded constant the
// way scripts/purge-old-photos.ts's RETENTION_DAYS is.
//
// Usage:
//   npx tsx scripts/rollover-term.ts rollover-config.json
//
// Config shape:
//   {
//     "schoolId": "...",
//     "endingTermId": "...",
//     "newTerm": { "name": "ปีการศึกษา 2570", "startDate": "2027-05-01", "endDate": "2028-03-31" },
//     "classroomPromotions": {
//       "<old ป.4/1 classroomId>": "<new ป.5/1 classroomId>",
//       "<old ป.6/1 classroomId>": null
//     },
//     "copyTimetable": false
//   }
//
// classroomPromotions maps every outgoing classroom to where its students
// go next; `null` means those students are leaving/graduating (enrollment
// just ends, no new one opens). The new classrooms must already exist —
// this script does not create classrooms (see CLAUDE.md/ARCHITECTURE.md:
// classroom creation is an out-of-band administrative task, same as terms).

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error("Usage: npx tsx scripts/rollover-term.ts <config.json>");
  }
  const config = JSON.parse(await readFile(configPath, "utf-8"));
  const result = await rolloverTerm(config);
  console.log(result);
}

main().finally(() => prisma.$disconnect());
