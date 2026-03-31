import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { spawnTmuxSession, buildDeveloperModeEnvBlock } from "@/lib/ssh";
import { checkReservationAccess } from "@/lib/reservation-guard";

/**
 * POST /api/day2 — start a Day 2 operation (long-running, tracked via backgroundJob)
 *
 * Body: {
 *   operation: "add-cluster" | "add-esxi-nodes" | "add-vcf-automation",
 *   site?: "a" | "b",
 *   domain?: "Management" | "Workload",
 *   count?: number,  // for add-esxi-nodes
 * }
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only labadmin+ can run Day 2 ops
  if (user.role === "user") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Lab admins need an active reservation; super admins bypass
  const reservationCheck = await checkReservationAccess(
    user.userId,
    user.role as "superadmin" | "labadmin" | "user"
  );
  if (!reservationCheck.allowed) {
    return NextResponse.json({ error: reservationCheck.message }, { status: 403 });
  }

  const body = await request.json();
  const { operation, site = "a", domain, count, configId } = body;

  if (!operation) {
    return NextResponse.json({ error: "operation is required" }, { status: 400 });
  }

  if (!configId) {
    return NextResponse.json({ error: "configId is required — select a target instance" }, { status: 400 });
  }

  // Validate inputs per operation
  let command: string;
  let jobName: string;

  switch (operation) {
    case "add-cluster": {
      if (!domain) {
        return NextResponse.json({ error: "domain is required for add-cluster" }, { status: 400 });
      }
      command = `Update-HoloDeckInstance -Site '${site}' -AdditionalCluster -VIDomain '${domain}'`;
      jobName = `Add Cluster (${domain}, Site ${site.toUpperCase()})`;
      break;
    }
    case "add-esxi-nodes": {
      const nodeCount = parseInt(count, 10);
      if (!nodeCount || nodeCount < 1) {
        return NextResponse.json({ error: "count must be a positive number" }, { status: 400 });
      }
      command = `New-HoloDeckESXiNodes -Count ${nodeCount}`;
      jobName = `Add ${nodeCount} ESXi Node${nodeCount > 1 ? "s" : ""}`;
      break;
    }
    case "add-vcf-automation": {
      if (!domain) {
        return NextResponse.json({ error: "domain is required for add-vcf-automation" }, { status: 400 });
      }
      command = `Update-HoloDeckInstance -Site '${site}' -AddVcfAutomationAllAppsOrg -VIDomain '${domain}'`;
      jobName = `Add VCF Automation (${domain}, Site ${site.toUpperCase()})`;
      break;
    }
    default:
      return NextResponse.json({ error: `Unknown operation: ${operation}` }, { status: 400 });
  }

  try {
    // Build environment block for DeveloperMode context
    const envBlock = await buildDeveloperModeEnvBlock(site as "a" | "b");

    // Load the target config on the holorouter first
    const escapedConfigId = configId.replace(/"/g, '`"');
    const importCmd = `Import-HoloDeckConfig -ConfigID "${escapedConfigId}"`;

    // Full script: set env vars → load config → run command
    const fullScript = [envBlock, importCmd, command].filter(Boolean).join("; ");
    const pwshCommand = `pwsh -NonInteractive -Command '${fullScript.replace(/'/g, "'\\''")}'`;

    const sessionName = `day2-${operation}-${Date.now()}`;

    await spawnTmuxSession(sessionName, pwshCommand);

    const job = await prisma.backgroundJob.create({
      data: {
        userId: user.userId,
        name: jobName,
        sessionName,
        mode: `day2-${operation}`,
        parameters: JSON.stringify(body),
        command: fullScript,
        status: "running",
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: user.userId,
        action: "day2_operation",
        details: JSON.stringify({
          operation,
          jobId: job.id,
          jobName,
          site,
          domain,
          count,
        }),
        status: "success",
      },
    });

    return NextResponse.json({ message: "Day 2 operation started", jobId: job.id, sessionName });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start operation" },
      { status: 500 }
    );
  }
}
