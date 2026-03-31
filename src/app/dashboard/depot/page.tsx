"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface DepotComponent {
  files: string[];
  totalSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// Expected components for a VCF install
const EXPECTED_COMPONENTS: { key: string; label: string }[] = [
  { key: "ESX_HOST", label: "ESXi Host" },
  { key: "VCENTER", label: "vCenter Server" },
  { key: "SDDC_MANAGER_VCF", label: "SDDC Manager" },
  { key: "NSX_T_MANAGER", label: "NSX Manager" },
  { key: "VRSLCM", label: "VCF Operations Lifecycle Manager" },
  { key: "VROPS", label: "VCF Operations (vROps)" },
  { key: "VRA", label: "VCF Automation (vRA)" },
  { key: "VCF_OPS_CLOUD_PROXY", label: "Operations Cloud Proxy" },
];

export default function DepotPage() {
  // Depot component map
  const [components, setComponents] = useState<Record<string, DepotComponent>>({});
  const [hasMetadata, setHasMetadata] = useState(false);
  const [hasVsanHcl, setHasVsanHcl] = useState(false);
  const [totalSize, setTotalSize] = useState("");

  // Check state
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [scanError, setScanError] = useState("");
  const [listOutput, setListOutput] = useState("");
  const [listError, setListError] = useState("");
  const [listSuccess, setListSuccess] = useState(false);

  // Download session
  const [downloading, setDownloading] = useState(false);
  const [downloadOutput, setDownloadOutput] = useState("");
  const [downloadAlive, setDownloadAlive] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  // Cleanup
  const [cleanupVersion, setCleanupVersion] = useState("");
  const [cleanupFiles, setCleanupFiles] = useState<string[]>([]);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupScanned, setCleanupScanned] = useState(false);
  const [cleanupDeleting, setCleanupDeleting] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState("");

  // Config
  const [vcfVersion, setVcfVersion] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Load VCF version from global config
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        const configs = data.configs || [];
        const ver = configs.find((c: { key: string }) => c.key === "vcf_version");
        if (ver) setVcfVersion(ver.value);
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  }, []);

  // Check for existing download session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/depot?action=status&session=depot-download");
        const data = await res.json();
        const output = (data.output || "").trim();
        if (output && output !== "[session ended]") {
          setDownloadAlive(data.alive);
          setDownloadOutput(output);
          setDownloading(true);
        }
      } catch {}
    };
    checkSession();
  }, []);

  // Scan depot
  const scanDepot = useCallback(async () => {
    try {
      const res = await fetch(`/api/depot?version=${encodeURIComponent(vcfVersion)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to scan depot");
      setComponents(data.components || {});
      setHasMetadata(data.hasMetadata || false);
      setHasVsanHcl(data.hasVsanHcl || false);
      setTotalSize(data.totalSize || "");
      setScanError("");
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Failed to connect to depot");
    }
  }, [vcfVersion]);

  // Poll download status
  useEffect(() => {
    if (!downloading) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/depot?action=status&session=depot-download");
        const data = await res.json();
        setDownloadOutput(data.output || "");
        setDownloadAlive(data.alive);
        if (!data.alive) {
          scanDepot();
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [downloading, scanDepot]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [downloadOutput]);

  // Check Available — single SSH call: scans depot AND queries Broadcom
  const handleCheckAvailable = async () => {
    setChecking(true);
    setScanError("");
    setListError("");
    setListOutput("");
    setListSuccess(false);
    setChecked(false);

    try {
      const res = await fetch(`/api/depot?action=check&version=${encodeURIComponent(vcfVersion)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check depot");

      setComponents(data.components || {});
      setHasMetadata(data.hasMetadata || false);
      setHasVsanHcl(data.hasVsanHcl || false);
      setTotalSize(data.totalSize || "");
      setListOutput(data.listOutput || "");
      setListSuccess(data.listSuccess || false);

      if (!data.listSuccess) {
        setListError("Broadcom list check returned errors — see output below");
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Failed to check depot");
    }

    setChecked(true);
    setChecking(false);
  };

  // Count missing components
  const missingComponents = EXPECTED_COMPONENTS.filter((c) => !components[c.key]);
  const presentComponents = EXPECTED_COMPONENTS.filter((c) => components[c.key]);

  // Start download
  const handleDownload = async () => {
    const missingList = missingComponents.map((c) => `  - ${c.label}`).join("\n");
    const extras = [];
    if (!hasMetadata) extras.push("  - Metadata");
    if (!hasVsanHcl) extras.push("  - vSAN HCL Data");
    const allMissing = missingList + (extras.length ? "\n" + extras.join("\n") : "");

    if (!confirm(`Download missing VCF ${vcfVersion} binaries to the depot?\n\nMissing:\n${allMissing || "  (none — all components present)"}\n\nThe download tool will skip files already present. This may take a long time.`)) {
      return;
    }
    try {
      const res = await fetch("/api/depot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", vcfVersion }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start download");
      setDownloading(true);
      setDownloadAlive(true);
      setDownloadOutput("Starting download...\n");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start download");
    }
  };

  // Kill download session
  const handleKillDownload = async () => {
    if (!confirm("Cancel the running download?")) return;
    try {
      await fetch("/api/depot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", session: "depot-download" }),
      });
      setDownloadAlive(false);
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Offline Depot Appliance (ODA) Management</h1>
        <p className="text-muted-foreground mt-1">
          Manage VCF binaries on the offline depot appliance using the VCF Download Tool
        </p>
      </div>

      {/* Check Available */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="font-semibold mb-3">Check Depot Status</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={vcfVersion}
            onChange={(e) => { setVcfVersion(e.target.value); setChecked(false); }}
            placeholder={loadingConfig ? "Loading..." : "e.g. 9.0.2"}
            className="px-3 py-2 bg-input border border-border rounded-md text-sm w-48"
          />
          <button
            onClick={handleCheckAvailable}
            disabled={checking || !vcfVersion}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
          >
            {checking ? "Checking..." : "Check Available"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Scans the depot appliance and queries Broadcom to show what&apos;s needed vs what&apos;s on hand.
        </p>
      </div>

      {/* Component Checklist */}
      {checked && !scanError && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">Depot Status for VCF {vcfVersion}</h2>
              {totalSize && (
                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  Total on depot: {totalSize}
                </span>
              )}
            </div>
            {missingComponents.length > 0 && listSuccess && (
              <button
                onClick={handleDownload}
                disabled={(downloading && downloadAlive) || !vcfVersion}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
              >
                Download {missingComponents.length + (!hasMetadata ? 1 : 0) + (!hasVsanHcl ? 1 : 0)} Missing
              </button>
            )}
            {missingComponents.length > 0 && !listSuccess && (
              <span className="text-xs px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400">
                Broadcom check failed — cannot download
              </span>
            )}
            {missingComponents.length === 0 && hasMetadata && hasVsanHcl && (
              <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400">
                All components present
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {EXPECTED_COMPONENTS.map((comp) => {
              const depotComp = components[comp.key];
              const present = !!depotComp;
              return (
                <div
                  key={comp.key}
                  className={`flex items-center justify-between px-3 py-2 rounded-md text-sm ${
                    present
                      ? "bg-green-500/10 border border-green-500/20"
                      : "bg-red-500/10 border border-red-500/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{present ? "✓" : "✗"}</span>
                    <span className={present ? "text-green-400" : "text-red-400"}>
                      {comp.label}
                    </span>
                  </div>
                  {present && (
                    <span className="text-xs text-muted-foreground">
                      {depotComp.files.length} file{depotComp.files.length !== 1 ? "s" : ""} &middot; {formatBytes(depotComp.totalSize)}
                    </span>
                  )}
                  {!present && (
                    <span className="text-xs text-red-400/70">Missing</span>
                  )}
                </div>
              );
            })}

            {/* Metadata & vSAN HCL */}
            <div
              className={`flex items-center justify-between px-3 py-2 rounded-md text-sm ${
                hasMetadata
                  ? "bg-green-500/10 border border-green-500/20"
                  : "bg-red-500/10 border border-red-500/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{hasMetadata ? "✓" : "✗"}</span>
                <span className={hasMetadata ? "text-green-400" : "text-red-400"}>
                  Metadata / Manifest
                </span>
              </div>
              {!hasMetadata && <span className="text-xs text-red-400/70">Missing</span>}
            </div>
            <div
              className={`flex items-center justify-between px-3 py-2 rounded-md text-sm ${
                hasVsanHcl
                  ? "bg-green-500/10 border border-green-500/20"
                  : "bg-red-500/10 border border-red-500/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{hasVsanHcl ? "✓" : "✗"}</span>
                <span className={hasVsanHcl ? "text-green-400" : "text-red-400"}>
                  vSAN HCL Data
                </span>
              </div>
              {!hasVsanHcl && <span className="text-xs text-red-400/70">Missing</span>}
            </div>
          </div>
        </div>
      )}

      {/* Scan error */}
      {checked && scanError && (
        <div className="bg-card border border-destructive/50 rounded-lg p-4">
          <h2 className="font-semibold mb-2 text-destructive">Depot Unreachable</h2>
          <div className="text-sm text-destructive/80 mb-3">{scanError}</div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>The offline depot appliance may need attention:</p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li>Check that the appliance is powered on and network is functional</li>
              <li>The appliance&apos;s network stack may need a reboot to recover</li>
              <li>Verify SSH credentials in Global Config &rarr; Depot Appliance section</li>
            </ul>
          </div>
        </div>
      )}

      {/* Broadcom list output (collapsible) */}
      {checked && (listOutput || listError) && (
        <details className="bg-card border border-border rounded-lg p-4">
          <summary className="font-semibold cursor-pointer hover:text-primary">
            Broadcom Available Binaries (VCF {vcfVersion})
          </summary>
          <div className="mt-3">
            {listError ? (
              <div className="text-sm text-destructive">{listError}</div>
            ) : (
              <pre className="text-xs font-mono bg-background/50 border border-border rounded-md p-3 max-h-80 overflow-auto whitespace-pre-wrap">
                {listOutput}
              </pre>
            )}
          </div>
        </details>
      )}

      {/* Active Download */}
      {downloading && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Download Progress</h2>
              {downloadAlive ? (
                <span className="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                  Running
                </span>
              ) : (
                <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400">
                  Complete
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {downloadAlive && (
                <button
                  onClick={handleKillDownload}
                  className="text-xs px-3 py-1 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30"
                >
                  Cancel
                </button>
              )}
              {!downloadAlive && (
                <button
                  onClick={() => { setDownloading(false); setDownloadOutput(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
          <pre
            ref={outputRef}
            className="text-xs font-mono bg-black/80 text-green-400 border border-border rounded-md p-3 max-h-96 overflow-auto whitespace-pre-wrap"
          >
            {downloadOutput || "Waiting for output..."}
          </pre>
        </div>
      )}

      {/* Cleanup Old Versions */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="font-semibold mb-3">Cleanup Old Versions</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Remove component binaries for a specific version from the depot. Metadata and vSAN HCL data are not affected.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={cleanupVersion}
            onChange={(e) => { setCleanupVersion(e.target.value); setCleanupScanned(false); setCleanupMessage(""); }}
            placeholder="e.g. 9.0.0"
            className="px-3 py-2 bg-input border border-border rounded-md text-sm w-48"
          />
          <button
            onClick={async () => {
              if (!cleanupVersion) return;
              setCleanupLoading(true);
              setCleanupFiles([]);
              setCleanupScanned(false);
              setCleanupMessage("");
              try {
                const res = await fetch("/api/depot", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "cleanup-list", cleanupVersion }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to scan");
                setCleanupFiles(data.files || []);
                setCleanupScanned(true);
              } catch (err) {
                setCleanupMessage(err instanceof Error ? err.message : "Failed to scan");
              }
              setCleanupLoading(false);
            }}
            disabled={cleanupLoading || !cleanupVersion}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
          >
            {cleanupLoading ? "Scanning..." : "Find Files"}
          </button>
        </div>

        {cleanupMessage && (
          <div className="mt-3 text-sm text-destructive">{cleanupMessage}</div>
        )}

        {cleanupScanned && cleanupFiles.length === 0 && (
          <div className="mt-3 text-sm text-muted-foreground">
            No files found matching version {cleanupVersion}.
          </div>
        )}

        {cleanupScanned && cleanupFiles.length > 0 && (
          <div className="mt-3 space-y-3">
            <div className="text-sm">
              Found <span className="font-semibold text-destructive">{cleanupFiles.length} file{cleanupFiles.length !== 1 ? "s" : ""}</span> matching version {cleanupVersion}:
            </div>
            <div className="bg-background/50 border border-border rounded-md p-3 max-h-48 overflow-auto">
              {cleanupFiles.map((f) => (
                <div key={f} className="text-xs font-mono text-muted-foreground truncate">
                  {f.replace("/var/www/build/", "")}
                </div>
              ))}
            </div>
            <button
              onClick={async () => {
                if (!confirm(`Are you sure you want to permanently delete ${cleanupFiles.length} file(s) for version ${cleanupVersion}?\n\nThis cannot be undone.`)) return;
                setCleanupDeleting(true);
                setCleanupMessage("");
                try {
                  const res = await fetch("/api/depot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "cleanup-delete", cleanupVersion, files: cleanupFiles }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || "Failed to delete");
                  setCleanupMessage(`Deleted ${data.deleted} file(s) for version ${cleanupVersion}.`);
                  setCleanupFiles([]);
                  setCleanupScanned(false);
                } catch (err) {
                  setCleanupMessage(err instanceof Error ? err.message : "Failed to delete");
                }
                setCleanupDeleting(false);
              }}
              disabled={cleanupDeleting}
              className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {cleanupDeleting ? "Deleting..." : `Delete ${cleanupFiles.length} Files`}
            </button>
          </div>
        )}
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">
          Depot store: /var/www/build &mdash; the download tool automatically skips files already present.
        </summary>
        <div className="mt-2 ml-4 space-y-1 font-mono">
          <p className="font-sans font-medium text-foreground/70 mb-1">Expected depot structure:</p>
          <p>PROD/COMP/ &mdash; Component binaries (ESXi, NSX, SDDC Manager, vCenter, etc.)</p>
          <p>PROD/COMP/SDDC_MANAGER_VCF/Compatibility/ &mdash; VMware compatibility data</p>
          <p>PROD/metadata/manifest/v1/ &mdash; VCF manifest for SDDC Manager discovery</p>
          <p>PROD/metadata/productVersionCatalog/v1/ &mdash; Product version catalog + signature</p>
          <p>PROD/vsan/hcl/ &mdash; vSAN Hardware Compatibility List data</p>
        </div>
      </details>
    </div>
  );
}
