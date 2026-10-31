// Checks the route protection and post-login redirects defined in middleware.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const clerk = vi.hoisted(() => ({
  options: undefined as any,
  redirectToSignIn: vi.fn(() => "sign-in-redirect"),
}));

vi.mock("@clerk/nextjs", () => ({
  authMiddleware: (options: unknown) => {
    clerk.options = options;
    return () => undefined;
  },
  redirectToSignIn: clerk.redirectToSignIn,
}));

import "@/middleware";

const BASE = "https://app.test";

const runAfterAuth = (path: string, auth: Record<string, unknown>) =>
  clerk.options.afterAuth(auth, new NextRequest(`${BASE}${path}`));

describe("middleware", () => {
  beforeEach(() => clerk.redirectToSignIn.mockClear());

  // Only the landing page and the Stripe webhook may skip authentication.
  it("keeps just the landing page and webhook public", () => {
    expect(clerk.options.publicRoutes).toEqual(["/", "/api/webhook"]);
  });

  // Protected pages must send anonymous visitors to sign-in and keep their destination.
  it("redirects anonymous visitors of protected routes to sign-in", () => {
    const result = runAfterAuth("/organization/org_1", { userId: null, isPublicRoute: false });

    expect(result).toBe("sign-in-redirect");
    expect(clerk.redirectToSignIn).toHaveBeenCalledWith({
      returnBackUrl: `${BASE}/organization/org_1`,
    });
  });

  // After login the app sends users from "/" to their active workspace.
  it("sends signed-in users with an organization to their workspace", () => {
    const result = runAfterAuth("/", { userId: "u", orgId: "org_1", isPublicRoute: true });

    expect(result.headers.get("location")).toBe(`${BASE}/organization/org_1`);
  });

  // The dashboard depends on an active organization, so it must be chosen first.
  it("forces signed-in users without an organization to select one", () => {
    const result = runAfterAuth("/board/1", { userId: "u", orgId: null, isPublicRoute: false });

    expect(result.headers.get("location")).toBe(`${BASE}/select-org`);
  });

  // Boundary case: redirecting from /select-org to itself would loop forever.
  it("does not redirect away from the organization selector", () => {
    const result = runAfterAuth("/select-org", { userId: "u", orgId: null, isPublicRoute: false });

    expect(result).toBeUndefined();
  });
});
