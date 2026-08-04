"use client";

import { useEffect } from "react";
import Link from "next/link";

// Route-level error boundary — catches render/data errors on app pages
// without taking down the whole shell.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced to the observability provider (Sentry) once wired up (#14).
    console.error("App error boundary:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mb-6">
          <svg className="w-7 h-7 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h1>
        <p className="text-slate-500 mb-8">
          An unexpected error occurred. You can retry, or head back to your dashboard.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={reset} className="btn-primary py-2.5 px-5">
            Try again
          </button>
          <Link href="/dashboard" className="py-2.5 px-5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            Back to dashboard
          </Link>
        </div>
        {error.digest && (
          <p className="mt-6 text-[11px] text-slate-400 font-mono">Ref: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
