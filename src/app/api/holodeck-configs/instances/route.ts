import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  extractCapabilities,
  getDefaultCapabilities,
  type Capabilities,
} from "@/lib/capabilities";

/**
 * GET /api/holodeck-configs/instances — fast cached endpoint for the Environment page
 *
 * Returns all locally-cached configs with:
 *  - Summary fields (configId, description, instance, vcfVersion, etc.)
 *  - Pre-computed capabilities (hasSiteB, hasAriaAutomation, etc.)
 *  - Cache staleness info (lastSynced)
 *
 * This is a DB-only read — no SSH calls, instant response.
 * The client should call POST /api/holodeck-configs/sync in the background
 * to refresh the cache.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await prisma.holoDeckConfig.findMany({
    orderBy: { configId: "asc" },
  });

  const enriched = configs.map((c) => {
    let summary: Record<string, unknown> = {};
    let capabilities: Capabilities = getDefaultCapabilities();

    if (c.cachedJson) {
      try {
        const json = JSON.parse(c.cachedJson);
        summary = extractConfigSummary(json);
        capabilities = extractCapabilities(json);
      } catch {
        // ignore parse errors
      }
    }

    // Instance data comes from output.json (set during sync), NOT from config JSON.
    // Remove any stale Instance from config summary — it's unreliable there.
    delete summary.instance;

    let instanceStatus: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nodes: any[] | undefined;
    if (c.instanceJson) {
      try {
        const instData = JSON.parse(c.instanceJson);
        instanceStatus = instData.Status;
        if (instData.InstanceID) {
          summary.instance = instData.InstanceID;
        }
        const allNodes = [
          ...(instData.SiteA?.Nodes || []),
          ...(instData.SiteB?.Nodes || []),
        ];
        if (allNodes.length > 0) nodes = allNodes;
        if (instData.SiteB?.Nodes?.length > 0) {
          summary.hasSiteB = true;
        }
      } catch {
        // ignore
      }
    }

    // Parse deployment execution state
    let deploymentState: string | undefined;
    if (c.stateJson) {
      try {
        const stateData = JSON.parse(c.stateJson);
        deploymentState = stateData["New-HoloDeckInstance"]?.status;
      } catch {
        // ignore
      }
    }

    return {
      configId: c.configId,
      description: c.description,
      notes: c.notes,
      lastSynced: c.lastSynced,
      capabilities,
      instanceStatus,
      deploymentState,
      nodes,
      ...summary,
    };
  });

  return NextResponse.json({
    configs: enriched,
    cached: true,
    // Tell the client if cache might be stale (older than 5 minutes)
    stale: enriched.length === 0 || enriched.some((c) => {
      if (!c.lastSynced) return true;
      const age = Date.now() - new Date(c.lastSynced).getTime();
      return age > 5 * 60 * 1000;
    }),
  });
}

function extractConfigSummary(json: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  if (json.VCFVersion) summary.vcfVersion = json.VCFVersion;
  if (json.Version) summary.vcfVersion = json.Version;
  // Instance is a runtime property — sourced from instanceJson, not config JSON
  if (json.ConfigID) summary.remoteConfigId = json.ConfigID;

  // Target host (check both flat and nested forms)
  const target = json.Target as Record<string, unknown> | undefined;
  if (json.TargetHost) summary.targetHost = json.TargetHost;
  if (target?.hostname) summary.targetHost = target.hostname;

  if (json.vSANMode) summary.vsanMode = json.vSANMode;
  if (json.DepotType) summary.depotType = json.DepotType;
  if (json.DNSDomain) summary.dnsDomain = json.DNSDomain;
  if (json.Description) summary.remoteDescription = json.Description;
  if (json.description) summary.remoteDescription = json.description;

  // Extract from nested sddc config if top-level is missing
  const sddcSiteA = (json["holodeck-sddc"] as Record<string, unknown>)?.["Site-A"] as Record<string, unknown> | undefined;
  if (!summary.vcfVersion && sddcSiteA?.version) summary.vcfVersion = sddcSiteA.version;
  if (!summary.dnsDomain && sddcSiteA?.domain) summary.dnsDomain = sddcSiteA.domain;
  if (!summary.depotType && sddcSiteA) {
    const installer = sddcSiteA["vcf-installer"] as Record<string, unknown> | undefined;
    if (installer?.depotType) summary.depotType = (installer.depotType as string).charAt(0).toUpperCase() + (installer.depotType as string).slice(1);
  }

  if (
    json.SiteB &&
    typeof json.SiteB === "object" &&
    Object.keys(json.SiteB as object).length > 0
  ) {
    summary.hasSiteB = true;
  }

  return summary;
}
