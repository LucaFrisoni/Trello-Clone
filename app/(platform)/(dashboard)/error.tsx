"use client";

// Error screen for the dashboard: keeps the navbar usable when a page fails to load its data.
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

interface DashboardErrorProps {
  error: Error;
  reset: () => void;
}

const DashboardError = ({ error, reset }: DashboardErrorProps) => {
  useEffect(() => {
    console.error("[DASHBOARD_ERROR]", error);
  }, [error]);

  return (
    <div className="h-full pt-40 px-4 flex flex-col items-center text-center gap-y-4">
      <h2 className="font-semibold text-xl text-neutral-700">
        We could not load your workspace
      </h2>
      <p className="text-sm text-muted-foreground max-w-md">
        You are signed in, but your data is temporarily unavailable.
        Please try again in a few minutes.
      </p>
      <Button size="sm" variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
};

export default DashboardError;
