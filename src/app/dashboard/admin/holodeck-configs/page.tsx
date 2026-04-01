"use client";

import { useEffect, useState, useCallback } from "react";
import { CommandPreview } from "@/components/ui/command-preview";

interface HoloDeckConfig {
  id: string;
  configId: string;
  description: string;
  notes: string | null;
  lastSynced: string | null;
  createdAt: string;
  // From cached JSON summary
  vcfVersion?: string;
  instance?: string;
  targetHost?: string;
  targetUsername?: string;
  targetDatastore?: string;
  targetPortGroup?: string;
  vsanMode?: string;
  depotType?: string;
  dnsDomain?: string;
  hasSiteB?: boolean;
  remoteDescription?: string;
}

export default function HoloDeckConfigsPage() {
  const [configs, setConfigs] = useState<HoloDeckConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // New Config form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTargetHost, setNewTargetHost] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [testingCredentials, setTestingCredentials] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/holodeck-configs");
      const data = await res.json();
      setConfigs(data.configs || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage("");
    try {
      const res = await fetch("/api/holodeck-configs/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncMessage(data.message || "Sync complete");
        await fetchConfigs();
      } else {
        setSyncMessage(`Error: ${data.error || "Sync failed"}`);
      }
    } catch (err) {
      setSyncMessage("Failed to sync configs from holorouter");
    }
    setSyncing(false);
  };

  const handleEdit = (config: HoloDeckConfig) => {
    setEditingId(config.configId);
    setEditDescription(config.description);
    setEditNotes(config.notes || "");
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/holodeck-configs/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: editDescription, notes: editNotes }),
      });
      if (res.ok) {
        setEditingId(null);
        await fetchConfigs();
      }
    } catch {
      // ignore
    }
    setSaving(false);
  };

  const handleDelete = async (configId: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/holodeck-configs/${encodeURIComponent(configId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setSyncMessage(data.message || "Config deleted");
        setDeletingId(null);
        await fetchConfigs();
      } else {
        setSyncMessage(`Error: ${data.error || "Failed to delete config"}`);
        setDeletingId(null);
      }
    } catch {
      setSyncMessage("Error: Failed to delete config");
      setDeletingId(null);
    }
    setDeleting(false);
  };

  const resetNewForm = () => {
    setShowNewForm(false);
    setNewTargetHost("");
    setNewUsername("");
    setNewPassword("");
    setNewDescription("");
    setCreateMessage("");
    setTestResult(null);
  };

  const handleClone = (config: HoloDeckConfig) => {
    setShowNewForm(true);
    setNewTargetHost(config.targetHost || "");
    setNewUsername(config.targetUsername || "");
    setNewPassword("");
    setNewDescription(config.description ? `${config.description} (copy)` : "");
    setCreateMessage("");
    setTestResult(null);
  };

  const handleTestCredentials = async () => {
    setTestingCredentials(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/holodeck-configs/test-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetHost: newTargetHost,
          username: newUsername,
          password: newPassword,
        }),
      });
      const data = await res.json();
      setTestResult({ success: data.success, message: data.message || data.error });
    } catch {
      setTestResult({ success: false, message: "Failed to test credentials" });
    }
    setTestingCredentials(false);
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateMessage("");
    try {
      if (!newTargetHost || !newUsername || !newPassword) {
        setCreateMessage("Error: Target host, username, and password are all required.");
        setCreating(false);
        return;
      }
      const payload: Record<string, unknown> = {
        targetHost: newTargetHost,
        username: newUsername,
        password: newPassword,
      };
      if (newDescription) payload.description = newDescription;

      const res = await fetch("/api/holodeck-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setCreateMessage(data.message || "Config created successfully");
        resetNewForm();
        // Sync from holorouter to ensure local cache is up to date
        setSyncing(true);
        setSyncMessage("Syncing new config from holorouter...");
        try {
          const syncRes = await fetch("/api/holodeck-configs/sync", { method: "POST" });
          const syncData = await syncRes.json();
          if (syncRes.ok) {
            setSyncMessage(syncData.message || "Sync complete");
          }
        } catch {
          // sync failure is non-critical
        }
        setSyncing(false);
        await fetchConfigs();
      } else {
        let errorMsg = `Error: ${data.error || "Failed to create config"}`;
        if (data.stderr) {
          errorMsg += `\n\nStderr:\n${data.stderr}`;
        }
        if (data.output) {
          errorMsg += `\n\nOutput:\n${data.output}`;
        }
        setCreateMessage(errorMsg);
      }
    } catch {
      setCreateMessage("Error: Failed to create config on holorouter");
    }
    setCreating(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manage Holodeck Configurations</h1>
          <p className="text-muted-foreground mt-1">
            Manage the holodeck router configurations (target details, credentials, etc.)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewForm(true)}
            className="px-4 py-2 bg-success text-success-foreground rounded-md font-medium hover:opacity-90 whitespace-nowrap"
          >
            + New Config
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            {syncing ? "Syncing..." : "Sync from Holorouter"}
          </button>
        </div>
      </div>

      {syncMessage && (
        <div
          className={`p-3 rounded-md text-sm ${
            syncMessage.startsWith("Error")
              ? "bg-destructive/10 text-destructive"
              : "bg-success/10 text-success"
          }`}
        >
          {syncMessage}
        </div>
      )}

      {createMessage && !showNewForm && (
        <div
          className={`p-3 rounded-md text-sm ${
            createMessage.startsWith("Error")
              ? "bg-destructive/10 text-destructive"
              : "bg-success/10 text-success"
          }`}
        >
          <p>{createMessage.split("\n\n")[0]}</p>
          {createMessage.includes("\n\n") && (
            <pre className="mt-2 text-xs font-mono whitespace-pre-wrap opacity-80 max-h-40 overflow-auto">
              {createMessage.split("\n\n").slice(1).join("\n\n")}
            </pre>
          )}
        </div>
      )}

      {/* New Config Form */}
      {showNewForm && (
        <div className="bg-card border border-primary/50 rounded-lg p-5 space-y-4">
          <h2 className="font-semibold text-lg">Create New Configuration</h2>

          <p className="text-sm text-muted-foreground">
            Initializes a new config file on the holorouter from the default template with your
            target host credentials. Each config is the source of truth for a single deployment
            — always create a new one for each new deployment.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Target (ESX/vCenter) <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={newTargetHost}
                onChange={(e) => { setNewTargetHost(e.target.value); setTestResult(null); }}
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
                placeholder="e.g. esxi-01.lab.local"
              />
              <p className="text-xs text-muted-foreground mt-1">
                ESX or vCenter host for this deployment
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Username <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => { setNewUsername(e.target.value); setTestResult(null); }}
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
                placeholder="e.g. root"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Password <span className="text-destructive">*</span>
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setTestResult(null); }}
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTestCredentials}
              disabled={testingCredentials || !newTargetHost || !newUsername || !newPassword}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {testingCredentials ? "Testing..." : "Test Connection"}
            </button>
            {testResult && (
              <p className={`text-sm ${testResult.success ? "text-success" : "text-destructive"}`}>
                {testResult.message}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
              placeholder="e.g. VCF 9 Lab - ESA"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Optional label for this configuration
            </p>
          </div>

          {newTargetHost && newUsername && (
            <CommandPreview
              label="Command Preview"
              command={[
                "New-HoloDeckConfig",
                `-TargetHost '${newTargetHost}'`,
                `-UserName '${newUsername}'`,
                `-Password '${newPassword ? "••••••••" : ""}'`,
                ...(newDescription ? [`-Description '${newDescription}'`] : []),
              ].join(" \\\n  ")}
            />
          )}

          {createMessage && (
            <div
              className={`p-3 rounded-md text-sm ${
                createMessage.startsWith("Error")
                  ? "bg-destructive/10 text-destructive"
                  : "bg-success/10 text-success"
              }`}
            >
              <p>{createMessage.split("\n\n")[0]}</p>
              {createMessage.includes("\n\n") && (
                <pre className="mt-2 text-xs font-mono whitespace-pre-wrap opacity-80 max-h-40 overflow-auto">
                  {createMessage.split("\n\n").slice(1).join("\n\n")}
                </pre>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {!testResult?.success && newTargetHost && newUsername && newPassword && (
              <p className="text-xs text-muted-foreground">
                A successful connection test is required before creating a config
              </p>
            )}
            <button
              onClick={resetNewForm}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:opacity-90"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !testResult?.success}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50"
              title={!testResult?.success ? "Test connection first" : undefined}
            >
              {creating ? "Creating..." : "Create Config"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading configurations...</p>
        </div>
      ) : configs.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center space-y-3">
          <p className="text-muted-foreground">No configurations found locally.</p>
          <p className="text-sm text-muted-foreground">
            Click &quot;Sync from Holorouter&quot; to fetch available configurations.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {configs.map((config) => (
            <div
              key={config.configId}
              className="bg-card border border-border rounded-lg p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-lg">{config.configId}</h3>
                  {config.instance && (
                    <span className="text-xs px-2 py-1 rounded-full bg-success/20 text-success">
                      Running: {config.instance}
                    </span>
                  )}
                  {config.hasSiteB && (
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400">
                      Multi-Site
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(config)}
                    className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleClone(config)}
                    className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md font-medium hover:opacity-90"
                  >
                    Clone
                  </button>
                  {!config.instance && (
                    <button
                      onClick={() => setDeletingId(config.configId)}
                      className="px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-md font-medium hover:opacity-90"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {config.description && (
                <p className="text-sm text-muted-foreground">{config.description}</p>
              )}

              {/* Config details grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {config.vcfVersion && (
                  <div>
                    <p className="text-xs text-muted-foreground">VCF Version</p>
                    <p className="font-medium">{config.vcfVersion}</p>
                  </div>
                )}
                {config.targetHost && (
                  <div>
                    <p className="text-xs text-muted-foreground">Target Host</p>
                    <p className="font-medium font-mono text-xs">{config.targetHost}</p>
                  </div>
                )}
                {config.targetDatastore && (
                  <div>
                    <p className="text-xs text-muted-foreground">Datastore</p>
                    <p className="font-medium font-mono text-xs">{config.targetDatastore}</p>
                  </div>
                )}
                {config.vsanMode && (
                  <div>
                    <p className="text-xs text-muted-foreground">vSAN Mode</p>
                    <p className="font-medium">{config.vsanMode}</p>
                  </div>
                )}
                {config.depotType && (
                  <div>
                    <p className="text-xs text-muted-foreground">Depot Type</p>
                    <p className="font-medium">{config.depotType}</p>
                  </div>
                )}
                {config.dnsDomain && (
                  <div>
                    <p className="text-xs text-muted-foreground">DNS Domain</p>
                    <p className="font-medium">{config.dnsDomain}</p>
                  </div>
                )}
                {config.lastSynced && (
                  <div>
                    <p className="text-xs text-muted-foreground">Last Synced</p>
                    <p className="font-medium">{new Date(config.lastSynced).toLocaleString()}</p>
                  </div>
                )}
              </div>

              {config.notes && (
                <div className="p-2 bg-background/50 rounded-md">
                  <p className="text-xs text-muted-foreground">Notes</p>
                  <p className="text-sm">{config.notes}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md space-y-4">
            <h2 className="font-semibold text-lg">Edit Config: {editingId}</h2>

            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                placeholder="E.g., Production VCF 9.0 Lab"
              />
              <p className="text-xs text-muted-foreground mt-1">
                A friendly name to identify this configuration
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-input border border-border rounded-md resize-none"
                placeholder="Optional notes about this deployment..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingId(null)}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:opacity-90"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md space-y-4">
            <h2 className="font-semibold text-lg text-destructive">Delete Config</h2>
            <p className="text-sm">
              Are you sure you want to delete <strong>{deletingId}</strong>? This will
              remove the config file from the holorouter and the local cache.
            </p>
            <p className="text-xs text-muted-foreground">
              This cannot be undone. If you need this config again, you&apos;ll have to create a new one.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeletingId(null)}
                disabled={deleting}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:opacity-90"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deletingId)}
                disabled={deleting}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Config"}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Each config is a JSON file on the holorouter that acts as the source of truth for its
        deployment. Configs are created from a default template and populated as deployments
        progress. Use &quot;Sync from Holorouter&quot; to refresh the local cache.
      </p>
    </div>
  );
}
