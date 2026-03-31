"use client";

import { useAuth } from "@/hooks/use-auth";
import { useReservation } from "@/hooks/use-reservation";
import { useSSE } from "@/hooks/use-sse";
import { useEffect, useState, useRef } from "react";
import { CommandPreview } from "@/components/ui/command-preview";

interface CommandParameter {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  required: boolean;
  validation?: string;
  placeholder?: string;
  options?: string[];
}

interface Command {
  id: string;
  name: string;
  slug: string;
  description: string;
  template: string;
  category: string;
  requiredRole: string;
  parameters: CommandParameter[];
}

const categoryLabels: Record<string, string> = {
  inventory: "Inventory & Status",
  network: "Network",
  lifecycle: "Lifecycle",
  maintenance: "Maintenance",
};

// day2 and deployment categories have dedicated pages — exclude from Commands
const hiddenCategories = new Set(["day2", "deployment"]);
const categoryOrder = ["inventory", "network", "lifecycle", "maintenance"];

// Commands that require a confirmation step before executing
const confirmRequired = new Set([
  "remove-holodeck-instance",
  "delete-config-file",
  "delete-instance-state",
  "delete-output-file",
]);

// Commands that don't need an imported config context
const noConfigRequired = new Set([
  "get-holodeck-config",
  "get-holodeck-config-detail",
  "new-holodeck-instance",
  "set-holodeck-dnsconfig",
  "remove-holodeck-dnsconfig",
  "delete-config-file",
  "delete-instance-state",
  "delete-output-file",
  "list-config-files",
  "list-state-files",
  "list-output-files",
]);

interface HoloDeckConfig {
  ConfigID?: string;
  configId?: string;
  Description?: string;
  description?: string;
  Instance?: string;
  instance?: string;
  hasSiteB?: string;
  [key: string]: string | undefined;
}

/** Normalize field access across live SSH and cached API shapes */
function cfgId(c: HoloDeckConfig): string { return c.ConfigID || c.configId || ""; }
function cfgDesc(c: HoloDeckConfig): string { return c.Description || c.description || ""; }
function cfgInst(c: HoloDeckConfig): string { return c.Instance || c.instance || ""; }
function cfgHasSiteB(c: HoloDeckConfig): boolean { return c.hasSiteB === "true" || c.hasSiteB === true as unknown as string; }

export default function CommandsPage() {
  const { user } = useAuth();
  const { reservation } = useReservation();
  const { messages, isRunning, execute, clear } = useSSE();
  const [commands, setCommands] = useState<Command[]>([]);
  const [selected, setSelected] = useState<Command | null>(null);
  const [params, setParams] = useState<Record<string, string | boolean>>({});
  const outputRef = useRef<HTMLDivElement>(null);
  const [holoConfigs, setHoloConfigs] = useState<HoloDeckConfig[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string>("");
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [configError, setConfigError] = useState("");
  const [confirmPending, setConfirmPending] = useState(false);

  const isAdmin = user?.role === "labadmin" || user?.role === "superadmin";

  useEffect(() => {
    fetch("/api/commands")
      .then((r) => r.json())
      .then((data) => setCommands(data.commands || []));
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [messages]);

  /** Pick a sensible default config when configs are loaded */
  const autoSelectConfig = (cfgs: HoloDeckConfig[]) => {
    const running = cfgs.filter((c) => cfgInst(c));
    if (running.length > 0) {
      setActiveConfigId(cfgId(running[0]));
    } else if (isAdmin && cfgs.length > 0) {
      // Admins can browse non-running configs
      setActiveConfigId(cfgId(cfgs[0]));
    }
  };

  /** Load configs — tries cache first, then falls back to live SSH */
  const fetchConfigs = async (forceLive = false) => {
    setLoadingConfigs(true);
    setConfigError("");
    try {
      // Try cached instances endpoint first (DB-only, fast)
      if (!forceLive) {
        const cacheRes = await fetch("/api/holodeck-configs/instances");
        if (cacheRes.ok) {
          const cacheData = await cacheRes.json();
          const cfgs = (cacheData.configs || []).map((c: Record<string, unknown>) => ({
            ...c,
            // Normalize to the shape the rest of the page expects
            ConfigID: c.configId as string,
            Description: (c.description as string) || (c.remoteDescription as string) || "",
            Instance: (c.instance as string) || "",
            hasSiteB: (c.hasSiteB as boolean) ? "true" : "false",
          }));
          if (cfgs.length > 0) {
            setHoloConfigs(cfgs);
            autoSelectConfig(cfgs);
            setLoadingConfigs(false);
            // Background refresh if stale
            if (cacheData.stale) {
              fetch("/api/holodeck-configs/sync", { method: "POST" })
                .then(() => fetch("/api/holodeck-configs/instances"))
                .then((r) => r.json())
                .then((data) => {
                  const refreshed = (data.configs || []).map((c: Record<string, unknown>) => ({
                    ...c,
                    ConfigID: c.configId as string,
                    Description: (c.description as string) || (c.remoteDescription as string) || "",
                    Instance: (c.instance as string) || "",
                    hasSiteB: (c.hasSiteB as boolean) ? "true" : "false",
                  }));
                  setHoloConfigs(refreshed);
                })
                .catch(() => {});
            }
            return;
          }
        }
      }

      // Fallback: live SSH fetch (slow but always fresh)
      const configRes = await fetch("/api/commands/configs");
      if (!configRes.ok) {
        const data = await configRes.json();
        setConfigError(data.error || "Failed to fetch configurations");
        return;
      }
      const data = await configRes.json();
      setHoloConfigs(data.configs || []);
      autoSelectConfig(data.configs || []);
    } catch {
      setConfigError("Failed to load configurations");
    } finally {
      setLoadingConfigs(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canExecute = user?.role === "superadmin" || !!reservation;

  const needsConfig = (cmd: Command | null) =>
    cmd ? !noConfigRequired.has(cmd.slug) : false;

  const activeCfg = holoConfigs.find((c) => cfgId(c) === activeConfigId);
  const activeConfigHasSiteB = activeCfg ? cfgHasSiteB(activeCfg) : false;
  const activeInstance = activeCfg ? cfgInst(activeCfg) : "";

  const grouped = categoryOrder
    .map((cat) => ({
      category: cat,
      label: categoryLabels[cat] || cat,
      commands: commands.filter((c) => c.category === cat),
    }))
    .filter((g) => g.commands.length > 0);

  const handleExecute = () => {
    if (!selected || !canExecute) return;
    if (needsConfig(selected) && !activeConfigId) return;
    if (confirmRequired.has(selected.slug) && !confirmPending) {
      setConfirmPending(true);
      return;
    }
    setConfirmPending(false);
    execute("/api/commands/execute", {
      commandId: selected.id,
      parameters: params,
      configId: needsConfig(selected) ? activeConfigId : undefined,
    });
  };

  const handleSelect = (cmd: Command) => {
    setSelected(cmd);
    setConfirmPending(false);
    clear();
    // Auto-fill known parameters
    const autoParams: Record<string, string | boolean> = {};
    // Default site to "a"
    if (cmd.parameters.some((p) => p.name === "site")) {
      autoParams.site = "a";
    }
    if (activeConfigId) {
      // Auto-fill configId
      if (cmd.parameters.some((p) => p.name === "configId")) {
        autoParams.configId = activeConfigId;
      }
      // Auto-fill instanceId from active config's running instance
      if (activeInstance && cmd.parameters.some((p) => p.name === "instanceId")) {
        autoParams.instanceId = activeInstance;
      }
    }
    setParams(autoParams);
  };

  /** Build a preview of the resolved command from the template + current params */
  const buildCommandPreview = (): string => {
    if (!selected) return "";
    let resolved = selected.template;
    // Handle conditional sections: {{#flag}} ... {{/flag}}
    resolved = resolved.replace(
      /\{\{#(\w+)\}\}(.*?)\{\{\/\1\}\}/g,
      (_, key, content) => {
        const value = params[key];
        if (value === true || (typeof value === "string" && value.length > 0)) {
          return content.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => {
            const v = params[k];
            return v !== undefined && v !== "" ? String(v) : `{{${k}}}`;
          });
        }
        return "";
      }
    );
    // Handle simple placeholders: {{key}}
    resolved = resolved.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = params[key];
      return value !== undefined && value !== "" ? String(value) : `<${key}>`;
    });
    // Prepend config import if needed
    if (needsConfig(selected) && activeConfigId) {
      resolved = `Import-HoloDeckConfig -ConfigID '${activeConfigId}' | Out-Null; ${resolved}`;
    }
    return resolved.trim();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Commands</h1>

      {/* Active Instance / Configuration Selector */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">
            {activeInstance ? "Active Instance" : "Configuration"}
          </h2>
          <button
            onClick={() => fetchConfigs(true)}
            disabled={loadingConfigs}
            className="text-xs text-primary hover:underline disabled:opacity-50"
          >
            {loadingConfigs ? "Loading..." : "Refresh"}
          </button>
        </div>
        {configError ? (
          <div className="text-sm text-destructive">{configError}</div>
        ) : holoConfigs.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {loadingConfigs
              ? "Loading configurations..."
              : "No configurations found. Deploy a new instance first."}
          </div>
        ) : !isAdmin && !activeConfigId ? (
          <div className="text-sm text-muted-foreground">
            No active instance available. Contact an administrator.
          </div>
        ) : !isAdmin ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 px-3 py-2 bg-input border border-border rounded-md text-sm">
              {activeCfg
                ? activeInstance
                  ? `${activeInstance}${cfgDesc(activeCfg) ? ` — ${cfgDesc(activeCfg)}` : ""}`
                  : `${cfgId(activeCfg)}${cfgDesc(activeCfg) ? ` — ${cfgDesc(activeCfg)}` : ""}`
                : activeConfigId}
            </div>
            {activeInstance && (
              <span className="text-xs px-2 py-1 rounded-full whitespace-nowrap bg-success/20 text-success">
                Running
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <select
              value={activeConfigId}
              onChange={(e) => setActiveConfigId(e.target.value)}
              className="flex-1 px-3 py-2 bg-input border border-border rounded-md text-sm"
            >
              <option value="">Select...</option>
              {/* Running instances first */}
              {holoConfigs.filter((c) => cfgInst(c)).length > 0 && (
                <optgroup label="Running Instances">
                  {holoConfigs.filter((c) => cfgInst(c)).map((cfg, i) => (
                    <option key={cfgId(cfg) || i} value={cfgId(cfg)}>
                      {cfgInst(cfg)}
                      {cfgDesc(cfg) ? ` — ${cfgDesc(cfg)}` : ""}
                      {` (Config: ${cfgId(cfg)})`}
                    </option>
                  ))}
                </optgroup>
              )}
              {/* Non-running configs */}
              {holoConfigs.filter((c) => !cfgInst(c)).length > 0 && (
                <optgroup label="Configs (No Instance)">
                  {holoConfigs.filter((c) => !cfgInst(c)).map((cfg, i) => (
                    <option key={cfgId(cfg) || i} value={cfgId(cfg)}>
                      {cfgId(cfg)}
                      {cfgDesc(cfg) ? ` — ${cfgDesc(cfg)}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {activeConfigId && (
              <>
                <span
                  className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${
                    activeInstance
                      ? "bg-success/20 text-success"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {activeInstance ? "Running" : "Not deployed"}
                </span>
                <span className="text-xs px-2 py-1 rounded-full whitespace-nowrap bg-primary/15 text-primary">
                  {activeConfigHasSiteB ? "Multi-Site" : "Single Site"}
                </span>
              </>
            )}
          </div>
        )}

        {/* Show the auto-filled instance for context */}
        {activeConfigId && activeInstance && (
          <p className="text-xs text-muted-foreground mt-2">
            Instance <span className="font-medium text-foreground/80">{activeInstance}</span> will be used for commands that require an instance ID.
          </p>
        )}
      </div>

      {!canExecute && (
        <div className="p-4 bg-warning/10 text-warning rounded-md text-sm">
          You need an active reservation to execute commands.
          <a
            href="/dashboard/reservations"
            className="underline ml-1"
          >
            Book a time slot
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ height: "calc(100vh - 16rem)" }}>
        {/* Command List */}
        <div className="space-y-4 overflow-y-auto pr-2">
          {grouped.map((group) => (
            <div key={group.category}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.commands.map((cmd) => (
                  <button
                    key={cmd.id}
                    onClick={() => handleSelect(cmd)}
                    className={`w-full text-left p-3 rounded-md text-sm transition-colors ${
                      selected?.id === cmd.id
                        ? confirmRequired.has(cmd.slug)
                          ? "bg-red-500/10 border border-red-500/30"
                          : "bg-primary/10 border border-primary/30"
                        : confirmRequired.has(cmd.slug)
                          ? "bg-card border border-red-500/20 hover:border-red-500/40"
                          : "bg-card border border-border hover:border-primary/30"
                    }`}
                  >
                    <div className={`font-medium ${confirmRequired.has(cmd.slug) ? "text-red-400" : ""}`}>{cmd.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {cmd.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Command Panel + Output */}
        <div className="lg:col-span-2 space-y-4 overflow-y-auto">
          {selected ? (
            <>
              <div className="bg-card border border-border rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-1">{selected.name}</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {selected.description}
                </p>

                {selected.parameters.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {selected.parameters
                      .filter((param) => !(param.name === "site" && !activeConfigHasSiteB && selected.slug !== "new-holodeck-instance"))
                      .map((param) => (
                      <div key={param.name}>
                        <label className="block text-sm font-medium mb-1">
                          {param.label}
                          {param.required && (
                            <span className="text-destructive ml-1">*</span>
                          )}
                        </label>
                        {param.type === "select" ? (
                          <select
                            value={(params[param.name] as string) || ""}
                            onChange={(e) =>
                              setParams((p) => ({
                                ...p,
                                [param.name]: e.target.value,
                              }))
                            }
                            className="w-full px-3 py-2 bg-input border border-border rounded-md"
                          >
                            <option value="">Select...</option>
                            {param.options?.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : param.type === "boolean" ? (
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={!!params[param.name]}
                              onChange={(e) =>
                                setParams((p) => ({
                                  ...p,
                                  [param.name]: e.target.checked,
                                }))
                              }
                              className="rounded"
                            />
                            <span className="text-sm">Enable</span>
                          </label>
                        ) : (
                          <input
                            type={param.type === "number" ? "number" : "text"}
                            value={(params[param.name] as string) || ""}
                            onChange={(e) =>
                              setParams((p) => ({
                                ...p,
                                [param.name]: e.target.value,
                              }))
                            }
                            placeholder={param.placeholder}
                            className="w-full px-3 py-2 bg-input border border-border rounded-md"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Command preview */}
                <div className="mb-3">
                  <CommandPreview command={buildCommandPreview()} />
                </div>

                {needsConfig(selected) && !activeConfigId && (
                  <div className="p-3 mb-3 bg-warning/10 text-warning rounded-md text-sm">
                    This command requires an active configuration. Select one above.
                  </div>
                )}

                {confirmPending ? (
                  <div className="p-3 mb-3 bg-destructive/10 border border-destructive/30 rounded-md">
                    <p className="text-sm font-medium text-destructive mb-2">
                      Are you sure you want to run <span className="font-bold">{selected.name}</span>?
                      {" "}This action is destructive and cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleExecute}
                        disabled={isRunning}
                        className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        {isRunning ? "Running..." : "Yes, Proceed"}
                      </button>
                      <button
                        onClick={() => setConfirmPending(false)}
                        className="px-4 py-2 bg-muted text-muted-foreground rounded-md font-medium hover:opacity-90 transition-opacity"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleExecute}
                    disabled={!canExecute || isRunning || (needsConfig(selected) && !activeConfigId)}
                    className={`px-4 py-2 rounded-md font-medium hover:opacity-90 disabled:opacity-50 transition-opacity ${
                      confirmRequired.has(selected.slug)
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {isRunning ? "Running..." : "Execute"}
                  </button>
                )}
              </div>

              {/* Terminal Output */}
              {messages.length > 0 && (
                <div>
                  <div
                    ref={outputRef}
                    className="bg-black rounded-lg p-4 font-mono text-sm max-h-96 overflow-y-auto"
                  >
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        className={
                          msg.type === "stderr"
                            ? "text-red-400"
                            : msg.type === "error"
                            ? "text-red-500 font-bold"
                            : msg.type === "complete"
                            ? msg.exitCode === 0
                              ? "text-green-400 font-bold mt-2"
                              : "text-yellow-400 font-bold mt-2"
                            : "text-gray-300"
                        }
                      >
                        {stripAnsi(msg.data)}
                      </div>
                    ))}
                  </div>
                  {!isRunning && messages.some((m) => m.type === "stdout") && (
                    <ExportBar messages={messages} commandName={selected?.slug || "output"} />
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground">
              Select a command from the list to get started
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SSEMessage {
  type: "stdout" | "stderr" | "complete" | "error";
  data: string;
  exitCode?: number;
  duration?: number;
}

function getOutputLines(messages: SSEMessage[]): string[] {
  // Join all stdout, strip ANSI, then split into individual key:value lines
  const raw = messages
    .filter((m) => m.type === "stdout")
    .map((m) => stripAnsi(m.data))
    .join("");
  // Split on newlines first
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      lines.push("");
      continue;
    }
    // Split lines that contain multiple "Key : Value" pairs
    // e.g. "Gateway : 10.1.0.1 DNS_Server : 10.1.0.1"
    const parts = trimmed.split(/\s+(?=\S+\s*:\s*)/);
    for (const part of parts) {
      if (part.trim()) lines.push(part.trim());
    }
  }
  return lines;
}

function getPlainText(messages: SSEMessage[]): string {
  return messages
    .filter((m) => m.type === "stdout" || m.type === "stderr")
    .map((m) => stripAnsi(m.data))
    .join("");
}

function parseKeyValueBlocks(lines: string[]): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  let current: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (Object.keys(current).length > 0) {
        records.push(current);
        current = {};
      }
      continue;
    }
    const match = trimmed.match(/^(\S+)\s*:\s*(.*)$/);
    if (match) {
      const key = match[1];
      // If we see a key that already exists in current record, start a new record
      if (key in current) {
        records.push(current);
        current = {};
      }
      current[key] = match[2].trim();
    }
  }
  if (Object.keys(current).length > 0) records.push(current);
  return records;
}

function toCSV(records: Record<string, string>[]): string | null {
  if (records.length === 0) return null;
  const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const header = keys.map((k) => `"${k}"`).join(",");
  const rows = records.map((r) =>
    keys.map((k) => `"${(r[k] || "").replace(/"/g, '""')}"`).join(",")
  );
  return [header, ...rows].join("\n");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportBar({ messages, commandName }: { messages: SSEMessage[]; commandName: string }) {
  const [copied, setCopied] = useState(false);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const basename = `${commandName}_${timestamp}`;

  const handleCopy = async () => {
    const text = getPlainText(messages);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for contexts where Clipboard API is blocked
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleText = () => {
    downloadFile(getPlainText(messages), `${basename}.txt`, "text/plain");
  };

  const handleJSON = () => {
    const lines = getOutputLines(messages);
    const records = parseKeyValueBlocks(lines);
    const content = records.length > 0
      ? JSON.stringify(records, null, 2)
      : JSON.stringify({ output: getPlainText(messages) }, null, 2);
    downloadFile(content, `${basename}.json`, "application/json");
  };

  const handleCSV = () => {
    const lines = getOutputLines(messages);
    const records = parseKeyValueBlocks(lines);
    const csv = toCSV(records);
    if (csv) {
      downloadFile(csv, `${basename}.csv`, "text/csv");
    } else {
      // Fallback: one-column CSV of raw lines
      const fallback = "Output\n" + lines.map((l) => `"${l.replace(/"/g, '""')}"`).join("\n");
      downloadFile(fallback, `${basename}.csv`, "text/csv");
    }
  };

  const btnClass =
    "px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors";

  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-xs text-muted-foreground mr-1">Export:</span>
      <button onClick={handleCopy} className={btnClass}>
        {copied ? "Copied!" : "Copy"}
      </button>
      <button onClick={handleText} className={btnClass}>
        Text
      </button>
      <button onClick={handleJSON} className={btnClass}>
        JSON
      </button>
      <button onClick={handleCSV} className={btnClass}>
        CSV
      </button>
    </div>
  );
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x7e]|\x1b\].*?(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[>=<]/g, "");
}
