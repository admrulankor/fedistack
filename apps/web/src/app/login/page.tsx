"use client";

import { Alert, Button, Card, Input } from "@fedistack/ui";
import * as React from "react";
import { requestMagicLinkApi } from "@/lib/api-client";

export default function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage("Please enter your email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await requestMagicLinkApi(trimmedEmail);
      setSuccessMessage(response.message);
      setEmail("");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Unable to send magic link. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Card className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Sign in to Fedistack
          </h1>
          <p className="text-sm text-slate-600">
            Enter your email address to receive a single-use passwordless sign-in
            link.
          </p>
        </div>

        {successMessage ? (
          <Alert variant="success" title="Check your email">
            {successMessage}
          </Alert>
        ) : null}

        {errorMessage ? (
          <Alert variant="error" title="Sign-in request failed">
            {errorMessage}
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input
            label="Email address"
            type="email"
            name="email"
            autoComplete="email"
            required
            placeholder="you@publication.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            helperText="We will send a short-lived magic link to verify your account."
          />

          <Button
            type="submit"
            isLoading={isSubmitting}
            className="w-full"
          >
            {isSubmitting ? "Sending link..." : "Send magic link"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
