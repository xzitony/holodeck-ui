import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  extractCapabilities,
  getDefaultCapabilities,
  type Capabilities,
} from "@/lib/capabilities";
import { reconcileRunningJobs } from "@/lib/job-reconciler";

type InstanceState = "not_deployed" | "deploying" | "running" | "failed" | "completed";

interface JobSummary {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  userName: string;
}

/**
 * GET /api/instances — unified view of configs + deployment status
 *
 * Merges HoloDeckConfig data with BackgroundJob status to provide
 * a single state per config: not_deployed, deploying, running, failed, completed.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reconcile any stale "running" jobs before reading state
  await reconcileRunningJobs();

  const [configs, jobs] = await Promise.all([
    prisma.holoDeckConfig.findMany({ orderBy: { configId: "asc" } }),
    prisma.backgroundJob.findMany({
      orderBy: { startedAt: "desc" },
      include: { user: { select: { displayName: true, username: true } } },
    }),
  ]);

  // Index jobs by configId (parsed from parameters JSON)
  const jobsByConfig = new Map<string, typeof jobs>();
  for (const job of jobs) {
    try {
      const params = JSON.parse(job.parameters || "{}");
      const cfgId = params.configId;
      if (cfgId) {
        const existing = jobsByConfig.get(cfgId) || [];
        existing.push(job);
        jobsByConfig.set(cfgId, existing);
      }
    } catch {
      // skip jobs with unparseable parameters
    }
  }

  const instances = configs.map((c) => {
    let capabilities: Capabilities = getDefaultCapabilities();
    let vcfVersion: string | undefined;
    let targetHost: string | undefined;
    let remoteDescription: string | undefined;

    if (c.cachedJson) {
      try {
        const json = JSON.parse(c.cachedJson);
        capabilities = extractCapabilities(json);
        vcfVersion = json.VCFVersion || json.Version;
        if (json.Target?.hostname) targetHost = json.Target.hostname;
        if (json.TargetHost) targetHost = json.TargetHost;
        if (json.Description) remoteDescription = json.Description;
      } catch {
        // ignore
      }
    }

    // Instance data comes from output.json (set during sync), NOT from config JSON.
    // The Instance ID is a runtime property only present in Get-HoloDeckConfig list output.
    let instance: string | undefined;
    let instanceStatus: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nodes: any[] | undefined;
    if (c.instanceJson) {
      try {
        const instData = JSON.parse(c.instanceJson);
        instance = instData.InstanceID;
        instanceStatus = instData.Status;
        const allNodes = [
          ...(instData.SiteA?.Nodes || []),
          ...(instData.SiteB?.Nodes || []),
        ];
        if (allNodes.length > 0) nodes = allNodes;
      } catch {
        // ignore
      }
    }

    // Parse deployment execution state from state file
    let deploymentState: string | undefined;
    if (c.stateJson) {
      try {
        const stateData = JSON.parse(c.stateJson);
        deploymentState = stateData["New-HoloDeckInstance"]?.status;
      } catch {
        // ignore
      }
    }

    const configJobs = jobsByConfig.get(c.configId) || [];
    const runningJobs = configJobs.filter((j) => j.status === "running");
    const runningDay2Jobs = runningJobs.filter((j) => j.mode.startsWith("day2-"));
    const runningDeployJobs = runningJobs.filter((j) => !j.mode.startsWith("day2-"));
    const mostRecentJob = configJobs[0]; // already sorted desc

    // Compute state using validated instance status from Get-HoloDeckInstance
    let state: InstanceState = "not_deployed";
    if (instance && instanceStatus) {
      // Instance exists and was validated — use the real status
      state = instanceStatus.toLowerCase() === "completed" ? "running" : "deploying";
    } else if (runningDeployJobs.length > 0) {
      state = "deploying";
    } else if (mostRecentJob) {
      if (mostRecentJob.status === "failed") state = "failed";
      else if (mostRecentJob.status === "completed") state = "completed";
    }

    // Build job summaries
    let activeJob: JobSummary | undefined;
    let activeDay2Job: JobSummary | undefined;
    let lastJob: JobSummary | undefined;

    // Active deployment job (non-Day2)
    if (runningDeployJobs.length > 0) {
      const j = runningDeployJobs[0];
      activeJob = {
        id: j.id,
        name: j.name,
        status: j.status,
        startedAt: j.startedAt.toISOString(),
        completedAt: null,
        userName: j.user.displayName,
      };
    }

    // Active Day 2 job (shown separately so running instances can display it)
    if (runningDay2Jobs.length > 0) {
      const j = runningDay2Jobs[0];
      activeDay2Job = {
        id: j.id,
        name: j.name,
        status: j.status,
        startedAt: j.startedAt.toISOString(),
        completedAt: null,
        userName: j.user.displayName,
      };
    }

    if (mostRecentJob && mostRecentJob.status !== "running") {
      lastJob = {
        id: mostRecentJob.id,
        name: mostRecentJob.name,
        status: mostRecentJob.status,
        startedAt: mostRecentJob.startedAt.toISOString(),
        completedAt: mostRecentJob.completedAt?.toISOString() || null,
        userName: mostRecentJob.user.displayName,
      };
    }

    return {
      configId: c.configId,
      description: c.description,
      notes: c.notes,
      lastSynced: c.lastSynced,
      capabilities,
      instance,
      instanceStatus,
      deploymentState,
      nodes,
      vcfVersion,
      targetHost,
      remoteDescription,
      state,
      activeJob,
      activeDay2Job,
      lastJob,
      jobCount: configJobs.length,
    };
  });

  // Also include stale flag
  const stale = instances.length === 0 || instances.some((i) => {
    if (!i.lastSynced) return true;
    const age = Date.now() - new Date(i.lastSynced).getTime();
    return age > 5 * 60 * 1000;
  });

  return NextResponse.json({ instances, stale });
}
