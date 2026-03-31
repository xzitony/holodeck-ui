"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";

interface Job {
  id: string;
  name: string;
  status: string;
  startedAt: string;
}

function Elapsed({ since }: { since: string }) {
  const [text, setText] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      if (h > 0) setText(`${h}h ${m}m`);
      else setText(`${m}m`);
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [since]);

  return <span>{text}</span>;
}

type BannerState = "running" | "completed" | "failed";

function getBannerState(jobs: Job[]): BannerState | null {
  const running = jobs.filter((j) => j.status === "running");
  if (running.length > 0) return "running";

  // Show the most recent non-running job's status
  const recent = jobs[0]; // jobs are sorted desc by startedAt from API
  if (!recent) return null;
  if (recent.status === "completed") return "completed";
  if (recent.status === "failed") return "failed";
  return null;
}

const stateStyles: Record<BannerState, { bg: string; text: string; dot: string; hoverBg: string; border: string }> = {
  running: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    dot: "bg-blue-400",
    hoverBg: "hover:bg-blue-500/15",
    border: "border-blue-500/20",
  },
  completed: {
    bg: "bg-success/10",
    text: "text-success",
    dot: "bg-success",
    hoverBg: "hover:bg-success/15",
    border: "border-success/20",
  },
  failed: {
    bg: "bg-destructive/10",
    text: "text-destructive",
    dot: "bg-destructive",
    hoverBg: "hover:bg-destructive/15",
    border: "border-destructive/20",
  },
};

export function ActiveJobsBanner() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("dismissed-deploy-banner-job");
  });

  const dismiss = (jobId: string) => {
    setDismissedJobId(jobId);
    localStorage.setItem("dismissed-deploy-banner-job", jobId);
  };

  useEffect(() => {
    if (!user) return;

    const fetchJobs = () => {
      fetch("/api/deployments")
        .then((r) => r.json())
        .then((data) => {
          const allJobs: Job[] = data.jobs || [];
          setJobs(allJobs);

          // Clear dismissal when a new job starts running
          const hasRunning = allJobs.some((j) => j.status === "running");
          if (hasRunning) {
            setDismissedJobId(null);
            localStorage.removeItem("dismissed-deploy-banner-job");
          }
        })
        .catch(() => {});
    };

    fetchJobs();
    const interval = setInterval(fetchJobs, 15000);
    return () => clearInterval(interval);
  }, [user]);

  const bannerState = getBannerState(jobs);
  if (!bannerState) return null;

  // Check if the most recent finished job was dismissed
  const mostRecentJob = jobs[0];
  if (bannerState !== "running" && mostRecentJob && dismissedJobId === mostRecentJob.id) return null;

  const styles = stateStyles[bannerState];
  const running = jobs.filter((j) => j.status === "running");
  const isAdmin = user?.role === "labadmin" || user?.role === "superadmin";

  // User role: simple warning/status message
  if (!isAdmin) {
    const userMessage =
      bannerState === "running"
        ? "A deployment is in progress, lab availability may be affected"
        : bannerState === "completed"
        ? "A deployment has completed successfully"
        : "A deployment has failed";

    const userStyles =
      bannerState === "running"
        ? { bg: "bg-warning/10", text: "text-warning", dot: "bg-warning", border: "border-warning/20" }
        : stateStyles[bannerState];

    return (
      <div className={`px-4 py-2 text-sm ${userStyles.bg} ${userStyles.text} border-b ${userStyles.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {bannerState === "running" && (
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${userStyles.dot} opacity-75`} />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${userStyles.dot}`} />
            </span>
            {userMessage}
          </div>
          {bannerState !== "running" && (
            <button
              onClick={() => mostRecentJob && dismiss(mostRecentJob.id)}
              className="opacity-60 hover:opacity-100 text-xs ml-4"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    );
  }

  // Admin: detailed banner with link
  const adminContent = (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          {bannerState === "running" && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${styles.dot} opacity-75`} />
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${styles.dot}`} />
        </span>
        {bannerState === "running" ? (
          running.length === 1 ? (
            <>
              Active Deployment Running: <strong>{running[0].name}</strong>
              <span className="opacity-75 ml-1">
                — <Elapsed since={running[0].startedAt} /> elapsed
              </span>
            </>
          ) : (
            <>
              <strong>{running.length} active operations</strong>
              <span className="opacity-75 ml-1">running</span>
            </>
          )
        ) : bannerState === "completed" ? (
          <>
            <strong>{jobs[0].name}</strong>
            <span className="opacity-75 ml-1">— completed successfully</span>
          </>
        ) : (
          <>
            <strong>{jobs[0].name}</strong>
            <span className="opacity-75 ml-1">— failed</span>
          </>
        )}
      </span>
      {bannerState !== "running" && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (mostRecentJob) dismiss(mostRecentJob.id); }}
          className="opacity-60 hover:opacity-100 text-xs ml-4"
        >
          Dismiss
        </button>
      )}
    </div>
  );

  return (
    <Link
      href="/dashboard/instances"
      className={`block px-4 py-2 text-sm ${styles.bg} ${styles.text} border-b ${styles.border} ${styles.hoverBg} transition-colors`}
    >
      {adminContent}
    </Link>
  );
}
