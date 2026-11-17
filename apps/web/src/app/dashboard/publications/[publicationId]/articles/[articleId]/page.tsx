"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Select,
  Textarea
} from "@fedistack/ui";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { ArticleEditor } from "@/components/article-editor";
import {
  type ArticleVisibility,
  deleteEditorialArticleApi,
  type EditorialArticleDetail,
  fetchCurrentSessionApi,
  getEditorialArticleApi,
  getPublicationDetailApi,
  type PublicationDetail,
  publishEditorialArticleApi,
  type SessionPayload,
  unpublishEditorialArticleApi,
  updateEditorialArticleApi
} from "@/lib/api-client";
import type { ArticleDocument } from "@/lib/article-document";

export default function EditorialArticlePage() {
  const router = useRouter();
  const params = useParams<{ publicationId: string; articleId: string }>();
  const publicationId = params.publicationId;
  const articleId = params.articleId;

  const [sessionData, setSessionData] = React.useState<SessionPayload | null>(
    null
  );
  const [pubDetail, setPubDetail] = React.useState<PublicationDetail | null>(
    null
  );
  const [article, setArticle] = React.useState<EditorialArticleDetail | null>(
    null
  );
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  const [title, setTitle] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [subtitle, setSubtitle] = React.useState("");
  const [excerpt, setExcerpt] = React.useState("");
  const [visibility, setVisibility] =
    React.useState<ArticleVisibility>("public");
  const [body, setBody] = React.useState<ArticleDocument>({
    type: "doc",
    content: []
  });

  const [isSaving, setIsSaving] = React.useState(false);
  const [isTransitioning, setIsTransitioning] = React.useState(false);

  const applyArticleState = React.useCallback(
    (loaded: EditorialArticleDetail) => {
      setArticle(loaded);
      setTitle(loaded.title);
      setSlug(loaded.slug);
      setSubtitle(loaded.subtitle ?? "");
      setExcerpt(loaded.excerpt ?? "");
      setVisibility(loaded.visibility);
      setBody(loaded.body);
    },
    []
  );

  React.useEffect(() => {
    let active = true;
    fetchCurrentSessionApi()
      .then(async (session) => {
        if (!active) return;
        if (!session) {
          router.replace("/login");
          return;
        }
        setSessionData(session);
        const [publication, editorialArticle] = await Promise.all([
          getPublicationDetailApi(publicationId),
          getEditorialArticleApi(publicationId, articleId)
        ]);
        if (!active) return;
        setPubDetail(publication);
        applyArticleState(editorialArticle);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load article editor."
        );
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router, publicationId, articleId, applyArticleState]);

  async function saveChanges(): Promise<EditorialArticleDetail | null> {
    if (!sessionData) return null;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSaving(true);
    try {
      const updated = await updateEditorialArticleApi(
        sessionData.csrfToken,
        publicationId,
        articleId,
        {
          title,
          slug,
          subtitle: subtitle.trim() || null,
          excerpt: excerpt.trim() || null,
          visibility,
          body
        }
      );
      applyArticleState(updated);
      setStatusMessage("Article saved.");
      return updated;
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to save article."
      );
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveChanges();
  }

  async function handlePublish() {
    if (!sessionData) return;
    setIsTransitioning(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const saved = await updateEditorialArticleApi(
        sessionData.csrfToken,
        publicationId,
        articleId,
        {
          title,
          slug,
          subtitle: subtitle.trim() || null,
          excerpt: excerpt.trim() || null,
          visibility,
          body
        }
      );
      applyArticleState(saved);
      const published = await publishEditorialArticleApi(
        sessionData.csrfToken,
        publicationId,
        articleId
      );
      applyArticleState(published);
      setStatusMessage("Article saved and published.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to publish article."
      );
    } finally {
      setIsTransitioning(false);
    }
  }

  async function handleUnpublish() {
    if (!sessionData) return;
    setIsTransitioning(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const unpublished = await unpublishEditorialArticleApi(
        sessionData.csrfToken,
        publicationId,
        articleId
      );
      applyArticleState(unpublished);
      setStatusMessage("Article unpublished.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to unpublish article."
      );
    } finally {
      setIsTransitioning(false);
    }
  }

  async function handleDelete() {
    if (!sessionData) return;
    setIsTransitioning(true);
    setErrorMessage(null);
    try {
      await deleteEditorialArticleApi(
        sessionData.csrfToken,
        publicationId,
        articleId
      );
      router.push(`/dashboard/publications/${publicationId}`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to delete article."
      );
      setIsTransitioning(false);
    }
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Card>
          <p className="text-sm text-slate-600">Loading article editor...</p>
        </Card>
      </main>
    );
  }

  if (!sessionData || !pubDetail || !article) {
    return (
      <main className="mx-auto max-w-5xl space-y-4 px-6 py-12">
        <Alert variant="error" title="Unable to load article">
          {errorMessage ?? "The requested article could not be loaded."}
        </Alert>
        <Link
          href={`/dashboard/publications/${publicationId}`}
          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Back to publication
        </Link>
      </main>
    );
  }

  const canPublish =
    pubDetail.effectiveRole === "admin" || pubDetail.effectiveRole === "editor";
  const canEdit =
    canPublish || article.authorUserId === sessionData.user.id;
  const canDelete =
    canPublish ||
    (article.authorUserId === sessionData.user.id &&
      article.status === "draft");

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <span>/</span>
            <Link
              href={`/dashboard/publications/${publicationId}`}
              className="hover:underline"
            >
              {pubDetail.publication.name}
            </Link>
            <span>/</span>
            <span>Editor</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {article.title}
            </h1>
            <Badge
              variant={
                article.status === "published"
                  ? "success"
                  : article.status === "unpublished"
                    ? "warning"
                    : "default"
              }
            >
              {article.status}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {article.status === "published" ? (
            <Link
              href={`/p/${pubDetail.publication.slug}/${article.slug}`}
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              View public post
            </Link>
          ) : null}
          {canPublish && article.status !== "published" ? (
            <Button
              variant="primary"
              isLoading={isTransitioning}
              onClick={handlePublish}
            >
              Publish
            </Button>
          ) : null}
          {canPublish && article.status === "published" ? (
            <Button
              variant="secondary"
              isLoading={isTransitioning}
              onClick={handleUnpublish}
            >
              Unpublish
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              variant="danger"
              isLoading={isTransitioning}
              onClick={handleDelete}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </header>

      {!canEdit ? (
        <Alert variant="info">
          You have read-only access because this article belongs to another
          author.
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="error" title="Action failed">
          {errorMessage}
        </Alert>
      ) : null}

      {statusMessage ? (
        <Alert variant="success" title="Saved">
          {statusMessage}
        </Alert>
      ) : null}

      <form onSubmit={handleSaveSubmit} className="space-y-6">
        <Card className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Title"
              name="title"
              required
              disabled={!canEdit}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              label="Slug"
              name="slug"
              required
              disabled={!canEdit}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              helperText={`URL: /p/${pubDetail.publication.slug}/${slug || "..."}`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Subtitle"
              name="subtitle"
              disabled={!canEdit}
              placeholder="Optional deck or subheadline"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />
            <Select
              label="Visibility"
              name="visibility"
              disabled={!canEdit}
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as ArticleVisibility)
              }
              options={[
                { value: "public", label: "Public" },
                { value: "members_only", label: "Members only" }
              ]}
            />
          </div>

          <Textarea
            label="Excerpt"
            name="excerpt"
            rows={2}
            disabled={!canEdit}
            placeholder="Short summary shown on the publication homepage."
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </Card>

        <ArticleEditor
          value={body}
          onChange={setBody}
          disabled={!canEdit}
        />

        {canEdit ? (
          <div className="flex items-center justify-end gap-3">
            <Button type="submit" isLoading={isSaving}>
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        ) : null}
      </form>
    </main>
  );
}
