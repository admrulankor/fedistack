"use client";

import { Alert, Badge, Card } from "@fedistack/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import {
  ApiClientError,
  fetchPublicArticleApi,
  type PublicArticleDetail
} from "@/lib/api-client";

export default function PublicArticlePage() {
  const params = useParams<{ publicationSlug: string; articleSlug: string }>();
  const publicationSlug = params.publicationSlug;
  const articleSlug = params.articleSlug;

  const [data, setData] = React.useState<PublicArticleDetail | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    fetchPublicArticleApi(publicationSlug, articleSlug)
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
            err instanceof Error ? err.message : "Failed to load article."
          );
        }
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [publicationSlug, articleSlug]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Card>
          <p className="text-sm text-slate-600">Loading article...</p>
        </Card>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-6 py-16">
        <Card className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">
            Article not found
          </h1>
          <p className="text-sm text-slate-600">
            This post may have been unpublished or does not exist.
          </p>
          <Link
            href={`/p/${publicationSlug}`}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Back to publication
          </Link>
        </Card>
      </main>
    );
  }

  if (errorMessage || !data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Alert variant="error" title="Error loading article">
          {errorMessage ?? "An unexpected error occurred."}
        </Alert>
      </main>
    );
  }

  const { publication, article } = data;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <nav className="flex items-center justify-between text-sm text-slate-600">
        <Link
          href={`/p/${publication.slug}`}
          className="font-semibold text-slate-900 hover:underline"
        >
          &larr; {publication.name}
        </Link>
        <Link href="/login" className="text-xs hover:underline">
          Member sign in
        </Link>
      </nav>

      <article className="space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <header className="space-y-3 border-b border-slate-100 pb-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{article.authorName}</span>
            {article.publishedAt ? (
              <>
                <span>&middot;</span>
                <time dateTime={article.publishedAt}>
                  {new Date(article.publishedAt).toLocaleDateString()}
                </time>
              </>
            ) : null}
            {article.visibility === "members_only" ? (
              <Badge variant="admin">Members only</Badge>
            ) : null}
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {article.title}
          </h1>

          {article.subtitle ? (
            <p className="text-lg text-slate-600">{article.subtitle}</p>
          ) : null}
        </header>

        {article.html ? (
          <div
            className="fedistack-article-content"
            dangerouslySetInnerHTML={{ __html: article.html }}
          />
        ) : null}

        {article.isPaywalled ? (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-base font-semibold text-amber-950">
              This post is for members of {publication.name}
            </h2>
            <p className="text-sm text-amber-900">
              Sign in with your member email to read the full article once
              membership access is active.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/login"
                className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Sign in with Magic Link
              </Link>
              <Link
                href={`/p/${publication.slug}`}
                className="inline-flex items-center rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100"
              >
                Browse public posts
              </Link>
            </div>
          </div>
        ) : null}
      </article>
    </main>
  );
}
