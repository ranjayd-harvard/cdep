# User / Organization / Tenant Model

This documents how identity, organizations, and tenants actually work in the
code today. It's a reference for the current implementation, not a design
proposal — see `src/lib/tenant.ts`, `src/auth.ts`,
`src/app/(auth)/onboarding/`, and `src/app/(portal)/settings/` for the
source of truth if this drifts.

## The core entities

```text
PortalUser  --belongs to-->  Organization  --has one or more-->  Tenant
                                  ^                                  ^
                                  |                                  |
                        membership/admin unit              data-scoping unit
```

| Entity | Model | Mongo collection | What it's for |
|---|---|---|---|
| `PortalUser` | `src/models/user.ts` | `users` | An account. Belongs to at most one `Organization`, and is assigned to exactly one `Tenant` within it. |
| `Organization` | `src/models/organization.ts` | `organizations` | The membership/admin boundary — who can request to join, who can approve, who can create tenants. Roughly "the company." |
| `Tenant` | `src/models/tenant.ts` | `tenants` | The actual **data-scoping unit**. Every `Organization` has exactly one `isDefault: true` tenant, created automatically; a `CUSTOMER_ADMIN` can create additional (non-default) tenants. |
| `OrganizationMembershipRequest` | `src/models/organization-membership-request.ts` | `organizationMembershipRequests` | A **user-initiated** pending/approved/rejected request to join an existing organization (see §3). |
| `OrganizationInvitation` | `src/models/organization-invitation.ts` | `organizationInvitations` | An **admin-initiated** pending/accepted/declined/revoked invitation for a specific email to join, at a role (and tenant) the admin already chose (see §3a). |

Important distinction: **Organization is not the isolation boundary — Tenant
is.** `TenantScopedCollection` (`src/lib/tenant-scoped-collection.ts`) and
every tenant-owned document (`Entitlement`, `Exchange`, etc.) key off
`tenantId`, never `organizationId`. An organization with two tenants has two
independent data-scoping buckets under one admin/membership umbrella.

## Field shapes

```ts
// src/models/user.ts
interface PortalUser {
  id: string;
  name: string;
  email: string;
  organizationId: string | null; // null until onboarding resolves
  tenantId: string | null;       // null until onboarding resolves
  role: UserRole | null;         // null until onboarding resolves
}

// src/models/organization.ts
interface Organization {
  id: string;            // "org-<slug>-<hex6>"
  name: string;           // slug
  displayName: string;
  status: "active" | "inactive";
}

// src/models/tenant.ts
interface Tenant {
  id: string;              // "tenant-<slug>-<hex6>"
  organizationId: string;
  name: string;
  displayName: string;
  isDefault: boolean;
  status: "active" | "inactive";
}

// src/models/organization-membership-request.ts
interface OrganizationMembershipRequest {
  id: string;               // "mreq-<hex8>"
  organizationId: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null; // userId of the approving/rejecting admin
}

// src/models/organization-invitation.ts
interface OrganizationInvitation {
  id: string;               // "invite-<hex8>"
  organizationId: string;
  tenantId: string;         // which tenant the invitee lands on if accepted
  email: string;            // normalized lowercase
  role: UserRole;           // the admin picks this at invite time
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED";
  invitedBy: string;        // userId of the inviting admin
  invitedAt: Date;
  resolvedAt: Date | null;
}
```

`UserRole` (`src/models/user.ts`) is unchanged from before this model
existed: `CUSTOMER_ADMIN`, `CUSTOMER_USER`, `CUSTOMER_READONLY` — the naming
predates the Organization/Tenant split and was intentionally left alone to
limit blast radius. Read it as "org admin / org user / org read-only."

A fourth role, `SUPERUSER`, sits above the Organization/Tenant model
entirely — see §7 below.

`PortalUser` also carries a `status: "active" | "suspended"` field. A
suspended account is rejected at sign-in (both the Credentials and Google
paths in `src/auth.ts`) but keeps its existing organization/tenant/role —
it's a hold, not a deletion. Managed from the Admin Console
(`/admin/users`, and per-org from `/admin/organizations/[organizationId]`).

## Account lifecycle

### 1. Account creation (org-less)

Both entry points create a `PortalUser` with `organizationId`, `tenantId`,
and `role` all `null`:

- **Signup** (`src/app/(auth)/signup/actions.ts`) — email + password, then
  requires email verification before login.
- **First-time Google sign-in** (`signIn` callback in `src/auth.ts`) —
  same org-less creation, but auto-verified (Google already confirmed the
  email), so no `/check-email` step.

Neither path collects a company/organization name anymore — that decision is
deferred to onboarding.

### 2. The onboarding gate

`requireTenantContext()` (`src/lib/tenant.ts`) is the single choke point
every `(portal)` page calls. After the existing "must be logged in" check, it
adds: **if `organizationId` or `tenantId` is missing, redirect to
`/onboarding`.** Past that guard, both fields are non-null for every
downstream consumer — no `| null` handling leaks into portal pages.

`src/app/(auth)/onboarding/page.tsx` renders two choices:

- **"I belong to an existing organization"** — search by name
  (`searchOrganizationsByName`, case-insensitive regex on `name`/
  `displayName`, capped to ~10 results), then **request to join**.
- **"Create a new organization"** — creates the `Organization`, its default
  `Tenant`, and immediately assigns the caller as `CUSTOMER_ADMIN` of both.

This choice screen is what a user without any pending invitation sees. If
an admin already invited their exact email, they see that instead — see
§3a.

### 3. Joining an existing organization (admin-approved)

```text
User picks an org
     │
     ▼
createMembershipRequest()          status: PENDING
     │                             (one PENDING request per user, enforced
     │                              by DuplicateMembershipRequestError)
     ▼
/onboarding/pending  ──── waits ────►  org admin sees it in Settings
                                              │
                                    Approve ──┴── Reject
                                       │              │
                                       ▼              ▼
                          assignPortalUserToOrganization   status: REJECTED
                          (org's default tenant,             │
                           role: CUSTOMER_USER)               ▼
                                       │                requester can
                                       ▼                immediately retry
                          status: APPROVED               (no cooldown)
```

Approval always assigns the org's **default** tenant and the
`CUSTOMER_USER` role — an admin can change the role afterward from Settings,
but there's no role-picker at approval time. A user can have at most one
`PENDING` request at a time; they can't request a second org until the first
is resolved (approved or rejected).

Membership-request logic lives in
`src/lib/organization-membership-directory.ts`; the admin-facing actions are
in `src/app/(portal)/settings/membership-actions.ts`, gated by
`canManageSettings(role)` (`src/lib/authorization.ts` — `CUSTOMER_ADMIN`
only).

### 3a. Being invited (admin-initiated)

The mirror image of §3: instead of a user finding an org and waiting on
approval, an admin picks a specific email, a role, and (if the org has more
than one tenant) a tenant, from Settings' **Invitations** card
(`src/app/(portal)/settings/invitation-actions.ts` → `inviteMember`). There's
no approval step on the invitee's side beyond accepting — the invite itself
already is the approval.

```text
Admin: email + role (+ tenant)
     │
     ▼
createInvitation()                 status: PENDING
     │                             (one PENDING invitation per email,
     │                              across the whole system — enforced by
     │                              DuplicateInvitationError; revoke and
     │                              re-invite to change role/tenant)
     ▼
createAuthToken(email, "org-invite", 7d)  ──►  emailed link: /invite?token=...
     │
     ▼
Invitee opens the link (single-use, consumed on view — see /invite/page.tsx)
     │
     ├─ no account for that email  →  "Create your account" (prefills /signup?email=...)
     ├─ account exists             →  "Sign in to accept"
     └─ already signed in as them  →  "Continue" straight to /onboarding
                                              │
                                              ▼
                          /onboarding sees a PENDING invitation for the
                          signed-in user's own email — shown ahead of both
                          the join-request pending state and the generic
                          choice screen (see §2)
                                              │
                                    Accept ───┴─── Decline
                                       │                │
                                       ▼                ▼
                          assignPortalUserToOrganization   status: DECLINED
                          (invitation's own tenantId          │
                           and role — admin already            ▼
                           chose both)                   falls through to
                                       │                 the generic choice
                                       ▼                 screen (§2)
                          status: ACCEPTED
```

Two things make this different from a join request, both deliberate:

- **The role (and tenant) are fixed at invite time**, chosen by the admin —
  there's no default-to-`CUSTOMER_USER` fallback the way approval works in
  §3, because the whole point of inviting a specific person is that the
  admin already knows what access they should have.
- **The invite link's token is a one-time *reveal*, not the credential that
  grants access.** Acceptance is matched by the *signed-in session's own
  email* (`findPendingInvitationByEmail`, matched against `session.user.email`
  in `/onboarding` and in `acceptInvitation`/`declineInvitation`,
  `src/app/(auth)/onboarding/actions.ts`) — never by trusting an id or token
  passed from the client. This is what makes the flow robust to the
  invitee opening the link on one device and actually signing up/verifying/
  logging in on another; losing the email entirely still works, since
  `/onboarding` will show the same prompt as soon as they're signed in with
  the invited email, invite link or not.

An admin can also **revoke** a still-pending invitation from the same card
(`revokeInvitation`) — e.g. wrong email, or wants to change the role before
re-inviting.

Invitation logic lives in `src/lib/organization-invitation-directory.ts`; it
reuses the existing single-use expiring token store
(`src/lib/auth-tokens.ts`, purpose `"org-invite"`) purely to prove the
invitee received the email — the invitation's own state (org/tenant/role/
status) is a separate record, not encoded in the token.

### 4. Session refresh without re-login

Sessions are JWT-based (no database sessions). Mutating `organizationId`/
`tenantId`/`role` in Mongo — via onboarding, an admin's approval, accepting
an invitation, a tenant reassignment, or a default-tenant change — doesn't
by itself touch an already-issued session cookie. The `jwt` callback in
`src/auth.ts` handles
this: whenever it runs with no fresh `user`/`account` (i.e. not a
brand-new sign-in), it re-fetches the portal user by id and patches the
token's `organizationId`/`tenantId`/`role` from whatever's currently in
Mongo. Since `auth()` re-invokes the `jwt` callback on every call (verified
against the installed `next-auth@5.0.0-beta.32` source, not assumed), any
such change takes effect on the caller's **very next page load**, with no
logout/login required. This re-fetches on every request rather than only
while org-less — a deliberate correctness-over-throughput tradeoff given
this app's request volume; see the comment in `src/auth.ts` if that
tradeoff ever needs revisiting.

### 5. Creating and managing tenants

An org admin can create additional (non-default) tenants for their
organization from Settings
(`src/app/(portal)/settings/tenant-actions.ts` → `createTenant`). Once an
org has more than one tenant, three more admin/self-service controls appear
in Settings:

- **Change the org's default tenant** — the Tenants card gets a "Make
  default" button per non-default tenant (`setDefaultTenant`, admin-only).
  This only changes which tenant a *future* approved join request lands
  on — it doesn't move any existing member.
- **Switch your own tenant** — the User Profile card's Access Hierarchy
  gets a tenant picker + "Switch my tenant" button (`switchMyTenant`),
  available to any org member, not just admins. It only ever moves the
  caller.
- **Reassign another member's tenant** — an admin-only "Members" card
  lists every user in the org with a per-row tenant picker + "Move" button
  (`reassignMemberTenant`, `src/app/(portal)/settings/member-actions.ts`).

All three validate that the target tenant (and, for member reassignment,
the target user) actually belongs to the caller's organization before
writing anything — the same defensive-lookup pattern used by
`membership-actions.ts`. None of this is a true multi-tenant *switcher* in
the sense of holding several tenants open at once — a user still has
exactly one active `tenantId` at a time; these controls just make it
changeable instead of fixed at assignment time.

### 6. Viewing the hierarchy (Profile UI)

The relationship in the diagram at the top of this doc — User → Organization
→ Tenant — is rendered for real in the portal, not just documented here:

- The Settings page's **User Profile** card includes an **"Your Access
  Hierarchy"** block, rendered by `UserHierarchy`
  (`src/app/(portal)/settings/user-hierarchy.tsx`) — a nested Organization
  → Tenant → You tree. Each level shows its name, id (email for the user
  node instead of an id), and a status/role badge; indentation and
  connecting lines make the containment visually explicit. It's purely
  presentational — the actual tenant-switching controls (§5 above) render
  as a sibling right below it, not inside the component itself.
- It's reachable from anywhere in the portal via a **"Profile"** entry in
  the top-right user menu (`src/components/layout/user-menu.tsx`), which
  links to `/settings#access-hierarchy` — an anchor on the User Profile
  card (`scroll-mt-20` so the jump clears the sticky topbar). The dropdown
  also still has "Sign out"; there's no separate `/profile` route.

## 7. Platform-root: the Superuser role and Admin Console

`SUPERUSER` is a platform-level role, not scoped to any Organization or
Tenant. For every other role, `organizationId`/`tenantId` being `null`
means "hasn't finished onboarding yet" (see §2); for `SUPERUSER` it's
**permanent** — a superuser never joins or creates an organization.

`requireTenantContext()` special-cases this: a signed-in `SUPERUSER` is
redirected to `/admin` instead of falling into the onboarding-incomplete
branch. The Admin Console has its own gate, `requireSuperuserContext()`
(`src/lib/admin.ts`), and its own chrome (`AdminShell`,
`src/components/layout/admin-shell.tsx`) with a dedicated LHS nav
(`ADMIN_NAV` in `src/config/navigation.ts`) — a superuser never sees the
customer-portal sidebar, since there's no organization for it to display.

From `/admin` a superuser can, across every organization on the platform:

- List every Organization, and activate/deactivate one
  (`/admin/organizations`).
- Open an Organization's detail page to activate/deactivate its Tenants,
  change a member's role or suspend/reactivate them, and act on its
  pending membership requests/invitations
  (`/admin/organizations/[organizationId]`).
- List and search every `PortalUser` on the platform, change any user's
  role (including granting/revoking `SUPERUSER` itself — the one place
  that happens) or suspend/reactivate them (`/admin/users`). A superuser
  can't act on their own row (no self-suspend, no self-demote).
- Manage platform-wide settings (`/admin/settings`,
  `src/lib/platform-settings-directory.ts`), currently
  `allowSelfServeSignup` (gates both `/signup` and first-time Google
  sign-in) and `supportEmail`.

Provisioning a superuser account is deliberately out of self-serve reach:
no signup or onboarding path can produce one — the only ways are the seed
script (`scripts/seed-users.ts` / `src/data/mocks/users.ts`) or an
existing superuser granting the role from `/admin/users`.

## Data isolation

`TenantScopedCollection` (`src/lib/tenant-scoped-collection.ts`) is the only
sanctioned way to read/write a tenant-owned Mongo collection. Every
`Entitlement`/`Exchange` document carries a `tenantId`; the wrapper folds in
the caller's `tenantId` on every query and throws `TenantIsolationError` if
a filter or document ever names a different one — a forgotten or wrong
scope check fails loudly instead of silently widening access.

`Organization` and `Tenant` documents themselves are **not** tenant-scoped
(a `Tenant` is looked up by its own id or listed by `organizationId` via
plain queries in `src/lib/tenant-directory.ts`) — they're profile/catalog
records, not tenant-owned data, the same treatment `Customer` got before
this model existed.

## Where things live

| Concern | File |
|---|---|
| Identity resolution (login, org-less account creation) | `src/auth.ts` |
| Session/JWT shape | `src/types/next-auth.d.ts` |
| "Who is asking, for which tenant" (the portal choke point) | `src/lib/tenant.ts` |
| "Who is asking" for the Admin Console (the `/admin` choke point) | `src/lib/admin.ts` |
| Organization CRUD + search | `src/lib/organization-directory.ts` |
| Tenant CRUD | `src/lib/tenant-directory.ts` |
| Membership request lifecycle | `src/lib/organization-membership-directory.ts` |
| Invitation lifecycle | `src/lib/organization-invitation-directory.ts` |
| User CRUD, org/tenant assignment | `src/lib/user-directory.ts` |
| Tenant data-isolation enforcement | `src/lib/tenant-scoped-collection.ts` |
| Role-based permission checks | `src/lib/authorization.ts` |
| Single-use expiring token store (verify-email, reset-password, org-invite) | `src/lib/auth-tokens.ts` |
| Transactional email content (verify, reset, invite) | `src/lib/auth-emails.ts` |
| Onboarding UI + server actions (choice, invitation prompt, pending) | `src/app/(auth)/onboarding/` |
| Public invite-link landing page | `src/app/(auth)/invite/page.tsx` |
| Admin approval, invitations, tenant creation/default/reassignment, member list UI | `src/app/(portal)/settings/` |
| Admin Console (Organizations/Tenants/Users/Platform Settings) | `src/app/admin/` |
| Platform-wide settings singleton | `src/lib/platform-settings-directory.ts` |
| Hierarchy visualization (Org → Tenant → You) | `src/app/(portal)/settings/user-hierarchy.tsx` |
| Global "Profile" link (top-right user menu) | `src/components/layout/user-menu.tsx` |
| Edge-level route gating | `src/proxy.ts` |

## Known gaps (by design, not yet built)

- No true multi-tenant switcher — a user has exactly one active `tenantId`
  at a time (changeable via Settings, see "Creating and managing tenants"
  above, but not "hold two tenants open at once").
- Join-request approval always grants `CUSTOMER_USER`; there's no role
  picker in that flow (unlike invitations, where the admin picks the role
  up front — see §3a).
- No cooldown or limit on retrying a join request after rejection.
- Invitations dedupe per email *globally*, not per organization — if org A
  invites `x@example.com` while that invite is still pending, org B can't
  also invite them until it's resolved (accepted/declined/revoked).
- No "resend" for a pending invitation — an admin revokes and re-invites to
  send a fresh link or change the role/tenant.
- No data-migration path — the org/tenant split assumes dev-stage data;
  existing environments are reseeded (`npm run seed:users`,
  `npm run seed:catalog`), not migrated.
