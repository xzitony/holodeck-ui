import { prisma } from "./db";
import { isTmuxSessionAlive, captureTmuxOutput, killTmuxSession } from "./ssh";
import { sendDeploymentNotification } from "./email";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const LOGS_DIR = path.join(process.cwd(), "data", "deployment-logs");

// Throttle: don't reconcile more than once every 10 seconds
let lastReconcileTime = 0;
const THROTTLE_MS = 10_000;

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

async function saveJobLog(jobId: string, sessionName: string): Promise<string | null> {
  try {
    const output = await captureTmuxOutput(sessionName, 10000);
    if (!output || output.trim() === "[session ended]") return null;

    await mkdir(LOGS_DIR, { recursive: true });
    const logPath = path.join(LOGS_DIR, `${jobId}.log`);
    await writeFile(logPath, output, "utf-8");
    return logPath;
  } catch {
    return null;
  }
}

/**
 * Check all "running" background jobs and mark any with dead tmux sessions
 * as completed. Throttled to avoid hammering SSH on every API call.
 */
export async function reconcileRunningJobs(): Promise<void> {
  const now = Date.now();
  if (now - lastReconcileTime < THROTTLE_MS) return;
  lastReconcileTime = now;

  const runningJobs = await prisma.backgroundJob.findMany({
    where: { status: "running" },
    include: { user: { select: { displayName: true, username: true, email: true } } },
  });

  if (runningJobs.length === 0) return;

  for (const job of runningJobs) {
    try {
      const alive = await isTmuxSessionAlive(job.sessionName);
      if (alive) continue;

      // Session is dead — save log and mark completed
      const completedAt = new Date();
      const logFile = await saveJobLog(job.id, job.sessionName);

      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          completedAt,
          logFile,
        },
      });

      // Send email notification
      let notifyUserEmail: string | undefined;
      try {
        const jobParams = JSON.parse(job.parameters || "{}");
        if (jobParams.notifyEmail && job.user?.email) {
          notifyUserEmail = job.user.email;
        }
      } catch {}
      sendDeploymentNotification({
        status: "completed",
        name: job.name,
        userName: job.user?.displayName || job.user?.username || "Unknown",
        duration: formatDuration(job.startedAt, completedAt),
        notifyUserEmail,
      }).catch(() => {}); // fire-and-forget
    } catch {
      // If SSH is unreachable, skip — don't mark jobs as failed
    }
  }
}
