"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";

interface LinkConditions {
  requiresSiteB?: boolean;
  requiresAriaAutomation?: boolean;
  requiresAriaOperations?: boolean;
  requiresAriaLogs?: boolean;
  requiresAriaNetworks?: boolean;
  requiresWorkloadDomain?: boolean;
}

interface EnvironmentLink {
  name: string;
  description: string;
  url: string;
  username?: string;
  conditions: LinkConditions;
}

interface LinkCategory {
  label: string;
  links: EnvironmentLink[];
}

interface Capabilities {
  hasSiteB: boolean;
  hasAriaAutomation: boolean;
  hasAriaOperations: boolean;
  hasAriaLogs: boolean;
  hasAriaNetworks: boolean;
  hasNsx: boolean;
  hasWorkloadDomain: boolean;
}

const defaultCaps: Capabilities = {
  hasSiteB: false,
  hasAriaAutomation: false,
  hasAriaOperations: false,
  hasAriaLogs: false,
  hasAriaNetworks: false,
  hasNsx: false,
  hasWorkloadDomain: false,
};

interface CachedInstance {
  configId: string;
  description: string;
  notes: string | null;
  lastSynced: string | null;
  capabilities: Capabilities;
  // Summary fields from config JSON
  instance?: string;
  vcfVersion?: string;
  targetHost?: string;
  vsanMode?: string;
  depotType?: string;
  dnsDomain?: string;
  hasSiteB?: boolean;
  remoteDescription?: string;
}

export default function EnvironmentPage() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<LinkCategory[]>([]);
  const [configs, setConfigs] = useState<CachedInstance[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const hasAutoRefreshed = useRef(false);

  const isAdmin = user?.role === "labadmin" || user?.role === "superadmin";

  // Derived: separate into running instances vs non-running configs
  const instances = configs.filter((c) => c.instance);
  const nonRunning = configs.filter((c) => !c.instance);

  const selectedConfig = configs.find((c) => c.configId === selectedConfigId);
  const selectedIsInstance = selectedConfig?.instance;
  const capabilities = selectedConfig?.capabilities || defaultCaps;

  // Auto-select logic
  const autoSelect = useCallback((cfgs: CachedInstance[]) => {
    const running = cfgs.filter((c) => c.instance);
    if (running.length >= 1) {
      setSelectedConfigId(running[0].configId);
    } else if (isAdmin && cfgs.length > 0) {
      setSelectedConfigId(cfgs[0].configId);
    }
  }, [isAdmin]);

  // Step 1: Fast load from cache (DB only, instant)
  useEffect(() => {
    Promise.all([
      fetch("/api/environment-links").then((r) => r.json()),
      fetch("/api/holodeck-configs/instances").then((r) => r.json()),
    ])
      .then(([linksData, instancesData]) => {
        setCategories(linksData.categories || []);
        const cfgs = instancesData.configs || [];
        setConfigs(cfgs);
        setIsStale(instancesData.stale || false);
        autoSelect(cfgs);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2: Background refresh if cache is stale
  useEffect(() => {
    if (!loading && isStale && !hasAutoRefreshed.current) {
      hasAutoRefreshed.current = true;
      handleRefresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isStale]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Trigger sync from holorouter (this does the SSH calls)
      const syncRes = await fetch("/api/holodeck-configs/sync", { method: "POST" });
      if (syncRes.ok) {
        // Re-fetch the cached data
        const res = await fetch("/api/holodeck-configs/instances");
        const data = await res.json();
        const cfgs = data.configs || [];
        setConfigs(cfgs);
        setIsStale(false);
        // Re-select if current selection is gone or nothing selected
        if (!selectedConfigId || !cfgs.find((c: CachedInstance) => c.configId === selectedConfigId)) {
          autoSelect(cfgs);
        }
      }
    } catch {
      // Non-critical — we still have cached data
    }
    setRefreshing(false);
  };

  function shouldShowLink(conditions: LinkConditions): boolean {
    if (conditions.requiresSiteB && !capabilities.hasSiteB) return false;
    if (conditions.requiresAriaAutomation && !capabilities.hasAriaAutomation) return false;
    if (conditions.requiresAriaOperations && !capabilities.hasAriaOperations) return false;
    if (conditions.requiresAriaLogs && !capabilities.hasAriaLogs) return false;
    if (conditions.requiresAriaNetworks && !capabilities.hasAriaNetworks) return false;
    if (conditions.requiresWorkloadDomain && !capabilities.hasWorkloadDomain) return false;
    return true;
  }

  function shouldShowCategory(category: LinkCategory): boolean {
    return category.links.some((link) => shouldShowLink(link.conditions));
  }

  const capBadges: Array<{ label: string; active: boolean; color: string }> = [
    { label: "Multi-Site", active: capabilities.hasSiteB, color: "bg-blue-500/20 text-blue-400" },
    { label: "VCF Automation", active: capabilities.hasAriaAutomation, color: "bg-purple-500/20 text-purple-400" },
    { label: "VCF Operations", active: capabilities.hasAriaOperations, color: "bg-purple-500/20 text-purple-400" },
    { label: "Aria Logs", active: capabilities.hasAriaLogs, color: "bg-purple-500/20 text-purple-400" },
    { label: "Aria Networks", active: capabilities.hasAriaNetworks, color: "bg-purple-500/20 text-purple-400" },
    { label: "Workload Domain", active: capabilities.hasWorkloadDomain, color: "bg-teal-500/20 text-teal-400" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Quick access to management interfaces for your Holodeck deployment
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        )}
      </div>

      {/* Instance Selector */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">
              {instances.length > 0 ? "Select Instance" : "No Running Instances"}
            </h2>
            {refreshing && (
              <span className="text-xs text-muted-foreground animate-pulse">
                syncing...
              </span>
            )}
          </div>
          {selectedConfig && (
            <div className="flex items-center gap-2">
              {selectedIsInstance ? (
                <span className="text-xs px-2 py-1 rounded-full bg-success/20 text-success font-medium">
                  Running
                </span>
              ) : (
                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  No Instance
                </span>
              )}
              {!capabilities.hasSiteB && selectedIsInstance && (
                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  Single Site
                </span>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground mt-2">Loading instances...</p>
        ) : instances.length === 0 && !isAdmin ? (
          <div className="mt-2">
            <p className="text-sm text-muted-foreground">
              No running instances found. Environment links will appear here when an instance is deployed.
            </p>
          </div>
        ) : instances.length === 0 && isAdmin ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              No running instances found. Deploy an instance to see environment links here.
            </p>
            {nonRunning.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Available configurations (no running instance):
                </p>
                {nonRunning.map((cfg) => (
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
                      <span className="font-medium text-sm">{cfg.configId}</span>
                    </div>
                    {cfg.description && (
                      <p className="text-sm text-muted-foreground mt-1">{cfg.description}</p>
                    )}
                    {cfg.notes && (
                      <p className="text-xs text-muted-foreground mt-1 italic">{cfg.notes}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {instances.length > 0 && instances.map((cfg) => (
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
            {isAdmin && nonRunning.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground pt-2">
                  Other configurations (no running instance):
                </p>
                {nonRunning.map((cfg) => (
                  <button
                    key={cfg.configId}
                    onClick={() => setSelectedConfigId(cfg.configId)}
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      selectedConfigId === cfg.configId
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background/50 hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {cfg.description || cfg.configId}
                      </span>
                    </div>
                    {cfg.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Config: {cfg.configId}
                      </p>
                    )}
                    {cfg.notes && (
                      <p className="text-xs text-muted-foreground mt-1 italic">{cfg.notes}</p>
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Detected capabilities */}
        {!loading && selectedConfigId && (
          <div className="mt-3 flex flex-wrap gap-2">
            {capBadges
              .filter((b) => b.active)
              .map((b) => (
                <span
                  key={b.label}
                  className={`text-xs px-2 py-1 rounded-full ${b.color}`}
                >
                  {b.label}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Warning when viewing a non-running config */}
      {selectedConfig && !selectedIsInstance && selectedConfigId && (
        <div className="p-3 rounded-md bg-warning/10 border border-warning/30 text-warning text-sm">
          This configuration has no running instance. Environment links may not be reachable.
        </div>
      )}

      {/* Links */}
      {!loading && selectedConfigId && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {categories.filter(shouldShowCategory).map((category) => (
            <div
              key={category.label}
              className="bg-card border border-border rounded-lg p-4 space-y-3"
            >
              <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                {category.label}
              </h2>
              <div className="space-y-2">
                {category.links
                  .filter((link) => shouldShowLink(link.conditions))
                  .map((link) => (
                    <a
                      key={link.name}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-3 rounded-md bg-background/50 border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm group-hover:text-primary transition-colors">
                            {link.name}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {link.url}
                        </p>
                        {link.username && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            User: <span className="text-foreground/70">{link.username}</span>
                          </p>
                        )}
                      </div>
                      <span className="text-muted-foreground group-hover:text-primary ml-3 shrink-0 transition-colors">
                        ↗
                      </span>
                    </a>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !selectedConfigId && instances.length === 0 && !isAdmin && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">
            No running instances found. Contact an administrator to deploy an instance.
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Links are filtered based on components detected in the deployment configuration.
        {selectedConfig?.lastSynced && (
          <> Last synced: {new Date(selectedConfig.lastSynced).toLocaleString()}.</>
        )}
        {!isAdmin && " Only running instances are shown."}
        {isAdmin && " Admins can also browse non-running configurations."}
      </p>
    </div>
  );
}
