// @vitest-environment jsdom
// Checks that the workspace header waits for Clerk before showing organization data.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const useOrganization = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs", () => ({ useOrganization }));

import { Info } from "@/app/(platform)/(dashboard)/organization/[organizationId]/_components/info";

describe("Info", () => {
  afterEach(cleanup);

  // Regression: Clerk loads after hydration, and the image was rendered without a src meanwhile.
  it("shows a placeholder while Clerk is still loading", () => {
    useOrganization.mockReturnValue({ isLoaded: false, organization: undefined });

    render(<Info isPro={false} />);

    expect(screen.queryByAltText("Organization")).toBeNull();
  });

  // Regression: right after login Clerk is loaded but the active organization may not be set yet.
  it("shows a placeholder when there is no active organization", () => {
    useOrganization.mockReturnValue({ isLoaded: true, organization: null });

    render(<Info isPro={false} />);

    expect(screen.queryByAltText("Organization")).toBeNull();
  });

  // The normal state must expose the workspace name and its plan.
  it("shows the organization name and plan once loaded", () => {
    useOrganization.mockReturnValue({
      isLoaded: true,
      organization: { name: "Acme", imageUrl: "https://img.clerk.com/acme.png" },
    });

    render(<Info isPro />);

    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByAltText("Organization")).toBeTruthy();
  });
});
