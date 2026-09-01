"use client";

export function SubjectSelect({
  defaultValue,
  subjects,
}: {
  defaultValue: string;
  subjects: { id: string; name: string }[];
}) {
  return (
    <select
      name="subjectId"
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
    >
      <option value="">—</option>
      {subjects.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
