import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFile } from "fs/promises";

/**
 * GET /api/deployments/[id]/log — download saved deployment log as a text file
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
  const job = await prisma.backgroundJob.findUnique({ where: { id } });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (!job.logFile) {
    return NextResponse.json({ error: "No log file available" }, { status: 404 });
  }

  try {
    const content = await readFile(job.logFile, "utf-8");
    const filename = `${job.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_${job.id}.log`;

    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Log file not found on disk" }, { status: 404 });
  }
}
