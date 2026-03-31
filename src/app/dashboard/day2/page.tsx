"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useReservation } from "@/hooks/use-reservation";
import { CommandPreview } from "@/components/ui/command-preview";

interface CachedInstance {
  configId: string;
  description: string;
  notes: string | null;
  lastSynced: string | null;
  instance?: string;
  vcfVersion?: string;
  targetHost?: string;
}

type Day2Operation = "add-cluster" | "add-esxi-nodes" | "add-vcf-automation";

const operations: Record<
  Day2Operation,
  { label: string; description: string; time: string }
> = {
  "add-cluster": {
    label: "Add Cluster",
    description:
      "Add an additional 3-node vSphere cluster to a management or workload domain.",
    time: "~1-3 hours",
  },
  "add-esxi-nodes": {
    label: "Add ESXi Nodes",
    description:
      "Dynamically add nested ESXi hosts to the deployment.",
    time: "~30-60 min per node",
  },
  "add-vcf-automation": {
    label: "Add VCF Automation",
    description:
      "Deploy VCF Automation with All Apps organization to a domain.",
    time: "~1-2 hours",
  },
};

export default function Day2OpsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { reservation } = useReservation();

  // Instance selection
  const [configs, setConfigs] = useState<CachedInstance[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasAutoRefreshed = useRef(false);
  const [isStale, setIsStale] = useState(false);

  // Operation state
  const [selected, setSelected] = useState<Day2Operation | null>(null);
  const [site, setSite] = useState("a");
  const [domain, setDomain] = useState("Management");
  const [count, setCount] = useState("3");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const [sshConfigured, setSshConfigured] = useState<boolean | null>(null);

  const instances = configs.filter((c) => c.instance);
  const selectedConfig = configs.find((c) => c.configId === selectedConfigId);

  useEffect(() => {
    fetch("/api/config/ssh-status")
      .then((r) => r.json())
      .then((data) => setSshConfigured(data.configured))
      .catch(() => setSshConfigured(false));
  }, []);

  // Load instances from cache
  const loadConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/holodeck-configs/instances");
      const data = await res.json();
      const cfgs = data.configs || [];
      setConfigs(cfgs);
      setIsStale(data.stale || false);

      // Auto-select first running instance
      const running = cfgs.filter((c: CachedInstance) => c.instance);
      if (running.length > 0 && !selectedConfigId) {
        setSelectedConfigId(running[0].configId);
      }
    } catch {
      // ignore
    } finally {
      setLoadingConfigs(false);
    }
  }, [selectedConfigId]);

  useEffect(() => {
    loadConfigs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background refresh if stale
  useEffect(() => {
    if (!loadingConfigs && isStale && !hasAutoRefreshed.current) {
      hasAutoRefreshed.current = true;
      handleRefresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingConfigs, isStale]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const syncRes = await fetch("/api/holodeck-configs/sync", { method: "POST" });
      if (syncRes.ok) {
        const res = await fetch("/api/holodeck-configs/instances");
        const data = await res.json();
        const cfgs = data.configs || [];
        setConfigs(cfgs);
        setIsStale(false);
        // Re-select if current selection is gone
        if (selectedConfigId && !cfgs.find((c: CachedInstance) => c.configId === selectedConfigId)) {
          const running = cfgs.filter((c: CachedInstance) => c.instance);
          if (running.length > 0) setSelectedConfigId(running[0].configId);
        }
      }
    } catch {
      // ignore
    }
    setRefreshing(false);
  };

  const needsReservation = user?.role === "labadmin" && !reservation;

  const handleLaunch = async () => {
    if (!selected || !selectedConfigId) return;
    setLaunching(true);
    setError("");

    try {
      const body: Record<string, unknown> = {
        operation: selected,
        site,
        configId: selectedConfigId,
      };

      if (selected === "add-cluster" || selected === "add-vcf-automation") {
        body.domain = domain;
      }
      if (selected === "add-esxi-nodes") {
        body.count = parseInt(count, 10);
      }

      const res = await fetch("/api/day2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start operation");
      }

      router.push("/dashboard/deployments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start operation");
    } finally {
      setLaunching(false);
    }
  };

  const buildCommandPreview = (): string => {
    if (!selected) return "";
    const configPrefix = selectedConfigId
      ? `Import-HoloDeckConfig -ConfigID '${selectedConfigId}'; `
      : "";
    switch (selected) {
      case "add-cluster":
        return `${configPrefix}Update-HoloDeckInstance -Site '${site}' -AdditionalCluster -VIDomain '${domain}'`;
      case "add-esxi-nodes":
        return `${configPrefix}New-HoloDeckESXiNodes -Count ${count}`;
      case "add-vcf-automation":
        return `${configPrefix}Update-HoloDeckInstance -Site '${site}' -AddVcfAutomationAllAppsOrg -VIDomain '${domain}'`;
    }
  };

  if (sshConfigured === false) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Day 2 Operations</h1>
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6 text-center space-y-3">
          <p className="text-destructive font-medium">
            SSH connection not configured
          </p>
          <p className="text-sm text-muted-foreground">
            A Super Admin must configure the holorouter connection in Global
            Config before operations can be started.
          </p>
          {user?.role === "superadmin" && (
            <button
              onClick={() => router.push("/dashboard/admin/config")}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90"
            >
              Go to Global Config
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Day 2 Operations</h1>
        <p className="text-muted-foreground mt-1">
          Run additional operations on an existing Holodeck deployment. These
          run in the background on the holorouter.
        </p>
      </div>

      {needsReservation && (
        <div className="p-3 rounded-md bg-warning/10 border border-warning/30 text-warning text-sm">
          You need an active reservation to run Day 2 operations. Book a time
          slot on the Reservations page first.
        </div>
      )}

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Target Instance */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Target Instance</h2>
          {refreshing && (
            <span className="text-xs text-muted-foreground animate-pulse">
              syncing...
            </span>
          )}
        </div>

        {loadingConfigs ? (
          <p className="text-sm text-muted-foreground">Loading instances...</p>
        ) : instances.length === 0 ? (
          <div className="p-3 rounded-md bg-warning/10 border border-warning/30 text-sm">
            <p className="text-warning font-medium">No running instances found</p>
            <p className="text-muted-foreground mt-1">
              Day 2 operations require a running Holodeck instance. Deploy an instance first.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {instances.map((cfg) => (
              <button
                key={cfg.configId}
                onClick={() => setSelectedConfigId(cfg.configId)}
                className={`w-full text-left p-3 rounded-md border transition-colors ${
                  selectedConfigId === cfg.configId
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background/50 hover:border-primary/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {cfg.description || cfg.instance || cfg.configId}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">
                      Running
                    </span>
                  </div>
                  {cfg.vcfVersion && (
                    <span className="text-xs text-muted-foreground">VCF {cfg.vcfVersion}</span>
                  )}
                </div>
                {cfg.description && cfg.instance && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Instance: {cfg.instance} / Config: {cfg.configId}
                  </p>
                )}
                {!cfg.description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Config: {cfg.configId}
                  </p>
                )}
                {cfg.notes && (
                  <p className="text-xs text-muted-foreground mt-1 italic">{cfg.notes}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Operation Selection — only show when an instance is selected */}
      {selectedConfig?.instance && (
        <>
          <div className="space-y-4">
            <h2 className="font-semibold text-lg">Select Operation</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(
                Object.entries(operations) as [
                  Day2Operation,
                  (typeof operations)[Day2Operation],
                ][]
              ).map(([key, info]) => (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={`p-4 rounded-lg border text-left transition-colors ${
                    selected === key
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <p className="font-semibold">{info.label}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {info.description}
                  </p>
                  <p className="text-xs text-warning mt-2">Est. {info.time}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Parameters */}
          {selected && (
            <div className="space-y-4">
              <h2 className="font-semibold text-lg">Parameters</h2>
              <div className="bg-card border border-border rounded-lg p-4 space-y-4">
                {/* Site selector - shown for cluster and automation */}
                {(selected === "add-cluster" ||
                  selected === "add-vcf-automation") && (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">Site</label>
                      <select
                        value={site}
                        onChange={(e) => setSite(e.target.value)}
                        className="w-full px-3 py-2 bg-input border border-border rounded-md"
                      >
                        <option value="a">Site A</option>
                        <option value="b">Site B</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        VI Domain
                      </label>
                      <select
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        className="w-full px-3 py-2 bg-input border border-border rounded-md"
                      >
                        <option value="Management">Management</option>
                        <option value="Workload">Workload</option>
                      </select>
                    </div>
                  </>
                )}

                {/* Node count - shown for ESXi nodes */}
                {selected === "add-esxi-nodes" && (
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Number of Nodes
                    </label>
                    <input
                      type="number"
                      value={count}
                      onChange={(e) => setCount(e.target.value)}
                      min="1"
                      max="20"
                      className="w-full px-3 py-2 bg-input border border-border rounded-md"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Each node takes approximately 30-60 minutes to deploy.
                    </p>
                  </div>
                )}
              </div>

              {/* Command preview */}
              <CommandPreview command={buildCommandPreview()} />

              <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                <p className="text-sm text-warning font-medium">
                  This operation will run against instance &quot;{selectedConfig?.instance}&quot; and take{" "}
                  {operations[selected].time} to complete.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  The process runs in a tmux session on the holorouter. You can
                  safely close your browser and return to monitor progress on the
                  Deployments page.
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleLaunch}
                  disabled={launching || needsReservation}
                  className="px-6 py-2 bg-success text-white rounded-md font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {launching
                    ? "Starting..."
                    : needsReservation
                    ? "Reservation Required"
                    : `Launch ${operations[selected].label}`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
