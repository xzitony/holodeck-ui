"use client";

import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";

interface BuildInfo {
  version: string;
  gitSha: string;
  buildTime: string;
  nodeVersion: string;
  hostname: string;
  environment: string;
  uptime: string;
}

export function BuildFooter() {
  const { user } = useAuth();
  const [info, setInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    if (user?.role !== "superadmin") return;

    fetch("/api/config/build-info")
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => null);

    // Refresh uptime every 5 minutes
    const interval = setInterval(() => {
      fetch("/api/config/build-info")
        .then((r) => (r.ok ? r.json() : null))
        .then(setInfo)
        .catch(() => null);
    }, 300000);
    return () => clearInterval(interval);
  }, [user?.role]);

  if (!info) return null;

  const buildDate = info.buildTime !== "dev"
    ? new Date(info.buildTime).toLocaleString()
    : null;

  return (
    <footer className="px-4 py-1.5 border-t border-border/50 text-[10px] text-muted-foreground/60 flex items-center justify-between font-mono">
      <span>
        v{info.version}
        {info.gitSha !== "dev" && (
          <> · <span title="Git commit">{info.gitSha.substring(0, 7)}</span></>
        )}
        {" · "}
        {info.environment}
      </span>
      <span>
        {info.hostname}
        {" · "}
        Node {info.nodeVersion}
        {buildDate ? (
          <> · built {buildDate}</>
        ) : (
          <> · up {info.uptime}</>
        )}
      </span>
    </footer>
  );
}
