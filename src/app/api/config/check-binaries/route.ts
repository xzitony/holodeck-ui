import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { executeCommand } from "@/lib/ssh";

/**
 * GET /api/config/check-binaries?version=9.0.2.0
 *
 * Checks if deployment binaries (ESX ISO, VCF Installer OVA) exist in
 * /holodeck-runtime/bin/{version}/ on the holorouter.
 */
export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const version = request.nextUrl.searchParams.get("version");
  if (!version || !/^[0-9.]+$/.test(version)) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  try {
    const binPath = `/holodeck-runtime/bin/${version}/`;
    const result = await executeCommand(
      `ls -1 '${binPath}' 2>/dev/null | head -20`,
      undefined,
      10000
    );

    const files = result.stdout
      .trim()
      .split("\n")
      .filter((f: string) => f.length > 0);

    return NextResponse.json({
      version,
      path: binPath,
      found: files.length > 0,
      fileCount: files.length,
      files,
    });
  } catch {
    return NextResponse.json({
      version,
      path: `/holodeck-runtime/bin/${version}/`,
      found: false,
      fileCount: 0,
      files: [],
      error: "Unable to check binaries — SSH connection may not be configured",
    });
  }
}
