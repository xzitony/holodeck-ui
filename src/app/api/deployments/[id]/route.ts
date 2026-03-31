import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  isTmuxSessionAlive,
  captureTmuxOutput,
  killTmuxSession,
} from "@/lib/ssh";
import { sendDeploymentNotification } from "@/lib/email";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";

const LOGS_DIR = path.join(process.cwd(), "data", "deployment-logs");

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

async function saveDeploymentLog(jobId: string, sessionName: string): Promise<string | null> {
  try {
    // Capture full output (up to 10000 lines)
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
 * GET /api/deployments/[id] — get job status and output
 * Query param: ?lines=500 to control output length
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
  const job = await prisma.backgroundJob.findUnique({
    where: { id },
    include: { user: { select: { displayName: true, username: true } } },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const lines = parseInt(searchParams.get("lines") || "500", 10);

  // Check if session is still alive and capture output
  let output = "";
  let alive = false;

  if (job.status === "running") {
    alive = await isTmuxSessionAlive(job.sessionName);
    output = await captureTmuxOutput(job.sessionName, lines);

    // If session ended, save log and update job status
    if (!alive) {
      const now = new Date();
      const logFile = await saveDeploymentLog(id, job.sessionName);
      await prisma.backgroundJob.update({
        where: { id },
        data: {
          status: "completed",
          completedAt: now,
          logFile,
        },
      });
      job.status = "completed";
      job.completedAt = now;
      job.logFile = logFile;

      // Send email notification
      let notifyUserEmail: string | undefined;
      try {
        const jobParams = JSON.parse(job.parameters || "{}");
        if (jobParams.notifyEmail) {
          const dbUser = await prisma.user.findUnique({ where: { id: job.userId }, select: { email: true } });
          if (dbUser?.email) notifyUserEmail = dbUser.email;
        }
      } catch {}
      sendDeploymentNotification({
        status: "completed",
        name: job.name,
        userName: job.user?.displayName || job.user?.username || "Unknown",
        duration: formatDuration(job.startedAt, now),
        notifyUserEmail,
      }).catch(() => {}); // fire-and-forget
    }
  } else if (job.logFile) {
    // Job completed and log was saved — read from file
    try {
      output = await readFile(job.logFile, "utf-8");
    } catch {
      output = "[Log file not found]";
    }
  } else {
    // Job finished but no saved log — try tmux (may return [session ended])
    output = await captureTmuxOutput(job.sessionName, lines);
  }

  return NextResponse.json({
    job: {
      id: job.id,
      name: job.name,
      mode: job.mode,
      status: job.status,
      sessionName: job.sessionName,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      user: job.user,
      hasLog: !!job.logFile,
    },
    output,
    alive,
  });
}

/**
 * DELETE /api/deployments/[id] — cancel/kill a running deployment
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only superadmin can kill deployments
  if (user.role !== "superadmin") {
    return NextResponse.json({ error: "Only super admins can cancel deployments" }, { status: 403 });
  }

  const { id } = await params;
  const job = await prisma.backgroundJob.findUnique({ where: { id } });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "running") {
    return NextResponse.json({ error: "Job is not running" }, { status: 400 });
  }

  // Save log before killing
  const now = new Date();
  const logFile = await saveDeploymentLog(id, job.sessionName);
  await killTmuxSession(job.sessionName);
  await prisma.backgroundJob.update({
    where: { id },
    data: {
      status: "failed",
      completedAt: now,
      logFile,
    },
  });

  // Send email notification
  let notifyUserEmail: string | undefined;
  try {
    const jobParams = JSON.parse(job.parameters || "{}");
    if (jobParams.notifyEmail) {
      const dbUser = await prisma.user.findUnique({ where: { id: job.userId }, select: { email: true } });
      if (dbUser?.email) notifyUserEmail = dbUser.email;
    }
  } catch {}
  sendDeploymentNotification({
    status: "failed",
    name: job.name,
    userName: user.username,
    duration: formatDuration(job.startedAt, now),
    notifyUserEmail,
  }).catch(() => {}); // fire-and-forget

  return NextResponse.json({ message: "Deployment cancelled" });
}
