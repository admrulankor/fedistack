"use client";

import { Alert, Badge, Card } from "@fedistack/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import {
  ApiClientError,
  fetchPublicPublicationApi,
  type PublicPublicationDetail
} from "@/lib/api-client";

export default function PublicPublicationPage() {
  const params = useParams<{ publicationSlug: string }>();
  const publicationSlug = params.publicationSlug;

  const [data, setData] = React.useState<PublicPublicationDetail | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    fetchPublicPublicationApi(publicationSlug)
      .then((res) => {
        if (!active) return;
        setData(res);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiClientError && err.status === 404) {
          setNotFound(true);
        } else {
          setErrorMessage(
            err instanceof Error ? err.message : "Failed to load publication."
          );
        }
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [publicationSlug]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Card>
          <p className="text-sm text-slate-600">Loading publication...</p>
        </Card>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-6 py-16">
        <Card className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">
            Publication not found
          </h1>
          <p className="text-sm text-slate-600">
            No publication exists at <code>/p/{publicationSlug}</code>.
          </p>
          <Link
            href="/"
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Back to Fedistack
          </Link>
        </Card>
      </main>
    );
  }

  if (errorMessage || !data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Alert variant="error" title="Error loading publication">
          {errorMessage ?? "An unexpected error occurred."}
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-3 border-b border-slate-200 pb-6">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <Link href="/" className="hover:underline">
            Fedistack
          </Link>
          <Link href="/dashboard" className="hover:underline">
            Publisher workspace
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {data.publication.name}
        </h1>
        {data.publication.description ? (
          <p className="text-base text-slate-600">
            {data.publication.description}
          </p>
        ) : null}
      </header>

      {data.articles.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No articles have been published yet.
          </p>
        </Card>
      ) : (
        <section className="space-y-4">
          {data.articles.map((article) => (
            <Card key={article.id} className="space-y-2 transition hover:border-slate-300">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {article.authorName}
                  {article.publishedAt
                    ? ` · ${new Date(article.publishedAt).toLocaleDateString()}`
                    : ""}
                </span>
                {article.visibility === "members_only" ? (
                  <Badge variant="admin">Members only</Badge>
                ) : null}
              </div>

              <h2 className="text-xl font-bold text-slate-900">
                <Link
                  href={`/p/${data.publication.slug}/${article.slug}`}
                  className="hover:underline"
                >
                  {article.title}
                </Link>
              </h2>

              {article.subtitle ? (
                <p className="text-sm font-medium text-slate-700">
                  {article.subtitle}
                </p>
              ) : null}

              {article.excerpt ? (
                <p className="text-sm text-slate-600">{article.excerpt}</p>
              ) : null}
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
