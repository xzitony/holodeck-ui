import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  spawnTmuxSession,
  buildDeveloperModeEnvBlock,
  executeCommand,
  killTmuxSession,
} from "@/lib/ssh";
import { checkReservationAccess } from "@/lib/reservation-guard";
import { reconcileRunningJobs } from "@/lib/job-reconciler";

/**
 * GET /api/deployments — list all background jobs
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reconcile any stale "running" jobs before listing
  await reconcileRunningJobs();

  const jobs = await prisma.backgroundJob.findMany({
    orderBy: { startedAt: "desc" },
    include: { user: { select: { displayName: true, username: true } } },
  });

  return NextResponse.json({ jobs });
}

/**
 * DELETE /api/deployments — clear completed/failed job history
 * Only labadmin+ can clear. Running jobs are never deleted.
 */
export async function DELETE(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role === "user") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Find all non-running jobs
  const finishedJobs = await prisma.backgroundJob.findMany({
    where: { status: { not: "running" } },
  });

  // Clean up tmux sessions (remain-on-exit dead panes)
  for (const job of finishedJobs) {
    await killTmuxSession(job.sessionName);
  }

  // Delete from database
  const result = await prisma.backgroundJob.deleteMany({
    where: { status: { not: "running" } },
  });

  return NextResponse.json({ deleted: result.count });
}

/**
 * POST /api/deployments — start a new deployment
 *
 * Body: {
 *   mode: "vvf" | "management" | "fullstack" | "dualsite",
 *   instanceId: string,
 *   version?: string,         // overrides global config
 *   site?: string,            // "a" or "b", default "a"
 *   vsanMode?: string,        // "ESA" or "OSA"
 *   depotType?: string,       // "Online" or "Offline"
 *   dnsDomain?: string,
 *   cidr?: string[],
 *   vlanRangeStart?: number[],
 *   logLevel?: string,
 *   // Mode-specific flags:
 *   nsxEdgeClusterMgmtDomain?: boolean,
 *   nsxEdgeClusterWkldDomain?: boolean,
 *   deployVcfAutomation?: boolean,
 *   deploySupervisorMgmtDomain?: boolean,
 *   deploySupervisorWldDomain?: boolean,
 *   workloadDomainType?: string,  // "SharedSSO" | "IsolatedSSO"
 *   provisionOnly?: boolean,
 *   // For dual-site: siteB parameters
 *   siteBCidr?: string[],
 *   siteBVlanRangeStart?: number[],
 * }
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only labadmin+ can deploy
  if (user.role === "user") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Lab admins need an active reservation; super admins bypass
  const reservationCheck = await checkReservationAccess(user.userId, user.role as "superadmin" | "labadmin" | "user");
  if (!reservationCheck.allowed) {
    return NextResponse.json({ error: reservationCheck.message }, { status: 403 });
  }

  const body = await request.json();
  const {
    mode,
    instanceId,
    site = "a",
    version,
    vsanMode,
    depotType,
    dnsDomain,
    cidr,
    vlanRangeStart,
    logLevel,
    nsxEdgeClusterMgmtDomain,
    nsxEdgeClusterWkldDomain,
    deployVcfAutomation,
    deploySupervisorMgmtDomain,
    deploySupervisorWldDomain,
    workloadDomainType,
    provisionOnly,
    siteBCidr,
    siteBVlanRangeStart,
    datastoreName,
    trunkPortGroupName,
    trunkPortGroupNameSiteB,
    clusterName,
    dcName,
  } = body;

  if (!mode || !instanceId) {
    return NextResponse.json({ error: "mode and instanceId are required" }, { status: 400 });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(instanceId)) {
    return NextResponse.json({ error: "Invalid instanceId format" }, { status: 400 });
  }

  // Resolve deployment settings from config JSON — configId is required
  const configId = body.configId;
  if (!configId) {
    return NextResponse.json({ error: "A Holodeck configuration must be selected before deploying" }, { status: 400 });
  }
  let configJson: Record<string, unknown> = {};
  {
    const holoDeckConfig = await prisma.holoDeckConfig.findUnique({
      where: { configId },
    });
    if (holoDeckConfig?.cachedJson) {
      try {
        configJson = JSON.parse(holoDeckConfig.cachedJson);
      } catch {
        // ignore parse errors, fall back to global config
      }
    }
  }

  // Fall back to global config for values not in config JSON
  const globalConfigs = await prisma.globalConfig.findMany({
    where: {
      key: { in: ["vcf_version", "default_vsan_mode", "default_dns_domain", "depot_type"] },
    },
  });
  const gcMap = new Map(globalConfigs.map((c) => [c.key, c.value]));

  // Config JSON takes priority, then user-provided values, then global config
  const resolvedVersion = version
    || (configJson.VCFVersion as string) || (configJson.Version as string)
    || gcMap.get("vcf_version") || "9.0.2.0"; // fallback to latest known version
  const resolvedVsanMode = vsanMode
    || (configJson.vSANMode as string)
    || gcMap.get("default_vsan_mode") || "ESA";
  const resolvedDepotType = depotType
    || (configJson.DepotType as string)
    || gcMap.get("depot_type") || "Offline";
  const resolvedDnsDomain = dnsDomain
    || (configJson.DNSDomain as string)
    || gcMap.get("default_dns_domain") || "vcf.lab";
  // Build DeveloperMode env var block (with per-deployment overrides)
  const infraOverrides = { datastoreName, trunkPortGroupName, trunkPortGroupNameSiteB, clusterName, dcName };
  const envBlock = await buildDeveloperModeEnvBlock(site as "a" | "b", infraOverrides);

  // Import the existing config, then build New-HoloDeckInstance command
  const importCmd = `Import-HoloDeckConfig -ConfigID '${configId}' | Out-Null`;

  const params: string[] = [
    `-Version '${resolvedVersion}'`,
    `-InstanceID '${instanceId}'`,
    `-Site '${site}'`,
    `-vSANMode '${resolvedVsanMode}'`,
    `-DepotType '${resolvedDepotType}'`,
    `-DNSDomain '${resolvedDnsDomain}'`,
    `-DeveloperMode`,
  ];

  // Mode-specific flags
  if (mode === "vvf") {
    params.push("-VVF");
  } else if (mode === "management") {
    params.push("-ManagementOnly");
  }
  // fullstack has no special flag

  // Optional flags
  if (nsxEdgeClusterMgmtDomain) params.push("-NsxEdgeClusterMgmtDomain");
  if (nsxEdgeClusterWkldDomain) params.push("-NsxEdgeClusterWkldDomain");
  if (deployVcfAutomation) params.push("-DeployVcfAutomation");
  if (deploySupervisorMgmtDomain) params.push("-DeploySupervisorMgmtDomain");
  if (deploySupervisorWldDomain) params.push("-DeploySupervisorWldDomain");
  if (provisionOnly) params.push("-ProvisionOnly");
  if (workloadDomainType) params.push(`-WorkloadDomainType '${workloadDomainType}'`);
  if (logLevel) params.push(`-LogLevel '${logLevel}'`);
  if (cidr && cidr.length > 0) params.push(`-CIDR '${cidr.join("','")}'`);
  if (vlanRangeStart && vlanRangeStart.length > 0) params.push(`-VLANRangeStart ${vlanRangeStart.join(",")}`);

  const deployCmd = `New-HoloDeckInstance ${params.join(" ")}`;

  // Full script: set env vars → import config → deploy
  const fullScript = [envBlock, importCmd, deployCmd].filter(Boolean).join("; ");

  // Wrap in pwsh
  const pwshCommand = `pwsh -NonInteractive -Command '${fullScript.replace(/'/g, "'\\''")}'`;

  const sessionName = `holodeck-${instanceId}-${Date.now()}`;
  const modeLabels: Record<string, string> = {
    vvf: "VVF",
    management: "Management Only",
    fullstack: "Full Stack",
    dualsite: "Dual Site",
  };

  try {
    // For dual-site, we need pre-setup commands first
    if (mode === "dualsite") {
      const siteACidr = cidr?.[0] || "10.1.0.0/20";
      const siteBCidrVal = siteBCidr?.[0] || "10.2.0.0/20";
      const siteAVlan = vlanRangeStart?.[0] || 10;
      const siteBVlan = siteBVlanRangeStart?.[0] || 40;

      const dualSetup = [
        `New-HoloDeckNetworkConfig -Site a -MasterCIDR '${siteACidr}' -VLANRangeStart ${siteAVlan}`,
        `New-HoloDeckNetworkConfig -Site b -MasterCIDR '${siteBCidrVal}' -VLANRangeStart ${siteBVlan}`,
        `Set-HoloRouter -dualsite`,
      ].join("; ");

      const setupScript = `pwsh -NonInteractive -Command '${dualSetup.replace(/'/g, "'\\''")}'`;
      await executeCommand(setupScript, undefined, 60000);

      // Site A deployment
      const siteASession = `${sessionName}-a`;
      await spawnTmuxSession(siteASession, pwshCommand);

      await prisma.backgroundJob.create({
        data: {
          userId: user.userId,
          name: `${modeLabels[mode]} - Site A (${instanceId})`,
          sessionName: siteASession,
          mode,
          parameters: JSON.stringify(body),
          command: fullScript,
          status: "running",
        },
      });

      // Site B deployment (modify params for site b)
      const siteBParams = params.map((p) => {
        if (p === `-Site '${site}'`) return `-Site 'b'`;
        // Site B needs both CIDRs
        if (p.startsWith("-CIDR")) return `-CIDR '${siteACidr}','${siteBCidrVal}'`;
        if (p.startsWith("-VLANRangeStart")) return `-VLANRangeStart ${siteAVlan},${siteBVlan}`;
        return p;
      });
      const siteBDeployCmd = `New-HoloDeckInstance ${siteBParams.join(" ")}`;
      const envBlockB = await buildDeveloperModeEnvBlock("b", infraOverrides);
      const siteBScript = [envBlockB, importCmd, siteBDeployCmd].filter(Boolean).join("; ");
      const siteBPwsh = `pwsh -NonInteractive -Command '${siteBScript.replace(/'/g, "'\\''")}'`;

      const siteBSession = `${sessionName}-b`;
      await spawnTmuxSession(siteBSession, siteBPwsh);

      const jobB = await prisma.backgroundJob.create({
        data: {
          userId: user.userId,
          name: `${modeLabels[mode]} - Site B (${instanceId})`,
          sessionName: siteBSession,
          mode,
          parameters: JSON.stringify({ ...body, site: "b" }),
          command: siteBScript,
          status: "running",
        },
      });

      return NextResponse.json({
        message: "Dual-site deployment started",
        jobs: [siteASession, siteBSession],
      });
    }

    // Single-site deployment
    await spawnTmuxSession(sessionName, pwshCommand);

    const job = await prisma.backgroundJob.create({
      data: {
        userId: user.userId,
        name: `${modeLabels[mode]} (${instanceId})`,
        sessionName,
        mode,
        parameters: JSON.stringify(body),
        command: fullScript,
        status: "running",
      },
    });

    return NextResponse.json({ message: "Deployment started", jobId: job.id, sessionName });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start deployment" },
      { status: 500 }
    );
  }
}
