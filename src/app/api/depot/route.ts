import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  executeDepotCommand,
  spawnDepotTmuxSession,
  isTmuxSessionAlive,
  captureTmuxOutput,
  killTmuxSession,
} from "@/lib/ssh";

const DEPOT_STORE = "/var/www/build";
const VDT_BIN = "/root/vdt/bin/vcf-download-tool";
const TOKEN_TMP = "/tmp/.holodeck-depot-token";

/**
 * GET — scan the depot appliance for what's currently downloaded.
 * Returns directory listing of the depot store.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || (user.role !== "labadmin" && user.role !== "superadmin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  // Check tmux session status for a running download
  if (action === "status") {
    const sessionName = searchParams.get("session") || "depot-download";
    const alive = await isTmuxSessionAlive(sessionName);
    const output = await captureTmuxOutput(sessionName, 500);
    return NextResponse.json({ alive, output });
  }

  // "check" action: combined scan + Broadcom list in a single SSH call
  if (action === "check") {
    const vcfVersion = searchParams.get("version") || "";
    if (!vcfVersion || !/^[\d.]+$/.test(vcfVersion)) {
      return NextResponse.json({ error: "Version is required" }, { status: 400 });
    }

    // Get download token
    const tokenRow = await prisma.globalConfig.findUnique({
      where: { key: "online_depot_token" },
    });
    const token = tokenRow?.value;
    if (!token) {
      return NextResponse.json(
        { error: "Broadcom download token not configured in Global Config" },
        { status: 400 }
      );
    }

    const escapedToken = token.replace(/'/g, "'\\''");

    try {
      // Single SSH call: scan depot files, then run VDT list — separated by a marker
      const combinedCmd = `sudo bash -c '
        if [ ! -d "${DEPOT_STORE}" ]; then echo "ERROR: ${DEPOT_STORE} does not exist"; exit 1; fi;
        find ${DEPOT_STORE} -type f | head -500 | while read f; do size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null); echo "$size|$f"; done;
        echo "---TOTAL---";
        du -sh ${DEPOT_STORE} 2>/dev/null | cut -f1;
        echo "---LIST---";
        echo '"'"'${escapedToken}'"'"' > ${TOKEN_TMP} && chmod 600 ${TOKEN_TMP};
        cd /root/vdt/bin && ./vcf-download-tool binaries list --depot-download-token-file=${TOKEN_TMP} --vcf-version=${vcfVersion} 2>&1;
        rm -f ${TOKEN_TMP}
      '`;

      const result = await executeDepotCommand(combinedCmd, 90000);
      const stdout = result.stdout || "";

      // Check for error
      if (stdout.startsWith("ERROR:")) {
        return NextResponse.json({ error: stdout.trim() }, { status: 500 });
      }

      // Split output at markers
      const listMarkerIdx = stdout.indexOf("---LIST---");
      const scanPart = listMarkerIdx >= 0 ? stdout.substring(0, listMarkerIdx) : stdout;
      const listPart = listMarkerIdx >= 0 ? stdout.substring(listMarkerIdx + "---LIST---".length) : "";

      // Parse scan
      const scanLines = scanPart.trim().split("\n");
      const totalMarkerIdx = scanLines.indexOf("---TOTAL---");
      const fileLines = totalMarkerIdx >= 0 ? scanLines.slice(0, totalMarkerIdx) : scanLines;
      const totalSize = totalMarkerIdx >= 0 && totalMarkerIdx + 1 < scanLines.length ? scanLines[totalMarkerIdx + 1].trim() : "";

      const files = fileLines
        .filter((line) => line.includes("|"))
        .map((line) => {
          const [sizeStr, ...pathParts] = line.split("|");
          const fullPath = pathParts.join("|");
          const size = parseInt(sizeStr, 10) || 0;
          const relativePath = fullPath.replace(DEPOT_STORE + "/", "");
          return { path: relativePath, size };
        });

      // Version filter for components — only count deployment binaries (.ova, .iso, .tar)
      const versionRegex = new RegExp(vcfVersion.replace(/\./g, "\\.") + "([.]|[^\\d]|$)");
      const deploymentExtRegex = /\.(ova|iso|tar)$/i;

      const components: Record<string, { files: string[]; totalSize: number }> = {};
      for (const f of files) {
        const parts = f.path.split("/");
        if (parts.length >= 3 && parts[0] === "PROD" && parts[1] === "COMP") {
          const comp = parts[2];
          const fileName = parts.slice(3).join("/");
          // Only count deployment binaries that match the version
          if (!deploymentExtRegex.test(fileName)) continue;
          if (!versionRegex.test(fileName)) continue;
          if (!components[comp]) components[comp] = { files: [], totalSize: 0 };
          components[comp].files.push(fileName);
          components[comp].totalSize += f.size;
        }
      }

      const hasMetadata = files.some((f) => f.path.startsWith("PROD/metadata/"));
      const hasVsanHcl = files.some((f) => f.path.startsWith("PROD/vsan/"));

      // Parse list output
      const listOutput = listPart.trim();
      const listSuccess = listOutput.length > 0 && !listOutput.includes("Error") && !listOutput.includes("error");

      return NextResponse.json({
        totalSize,
        components,
        hasMetadata,
        hasVsanHcl,
        listOutput: listOutput || "No output from Broadcom list",
        listSuccess,
        vcfVersion,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to check depot" },
        { status: 500 }
      );
    }
  }

  // Default scan (no list) — used by download completion refresh
  try {
    const versionFilter = searchParams.get("version") || "";

    const result = await executeDepotCommand(
      `sudo bash -c 'if [ ! -d "${DEPOT_STORE}" ]; then echo "ERROR: ${DEPOT_STORE} does not exist"; exit 1; fi; find ${DEPOT_STORE} -type f | head -500 | while read f; do size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null); echo "$size|$f"; done; echo "---TOTAL---"; du -sh ${DEPOT_STORE} 2>/dev/null | cut -f1'`,
      30000
    );

    if (result.stdout.startsWith("ERROR:")) {
      return NextResponse.json({ error: result.stdout.trim() }, { status: 500 });
    }

    const lines = result.stdout.trim().split("\n");
    const markerIdx = lines.indexOf("---TOTAL---");
    const fileLines = markerIdx >= 0 ? lines.slice(0, markerIdx) : lines;
    const totalSize = markerIdx >= 0 && markerIdx + 1 < lines.length ? lines[markerIdx + 1].trim() : "";

    const files = fileLines
      .filter((line) => line.includes("|"))
      .map((line) => {
        const [sizeStr, ...pathParts] = line.split("|");
        const fullPath = pathParts.join("|");
        const size = parseInt(sizeStr, 10) || 0;
        const relativePath = fullPath.replace(DEPOT_STORE + "/", "");
        return { path: relativePath, size };
      });

    const versionRegex = versionFilter
      ? new RegExp(versionFilter.replace(/\./g, "\\.") + "([.]|[^\\d]|$)")
      : null;
    const deploymentExtRegex = /\.(ova|iso|tar)$/i;

    const components: Record<string, { files: string[]; totalSize: number }> = {};
    for (const f of files) {
      const parts = f.path.split("/");
      if (parts.length >= 3 && parts[0] === "PROD" && parts[1] === "COMP") {
        const comp = parts[2];
        const fileName = parts.slice(3).join("/");
        if (!deploymentExtRegex.test(fileName)) continue;
        if (versionRegex && !versionRegex.test(fileName)) continue;
        if (!components[comp]) components[comp] = { files: [], totalSize: 0 };
        components[comp].files.push(fileName);
        components[comp].totalSize += f.size;
      }
    }

    const hasMetadata = files.some((f) => f.path.startsWith("PROD/metadata/"));
    const hasVsanHcl = files.some((f) => f.path.startsWith("PROD/vsan/"));

    return NextResponse.json({
      totalSize,
      components,
      hasMetadata,
      hasVsanHcl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to scan depot" },
      { status: 500 }
    );
  }
}

/**
 * POST — run VCF Download Tool commands.
 * action: "list" — list available binaries from Broadcom for a version
 * action: "download" — start a tmux download session
 * action: "kill" — kill a running download session
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || (user.role !== "labadmin" && user.role !== "superadmin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { action } = body;

  // Actions that don't need the download token or version
  if (action === "kill") {
    const sessionName = body.session || "depot-download";
    await killTmuxSession(sessionName);
    return NextResponse.json({ message: "Session terminated" });
  }

  if (action === "cleanup-list") {
    const cleanupVersion = body.cleanupVersion;
    if (!cleanupVersion || !/^[\d.]+$/.test(cleanupVersion)) {
      return NextResponse.json({ error: "Invalid cleanup version" }, { status: 400 });
    }

    const result = await executeDepotCommand(
      `sudo bash -c 'find ${DEPOT_STORE}/PROD/COMP -type f 2>/dev/null | while read f; do echo "$f"; done'`,
      30000
    );

    const versionRegex = new RegExp(cleanupVersion.replace(/\./g, "\\.") + "([.]|[^\\d]|$)");
    const matchingFiles = result.stdout
      .trim()
      .split("\n")
      .filter((f) => f.trim() && versionRegex.test(f))
      .map((f) => f.trim());

    return NextResponse.json({ files: matchingFiles, count: matchingFiles.length });
  }

  if (action === "cleanup-delete") {
    const cleanupVersion = body.cleanupVersion;
    const filesToDelete: string[] = body.files;

    if (!cleanupVersion || !/^[\d.]+$/.test(cleanupVersion)) {
      return NextResponse.json({ error: "Invalid cleanup version" }, { status: 400 });
    }
    if (!Array.isArray(filesToDelete) || filesToDelete.length === 0) {
      return NextResponse.json({ error: "No files to delete" }, { status: 400 });
    }

    // Safety: verify all files are under the depot store and contain the version string
    const versionRegex = new RegExp(cleanupVersion.replace(/\./g, "\\.") + "([.]|[^\\d]|$)");
    for (const f of filesToDelete) {
      if (!f.startsWith(DEPOT_STORE + "/PROD/COMP/") || !versionRegex.test(f)) {
        return NextResponse.json(
          { error: `Refusing to delete file outside depot or not matching version: ${f}` },
          { status: 400 }
        );
      }
    }

    // Build rm command for all files
    const escapedFiles = filesToDelete.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(" ");
    const result = await executeDepotCommand(
      `sudo bash -c 'rm -f ${escapedFiles} && echo "DELETED ${filesToDelete.length} files"'`,
      30000
    );

    return NextResponse.json({
      message: result.stdout.trim() || "Files deleted",
      deleted: filesToDelete.length,
    });
  }

  // Actions that need the download token
  const tokenRow = await prisma.globalConfig.findUnique({
    where: { key: "online_depot_token" },
  });
  const token = tokenRow?.value;
  if (!token) {
    return NextResponse.json(
      { error: "Broadcom download token not configured in Global Config" },
      { status: 400 }
    );
  }

  // Get VCF version from GlobalConfig
  const versionRow = await prisma.globalConfig.findUnique({
    where: { key: "vcf_version" },
  });
  const vcfVersion = body.vcfVersion || versionRow?.value || "9.0.2.0";

  // Validate version format
  if (!/^[\d.]+$/.test(vcfVersion)) {
    return NextResponse.json({ error: "Invalid VCF version format" }, { status: 400 });
  }

  // Write token to a temp file on the depot appliance (needs sudo for /tmp access as root)
  const escapedToken = token.replace(/'/g, "'\\''");
  const writeTokenCmd = `echo '${escapedToken}' > ${TOKEN_TMP} && chmod 600 ${TOKEN_TMP}`;

  try {
    if (action === "list") {
      // Single SSH call: write token, run list, capture exit code, clean up
      const listCmd = `sudo bash -c '${writeTokenCmd} && cd /root/vdt/bin && ./vcf-download-tool binaries list --depot-download-token-file=${TOKEN_TMP} --vcf-version=${vcfVersion} 2>&1; EXIT_CODE=$?; rm -f ${TOKEN_TMP}; exit $EXIT_CODE'`;
      const result = await executeDepotCommand(listCmd, 60000);

      const output = (result.stdout || "").trim() || (result.stderr || "").trim();
      return NextResponse.json({
        output: output || `Command returned no output (exit code: ${result.exitCode}). Check that the VCF Download Tool is installed at /root/vdt/bin and the download token is valid.`,
        exitCode: result.exitCode,
        vcfVersion,
      });
    }

    if (action === "download") {
      const sessionName = "depot-download";

      // Check if already running
      const alive = await isTmuxSessionAlive(sessionName);
      if (alive) {
        return NextResponse.json(
          { error: "A download is already in progress" },
          { status: 409 }
        );
      }

      // Kill any stale session
      await killTmuxSession(sessionName);

      // Build the download command — sudo to run as root
      const downloadCmd = `sudo bash -c '${writeTokenCmd} && cd /root/vdt/bin && ./vcf-download-tool binaries download --vcf-version ${vcfVersion} --automated-install --depot-download-token-file=${TOKEN_TMP} --depot-store=${DEPOT_STORE} 2>&1; echo ""; echo "=== DOWNLOAD COMPLETE ==="'`;

      await spawnDepotTmuxSession(sessionName, downloadCmd);

      return NextResponse.json({
        session: sessionName,
        message: `Download started for VCF ${vcfVersion}`,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Command failed" },
      { status: 500 }
    );
  }
}
