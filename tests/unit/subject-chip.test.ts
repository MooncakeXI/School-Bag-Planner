import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubjectChip } from "@/components/subject-chip";

describe("SubjectChip", () => {
  it("uses meaningful teacher icons while keeping the default text chip", () => {
    const mathGradeOne = renderToStaticMarkup(createElement(SubjectChip, { subjectName: "คณิตศาสตร์ ป.1", showIcon: true }));
    const mathGradeSix = renderToStaticMarkup(createElement(SubjectChip, { subjectName: "คณิตศาสตร์ ป.6", showIcon: true }));
    expect(mathGradeOne).toContain("lucide-calculator");
    expect(mathGradeSix.match(/style="([^"]+)"/)?.[1]).toBe(mathGradeOne.match(/style="([^"]+)"/)?.[1]);
    expect(renderToStaticMarkup(createElement(SubjectChip, { subjectName: "วิทยาศาสตร์", showIcon: true }))).toContain(
      "lucide-flask-conical",
    );
    expect(renderToStaticMarkup(createElement(SubjectChip, { subjectName: "คณิตศาสตร์" }))).toContain("คณ");
  });
});
