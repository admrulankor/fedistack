import { Card } from "@fedistack/ui";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <Card className="space-y-6 p-8">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Fedistack MVP 0.1
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Federated Publishing &amp; Newsletter Platform
          </h1>
          <p className="text-base text-slate-600">
            Publish independent journalism, cultivate reader memberships, and
            federate over the open social web without vendor lock-in.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            Sign in with Magic Link
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            Open Dashboard
          </Link>
        </div>
      </Card>
    </main>
  );
}
