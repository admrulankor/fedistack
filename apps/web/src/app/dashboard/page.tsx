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
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  createOrganizationApi,
  createPublicationApi,
  fetchCurrentSessionApi,
  getOrganizationDetailApi,
  listOrganizationsApi,
  listPublicationsApi,
  logoutSessionApi,
  type OrganizationDetail,
  type OrganizationRole,
  type OrganizationSummary,
  type PublicationSummary,
  removeOrganizationMemberApi,
  type SessionPayload,
  updateOrganizationApi,
  upsertOrganizationMemberApi
} from "@/lib/api-client";

function suggestSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export default function DashboardPage() {
  const router = useRouter();
  const [sessionData, setSessionData] = React.useState<SessionPayload | null>(
    null
  );
  const [organizations, setOrganizations] = React.useState<
    OrganizationSummary[]
  >([]);
  const [publications, setPublications] = React.useState<PublicationSummary[]>(
    []
  );
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  // Create organization form
  const [orgName, setOrgName] = React.useState("");
  const [orgSlug, setOrgSlug] = React.useState("");
  const [orgSlugEdited, setOrgSlugEdited] = React.useState(false);
  const [isCreatingOrg, setIsCreatingOrg] = React.useState(false);

  // Create publication form
  const [pubOrgId, setPubOrgId] = React.useState("");
  const [pubName, setPubName] = React.useState("");
  const [pubSlug, setPubSlug] = React.useState("");
  const [pubSlugEdited, setPubSlugEdited] = React.useState(false);
  const [pubDescription, setPubDescription] = React.useState("");
  const [isCreatingPub, setIsCreatingPub] = React.useState(false);

  // Selected organization management drawer
  const [selectedOrgDetail, setSelectedOrgDetail] =
    React.useState<OrganizationDetail | null>(null);
  const [editOrgName, setEditOrgName] = React.useState("");
  const [editOrgSlug, setEditOrgSlug] = React.useState("");
  const [isSavingOrg, setIsSavingOrg] = React.useState(false);
  const [memberEmail, setMemberEmail] = React.useState("");
  const [memberRole, setMemberRole] =
    React.useState<OrganizationRole>("editor");
  const [isSavingMember, setIsSavingMember] = React.useState(false);

  const loadWorkspaceData = React.useCallback(async () => {
    const [orgs, pubs] = await Promise.all([
      listOrganizationsApi(),
      listPublicationsApi()
    ]);
    setOrganizations(orgs);
    setPublications(pubs);

    const adminOrg = orgs.find(
      (org) => org.role === "owner" || org.role === "admin"
    );
    if (adminOrg) {
      setPubOrgId((prev) =>
        orgs.some(
          (o) => o.id === prev && (o.role === "owner" || o.role === "admin")
        )
          ? prev
          : adminOrg.id
      );
    }
  }, []);

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
        await loadWorkspaceData();
        if (!active) return;
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Unable to load your active workspace."
        );
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router, loadWorkspaceData]);

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

  async function handleCreateOrganization(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!sessionData) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsCreatingOrg(true);

    try {
      const created = await createOrganizationApi(sessionData.csrfToken, {
        name: orgName,
        slug: orgSlug
      });
      setOrgName("");
      setOrgSlug("");
      setOrgSlugEdited(false);
      await loadWorkspaceData();
      setPubOrgId(created.id);
      setStatusMessage(`Created organization "${created.name}".`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create organization."
      );
    } finally {
      setIsCreatingOrg(false);
    }
  }

  async function handleCreatePublication(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!sessionData) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsCreatingPub(true);

    try {
      const created = await createPublicationApi(sessionData.csrfToken, {
        organizationId: pubOrgId,
        name: pubName,
        slug: pubSlug,
        description: pubDescription.trim() || null
      });
      setPubName("");
      setPubSlug("");
      setPubSlugEdited(false);
      setPubDescription("");
      await loadWorkspaceData();
      setStatusMessage(`Created publication "${created.name}".`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create publication."
      );
    } finally {
      setIsCreatingPub(false);
    }
  }

  async function handleOpenOrganization(organizationId: string) {
    setErrorMessage(null);
    try {
      const detail = await getOrganizationDetailApi(organizationId);
      setSelectedOrgDetail(detail);
      setEditOrgName(detail.organization.name);
      setEditOrgSlug(detail.organization.slug);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to load organization details."
      );
    }
  }

  async function handleUpdateOrganization(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!sessionData || !selectedOrgDetail) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSavingOrg(true);

    try {
      await updateOrganizationApi(
        sessionData.csrfToken,
        selectedOrgDetail.organization.id,
        {
          name: editOrgName,
          slug: editOrgSlug
        }
      );
      await Promise.all([
        loadWorkspaceData(),
        handleOpenOrganization(selectedOrgDetail.organization.id)
      ]);
      setStatusMessage("Updated organization settings.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to update organization."
      );
    } finally {
      setIsSavingOrg(false);
    }
  }

  async function handleUpsertOrgMember(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!sessionData || !selectedOrgDetail) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSavingMember(true);

    try {
      await upsertOrganizationMemberApi(
        sessionData.csrfToken,
        selectedOrgDetail.organization.id,
        {
          email: memberEmail,
          role: memberRole
        }
      );
      setMemberEmail("");
      await handleOpenOrganization(selectedOrgDetail.organization.id);
      setStatusMessage("Saved organization team member.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to save organization member."
      );
    } finally {
      setIsSavingMember(false);
    }
  }

  async function handleRemoveOrgMember(userId: string) {
    if (!sessionData || !selectedOrgDetail) return;
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await removeOrganizationMemberApi(
        sessionData.csrfToken,
        selectedOrgDetail.organization.id,
        userId
      );
      await handleOpenOrganization(selectedOrgDetail.organization.id);
      setStatusMessage("Removed organization member.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to remove organization member."
      );
    }
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Card>
          <p className="text-sm text-slate-600">Loading your workspace...</p>
        </Card>
      </main>
    );
  }

  if (!sessionData) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        {errorMessage ? (
          <Alert variant="error" title="Session Error">
            {errorMessage}
          </Alert>
        ) : null}
      </main>
    );
  }

  const adminOrganizations = organizations.filter(
    (org) => org.role === "owner" || org.role === "admin"
  );

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Fedistack Publishing Workspace
          </h1>
          <p className="text-sm text-slate-600">
            Signed in as{" "}
            <span className="font-medium text-slate-900">
              {sessionData.user.email}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
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
          <Button
            variant="secondary"
            isLoading={isSigningOut}
            onClick={handleSignOut}
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </Button>
        </div>
      </header>

      {errorMessage ? (
        <Alert variant="error" title="Action failed">
          {errorMessage}
        </Alert>
      ) : null}

      {statusMessage ? (
        <Alert variant="success" title="Success">
          {statusMessage}
        </Alert>
      ) : null}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Create Organization
            </h2>
            <p className="text-xs text-slate-500">
              Organizations isolate tenant teams and own one or more
              publications.
            </p>
          </div>
          <form onSubmit={handleCreateOrganization} className="space-y-3">
            <Input
              label="Organization name"
              name="orgName"
              required
              placeholder="Independent Press Collective"
              value={orgName}
              onChange={(e) => {
                const next = e.target.value;
                setOrgName(next);
                if (!orgSlugEdited) {
                  setOrgSlug(suggestSlug(next));
                }
              }}
            />
            <Input
              label="Organization slug"
              name="orgSlug"
              required
              placeholder="independent-press"
              value={orgSlug}
              onChange={(e) => {
                setOrgSlugEdited(true);
                setOrgSlug(e.target.value);
              }}
              helperText="Lowercase letters, numbers, and hyphens only."
            />
            <Button type="submit" isLoading={isCreatingOrg}>
              {isCreatingOrg ? "Creating..." : "Create organization"}
            </Button>
          </form>
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Create Publication
            </h2>
            <p className="text-xs text-slate-500">
              Launch a publication inside an organization you administer.
            </p>
          </div>

          {adminOrganizations.length === 0 ? (
            <Alert variant="info">
              Create or join an organization as an owner/admin first to launch a
              publication.
            </Alert>
          ) : (
            <form onSubmit={handleCreatePublication} className="space-y-3">
              <Select
                label="Organization"
                name="pubOrgId"
                value={pubOrgId}
                onChange={(e) => setPubOrgId(e.target.value)}
                options={adminOrganizations.map((org) => ({
                  value: org.id,
                  label: `${org.name} (${org.slug})`
                }))}
              />
              <Input
                label="Publication name"
                name="pubName"
                required
                placeholder="Morning Dispatch"
                value={pubName}
                onChange={(e) => {
                  const next = e.target.value;
                  setPubName(next);
                  if (!pubSlugEdited) {
                    setPubSlug(suggestSlug(next));
                  }
                }}
              />
              <Input
                label="Publication slug"
                name="pubSlug"
                required
                placeholder="morning-dispatch"
                value={pubSlug}
                onChange={(e) => {
                  setPubSlugEdited(true);
                  setPubSlug(e.target.value);
                }}
                helperText="Public URL path: /p/<slug>"
              />
              <Input
                label="Description"
                name="pubDescription"
                placeholder="Weekly analysis and open-web reporting."
                value={pubDescription}
                onChange={(e) => setPubDescription(e.target.value)}
              />
              <Button type="submit" isLoading={isCreatingPub}>
                {isCreatingPub ? "Creating..." : "Create publication"}
              </Button>
            </form>
          )}
        </Card>
      </section>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            Your Publications ({publications.length})
          </h2>
        </div>

        {publications.length === 0 ? (
          <p className="text-sm text-slate-500">
            You do not have any publications yet. Create one above to start
            writing.
          </p>
        ) : (
          <div className="divide-y divide-slate-200">
            {publications.map((pub) => (
              <div
                key={pub.id}
                className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {pub.name}
                    </span>
                    <Badge>{pub.effectiveRole}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    Organization: {pub.organizationName} &middot; Slug:{" "}
                    <code>/p/{pub.slug}</code>
                  </p>
                  {pub.description ? (
                    <p className="text-sm text-slate-600">{pub.description}</p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    href={`/p/${pub.slug}`}
                    className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Public site
                  </Link>
                  <Link
                    href={`/dashboard/publications/${pub.id}`}
                    className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Open workspace
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Your Organizations ({organizations.length})
        </h2>

        {organizations.length === 0 ? (
          <p className="text-sm text-slate-500">
            No organization memberships yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-200">
            {organizations.map((org) => (
              <div
                key={org.id}
                className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {org.name}
                    </span>
                    <Badge variant={org.role === "owner" ? "admin" : "default"}>
                      {org.role}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    Slug: <code>{org.slug}</code> &middot;{" "}
                    {org.publicationCount} publication(s)
                  </p>
                </div>

                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => handleOpenOrganization(org.id)}
                >
                  Manage organization
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {selectedOrgDetail ? (
        <Card className="space-y-6 border-slate-300">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Manage Organization: {selectedOrgDetail.organization.name}
              </h3>
              <p className="text-xs text-slate-500">
                Your role: {selectedOrgDetail.role}
              </p>
            </div>
            <Button
              variant="ghost"
              className="text-xs"
              onClick={() => setSelectedOrgDetail(null)}
            >
              Close
            </Button>
          </div>

          {selectedOrgDetail.role === "owner" ||
          selectedOrgDetail.role === "admin" ? (
            <form
              onSubmit={handleUpdateOrganization}
              className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end"
            >
              <Input
                label="Organization name"
                value={editOrgName}
                onChange={(e) => setEditOrgName(e.target.value)}
                required
              />
              <Input
                label="Slug"
                value={editOrgSlug}
                onChange={(e) => setEditOrgSlug(e.target.value)}
                required
              />
              <Button type="submit" isLoading={isSavingOrg}>
                Save organization
              </Button>
            </form>
          ) : null}

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900">
              Organization Members ({selectedOrgDetail.members.length})
            </h4>

            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {selectedOrgDetail.members.map((member) => (
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
                  {selectedOrgDetail.role === "owner" ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => handleRemoveOrgMember(member.userId)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>

            {selectedOrgDetail.role === "owner" ? (
              <form
                onSubmit={handleUpsertOrgMember}
                className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3 sm:items-end"
              >
                <Input
                  label="Member email"
                  type="email"
                  required
                  placeholder="colleague@example.com"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                />
                <Select
                  label="Role"
                  value={memberRole}
                  onChange={(e) =>
                    setMemberRole(e.target.value as OrganizationRole)
                  }
                  options={[
                    { value: "editor", label: "Editor" },
                    { value: "admin", label: "Admin" },
                    { value: "owner", label: "Owner" }
                  ]}
                />
                <Button type="submit" isLoading={isSavingMember}>
                  Add / Update member
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      ) : null}
    </main>
  );
}
