import Link from "next/link";

/**
 * Shared page chrome (Phase 3.1) — rendered once from the root layout, so
 * every future page gets it for free. The "Compare" link was deliberately
 * held back until `compare/page.tsx` (Phase 7) actually existed — no point
 * linking to a 404 in the meantime.
 */
export function Nav() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          Coinbase Trading Bot
        </Link>
        <Link href="/compare" className="text-base text-muted hover:text-foreground">
          Compare
        </Link>
      </div>
    </header>
  );
}
