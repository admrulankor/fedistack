"use client";

import { Alert, Card } from "@fedistack/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { verifyMagicLinkApi } from "@/lib/api-client";

function VerifyMagicLinkContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = React.useState<"verifying" | "success" | "error">(
    "verifying"
  );
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const attemptedRef = React.useRef(false);

  React.useEffect(() => {
    if (attemptedRef.current) {
      return;
    }
    attemptedRef.current = true;

    if (!token) {
      setStatus("error");
      setErrorMessage("Missing magic link verification token.");
      return;
    }

    verifyMagicLinkApi(token)
      .then(() => {
        setStatus("success");
        router.replace("/dashboard");
      })
      .catch((err: unknown) => {
        setStatus("error");
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "The sign-in link is invalid or has expired."
        );
      });
  }, [token, router]);

  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">
        Verifying your sign-in link
      </h1>

      {status === "verifying" ? (
        <Alert variant="info">
          Validating your single-use authentication token...
        </Alert>
      ) : null}

      {status === "success" ? (
        <Alert variant="success" title="Signed in">
          Redirecting you to your Fedistack dashboard...
        </Alert>
      ) : null}

      {status === "error" ? (
        <div className="space-y-4">
          <Alert variant="error" title="Verification failed">
            {errorMessage ?? "Unable to verify sign-in link."}
          </Alert>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Request a new sign-in link
          </Link>
        </div>
      ) : null}
    </Card>
  );
}

export default function VerifyMagicLinkPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <React.Suspense
        fallback={
          <Card>
            <p className="text-sm text-slate-600">Loading verification...</p>
          </Card>
        }
      >
        <VerifyMagicLinkContent />
      </React.Suspense>
    </main>
  );
}
