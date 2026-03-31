"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface JobInfo {
  id: string;
  name: string;
  mode: string;
  status: string;
  sessionName: string;
  startedAt: string;
  completedAt: string | null;
  user: { displayName: string; username: string };
  hasLog?: boolean;
}

const statusColors: Record<string, string> = {
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-success/20 text-success",
  failed: "bg-destructive/20 text-destructive",
};

function formatDuration(start: string, end?: string | null): string {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function DeploymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<JobInfo | null>(null);
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const outputRef = useRef<HTMLPreElement>(null);
  const [elapsed, setElapsed] = useState("");

  const fetchStatus = () => {
    fetch(`/api/deployments/${id}?lines=1000`)
      .then((r) => r.json())
      .then((data) => {
        if (data.job) setJob(data.job);
        if (data.output) setOutput(data.output);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  // Elapsed time counter
  useEffect(() => {
    if (!job) return;
    const tick = () => setElapsed(formatDuration(job.startedAt, job.completedAt));
    tick();
    if (job.status === "running") {
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    }
  }, [job]);

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel this deployment? This may leave the environment in an incomplete state.")) return;
    await fetch(`/api/deployments/${id}`, { method: "DELETE" });
    fetchStatus();
  };

  // Strip ANSI codes for display
  const cleanOutput = output
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x7e]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\].*?(\x07|\x1b\\)/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\r/g, "");

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Loading deployment details...</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-6">
        <p className="text-destructive">Deployment not found</p>
        <Link href="/dashboard/instances" className="text-primary hover:underline text-sm">
          ← Instances
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/instances" className="text-muted-foreground hover:text-foreground text-sm">
              ← Instances
            </Link>
          </div>
          <h1 className="text-2xl font-bold mt-2">{job.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Started by {job.user.displayName} on{" "}
            {new Date(job.startedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded-full ${statusColors[job.status]}`}>
            {job.status}
          </span>
          {job.status === "running" && (
            <button
              onClick={handleCancel}
              className="px-3 py-1 text-xs bg-destructive/20 text-destructive rounded-md hover:bg-destructive/30 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-card border border-border rounded-lg p-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground">
            Duration: <span className="text-foreground font-medium">{elapsed}</span>
          </span>
          <span className="text-muted-foreground">
            Session: <span className="text-foreground font-mono text-xs">{job.sessionName}</span>
          </span>
        </div>
        {job.status === "running" && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-blue-400 text-xs">Live</span>
          </div>
        )}
      </div>

      {/* Output terminal */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background/50">
          <span className="text-xs text-muted-foreground font-mono">
            {job.hasLog && job.status !== "running" ? "saved log output" : "tmux output"}
          </span>
          <div className="flex items-center gap-4">
            {job.hasLog && (
              <a
                href={`/api/deployments/${id}/log`}
                download
                className="text-xs text-primary hover:underline"
              >
                Download Log
              </a>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="w-3 h-3"
              />
              Auto-scroll
            </label>
          </div>
        </div>
        <pre
          ref={outputRef}
          className="p-4 font-mono text-xs leading-relaxed overflow-auto text-foreground/90 whitespace-pre-wrap"
          style={{ height: "calc(100vh - 22rem)", minHeight: "300px" }}
        >
          {cleanOutput || (job.status === "running" ? "Waiting for output..." : "No output captured")}
        </pre>
      </div>
    </div>
  );
}
