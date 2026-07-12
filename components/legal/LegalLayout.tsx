import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";

// Shared chrome + typography for the Privacy Policy and Terms pages. Keeps both
// documents visually consistent without pulling in the Tailwind typography plugin.
export default function LegalLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700 mb-8"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{title}</h1>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mt-2">
        Last updated: {LEGAL_LAST_UPDATED}
      </p>
      <p className="text-sm text-slate-600 leading-relaxed mt-6">{intro}</p>

      <div className="mt-10 space-y-10">{children}</div>
    </div>
  );
}

// One numbered/titled section of a legal document.
export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-slate-900 mb-3">{heading}</h2>
      <div className="space-y-3 text-sm text-slate-600 leading-relaxed [&_a]:text-blue-600 [&_a]:font-medium [&_a:hover]:underline [&_strong]:text-slate-800 [&_strong]:font-semibold">
        {children}
      </div>
    </section>
  );
}

// Consistently styled bullet list for legal copy.
export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1.5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
