import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  extractCapabilities,
  getDefaultCapabilities,
  type Capabilities,
} from "@/lib/capabilities";

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
    let instance: string | undefined;
    let vcfVersion: string | undefined;
    let targetHost: string | undefined;
    let remoteDescription: string | undefined;

    if (c.cachedJson) {
      try {
        const json = JSON.parse(c.cachedJson);
        capabilities = extractCapabilities(json);
        if (json.Instance) instance = json.Instance;
        vcfVersion = json.VCFVersion || json.Version;
        if (json.Target?.hostname) targetHost = json.Target.hostname;
        if (json.TargetHost) targetHost = json.TargetHost;
        if (json.Description) remoteDescription = json.Description;
      } catch {
        // ignore
      }
    }

    const configJobs = jobsByConfig.get(c.configId) || [];
    const runningJobs = configJobs.filter((j) => j.status === "running");
    const mostRecentJob = configJobs[0]; // already sorted desc

    // Compute state
    let state: InstanceState = "not_deployed";
    if (instance) {
      state = "running";
    } else if (runningJobs.length > 0) {
      state = "deploying";
    } else if (mostRecentJob) {
      if (mostRecentJob.status === "failed") state = "failed";
      else if (mostRecentJob.status === "completed") state = "completed";
    }

    // Build job summaries
    let activeJob: JobSummary | undefined;
    let lastJob: JobSummary | undefined;

    if (runningJobs.length > 0) {
      const j = runningJobs[0];
      activeJob = {
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
      vcfVersion,
      targetHost,
      remoteDescription,
      state,
      activeJob,
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
