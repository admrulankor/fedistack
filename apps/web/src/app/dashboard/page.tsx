"use client";

import { Alert, Badge, Button, Card } from "@fedistack/ui";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  fetchCurrentSessionApi,
  logoutSessionApi,
  type SessionPayload
} from "@/lib/api-client";

export default function DashboardPage() {
  const router = useRouter();
  const [sessionData, setSessionData] = React.useState<SessionPayload | null>(
    null
  );
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    fetchCurrentSessionApi()
      .then((session) => {
        if (!active) return;
        if (!session) {
          router.replace("/login");
          return;
        }
        setSessionData(session);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Unable to load your active session."
        );
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router]);

  async function handleSignOut() {
    if (!sessionData) return;
    setIsSigningOut(true);
    setErrorMessage(null);
    try {
      await logoutSessionApi(sessionData.csrfToken);
      router.replace("/login");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to sign out."
      );
      setIsSigningOut(false);
    }
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <Card>
          <p className="text-sm text-slate-600">Loading your workspace...</p>
        </Card>
      </main>
    );
  }

  if (!sessionData) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        {errorMessage ? (
          <Alert variant="error" title="Session Error">
            {errorMessage}
          </Alert>
        ) : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Fedistack Workspace
          </h1>
          <p className="text-sm text-slate-600">
            Signed in as <span className="font-medium">{sessionData.user.email}</span>
          </p>
        </div>

        <Button
          variant="secondary"
          isLoading={isSigningOut}
          onClick={handleSignOut}
        >
          {isSigningOut ? "Signing out..." : "Sign out"}
        </Button>
      </header>

      {errorMessage ? (
        <Alert variant="error" title="Action failed">
          {errorMessage}
        </Alert>
      ) : null}

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            Account &amp; Role Scopes
          </h2>
          <Badge
            variant={
              sessionData.user.instanceRole === "instance_admin"
                ? "admin"
                : "default"
            }
          >
            {sessionData.user.instanceRole === "instance_admin"
              ? "Instance Administrator"
              : "Standard User"}
          </Badge>
        </div>

        <dl className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">User ID</dt>
            <dd className="font-mono text-xs text-slate-900">
              {sessionData.user.id}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Session Expires</dt>
            <dd className="text-slate-900">
              {new Date(sessionData.expiresAt).toUTCString()}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Organization Memberships</dt>
            <dd className="text-slate-900">
              {sessionData.scopes.organizations.length}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Publication Memberships</dt>
            <dd className="text-slate-900">
              {sessionData.scopes.publications.length}
            </dd>
          </div>
        </dl>
      </Card>
    </main>
  );
}
