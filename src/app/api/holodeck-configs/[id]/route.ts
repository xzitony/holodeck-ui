import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { executeCommand } from "@/lib/ssh";

/**
 * GET /api/holodeck-configs/[id] — get full details for a specific config
 * Returns local metadata + parsed config JSON with all deployment settings
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Look up by configId (not cuid)
  const config = await prisma.holoDeckConfig.findUnique({
    where: { configId: id },
  });

  if (!config) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

  let parsedJson: Record<string, unknown> = {};
  let deploymentSettings: Record<string, unknown> = {};
  if (config.cachedJson) {
    try {
      parsedJson = JSON.parse(config.cachedJson);
      deploymentSettings = extractFullSettings(parsedJson);
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    config: {
      id: config.id,
      configId: config.configId,
      description: config.description,
      notes: config.notes,
      lastSynced: config.lastSynced,
      createdAt: config.createdAt,
    },
    deploymentSettings,
    // Only send raw JSON to superadmins
    rawJson: user.role === "superadmin" ? parsedJson : undefined,
  });
}

/**
 * PUT /api/holodeck-configs/[id] — update local metadata
 * Body: { description?, notes? }
 * labadmin+ only
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "user") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { description, notes } = body;

  const config = await prisma.holoDeckConfig.findUnique({
    where: { configId: id },
  });

  if (!config) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

  const updated = await prisma.holoDeckConfig.update({
    where: { configId: id },
    data: {
      ...(description !== undefined && { description }),
      ...(notes !== undefined && { notes }),
    },
  });

  return NextResponse.json({ config: updated });
}

/**
 * DELETE /api/holodeck-configs/[id] — delete a config from the holorouter and local cache
 *
 * Removes the config JSON file from /holodeck-runtime/config/<id>.json on the
 * holorouter, then deletes the local DB record. labadmin+ only.
 *
 * Will refuse to delete a config that has a running instance.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "user") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const config = await prisma.holoDeckConfig.findUnique({
    where: { configId: id },
  });

  if (!config) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

  // Check if there's a running instance — don't delete if so
  if (config.cachedJson) {
    try {
      const json = JSON.parse(config.cachedJson);
      if (json.Instance) {
        return NextResponse.json(
          {
            error: `Cannot delete config "${id}" — it has a running instance "${json.Instance}". Remove the instance first.`,
          },
          { status: 409 }
        );
      }
    } catch {
      // ignore parse errors
    }
  }

  // Delete the file on the holorouter
  try {
    const escapedId = id.replace(/"/g, '`"');
    await executeCommand(
      `pwsh -NonInteractive -Command 'Remove-Item "/holodeck-runtime/config/${escapedId}.json" -Force -ErrorAction Stop; Write-Output "deleted"'`,
      undefined,
      15000
    );
  } catch (error) {
    // If the file doesn't exist on the holorouter, that's fine — still clean up locally
    const msg = error instanceof Error ? error.message : "";
    if (!msg.includes("does not exist") && !msg.includes("Cannot find path")) {
      return NextResponse.json(
        { error: `Failed to delete config file on holorouter: ${msg}` },
        { status: 500 }
      );
    }
  }

  // Remove from local DB
  await prisma.holoDeckConfig.delete({
    where: { configId: id },
  });

  return NextResponse.json({
    message: `Config "${id}" deleted from holorouter and local cache`,
  });
}

/**
 * Extract comprehensive deployment settings from config JSON.
 * These are the values that would be used when deploying with this config.
 */
function extractFullSettings(json: Record<string, unknown>): Record<string, unknown> {
  const s: Record<string, unknown> = {};

  // Core deployment parameters
  s.vcfVersion = json.VCFVersion || json.Version || null;
  s.instance = json.Instance || null;
  s.configId = json.ConfigID || null;
  s.description = json.Description || null;

  // Target infrastructure
  s.targetHost = json.TargetHost || null;
  s.targetUsername = json.Username || null;

  // Deployment options
  s.vsanMode = json.vSANMode || null;
  s.depotType = json.DepotType || null;
  s.dnsDomain = json.DNSDomain || null;
  s.site = json.Site || null;

  // Network
  s.cidr = json.CIDR || null;
  s.vlanRangeStart = json.VLANRangeStart || null;

  // Components
  s.managementOnly = json.ManagementOnly || false;
  s.vvf = json.VVF || false;
  s.nsxEdgeClusterMgmtDomain = json.NsxEdgeClusterMgmtDomain || false;
  s.nsxEdgeClusterWkldDomain = json.NsxEdgeClusterWkldDomain || false;
  s.deployVcfAutomation = json.DeployVcfAutomation || false;
  s.deploySupervisorMgmtDomain = json.DeploySupervisorMgmtDomain || false;
  s.deploySupervisorWldDomain = json.DeploySupervisorWldDomain || false;
  s.workloadDomainType = json.WorkloadDomainType || null;

  // DeveloperMode settings
  s.developerMode = json.DeveloperMode || false;
  s.datastoreName = json.DatastoreName || json.datastore_name || null;
  s.trunkPortGroupName = json.TrunkPortGroupName || json.trunk_port_group_name || null;
  s.clusterName = json.ClusterName || json.cluster_name || null;
  s.dcName = json.DcName || json.dc_name || null;

  // Depot info (offline)
  s.offlineDepotIp = json.OfflineDepotIP || json.offline_depot_ip || null;
  s.offlineDepotPort = json.OfflineDepotPort || json.offline_depot_port || null;

  // Site B
  const siteB = json.SiteB;
  s.hasSiteB = !!(siteB && typeof siteB === "object" && Object.keys(siteB as object).length > 0);

  return s;
}
