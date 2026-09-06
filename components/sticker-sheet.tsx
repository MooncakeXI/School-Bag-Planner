"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export type StickerLabel = { code: string; svg: string; studentName?: string | null; itemName?: string | null };

// A couple of common pre-cut A4 sticker sheet sizes. Add another entry here
// to match whatever the school actually buys — cols x rows is derived from
// the label size against A4 (210x297mm) minus the @page margin in globals.css.
const PRESETS = {
  "24up": { label: "24 ดวง/แผ่น (70×37 มม.)", cols: 3, width: 70, height: 37 },
  "12up": { label: "12 ดวง/แผ่น (105×48 มม.)", cols: 2, width: 105, height: 48 },
} as const;
type PresetKey = keyof typeof PRESETS;

/** Printable sheet for both spare (unassigned, code-only) and pre-bound
 * (student name + item name) QR stickers — one `StickerLabel` shape covers
 * both, falling back to the raw code when there's no name to show. Exact
 * millimetre sizing (@media print in globals.css handles @page + the
 * break-inside rule so a label is never split across a page). */
export function StickerSheet({ labels }: { labels: StickerLabel[] }) {
  const [presetKey, setPresetKey] = useState<PresetKey>("24up");
  const preset = PRESETS[presetKey];

  return (
    <>
      <div className="flex items-center gap-2 print:hidden">
        <select
          value={presetKey}
          onChange={(e) => setPresetKey(e.target.value as PresetKey)}
          className="h-11 rounded-xl border bg-background px-3 text-sm"
        >
          {Object.entries(PRESETS).map(([key, p]) => (
            <option key={key} value={key}>
              {p.label}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={() => window.print()}>
          <Printer />
          พิมพ์
        </Button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: `repeat(${preset.cols}, ${preset.width}mm)` }}>
        {labels.map((l) => (
          <div
            key={l.code}
            className="sticker-label flex flex-col items-center justify-center gap-1 overflow-hidden border p-1"
            style={{ width: `${preset.width}mm`, height: `${preset.height}mm` }}
          >
            {/* server-generated QR SVG, not user input */}
            <div dangerouslySetInnerHTML={{ __html: l.svg }} />
            {l.studentName ? (
              <div className="text-center leading-tight">
                <p className="text-[9px] font-medium">{l.studentName}</p>
                <p className="text-[8px] text-muted-foreground">{l.itemName}</p>
              </div>
            ) : (
              <p className="font-mono text-[9px]">{l.code}</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
