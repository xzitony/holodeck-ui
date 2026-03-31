/**
 * Shared capability extraction from Holodeck config JSON.
 * Used by both the cached API and the live SSH-based capabilities endpoint.
 */

export interface Capabilities {
  hasSiteB: boolean;
  hasAriaAutomation: boolean;
  hasAriaOperations: boolean;
  hasAriaLogs: boolean;
  hasAriaNetworks: boolean;
  hasNsx: boolean;
  hasWorkloadDomain: boolean;
}

export function getDefaultCapabilities(): Capabilities {
  return {
    hasSiteB: false,
    hasAriaAutomation: false,
    hasAriaOperations: false,
    hasAriaLogs: false,
    hasAriaNetworks: false,
    hasNsx: false,
    hasWorkloadDomain: false,
  };
}

/**
 * Detect capabilities by looking for populated values (hostnames, IPs, FQDNs)
 * in config sections associated with each component.
 */
export function extractCapabilities(config: Record<string, unknown>): Capabilities {
  const caps = getDefaultCapabilities();

  const entries = getAllEntries(config);

  // Site B: look for a SiteB section with actual populated content
  caps.hasSiteB = hasPopulatedSection(config, "SiteB");

  const ariaAutoKeys = ["ariaautomation", "vcfautomation", "vracloud", "vra"];
  const ariaOpsKeys = ["ariaoperations", "vrops", "ariaops"];
  const ariaLogsKeys = ["arialog", "vrli", "loginsight"];
  const ariaNetKeys = ["arianetwork", "vrni", "networkins"];
  const nsxKeys = ["nsxmanager", "nsx_manager", "nsxmgr"];
  const wldKeys = ["workloaddomain", "wld_"];

  caps.hasAriaAutomation = hasPopulatedValue(entries, ariaAutoKeys);
  caps.hasAriaOperations = hasPopulatedValue(entries, ariaOpsKeys);
  caps.hasAriaLogs = hasPopulatedValue(entries, ariaLogsKeys);
  caps.hasAriaNetworks = hasPopulatedValue(entries, ariaNetKeys);
  caps.hasNsx = hasPopulatedValue(entries, nsxKeys);
  caps.hasWorkloadDomain = hasPopulatedValue(entries, wldKeys);

  return caps;
}

interface ConfigEntry {
  key: string;
  value: unknown;
}

function getAllEntries(obj: unknown, prefix = ""): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      entries.push({ key: fullKey.toLowerCase(), value });
      entries.push(...getAllEntries(value, fullKey));
    }
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      entries.push(...getAllEntries(obj[i], `${prefix}[${i}]`));
    }
  }
  return entries;
}

function hasPopulatedValue(entries: ConfigEntry[], patterns: string[]): boolean {
  for (const entry of entries) {
    if (!patterns.some((p) => entry.key.includes(p))) continue;
    if (looksLikeHostOrUrl(entry.value)) return true;
    if (entry.value && typeof entry.value === "object" && !Array.isArray(entry.value)) {
      const childEntries = getAllEntries(entry.value);
      if (childEntries.some((e) => looksLikeHostOrUrl(e.value))) return true;
    }
  }
  return false;
}

function looksLikeHostOrUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return true;
  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(v)) return true;
  if (/^https?:\/\/.+/.test(v)) return true;
  return false;
}

function hasPopulatedSection(obj: Record<string, unknown>, key: string): boolean {
  const value = obj[key];
  if (!value) return false;
  if (typeof value !== "object") return false;
  const entries = getAllEntries(value);
  return entries.some((e) => looksLikeHostOrUrl(e.value));
}
