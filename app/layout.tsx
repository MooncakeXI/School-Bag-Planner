import type { Metadata, Viewport } from "next";
import { Anuphan, Kanit } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

// All UI text is Thai — these are the actual --font-sans/--font-heading
// tokens, not fallbacks. Anuphan carries body text, Kanit carries headings
// and numerals, matching the School Bag Planner design reference.
const anuphan = Anuphan({
  variable: "--font-sans",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

const kanit = Kanit({
  variable: "--font-heading",
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "จัดกระเป๋าไปโรงเรียน",
  description: "แอปช่วยนักเรียนจัดกระเป๋าไปโรงเรียนให้ครบตามตารางเรียน",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale/userScalable lock — pinch-to-zoom must stay available
  // (WCAG 1.4.4 Resize Text; the ui-ux-pro-max skill's own "Disable zoom"
  // anti-pattern). This app's audience skews toward low-tech users and
  // includes parents who may need to zoom in on small Thai text.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F1E8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="th"
      className={cn("h-full antialiased", anuphan.variable, kanit.variable)}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
