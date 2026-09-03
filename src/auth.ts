import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { createPortalUser, findPortalUserByEmail, findPortalUserById, verifyPortalUserEmail } from "@/lib/user-directory";
import { getPlatformSettings } from "@/lib/platform-settings-directory";
import { PortalUserStatus, type UserRole } from "@/models";

/**
 * Thrown by the Credentials provider for a real, existing account whose
 * email hasn't been verified yet. `code` surfaces to the client via
 * `signIn(...).code` (see `login-form.tsx`) so the UI can point the user
 * at `/check-email` instead of showing a generic "invalid credentials"
 * error.
 */
class EmailNotVerifiedError extends CredentialsSignin {
  code = "email-not-verified";
}

/**
 * Authentication providers, backed by the tenant directory in MongoDB
 * (`src/lib/user-directory.ts`). This is intentionally the ONLY file
 * that knows how identity is established. Both providers resolve to the
 * same directory, so `{ id, name, email, organizationId, tenantId, role }`
 * always comes from one place — nothing else in the app (routes, services,
 * components) needs to change, since everything downstream reads identity
 * from the session, not from the provider.
 *
 * Neither provider assigns an organization/tenant at account-creation
 * time anymore — both a self-serve signup
 * (`src/app/(auth)/signup`) and a first-time Google login create an
 * account with `organizationId`/`tenantId`/`role` all `null`. Resolving
 * that (join an existing org, or create a new one) happens once, post-login,
 * in the onboarding gate (`src/app/(auth)/onboarding`), which
 * `requireTenantContext` (see `src/lib/tenant.ts`) routes an org-less user
 * to before they can reach the portal.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Required for self-hosted deployments (Docker, bare Node) where Auth.js
  // cannot otherwise verify the request Host header against a known list
  // of trusted platforms the way it can on Vercel.
  trustHost: true,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email =
          typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password) {
          return null;
        }

        const user = await findPortalUserByEmail(email);
        if (!user?.passwordHash) {
          return null;
        }

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) {
          return null;
        }

        if (!user.emailVerified) {
          throw new EmailNotVerifiedError();
        }

        if (user.status === PortalUserStatus.SUSPENDED) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          organizationId: user.organizationId,
          tenantId: user.tenantId,
          role: user.role,
        };
      },
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") {
        return true;
      }

      const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
      if (!email) {
        return false;
      }

      const existing = await findPortalUserByEmail(email);
      if (existing) {
        return existing.status !== PortalUserStatus.SUSPENDED;
      }

      const { allowSelfServeSignup } = await getPlatformSettings();
      if (!allowSelfServeSignup) {
        return false;
      }

      // First time this Google account has signed in: create the account
      // with no organization/tenant yet, same as a fresh email/password
      // signup, minus the verification step (Google already confirmed the
      // email). They land in `/onboarding` on the next gate check.
      const name = typeof profile?.name === "string" && profile.name.trim() ? profile.name.trim() : email;
      await createPortalUser({
        name,
        email,
        organizationId: null,
        tenantId: null,
        role: null,
        passwordHash: null,
      });
      await verifyPortalUserEmail(email);

      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "google") {
          const portalUser = await findPortalUserByEmail(user.email ?? "");
          if (portalUser) {
            token.userId = portalUser.id;
            token.organizationId = portalUser.organizationId;
            token.tenantId = portalUser.tenantId;
            token.role = portalUser.role;
          }
          return token;
        }

        token.userId = user.id as string;
        token.organizationId = user.organizationId as string | null;
        token.tenantId = user.tenantId as string | null;
        token.role = user.role as UserRole | null;
        return token;
      }

      // Not a fresh sign-in: `auth()` re-invokes this callback on every
      // call (see `node_modules/next-auth/lib/index.js` ->
      // `@auth/core`'s `lib/actions/session.js`), so re-reading the
      // portal user here means any change made outside the session —
      // finishing onboarding, a join request getting approved, an admin
      // moving the caller to a different tenant, a role change — takes
      // effect on the very next page load, with no re-login required.
      // This app's request volume is low enough that the extra lookup on
      // every call is worth it for that correctness guarantee; if that
      // stops being true, narrow this back to only the fields that are
      // still unset (as it was before tenant reassignment existed).
      const portalUser = await findPortalUserById(token.userId as string);
      if (portalUser) {
        token.organizationId = portalUser.organizationId;
        token.tenantId = portalUser.tenantId;
        token.role = portalUser.role;
      }

      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.organizationId = token.organizationId as string | null;
      session.user.tenantId = token.tenantId as string | null;
      session.user.role = token.role as UserRole | null;
      return session;
    },
  },
});
