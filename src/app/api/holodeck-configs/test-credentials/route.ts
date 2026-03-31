import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { executeCommand } from "@/lib/ssh";

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * POST /api/holodeck-configs/test-credentials
 *
 * Tests ESX/vCenter credentials using Connect-VIServer from VMware PowerCLI.
 * Runs on the holorouter via SSH.
 *
 * Body: { targetHost: string, username: string, password: string }
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "user") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const targetHost = (body.targetHost || "").trim();
  const username = (body.username || "").trim();
  const password = body.password || "";

  if (!targetHost || !username || !password) {
    return NextResponse.json(
      { error: "targetHost, username, and password are required" },
      { status: 400 }
    );
  }

  // Sanitize inputs
  if (!/^[a-zA-Z0-9._-]+$/.test(targetHost)) {
    return NextResponse.json({ error: "Invalid targetHost format" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9._@\\/-]+$/.test(username)) {
    return NextResponse.json({ error: "Invalid username format" }, { status: 400 });
  }

  try {
    // Use single-quoted strings in PowerShell (double '' to escape internal quotes)
    const psPassword = password.replace(/'/g, "''");

    // Use Connect-VIServer to validate credentials, then immediately disconnect
    const psScript = [
      "$ErrorActionPreference = 'Stop'",
      `$cred = New-Object System.Management.Automation.PSCredential('${username}', (ConvertTo-SecureString '${psPassword}' -AsPlainText -Force))`,
      `$conn = Connect-VIServer -Server '${targetHost}' -Credential $cred -ErrorAction Stop`,
      `Disconnect-VIServer -Server $conn -Confirm:$false`,
      `Write-Output "SUCCESS"`,
    ].join("; ");

    // Encode as base64 UTF-16LE for pwsh -EncodedCommand to avoid shell quoting issues
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    const result = await executeCommand(
      `pwsh -NonInteractive -EncodedCommand ${encoded}`,
      undefined,
      30000
    );

    const stdout = stripAnsi(result.stdout).trim();
    const stderr = stripAnsi(result.stderr).trim();

    if (stdout.includes("SUCCESS")) {
      return NextResponse.json({
        success: true,
        message: `Successfully connected to ${targetHost}`,
      });
    }

    return NextResponse.json({
      success: false,
      message: stderr || stdout || "Connection failed — check credentials and host",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Connection test failed";
    return NextResponse.json({ success: false, message: msg });
  }
}
