"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { CommandPreview } from "@/components/ui/command-preview";
import { useReservation } from "@/hooks/use-reservation";

type DeployMode = "vvf" | "management" | "fullstack" | "dualsite";

const modeDescriptions: Record<DeployMode, { label: string; description: string; time: string }> = {
  vvf: {
    label: "VVF",
    description: "Deploy VCF Foundation (VVF) only. Requires version 9.0+.",
    time: "~4-5 hours",
  },
  management: {
    label: "Management Domain Only",
    description: "Deploy management domain with 4 hosts. No workload domain.",
    time: "~4-6 hours",
  },
  fullstack: {
    label: "Full Stack",
    description: "Deploy management domain + workload domain with all components.",
    time: "~8-12+ hours",
  },
  dualsite: {
    label: "Dual Site",
    description: "Deploy Site A and Site B simultaneously. Requires network pre-configuration.",
    time: "~8-12+ hours per site",
  },
};

const vcfVersions = ["9.0.2.0", "9.0.1.0", "9.0.0.0", "5.2.2", "5.2.1", "5.2"];
const latestVersion = vcfVersions[0];
const vsanModes = ["ESA", "OSA"];
const logLevels = ["INFO", "DEBUG", "SUCCESS", "WARN", "ERROR"];

interface HoloDeckConfigSummary {
  id: string;
  configId: string;
  description: string;
  vcfVersion?: string;
  instance?: string;
  targetHost?: string;
  vsanMode?: string;
  depotType?: string;
  dnsDomain?: string;
}

interface DeployParams {
  mode: DeployMode;
  instanceId: string;
  version: string;
  site: string;
  vsanMode: string;
  depotType: string;
  dnsDomain: string;
  logLevel: string;
  // Flags
  nsxEdgeClusterMgmtDomain: boolean;
  nsxEdgeClusterWkldDomain: boolean;
  deployVcfAutomation: boolean;
  deploySupervisorMgmtDomain: boolean;
  deploySupervisorWldDomain: boolean;
  workloadDomainType: string;
  provisionOnly: boolean;
  // VMware infrastructure
  datastoreName: string;
  trunkPortGroupName: string;
  trunkPortGroupNameSiteB: string;
  clusterName: string;
  dcName: string;
  // Advanced
  cidr: string;
  vlanRangeStart: string;
  // Dual-site
  siteBCidr: string;
  siteBVlanRangeStart: string;
}

const defaultParams: DeployParams = {
  mode: "management",
  instanceId: "",
  version: latestVersion,
  site: "a",
  vsanMode: "OSA",
  depotType: "Offline",
  dnsDomain: "",
  logLevel: "INFO",
  nsxEdgeClusterMgmtDomain: false,
  nsxEdgeClusterWkldDomain: false,
  deployVcfAutomation: false,
  deploySupervisorMgmtDomain: false,
  deploySupervisorWldDomain: false,
  workloadDomainType: "",
  provisionOnly: false,
  datastoreName: "",
  trunkPortGroupName: "",
  trunkPortGroupNameSiteB: "",
  clusterName: "",
  dcName: "",
  cidr: "",
  vlanRangeStart: "",
  siteBCidr: "",
  siteBVlanRangeStart: "",
};

export default function DeployPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { reservation } = useReservation();
  const [step, setStep] = useState(0); // 0=config, 1=mode, 2=params, 3=options, 4=review
  const [params, setParams] = useState<DeployParams>(defaultParams);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const [sshConfigured, setSshConfigured] = useState<boolean | null>(null);
  const [notifyEmail, setNotifyEmail] = useState(false);

  // Config selection
  const [configs, setConfigs] = useState<HoloDeckConfigSummary[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>("");
  const [loadingConfigs, setLoadingConfigs] = useState(true);

  // Binary check for selected VCF version
  const [binCheck, setBinCheck] = useState<{ found: boolean; fileCount: number; files: string[] } | null>(null);
  const [binCheckLoading, setBinCheckLoading] = useState(false);

  // VMware inventory
  const [inventory, setInventory] = useState<{
    datastores: string[];
    networks: string[];
    clusters: string[];
    datacenters: string[];
  } | null>(null);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [inventoryError, setInventoryError] = useState("");

  useEffect(() => {
    fetch("/api/config/ssh-status")
      .then((r) => r.json())
      .then((data) => setSshConfigured(data.configured))
      .catch(() => setSshConfigured(false));

    fetch("/api/holodeck-configs")
      .then((r) => r.json())
      .then((data) => {
        const cfgs = data.configs || [];
        setConfigs(cfgs);
        // Auto-select first config (or first with a running instance)
        const running = cfgs.find((c: HoloDeckConfigSummary) => c.instance);
        if (running) {
          setSelectedConfigId(running.configId);
        } else if (cfgs.length > 0) {
          setSelectedConfigId(cfgs[0].configId);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConfigs(false));
  }, []);

  // Fetch full config details when selection changes (pre-populate params)
  const fetchConfigDetails = useCallback(async (configId: string) => {
    if (!configId) return;
    try {
      const res = await fetch(`/api/holodeck-configs/${encodeURIComponent(configId)}`);
      const data = await res.json();
      if (res.ok) {
        const s = data.deploymentSettings || {};
        setParams((p) => ({
          ...p,
          version: s.vcfVersion || p.version,
          vsanMode: s.vsanMode || p.vsanMode,
          depotType: s.depotType || p.depotType,
          dnsDomain: s.dnsDomain || p.dnsDomain,
          datastoreName: s.datastoreName || p.datastoreName,
          trunkPortGroupName: s.trunkPortGroupName || p.trunkPortGroupName,
          clusterName: s.clusterName || p.clusterName,
          dcName: s.dcName || p.dcName,
        }));
      }
    } catch {
      // ignore
    }
    // Reset inventory when config changes
    setInventory(null);
    setInventoryError("");
  }, []);

  const fetchInventory = useCallback(async (configId: string) => {
    setLoadingInventory(true);
    setInventoryError("");
    try {
      const res = await fetch(`/api/holodeck-configs/${encodeURIComponent(configId)}/inventory`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load inventory");
      setInventory(data);
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : "Failed to load inventory");
    } finally {
      setLoadingInventory(false);
    }
  }, []);

  useEffect(() => {
    if (selectedConfigId) {
      fetchConfigDetails(selectedConfigId);
    }
  }, [selectedConfigId, fetchConfigDetails]);

  // Check for binaries when version changes
  useEffect(() => {
    if (!params.version || sshConfigured === false) return;
    setBinCheckLoading(true);
    setBinCheck(null);
    fetch(`/api/config/check-binaries?version=${encodeURIComponent(params.version)}`)
      .then((r) => r.json())
      .then((data) => setBinCheck({ found: data.found, fileCount: data.fileCount, files: data.files || [] }))
      .catch(() => setBinCheck(null))
      .finally(() => setBinCheckLoading(false));
  }, [params.version, sshConfigured]);

  const set = (updates: Partial<DeployParams>) =>
    setParams((p) => ({ ...p, ...updates }));

  const selectedConfig = configs.find((c) => c.configId === selectedConfigId);
  const canProceedStep0 = !!selectedConfigId;
  const canProceedStep1 = !!params.mode;
  const canProceedStep2 = !!params.instanceId && /^[a-zA-Z0-9]+$/.test(params.instanceId) && params.instanceId.length <= 8;

  const handleLaunch = async () => {
    setLaunching(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        mode: params.mode,
        instanceId: params.instanceId,
        site: params.site,
        configId: selectedConfigId || undefined,
        notifyEmail: notifyEmail || undefined,
      };

      if (params.version) body.version = params.version;
      if (params.vsanMode) body.vsanMode = params.vsanMode;
      if (params.depotType) body.depotType = params.depotType;
      if (params.dnsDomain) body.dnsDomain = params.dnsDomain;
      if (params.logLevel !== "INFO") body.logLevel = params.logLevel;
      if (params.nsxEdgeClusterMgmtDomain) body.nsxEdgeClusterMgmtDomain = true;
      if (params.nsxEdgeClusterWkldDomain) body.nsxEdgeClusterWkldDomain = true;
      if (params.deployVcfAutomation) body.deployVcfAutomation = true;
      if (params.deploySupervisorMgmtDomain) body.deploySupervisorMgmtDomain = true;
      if (params.deploySupervisorWldDomain) body.deploySupervisorWldDomain = true;
      if (params.provisionOnly) body.provisionOnly = true;
      if (params.workloadDomainType) body.workloadDomainType = params.workloadDomainType;
      if (params.datastoreName) body.datastoreName = params.datastoreName;
      if (params.trunkPortGroupName) body.trunkPortGroupName = params.trunkPortGroupName;
      if (params.trunkPortGroupNameSiteB) body.trunkPortGroupNameSiteB = params.trunkPortGroupNameSiteB;
      if (params.clusterName) body.clusterName = params.clusterName;
      if (params.dcName) body.dcName = params.dcName;
      if (params.cidr) body.cidr = params.cidr.split(",").map((s) => s.trim());
      if (params.vlanRangeStart) body.vlanRangeStart = params.vlanRangeStart.split(",").map((s) => parseInt(s.trim(), 10));
      if (params.siteBCidr) body.siteBCidr = params.siteBCidr.split(",").map((s) => s.trim());
      if (params.siteBVlanRangeStart) body.siteBVlanRangeStart = params.siteBVlanRangeStart.split(",").map((s) => parseInt(s.trim(), 10));

      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start deployment");
      }

      router.push("/dashboard/deployments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start deployment");
    } finally {
      setLaunching(false);
    }
  };

  const buildCommandPreview = (): string => {
    const lines: string[] = [];

    // DeveloperMode env vars
    const envLines: string[] = [];
    if (params.datastoreName) envLines.push(`$env:datastore_name = "${params.datastoreName}"`);
    if (params.trunkPortGroupName) envLines.push(`$env:trunk_port_group_name = "${params.trunkPortGroupName}"`);
    if (params.trunkPortGroupNameSiteB) envLines.push(`$env:trunk_port_group_name_b = "${params.trunkPortGroupNameSiteB}"`);
    if (params.clusterName) envLines.push(`$env:cluster_name = "${params.clusterName}"`);
    if (params.dcName) envLines.push(`$env:dc_name = "${params.dcName}"`);
    if (envLines.length > 0) lines.push(envLines.join("\n"));

    if (selectedConfigId) {
      lines.push(`Import-HoloDeckConfig -ConfigID '${selectedConfigId}'`);
    }
    const parts = ["New-HoloDeckInstance"];
    if (params.version) parts.push(`-Version '${params.version}'`);
    parts.push(`-InstanceID '${params.instanceId}'`);
    parts.push(`-Site '${params.site}'`);
    if (params.vsanMode) parts.push(`-vSANMode '${params.vsanMode}'`);
    if (params.depotType) parts.push(`-DepotType '${params.depotType}'`);
    if (params.dnsDomain) parts.push(`-DNSDomain '${params.dnsDomain}'`);
    parts.push("-DeveloperMode");

    if (params.mode === "vvf") parts.push("-VVF");
    if (params.mode === "management") parts.push("-ManagementOnly");
    if (params.nsxEdgeClusterMgmtDomain) parts.push("-NsxEdgeClusterMgmtDomain");
    if (params.nsxEdgeClusterWkldDomain) parts.push("-NsxEdgeClusterWkldDomain");
    if (params.deployVcfAutomation) parts.push("-DeployVcfAutomation");
    if (params.deploySupervisorMgmtDomain) parts.push("-DeploySupervisorMgmtDomain");
    if (params.deploySupervisorWldDomain) parts.push("-DeploySupervisorWldDomain");
    if (params.provisionOnly) parts.push("-ProvisionOnly");
    if (params.workloadDomainType) parts.push(`-WorkloadDomainType '${params.workloadDomainType}'`);
    if (params.logLevel !== "INFO") parts.push(`-LogLevel '${params.logLevel}'`);
    if (params.cidr) parts.push(`-CIDR '${params.cidr}'`);
    if (params.vlanRangeStart) parts.push(`-VLANRangeStart ${params.vlanRangeStart}`);

    lines.push(parts.join(" \\\n  "));
    return lines.join("\n\n");
  };

  const needsReservation = user?.role === "labadmin" && !reservation;

  if (sshConfigured === false) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">New Deployment</h1>
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6 text-center space-y-3">
          <p className="text-destructive font-medium">
            SSH connection not configured
          </p>
          <p className="text-sm text-muted-foreground">
            A Super Admin must configure the holorouter connection in Global Config before deployments can be started.
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

  const stepLabels = ["Config", "Mode", "Parameters", "Options", "Review"];

  const effectiveStep = step;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Deployment</h1>
        <p className="text-muted-foreground mt-1">
          Deploy a new Holodeck VCF environment. This process runs in the background on the holorouter.
        </p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 text-sm">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground">—</span>}
            <button
              onClick={() => i < step && setStep(i)}
              className={`px-3 py-1 rounded-full transition-colors ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                  ? "bg-primary/20 text-primary cursor-pointer hover:bg-primary/30"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {label}
            </button>
          </div>
        ))}
      </div>

      {needsReservation && (
        <div className="p-3 rounded-md bg-warning/10 border border-warning/30 text-warning text-sm">
          You need an active reservation to start a deployment. Book a time slot on the Reservations page first.
        </div>
      )}

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      {/* Step 0: Config Selection */}
      {effectiveStep === 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-lg">Select Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Choose a Holodeck configuration from the holorouter. This determines the target host,
            VCF version, and other deployment settings.
          </p>

          {loadingConfigs ? (
            <div className="bg-card border border-border rounded-lg p-6 text-center">
              <p className="text-muted-foreground">Loading configurations...</p>
            </div>
          ) : configs.length === 0 ? (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-6 text-center space-y-3">
              <p className="text-warning font-medium">No configurations found</p>
              <p className="text-sm text-muted-foreground">
                A Holodeck configuration must exist on the holorouter before you can deploy.
                Create one from the Holodeck Configs page first.
              </p>
              {(user?.role === "superadmin" || user?.role === "labadmin") && (
                <button
                  onClick={() => router.push("/dashboard/admin/holodeck-configs")}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90"
                >
                  Go to Holodeck Configs
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {configs.map((cfg) => (
                <button
                  key={cfg.configId}
                  onClick={() => setSelectedConfigId(cfg.configId)}
                  className={`w-full p-4 rounded-lg border text-left transition-colors ${
                    selectedConfigId === cfg.configId
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{cfg.configId}</p>
                      {cfg.description && (
                        <p className="text-sm text-muted-foreground mt-0.5">{cfg.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {cfg.instance && (
                        <span className="text-xs px-2 py-1 rounded-full bg-success/20 text-success">Running</span>
                      )}
                    </div>
                  </div>
                  {(cfg.vcfVersion || cfg.targetHost || cfg.vsanMode) && (
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      {cfg.vcfVersion && <span>VCF {cfg.vcfVersion}</span>}
                      {cfg.targetHost && <span>Host: {cfg.targetHost}</span>}
                      {cfg.vsanMode && <span>vSAN: {cfg.vsanMode}</span>}
                      {cfg.depotType && <span>Depot: {cfg.depotType}</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}


          <div className="flex justify-end">
            <button
              onClick={() => setStep(1)}
              disabled={!canProceedStep0}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Mode Selection */}
      {effectiveStep === 1 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-lg">Select Deployment Mode</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(Object.entries(modeDescriptions) as [DeployMode, typeof modeDescriptions[DeployMode]][]).map(
              ([key, info]) => (
                <button
                  key={key}
                  onClick={() => set({ mode: key })}
                  className={`p-4 rounded-lg border text-left transition-colors ${
                    params.mode === key
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <p className="font-semibold">{info.label}</p>
                  <p className="text-sm text-muted-foreground mt-1">{info.description}</p>
                  <p className="text-xs text-warning mt-2">Est. {info.time}</p>
                </button>
              )
            )}
          </div>
          <div className="flex justify-between">
            {configs.length > 0 && (
              <button onClick={() => setStep(0)} className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md font-medium hover:opacity-90">
                Back
              </button>
            )}
            <div className={configs.length === 0 ? "ml-auto" : ""}>
              <button
                onClick={() => setStep(configs.length > 0 ? 2 : 1)}
                disabled={!canProceedStep1}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Core Parameters */}
      {effectiveStep === 2 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-lg">Core Parameters</h2>

          {selectedConfig && (
            <div className="p-3 rounded-md bg-primary/5 border border-primary/20 text-sm">
              Using config: <span className="font-medium">{selectedConfig.configId}</span>
              {selectedConfig.description && <span className="text-muted-foreground"> — {selectedConfig.description}</span>}
            </div>
          )}

          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Instance ID *</label>
              <input
                type="text"
                value={params.instanceId}
                onChange={(e) => set({ instanceId: e.target.value })}
                maxLength={8}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                placeholder="e.g. mylab01"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Unique prefix for nested VMs. Alphanumeric only, max 8 characters.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                VCF Version
                {params.version && selectedConfig?.vcfVersion && params.version !== selectedConfig.vcfVersion && (
                  <span className="text-xs text-warning ml-2">(overriding config default: {selectedConfig.vcfVersion})</span>
                )}
              </label>
              <select
                value={params.version}
                onChange={(e) => set({ version: e.target.value })}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
              >
                {vcfVersions.map((v) => (
                  <option key={v} value={v}>{v}{v === latestVersion ? " (latest)" : ""}</option>
                ))}
              </select>
              {binCheckLoading && (
                <p className="text-xs text-muted-foreground mt-1">Checking for binaries on holorouter...</p>
              )}
              {!binCheckLoading && binCheck && binCheck.found && (
                <p className="text-xs text-green-400 mt-1">
                  ✓ Found {binCheck.fileCount} file{binCheck.fileCount !== 1 ? "s" : ""} in /holodeck-runtime/bin/{params.version}/
                </p>
              )}
              {!binCheckLoading && binCheck && !binCheck.found && (
                <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-md">
                  <p className="text-sm text-red-400 font-medium">
                    ⚠ No binaries found in /holodeck-runtime/bin/{params.version}/
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    ESX ISO and VCF Installer OVA must be staged on the holorouter before deploying.
                    Upload them to <code className="text-red-400/80">/holodeck-runtime/bin/{params.version}/</code> via SCP or the holorouter webtop.
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">vSAN Mode</label>
                <select
                  value={params.vsanMode}
                  onChange={(e) => set({ vsanMode: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-md"
                >
                  <option value="">Select mode</option>
                  {vsanModes.map((v) => (
                    <option key={v} value={v}>{v}{v === "OSA" ? " (recommended)" : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Depot Type</label>
                <select
                  value={params.depotType}
                  onChange={(e) => set({ depotType: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-md"
                >
                  <option value="">Select type</option>
                  <option value="Online">Online</option>
                  <option value="Offline">Offline (recommended)</option>
                </select>
              </div>
            </div>

            {params.mode === "dualsite" && (
              <div>
                <label className="block text-sm font-medium mb-1">Site</label>
                <p className="text-xs text-muted-foreground">
                  Dual-site mode will deploy both Site A and Site B simultaneously.
                </p>
              </div>
            )}

            {params.mode !== "dualsite" && (
              <div>
                <label className="block text-sm font-medium mb-1">Site</label>
                <select
                  value={params.site}
                  onChange={(e) => set({ site: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-border rounded-md"
                >
                  <option value="a">Site A</option>
                  <option value="b">Site B</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(configs.length > 0 ? 1 : 0)} className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md font-medium hover:opacity-90">
              Back
            </button>
            <button
              onClick={() => setStep(configs.length > 0 ? 3 : 2)}
              disabled={!canProceedStep2}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Optional Flags */}
      {effectiveStep === 3 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-lg">Deployment Options</h2>

          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Components</h3>

            {(params.mode === "management" || params.mode === "fullstack" || params.mode === "dualsite") && (
              <>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.nsxEdgeClusterMgmtDomain}
                    onChange={(e) => set({ nsxEdgeClusterMgmtDomain: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <div>
                    <p className="text-sm font-medium">NSX Edge Cluster (Management Domain)</p>
                    <p className="text-xs text-muted-foreground">Deploy 2-node NSX Edge cluster in management</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.deployVcfAutomation}
                    onChange={(e) => set({ deployVcfAutomation: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <div>
                    <p className="text-sm font-medium">VCF Automation</p>
                    <p className="text-xs text-muted-foreground">Deploy Aria Automation suite (9.0+ only)</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.deploySupervisorMgmtDomain}
                    onChange={(e) => set({ deploySupervisorMgmtDomain: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <div>
                    <p className="text-sm font-medium">Supervisor (Management Domain)</p>
                    <p className="text-xs text-muted-foreground">Deploy Kubernetes Supervisor in management domain</p>
                  </div>
                </label>
              </>
            )}

            {(params.mode === "fullstack" || params.mode === "dualsite") && (
              <>
                <div className="border-t border-border pt-4 mt-2">
                  <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider mb-3">Workload Domain</h3>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">SSO Configuration</label>
                  <select
                    value={params.workloadDomainType}
                    onChange={(e) => set({ workloadDomainType: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                  >
                    <option value="">Default (none)</option>
                    <option value="SharedSSO">Shared SSO</option>
                    <option value="IsolatedSSO">Isolated SSO</option>
                  </select>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.nsxEdgeClusterWkldDomain}
                    onChange={(e) => set({ nsxEdgeClusterWkldDomain: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <div>
                    <p className="text-sm font-medium">NSX Edge Cluster (Workload Domain)</p>
                    <p className="text-xs text-muted-foreground">Deploy NSX Edge in workload domain</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.deploySupervisorWldDomain}
                    onChange={(e) => set({ deploySupervisorWldDomain: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <div>
                    <p className="text-sm font-medium">Supervisor (Workload Domain)</p>
                    <p className="text-xs text-muted-foreground">Deploy Kubernetes Supervisor in workload (9.0+ only)</p>
                  </div>
                </label>
              </>
            )}

            <div className="border-t border-border pt-4 mt-2">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider mb-3">VMware Infrastructure</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Select the datastore, network, and cluster for nested VM placement. Load inventory from the target host to populate dropdowns.
              </p>
            </div>

            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={() => selectedConfigId && fetchInventory(selectedConfigId)}
                disabled={loadingInventory || !selectedConfigId}
                className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {loadingInventory ? "Loading Inventory..." : inventory ? "Refresh Inventory" : "Load VMware Inventory"}
              </button>
              {inventory && (
                <span className="text-xs text-success">
                  {inventory.datastores.length} datastores, {inventory.networks.length} networks
                  {inventory.clusters.length > 0 && `, ${inventory.clusters.length} clusters`}
                </span>
              )}
              {inventoryError && (
                <span className="text-xs text-destructive">{inventoryError}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Datastore</label>
                {inventory && inventory.datastores.length > 0 ? (
                  <select
                    value={params.datastoreName}
                    onChange={(e) => set({ datastoreName: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                  >
                    <option value="">Select datastore</option>
                    {inventory.datastores.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={params.datastoreName}
                    onChange={(e) => set({ datastoreName: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                    placeholder="Load inventory or type name"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Trunk Port Group</label>
                {inventory && inventory.networks.length > 0 ? (
                  <select
                    value={params.trunkPortGroupName}
                    onChange={(e) => set({ trunkPortGroupName: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                  >
                    <option value="">Select network</option>
                    {inventory.networks.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={params.trunkPortGroupName}
                    onChange={(e) => set({ trunkPortGroupName: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                    placeholder="Load inventory or type name"
                  />
                )}
              </div>
              {params.mode === "dualsite" && (
                <div>
                  <label className="block text-sm font-medium mb-1">Trunk Port Group (Site B)</label>
                  {inventory && inventory.networks.length > 0 ? (
                    <select
                      value={params.trunkPortGroupNameSiteB}
                      onChange={(e) => set({ trunkPortGroupNameSiteB: e.target.value })}
                      className="w-full px-3 py-2 bg-input border border-border rounded-md"
                    >
                      <option value="">Select network</option>
                      {inventory.networks.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={params.trunkPortGroupNameSiteB}
                      onChange={(e) => set({ trunkPortGroupNameSiteB: e.target.value })}
                      className="w-full px-3 py-2 bg-input border border-border rounded-md"
                      placeholder="Load inventory or type name"
                    />
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Cluster</label>
                {inventory && inventory.clusters.length > 0 ? (
                  <select
                    value={params.clusterName}
                    onChange={(e) => set({ clusterName: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                  >
                    <option value="">Select cluster</option>
                    {inventory.clusters.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={params.clusterName}
                    onChange={(e) => set({ clusterName: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                    placeholder="Load inventory or type name"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Datacenter</label>
                {inventory && inventory.datacenters.length > 0 ? (
                  <select
                    value={params.dcName}
                    onChange={(e) => set({ dcName: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                  >
                    <option value="">Select datacenter</option>
                    {inventory.datacenters.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={params.dcName}
                    onChange={(e) => set({ dcName: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                    placeholder="Load inventory or type name"
                  />
                )}
              </div>
            </div>

            <div className="border-t border-border pt-4 mt-2">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider mb-3">Advanced</h3>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={params.provisionOnly}
                onChange={(e) => set({ provisionOnly: e.target.checked })}
                className="w-4 h-4"
              />
              <div>
                <p className="text-sm font-medium">Provision Only</p>
                <p className="text-xs text-muted-foreground">Deploy hosts and installer only — skip full VCF deployment</p>
              </div>
            </label>

            <div>
              <label className="block text-sm font-medium mb-1">DNS Domain</label>
              <input
                type="text"
                value={params.dnsDomain}
                onChange={(e) => set({ dnsDomain: e.target.value })}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                placeholder="vcf.lab"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Log Level</label>
              <select
                value={params.logLevel}
                onChange={(e) => set({ logLevel: e.target.value })}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
              >
                {logLevels.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Custom CIDR</label>
              <input
                type="text"
                value={params.cidr}
                onChange={(e) => set({ cidr: e.target.value })}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                placeholder="e.g. 10.1.0.0/20,10.2.0.0/20 (default)"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Custom VLAN Range Start</label>
              <input
                type="text"
                value={params.vlanRangeStart}
                onChange={(e) => set({ vlanRangeStart: e.target.value })}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                placeholder="e.g. 10,40 (default)"
              />
            </div>

            {params.mode === "dualsite" && (
              <>
                <div className="border-t border-border pt-4 mt-2">
                  <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider mb-3">Site B Network</h3>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Site B CIDR</label>
                  <input
                    type="text"
                    value={params.siteBCidr}
                    onChange={(e) => set({ siteBCidr: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                    placeholder="e.g. 10.2.0.0/20 (default)"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Site B VLAN Range Start</label>
                  <input
                    type="text"
                    value={params.siteBVlanRangeStart}
                    onChange={(e) => set({ siteBVlanRangeStart: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                    placeholder="e.g. 40 (default)"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(configs.length > 0 ? 2 : 1)} className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md font-medium hover:opacity-90">
              Back
            </button>
            <button
              onClick={() => setStep(configs.length > 0 ? 4 : 3)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90"
            >
              Review
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Launch */}
      {effectiveStep === 4 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-lg">Review & Launch</h2>

          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            {selectedConfig && (
              <div>
                <p className="text-muted-foreground text-sm">Configuration</p>
                <p className="font-medium">
                  {selectedConfig.configId}
                  {selectedConfig.description && <span className="text-muted-foreground"> — {selectedConfig.description}</span>}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Mode</p>
                <p className="font-medium">{modeDescriptions[params.mode].label}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Instance ID</p>
                <p className="font-medium">{params.instanceId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Version</p>
                <p className="font-medium">{params.version || selectedConfig?.vcfVersion || "(default)"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Site</p>
                <p className="font-medium">{params.mode === "dualsite" ? "A + B" : `Site ${params.site.toUpperCase()}`}</p>
              </div>
              <div>
                <p className="text-muted-foreground">vSAN Mode</p>
                <p className="font-medium">{params.vsanMode || selectedConfig?.vsanMode || "(default)"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Depot</p>
                <p className="font-medium">{params.depotType || selectedConfig?.depotType || "(default)"}</p>
              </div>
            </div>

            {/* Infrastructure */}
            {(params.datastoreName || params.trunkPortGroupName || params.clusterName || params.dcName) && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                {params.datastoreName && (
                  <div>
                    <p className="text-muted-foreground">Datastore</p>
                    <p className="font-medium">{params.datastoreName}</p>
                  </div>
                )}
                {params.trunkPortGroupName && (
                  <div>
                    <p className="text-muted-foreground">Trunk Port Group{params.mode === "dualsite" ? " (Site A)" : ""}</p>
                    <p className="font-medium">{params.trunkPortGroupName}</p>
                  </div>
                )}
                {params.trunkPortGroupNameSiteB && (
                  <div>
                    <p className="text-muted-foreground">Trunk Port Group (Site B)</p>
                    <p className="font-medium">{params.trunkPortGroupNameSiteB}</p>
                  </div>
                )}
                {params.clusterName && (
                  <div>
                    <p className="text-muted-foreground">Cluster</p>
                    <p className="font-medium">{params.clusterName}</p>
                  </div>
                )}
                {params.dcName && (
                  <div>
                    <p className="text-muted-foreground">Datacenter</p>
                    <p className="font-medium">{params.dcName}</p>
                  </div>
                )}
              </div>
            )}

            {/* Active flags */}
            <div>
              <p className="text-sm text-muted-foreground mb-2">Components</p>
              <div className="flex flex-wrap gap-2">
                {params.nsxEdgeClusterMgmtDomain && (
                  <span className="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400">NSX Edge (Mgmt)</span>
                )}
                {params.nsxEdgeClusterWkldDomain && (
                  <span className="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400">NSX Edge (Wkld)</span>
                )}
                {params.deployVcfAutomation && (
                  <span className="text-xs px-2 py-1 rounded-full bg-purple-500/20 text-purple-400">VCF Automation</span>
                )}
                {params.deploySupervisorMgmtDomain && (
                  <span className="text-xs px-2 py-1 rounded-full bg-teal-500/20 text-teal-400">Supervisor (Mgmt)</span>
                )}
                {params.deploySupervisorWldDomain && (
                  <span className="text-xs px-2 py-1 rounded-full bg-teal-500/20 text-teal-400">Supervisor (Wkld)</span>
                )}
                {params.provisionOnly && (
                  <span className="text-xs px-2 py-1 rounded-full bg-warning/20 text-warning">Provision Only</span>
                )}
                {!params.nsxEdgeClusterMgmtDomain && !params.deployVcfAutomation && !params.deploySupervisorMgmtDomain && !params.provisionOnly && (
                  <span className="text-xs text-muted-foreground">Base deployment only</span>
                )}
              </div>
            </div>
          </div>

          {/* Command preview */}
          <CommandPreview command={buildCommandPreview()} />

          {user?.email && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">Notify me by email when this deployment completes or fails</span>
              <span className="text-xs text-muted-foreground">({user.email})</span>
            </label>
          )}

          <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
            <p className="text-sm text-warning font-medium">
              This deployment will take {modeDescriptions[params.mode].time} to complete.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              The process runs in a tmux session on the holorouter. You can safely close your browser
              and return to monitor progress at any time.
            </p>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(configs.length > 0 ? 3 : 2)} className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md font-medium hover:opacity-90">
              Back
            </button>
            <button
              onClick={handleLaunch}
              disabled={launching || needsReservation}
              className="px-6 py-2 bg-success text-white rounded-md font-medium hover:opacity-90 disabled:opacity-50"
            >
              {launching ? "Starting Deployment..." : needsReservation ? "Reservation Required" : "Launch Deployment"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}