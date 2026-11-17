"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Select
} from "@fedistack/ui";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import {
  type ArticleStatus,
  type ArticleVisibility,
  createEditorialArticleApi,
  deleteEditorialArticleApi,
  type EditorialArticleSummary,
  fetchCurrentSessionApi,
  getPublicationDetailApi,
  listEditorialArticlesApi,
  type PublicationDetail,
  type PublicationRole,
  publishEditorialArticleApi,
  removePublicationMemberApi,
  type SessionPayload,
  unpublishEditorialArticleApi,
  updatePublicationApi,
  upsertPublicationMemberApi
} from "@/lib/api-client";

export default function PublicationWorkspacePage() {
  const router = useRouter();
  const params = useParams<{ publicationId: string }>();
  const publicationId = params.publicationId;

  const [sessionData, setSessionData] = React.useState<SessionPayload | null>(
    null
  );
  const [detail, setDetail] = React.useState<PublicationDetail | null>(null);
  const [articles, setArticles] = React.useState<EditorialArticleSummary[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<"all" | ArticleStatus>(
    "all"
  );
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  // Create article form
  const [newTitle, setNewTitle] = React.useState("");
  const [newSlug, setNewSlug] = React.useState("");
  const [newVisibility, setNewVisibility] =
    React.useState<ArticleVisibility>("public");
  const [isCreatingArticle, setIsCreatingArticle] = React.useState(false);

  // Publication settings form
  const [pubName, setPubName] = React.useState("");
  const [pubSlug, setPubSlug] = React.useState("");
  const [pubDescription, setPubDescription] = React.useState("");
  const [isSavingPub, setIsSavingPub] = React.useState(false);

  // Publication team member form
  const [memberEmail, setMemberEmail] = React.useState("");
  const [memberRole, setMemberRole] =
    React.useState<PublicationRole>("author");
  const [isSavingMember, setIsSavingMember] = React.useState(false);

  const loadPublicationData = React.useCallback(
    async (filter: "all" | ArticleStatus) => {
      const [pubDetail, articleRows] = await Promise.all([
        getPublicationDetailApi(publicationId),
        listEditorialArticlesApi(
          publicationId,
          filter === "all" ? undefined : filter
        )
      ]);
      setDetail(pubDetail);
      setPubName(pubDetail.publication.name);
      setPubSlug(pubDetail.publication.slug);
      setPubDescription(pubDetail.publication.description ?? "");
      setArticles(articleRows);
    },
    [publicationId]
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
        await loadPublicationData(statusFilter);
        if (!active) return;
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Failed to load publication workspace."
        );
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router, loadPublicationData, statusFilter]);

  async function handleCreateArticle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionData) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsCreatingArticle(true);

    try {
      const created = await createEditorialArticleApi(
        sessionData.csrfToken,
        publicationId,
        {
          title: newTitle,
          ...(newSlug.trim() ? { slug: newSlug.trim() } : {}),
          visibility: newVisibility
        }
      );
      router.push(
        `/dashboard/publications/${publicationId}/articles/${created.id}`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create article."
      );
      setIsCreatingArticle(false);
    }
  }

  async function handlePublish(articleId: string) {
    if (!sessionData) return;
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await publishEditorialArticleApi(
        sessionData.csrfToken,
        publicationId,
        articleId
      );
      await loadPublicationData(statusFilter);
      setStatusMessage("Article published.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to publish article."
      );
    }
  }

  async function handleUnpublish(articleId: string) {
    if (!sessionData) return;
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await unpublishEditorialArticleApi(
        sessionData.csrfToken,
        publicationId,
        articleId
      );
      await loadPublicationData(statusFilter);
      setStatusMessage("Article unpublished.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to unpublish article."
      );
    }
  }

  async function handleDeleteArticle(articleId: string) {
    if (!sessionData) return;
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await deleteEditorialArticleApi(
        sessionData.csrfToken,
        publicationId,
        articleId
      );
      await loadPublicationData(statusFilter);
      setStatusMessage("Article deleted.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to delete article."
      );
    }
  }

  async function handleSavePublication(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!sessionData) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSavingPub(true);

    try {
      await updatePublicationApi(sessionData.csrfToken, publicationId, {
        name: pubName,
        slug: pubSlug,
        description: pubDescription.trim() || null
      });
      await loadPublicationData(statusFilter);
      setStatusMessage("Updated publication settings.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to update publication."
      );
    } finally {
      setIsSavingPub(false);
    }
  }

  async function handleUpsertMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionData) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSavingMember(true);

    try {
      await upsertPublicationMemberApi(
        sessionData.csrfToken,
        publicationId,
        {
          email: memberEmail,
          role: memberRole
        }
      );
      setMemberEmail("");
      await loadPublicationData(statusFilter);
      setStatusMessage("Saved publication team member.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to save publication member."
      );
    } finally {
      setIsSavingMember(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!sessionData) return;
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await removePublicationMemberApi(
        sessionData.csrfToken,
        publicationId,
        userId
      );
      await loadPublicationData(statusFilter);
      setStatusMessage("Removed publication team member.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to remove publication member."
      );
    }
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Card>
          <p className="text-sm text-slate-600">
            Loading publication workspace...
          </p>
        </Card>
      </main>
    );
  }

  if (!sessionData || !detail) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12 space-y-4">
        <Alert variant="error" title="Unable to open publication">
          {errorMessage ?? "Publication workspace could not be loaded."}
        </Alert>
        <Link
          href="/dashboard"
          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Back to dashboard
        </Link>
      </main>
    );
  }

  const canAdminister = detail.effectiveRole === "admin";
  const canPublish =
    detail.effectiveRole === "admin" || detail.effectiveRole === "editor";

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <span>/</span>
            <span>{detail.organization.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {detail.publication.name}
            </h1>
            <Badge>{detail.effectiveRole}</Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/p/${detail.publication.slug}`}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            View public publication
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-200"
          >
            All publications
          </Link>
        </div>
      </header>

      {errorMessage ? (
        <Alert variant="error" title="Action failed">
          {errorMessage}
        </Alert>
      ) : null}

      {statusMessage ? (
        <Alert variant="success" title="Updated">
          {statusMessage}
        </Alert>
      ) : null}

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">New Article</h2>
        <form
          onSubmit={handleCreateArticle}
          className="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end"
        >
          <Input
            label="Title"
            name="articleTitle"
            required
            placeholder="Why Open Web Publishing Matters"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <Input
            label="Slug (optional)"
            name="articleSlug"
            placeholder="auto-generated-from-title"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
          />
          <Select
            label="Visibility"
            name="articleVisibility"
            value={newVisibility}
            onChange={(e) =>
              setNewVisibility(e.target.value as ArticleVisibility)
            }
            options={[
              { value: "public", label: "Public" },
              { value: "members_only", label: "Members only" }
            ]}
          />
          <Button type="submit" isLoading={isCreatingArticle}>
            {isCreatingArticle ? "Creating..." : "Create draft"}
          </Button>
        </form>
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Articles ({articles.length})
          </h2>

          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "draft", "published", "unpublished"] as const).map(
              (filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStatusFilter(filter)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    statusFilter === filter
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {filter}
                </button>
              )
            )}
          </div>
        </div>

        {articles.length === 0 ? (
          <p className="text-sm text-slate-500">
            No articles match this filter yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-200">
            {articles.map((article) => {
              const canDelete =
                canPublish ||
                (article.authorUserId === sessionData.user.id &&
                  article.status === "draft");

              return (
                <div
                  key={article.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/dashboard/publications/${publicationId}/articles/${article.id}`}
                        className="font-semibold text-slate-900 hover:underline"
                      >
                        {article.title}
                      </Link>
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
                      <Badge
                        variant={
                          article.visibility === "members_only"
                            ? "admin"
                            : "default"
                        }
                      >
                        {article.visibility === "members_only"
                          ? "members only"
                          : "public"}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      <code>/p/{detail.publication.slug}/{article.slug}</code>{" "}
                      &middot; Author: {article.authorEmail} &middot; Updated{" "}
                      {new Date(article.updatedAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/publications/${publicationId}/articles/${article.id}`}
                      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      Edit
                    </Link>

                    {article.status === "published" ? (
                      <Link
                        href={`/p/${detail.publication.slug}/${article.slug}`}
                        className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        View
                      </Link>
                    ) : null}

                    {canPublish && article.status !== "published" ? (
                      <Button
                        variant="primary"
                        className="px-2.5 py-1 text-xs"
                        onClick={() => handlePublish(article.id)}
                      >
                        Publish
                      </Button>
                    ) : null}

                    {canPublish && article.status === "published" ? (
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1 text-xs"
                        onClick={() => handleUnpublish(article.id)}
                      >
                        Unpublish
                      </Button>
                    ) : null}

                    {canDelete ? (
                      <Button
                        variant="ghost"
                        className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                        onClick={() => handleDeleteArticle(article.id)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {canAdminister ? (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Publication Settings
            </h2>
            <form onSubmit={handleSavePublication} className="space-y-3">
              <Input
                label="Publication name"
                value={pubName}
                onChange={(e) => setPubName(e.target.value)}
                required
              />
              <Input
                label="Slug"
                value={pubSlug}
                onChange={(e) => setPubSlug(e.target.value)}
                required
              />
              <Input
                label="Description"
                value={pubDescription}
                onChange={(e) => setPubDescription(e.target.value)}
              />
              <Button type="submit" isLoading={isSavingPub}>
                {isSavingPub ? "Saving..." : "Save settings"}
              </Button>
            </form>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Publication Team ({detail.members.length})
            </h2>

            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {detail.members.length === 0 ? (
                <p className="p-3 text-xs text-slate-500">
                  No direct publication members yet (organization owners/admins
                  inherit admin access).
                </p>
              ) : (
                detail.members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium text-slate-900">
                        {member.email}
                      </span>{" "}
                      <Badge>{member.role}</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => handleRemoveMember(member.userId)}
                    >
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleUpsertMember} className="space-y-3 pt-2">
              <Input
                label="Team member email"
                type="email"
                required
                placeholder="writer@example.com"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
              />
              <Select
                label="Role"
                value={memberRole}
                onChange={(e) =>
                  setMemberRole(e.target.value as PublicationRole)
                }
                options={[
                  { value: "author", label: "Author" },
                  { value: "editor", label: "Editor" },
                  { value: "admin", label: "Admin" }
                ]}
              />
              <Button type="submit" isLoading={isSavingMember}>
                {isSavingMember ? "Saving..." : "Add / Update member"}
              </Button>
            </form>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
