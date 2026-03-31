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

    return {
      configId: c.configId,
      description: c.description,
      notes: c.notes,
      lastSynced: c.lastSynced,
      capabilities,
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
  if (json.Instance) summary.instance = json.Instance;
  if (json.ConfigID) summary.remoteConfigId = json.ConfigID;
  if (json.TargetHost) summary.targetHost = json.TargetHost;
  if (json.vSANMode) summary.vsanMode = json.vSANMode;
  if (json.DepotType) summary.depotType = json.DepotType;
  if (json.DNSDomain) summary.dnsDomain = json.DNSDomain;
  if (json.Description) summary.remoteDescription = json.Description;

  if (
    json.SiteB &&
    typeof json.SiteB === "object" &&
    Object.keys(json.SiteB as object).length > 0
  ) {
    summary.hasSiteB = true;
  }

  return summary;
}
