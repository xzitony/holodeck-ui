import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import os from "os";

const startTime = Date.now();

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const uptimeMs = Date.now() - startTime;
  const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

  return NextResponse.json({
    version: process.env.npm_package_version || "1.0.0",
    gitSha: process.env.NEXT_PUBLIC_GIT_SHA || "dev",
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || "dev",
    nodeVersion: process.version,
    hostname: os.hostname(),
    environment: process.env.NODE_ENV || "development",
    uptime: `${uptimeHours}h ${uptimeMins}m`,
    uptimeMs,
  });
}
