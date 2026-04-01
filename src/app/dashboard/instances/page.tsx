"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";

interface Capabilities {
  hasSiteB: boolean;
  hasAriaAutomation: boolean;
  hasAriaOperations: boolean;
  hasAriaLogs: boolean;
  hasAriaNetworks: boolean;
  hasNsx: boolean;
  hasWorkloadDomain: boolean;
}

interface JobSummary {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  userName: string;
}

type InstanceState = "not_deployed" | "deploying" | "running" | "failed" | "completed";

interface Instance {
  configId: string;
  description: string;
  notes: string | null;
  lastSynced: string | null;
  capabilities: Capabilities;
  instance?: string;
  vcfVersion?: string;
  targetHost?: string;
  remoteDescription?: string;
  state: InstanceState;
  activeJob?: JobSummary;
  activeDay2Job?: JobSummary;
  lastJob?: JobSummary;
  jobCount: number;
}

const stateConfig: Record<InstanceState, { label: string; color: string; borderColor: string }> = {
  not_deployed: {
    label: "Not Deployed",
    color: "bg-muted text-muted-foreground",
    borderColor: "border-border",
  },
  deploying: {
    label: "Deploying",
    color: "bg-blue-500/20 text-blue-400",
    borderColor: "border-blue-500/30",
  },
  running: {
    label: "Running",
    color: "bg-success/20 text-success",
    borderColor: "border-success/30",
  },
  completed: {
    label: "Completed",
    color: "bg-success/20 text-success",
    borderColor: "border-success/30",
  },
  failed: {
    label: "Failed",
    color: "bg-destructive/20 text-destructive",
    borderColor: "border-destructive/30",
  },
};

function formatDuration(start: string, end?: string | null): string {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function Elapsed({ since }: { since: string }) {
  const [text, setText] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      if (h > 0) setText(`${h}h ${m}m`);
      else if (m > 0) setText(`${m}m ${s}s`);
      else setText(`${s}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [since]);

  return <span>{text}</span>;
}

const capBadges: Array<{ key: keyof Capabilities; label: string; color: string }> = [
  { key: "hasSiteB", label: "Multi-Site", color: "bg-blue-500/20 text-blue-400" },
  { key: "hasAriaAutomation", label: "VCF Automation", color: "bg-purple-500/20 text-purple-400" },
  { key: "hasAriaOperations", label: "VCF Operations", color: "bg-purple-500/20 text-purple-400" },
  { key: "hasAriaLogs", label: "Aria Logs", color: "bg-purple-500/20 text-purple-400" },
  { key: "hasAriaNetworks", label: "Aria Networks", color: "bg-purple-500/20 text-purple-400" },
  { key: "hasWorkloadDomain", label: "Workload Domain", color: "bg-teal-500/20 text-teal-400" },
];

export default function InstancesPage() {
  const { user } = useAuth();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isStale, setIsStale] = useState(false);

  const isAdmin = user?.role === "labadmin" || user?.role === "superadmin";

  const fetchInstances = () => {
    fetch("/api/instances")
      .then((r) => r.json())
      .then((data) => {
        setInstances(data.instances || []);
        setIsStale(data.stale || false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchInstances();
    const interval = setInterval(fetchInstances, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/holodeck-configs/sync", { method: "POST" });
      fetchInstances();
    } catch {
      // non-critical
    }
    setRefreshing(false);
  };

  const handleClearHistory = async () => {
    if (!confirm("Clear all completed and failed deployment history?")) return;
    await fetch("/api/deployments", { method: "DELETE" });
    fetchInstances();
  };

  // Sort: deploying first, then running, then failed/completed, then not_deployed
  const stateOrder: Record<InstanceState, number> = {
    deploying: 0,
    running: 1,
    failed: 2,
    completed: 3,
    not_deployed: 4,
  };
  const sorted = [...instances].sort(
    (a, b) => stateOrder[a.state] - stateOrder[b.state]
  );

  const hasHistory = instances.some((i) => i.lastJob);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manage Instances</h1>
          <p className="text-muted-foreground mt-1">
            Each Holodeck configuration is a single deployment instance.
            Always create a new config for each new deployment.{" "}
            <strong>Do not re-use a config for multiple deployments</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {refreshing ? "Syncing..." : "Sync"}
            </button>
          )}
          {isAdmin && (
            <Link
              href="/dashboard/deploy"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 text-sm"
            >
              New Deployment
            </Link>
          )}
        </div>
      </div>

      {loading && (
        <p className="text-muted-foreground">Loading instances...</p>
      )}

      {/* Instance Cards */}
      {!loading && sorted.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">No Holodeck configurations found.</p>
          {isAdmin && (
            <Link
              href="/dashboard/admin/holodeck-configs"
              className="inline-block mt-3 text-sm text-primary hover:underline"
            >
              Create a configuration
            </Link>
          )}
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sorted.map((inst) => {
            const sc = stateConfig[inst.state];
            const activeCaps = capBadges.filter((b) => inst.capabilities[b.key]);

            return (
              <div
                key={inst.configId}
                className={`bg-card border ${sc.borderColor} rounded-lg p-4 space-y-3`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">
                        {inst.description || inst.configId}
                      </h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${sc.color}`}>
                        {sc.label}
                      </span>
                    </div>
                    {inst.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {inst.configId}
                      </p>
                    )}
                    {inst.remoteDescription && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">
                        {inst.remoteDescription}
                      </p>
                    )}
                  </div>
                  {inst.vcfVersion && (
                    <span className="text-xs text-muted-foreground ml-2 whitespace-nowrap">
                      VCF {inst.vcfVersion}
                    </span>
                  )}
                </div>

                {/* Instance Info */}
                {inst.instance && (
                  <div className="text-sm text-muted-foreground">
                    Instance: <span className="text-foreground font-mono text-xs">{inst.instance}</span>
                    {inst.targetHost && (
                      <span className="ml-3">
                        Host: <span className="text-foreground font-mono text-xs">{inst.targetHost}</span>
                      </span>
                    )}
                  </div>
                )}

                {/* Active Deployment */}
                {inst.state === "deploying" && inst.activeJob && (
                  <Link
                    href={`/dashboard/deployments/${inst.activeJob.id}`}
                    className="flex items-center justify-between p-3 rounded-md bg-blue-500/5 border border-blue-500/20 hover:border-blue-500/40 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                      <span className="text-sm">
                        {inst.activeJob.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        — <Elapsed since={inst.activeJob.startedAt} /> elapsed
                      </span>
                    </div>
                    <span className="text-xs text-blue-400">View Output →</span>
                  </Link>
                )}

                {/* Active Day 2 Operation (shown on running instances) */}
                {inst.activeDay2Job && (
                  <Link
                    href={`/dashboard/deployments/${inst.activeDay2Job.id}`}
                    className="flex items-center justify-between p-3 rounded-md bg-amber-500/5 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-sm">
                        {inst.activeDay2Job.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        — <Elapsed since={inst.activeDay2Job.startedAt} /> elapsed
                      </span>
                    </div>
                    <span className="text-xs text-amber-400">View Output →</span>
                  </Link>
                )}

                {/* Last Job (completed/failed) */}
                {inst.state !== "deploying" && inst.lastJob && (
                  <Link
                    href={`/dashboard/deployments/${inst.lastJob.id}`}
                    className={`flex items-center justify-between p-3 rounded-md border transition-colors ${
                      inst.lastJob.status === "failed"
                        ? "bg-destructive/5 border-destructive/20 hover:border-destructive/40"
                        : "bg-success/5 border-success/20 hover:border-success/40"
                    }`}
                  >
                    <div className="text-sm">
                      <span className="text-muted-foreground">Last deployment: </span>
                      <span className={inst.lastJob.status === "failed" ? "text-destructive" : "text-success"}>
                        {inst.lastJob.status}
                      </span>
                      {inst.lastJob.completedAt && (
                        <span className="text-xs text-muted-foreground ml-2">
                          {formatDuration(inst.lastJob.startedAt, inst.lastJob.completedAt)} — {new Date(inst.lastJob.completedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-primary">View Log →</span>
                  </Link>
                )}

                {/* Capability Badges */}
                {activeCaps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {activeCaps.map((b) => (
                      <span key={b.key} className={`text-xs px-2 py-0.5 rounded-full ${b.color}`}>
                        {b.label}
                      </span>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  {inst.state === "running" && (
                    <>
                      <Link
                        href="/dashboard/environment"
                        className="text-xs px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      >
                        Environment Links
                      </Link>
                      {isAdmin && (
                        <Link
                          href={`/dashboard/day2?configId=${inst.configId}`}
                          className="text-xs px-3 py-1.5 rounded-md bg-amber-600/10 text-amber-500 hover:bg-amber-600/20 transition-colors"
                        >
                          Day 2 Ops
                        </Link>
                      )}
                    </>
                  )}
                  {isAdmin && inst.state !== "deploying" && inst.state !== "running" && (
                    <Link
                      href={`/dashboard/deploy?configId=${inst.configId}`}
                      className="text-xs px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:opacity-90 transition-colors"
                    >
                      {inst.state === "failed" ? "Retry" : "Deploy"}
                    </Link>
                  )}
                </div>

                {/* Notes */}
                {inst.notes && (
                  <p className="text-xs text-muted-foreground italic border-t border-border pt-2">
                    {inst.notes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Clear History */}
      {isAdmin && hasHistory && (
        <div className="flex justify-end">
          <button
            onClick={handleClearHistory}
            className="text-xs px-3 py-1.5 rounded-md bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            Clear Deployment History
          </button>
        </div>
      )}

      {isStale && !refreshing && (
        <p className="text-xs text-warning">
          Cache may be stale.{" "}
          {isAdmin ? (
            <button onClick={handleRefresh} className="underline hover:no-underline">
              Sync now
            </button>
          ) : (
            "Contact an admin to refresh."
          )}
        </p>
      )}
    </div>
  );
}
