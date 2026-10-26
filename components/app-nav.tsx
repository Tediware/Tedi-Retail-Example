import Link from "next/link";

/** Top navigation. Two destinations: the orders inbox and the activity log. */
export function AppNav() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Tedi Consumer
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/" className="transition-colors hover:text-foreground">
            Orders
          </Link>
          <Link
            href="/activity"
            className="transition-colors hover:text-foreground"
          >
            Activity
          </Link>
        </nav>
      </div>
    </header>
  );
}
