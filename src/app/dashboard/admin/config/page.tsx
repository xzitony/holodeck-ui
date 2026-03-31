"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ConfigEntry {
  id: string;
  key: string;
  value: string;
  sensitive: boolean;
  description: string;
}

const configGroups = [
  {
    label: "Holorouter Connection",
    keys: ["ssh_host", "ssh_port", "ssh_username", "ssh_password"],
  },
  {
    label: "Offline Depot Connection",
    keys: ["offline_depot_ip", "offline_depot_port", "offline_depot_username", "offline_depot_password", "offline_depot_protocol", "online_depot_token"],
  },
  {
    label: "Depot Appliance SSH (VCF Download Tool)",
    keys: ["depot_ssh_port", "depot_ssh_username", "depot_ssh_password"],
  },
  {
    label: "UI Customization",
    keys: [
      "ui_app_title",
      "ui_app_subtitle",
      "ui_logo_url",
      "ui_color_primary",
      "ui_color_background",
      "ui_color_card",
      "ui_color_sidebar",
    ],
  },
];

const friendlyLabels: Record<string, string> = {
  ssh_host: "Holorouter IP address",
  ssh_port: "Holorouter SSH port",
  ssh_username: "Holorouter SSH username",
  ssh_password: "Holorouter SSH password",
  offline_depot_ip: "Offline depot appliance IP",
  offline_depot_port: "Offline depot port",
  offline_depot_username: "Offline depot username",
  offline_depot_password: "Offline depot password",
  offline_depot_protocol: "Offline depot protocol (http/https)",
  online_depot_token: "Broadcom download token",
  depot_ssh_port: "Depot appliance SSH port",
  depot_ssh_username: "Depot appliance SSH username",
  depot_ssh_password: "Depot appliance SSH password",
  ui_app_title: "Application title in sidebar",
  ui_app_subtitle: "Subtitle below app title",
  ui_logo_url: "Logo image URL (displayed in sidebar)",
  ui_color_primary: "Primary accent color",
  ui_color_background: "Page background color",
  ui_color_card: "Card/panel background color",
  ui_color_sidebar: "Sidebar background color",
  email_smtp_host: "SMTP server hostname",
  email_smtp_port: "SMTP server port",
  email_smtp_username: "SMTP username",
  email_smtp_password: "SMTP password",
  email_smtp_from: "From address",
  email_smtp_secure: "Use TLS (true/false)",
  email_resend_api_key: "Resend API key",
  email_resend_from: "From address",
  email_notify_recipients: "Notification recipients (comma-separated)",
  app_base_url: "Public URL of this app (e.g. https://holodeck.lab.local)",
};

const sensitiveFields = new Set([
  "ssh_password",
  "esx_password",
  "offline_depot_password",
  "online_depot_token",
  "depot_ssh_password",
  "email_smtp_password",
  "email_resend_api_key",
]);

const colorFields = new Set([
  "ui_color_primary",
  "ui_color_background",
  "ui_color_card",
  "ui_color_sidebar",
]);

export default function GlobalConfigPage() {
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [testingRouter, setTestingRouter] = useState(false);
  const [routerResult, setRouterResult] = useState("");
  const [testingDepot, setTestingDepot] = useState(false);
  const [depotResult, setDepotResult] = useState("");
  const [testingDepotHttp, setTestingDepotHttp] = useState(false);
  const [depotHttpResult, setDepotHttpResult] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailAddr, setTestEmailAddr] = useState("");
  const [emailResult, setEmailResult] = useState("");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        setConfigs(data.configs || []);
        const vals: Record<string, string> = {};
        for (const c of data.configs || []) {
          vals[c.key] = c.value;
        }
        setValues(vals);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        configs: Object.entries(values).map(([key, value]) => ({
          key,
          value,
        })),
      }),
    });

    if (res.ok) {
      setMessage("Configuration saved successfully");
    } else {
      setMessage("Failed to save configuration");
    }
    setSaving(false);
  };

  const handleTestRouter = async () => {
    setTestingRouter(true);
    setRouterResult("");
    try {
      await handleSave();
      const res = await fetch("/api/config/test", { method: "POST" });
      const data = await res.json();
      setRouterResult(data.success ? "Connected successfully!" : `Failed: ${data.message}`);
    } catch {
      setRouterResult("Failed to test connection");
    }
    setTestingRouter(false);
  };

  const handleTestDepot = async () => {
    setTestingDepot(true);
    setDepotResult("");
    try {
      await handleSave();
      const res = await fetch("/api/config/test-depot", { method: "POST" });
      const data = await res.json();
      setDepotResult(data.success ? "Connected successfully!" : `Failed: ${data.message}`);
    } catch {
      setDepotResult("Failed to test connection");
    }
    setTestingDepot(false);
  };

  const handleTestDepotHttp = async () => {
    setTestingDepotHttp(true);
    setDepotHttpResult("");
    try {
      await handleSave();
      const res = await fetch("/api/config/test-depot-http", { method: "POST" });
      const data = await res.json();
      setDepotHttpResult(data.success ? `Connected: ${data.message}` : `Failed: ${data.message}`);
    } catch {
      setDepotHttpResult("Failed to test HTTP connection");
    }
    setTestingDepotHttp(false);
  };

  const handleTestEmail = async () => {
    if (!testEmailAddr) return;
    setTestingEmail(true);
    setEmailResult("");
    try {
      await handleSave();
      const res = await fetch("/api/config/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmailAddr }),
      });
      const data = await res.json();
      setEmailResult(data.success ? data.message : `Failed: ${data.message}`);
    } catch {
      setEmailResult("Failed to send test email");
    }
    setTestingEmail(false);
  };

  const emailProvider = values["email_provider"] || "none";

  const getConfig = (key: string) =>
    configs.find((c) => c.key === key);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-muted-foreground">
        Manage Holodeck UI appliance connectivity and UI customizations
      </p>

      {message && (
        <div
          className={`p-3 rounded-md text-sm ${
            message.includes("success")
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {message}
        </div>
      )}

      {configGroups.map((group) => (
        <div
          key={group.label}
          className="bg-card border border-border rounded-lg p-4 space-y-4"
        >
          <h2 className="font-semibold">{group.label}</h2>
          {group.keys.map((key) => {
            const cfg = getConfig(key);
            return (
              <div key={key}>
                <label className="block text-sm font-medium mb-1">
                  {friendlyLabels[key] || cfg?.description || key}
                  {(cfg?.sensitive || sensitiveFields.has(key)) && (
                    <span className="text-xs text-muted-foreground ml-2">
                      (sensitive)
                    </span>
                  )}
                </label>
                {colorFields.has(key) ? (
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={values[key] || "#000000"}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [key]: e.target.value }))
                      }
                      className="w-10 h-10 rounded cursor-pointer border border-border bg-transparent"
                    />
                    <input
                      type="text"
                      value={values[key] || ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [key]: e.target.value }))
                      }
                      className="flex-1 px-3 py-2 bg-input border border-border rounded-md font-mono"
                      placeholder="#000000"
                    />
                  </div>
                ) : (
                  <input
                    type={(cfg?.sensitive || sensitiveFields.has(key)) ? "password" : "text"}
                    value={values[key] || ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [key]: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-input border border-border rounded-md"
                    placeholder={friendlyLabels[key] || cfg?.description || key}
                  />
                )}
              </div>
            );
          })}

          {/* Test SSH for Holorouter */}
          {group.label === "Holorouter Connection" && (
            <div className="pt-2 space-y-2">
              <button
                onClick={handleTestRouter}
                disabled={testingRouter}
                className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {testingRouter ? "Testing..." : "Test SSH Connection"}
              </button>
              {routerResult && (
                <div className={`p-2 rounded-md text-sm ${routerResult.includes("success") ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {routerResult}
                </div>
              )}
            </div>
          )}

          {/* Test HTTP for Offline Depot */}
          {group.label === "Offline Depot Connection" && (
            <div className="pt-2 space-y-2">
              <button
                onClick={handleTestDepotHttp}
                disabled={testingDepotHttp}
                className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {testingDepotHttp ? "Testing..." : "Test HTTP Connection"}
              </button>
              {depotHttpResult && (
                <div className={`p-2 rounded-md text-sm ${depotHttpResult.includes("Connected") ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {depotHttpResult}
                </div>
              )}
            </div>
          )}

          {/* Test SSH for Depot Appliance */}
          {group.label === "Depot Appliance SSH (VCF Download Tool)" && (
            <div className="pt-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                Connects to the Offline Depot IP configured above.
              </p>
              <button
                onClick={handleTestDepot}
                disabled={testingDepot}
                className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {testingDepot ? "Testing..." : "Test SSH Connection"}
              </button>
              {depotResult && (
                <div className={`p-2 rounded-md text-sm ${depotResult.includes("success") ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {depotResult}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Email Notifications */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <h2 className="font-semibold">Email Notifications</h2>
        <p className="text-xs text-muted-foreground">
          Configure email notifications for deployment events
        </p>

        {/* Provider */}
        <div>
          <label className="block text-sm font-medium mb-1">Email Provider</label>
          <select
            value={emailProvider}
            onChange={(e) => setValues((v) => ({ ...v, email_provider: e.target.value }))}
            className="w-full px-3 py-2 bg-input border border-border rounded-md"
          >
            <option value="none">None (disabled)</option>
            <option value="smtp">SMTP Relay</option>
            <option value="resend">Resend</option>
          </select>
        </div>

        {/* SMTP fields */}
        {emailProvider === "smtp" && (
          <div className="space-y-4 pl-2 border-l-2 border-primary/20">
            {["email_smtp_host", "email_smtp_port", "email_smtp_username", "email_smtp_password", "email_smtp_from", "email_smtp_secure"].map((key) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-1">
                  {friendlyLabels[key] || key}
                  {sensitiveFields.has(key) && (
                    <span className="text-xs text-muted-foreground ml-2">(sensitive)</span>
                  )}
                </label>
                <input
                  type={sensitiveFields.has(key) ? "password" : "text"}
                  value={values[key] || ""}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  className="w-full px-3 py-2 bg-input border border-border rounded-md"
                  placeholder={friendlyLabels[key] || key}
                />
              </div>
            ))}
          </div>
        )}

        {/* Resend fields */}
        {emailProvider === "resend" && (
          <div className="space-y-4 pl-2 border-l-2 border-primary/20">
            {["email_resend_api_key", "email_resend_from"].map((key) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-1">
                  {friendlyLabels[key] || key}
                  {sensitiveFields.has(key) && (
                    <span className="text-xs text-muted-foreground ml-2">(sensitive)</span>
                  )}
                </label>
                <input
                  type={sensitiveFields.has(key) ? "password" : "text"}
                  value={values[key] || ""}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  className="w-full px-3 py-2 bg-input border border-border rounded-md"
                  placeholder={friendlyLabels[key] || key}
                />
              </div>
            ))}
          </div>
        )}

        {/* Test email */}
        {emailProvider !== "none" && (
          <div className="pt-2 space-y-2">
            <label className="block text-sm font-medium mb-1">Send Test Email</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={testEmailAddr}
                onChange={(e) => setTestEmailAddr(e.target.value)}
                className="flex-1 px-3 py-2 bg-input border border-border rounded-md"
                placeholder="recipient@example.com"
              />
              <button
                onClick={handleTestEmail}
                disabled={testingEmail || !testEmailAddr}
                className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {testingEmail ? "Sending..." : "Send Test"}
              </button>
            </div>
            {emailResult && (
              <div className={`p-2 rounded-md text-sm ${emailResult.includes("sent") ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {emailResult}
              </div>
            )}
          </div>
        )}

        {/* Notification preferences */}
        <div className="border-t border-border pt-4 space-y-4">
          <h3 className="text-sm font-medium">Notification Preferences</h3>
          <div>
            <label className="block text-sm font-medium mb-1">Deployment Notifications</label>
            <select
              value={values["email_notify_on"] || "none"}
              onChange={(e) => setValues((v) => ({ ...v, email_notify_on: e.target.value }))}
              className="w-full px-3 py-2 bg-input border border-border rounded-md"
            >
              <option value="none">Never</option>
              <option value="failures">Failures Only</option>
              <option value="all">All Events (started, completed, failed)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {friendlyLabels["email_notify_recipients"]}
            </label>
            <input
              type="text"
              value={values["email_notify_recipients"] || ""}
              onChange={(e) => setValues((v) => ({ ...v, email_notify_recipients: e.target.value }))}
              className="w-full px-3 py-2 bg-input border border-border rounded-md"
              placeholder="admin@example.com, ops@example.com"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={values["email_reservation_reminders"] === "true"}
                onChange={(e) => setValues((v) => ({ ...v, email_reservation_reminders: e.target.checked ? "true" : "false" }))}
                className="rounded border-border"
              />
              <span className="text-sm">Send reservation reminder emails 5 minutes before start time</span>
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-6">
              Users with an email address on their account will receive a reminder with a link to the dashboard
            </p>
          </div>
        </div>

        {/* App URL */}
        <div className="border-t border-border pt-4 space-y-4">
          <h3 className="text-sm font-medium">Application URL</h3>
          <div>
            <label className="block text-sm font-medium mb-1">
              {friendlyLabels["app_base_url"]}
            </label>
            <input
              type="text"
              value={values["app_base_url"] || ""}
              onChange={(e) => setValues((v) => ({ ...v, app_base_url: e.target.value }))}
              className="w-full px-3 py-2 bg-input border border-border rounded-md"
              placeholder="https://holodeck.lab.local"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used in email links. Set this to the URL users access through your load balancer or reverse proxy.
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>

      {/* Troubleshooting */}
      <div className="border-t border-border pt-6">
        <h2 className="text-lg font-semibold mb-1">Troubleshooting</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Advanced tools for debugging and managing the holorouter
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/dashboard/commands"
            className="p-4 bg-card border border-border rounded-lg hover:border-primary/50 transition-colors"
          >
            <h3 className="font-semibold text-sm">Run Commands</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Execute Holodeck PowerShell commands directly on the holorouter
            </p>
          </Link>
          <Link
            href="/dashboard/admin/commands"
            className="p-4 bg-card border border-border rounded-lg hover:border-primary/50 transition-colors"
          >
            <h3 className="font-semibold text-sm">Manage Command Definitions</h3>
            <p className="text-xs text-muted-foreground mt-1">
              View, edit, and add available Holodeck command definitions
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
