import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { executeCommand } from "@/lib/ssh";

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x7e]|\x1b\].*?(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[>=<]|\x1b\[\?[0-9;]*[a-zA-Z]|\r/g, "");
}

/**
 * POST /api/holodeck-configs/[id]/inventory
 *
 * Connects to the config's target vCenter/ESXi host using stored credentials
 * and queries available datastores, networks, clusters, and datacenters.
 * labadmin+ only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "user") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const config = await prisma.holoDeckConfig.findUnique({
    where: { configId: id },
  });

  if (!config) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

  try {
    // Import the config on the holorouter to get credentials, then query inventory
    // This avoids guessing field names in cached JSON and ensures we have the password
    // Read the config JSON file directly from the holorouter filesystem
    // to get TargetHost and credentials reliably
    const psScript = [
      `$ErrorActionPreference = 'Stop'`,
      `$cfgJson = Get-Content '/holodeck-runtime/config/${id}.json' -Raw | ConvertFrom-Json`,
      `$targetHost = $cfgJson.Target.hostname`,
      `$username = $cfgJson.Target.username`,
      `$password = $cfgJson.Target.password`,
      `if (-not $targetHost) { throw 'Config has no Target hostname' }`,
      `if (-not $username -or -not $password) { throw 'Config has no Target credentials' }`,
      `$cred = New-Object System.Management.Automation.PSCredential($username, (ConvertTo-SecureString $password -AsPlainText -Force))`,
      `$conn = Connect-VIServer -Server $targetHost -Credential $cred -ErrorAction Stop`,
      `$result = @{`,
      `  datastores = @((Get-Datastore -Server $conn | Select-Object -ExpandProperty Name | Sort-Object))`,
      `  networks = @((Get-VirtualPortGroup -Server $conn | Select-Object -ExpandProperty Name | Sort-Object -Unique))`,
      `  clusters = @((Get-Cluster -Server $conn -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name | Sort-Object))`,
      `  datacenters = @((Get-Datacenter -Server $conn -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name | Sort-Object))`,
      `}`,
      `Disconnect-VIServer -Server $conn -Confirm:$false`,
      `$result | ConvertTo-Json -Depth 3`,
    ].join("\n");

    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    const result = await executeCommand(
      `pwsh -NonInteractive -EncodedCommand ${encoded}`,
      undefined,
      45000
    );

    const stdout = stripAnsi(result.stdout).trim();
    const stderr = stripAnsi(result.stderr).trim();

    if (result.exitCode !== 0) {
      return NextResponse.json(
        { error: `Failed to query inventory: ${stderr || stdout || "Unknown error"}` },
        { status: 500 }
      );
    }

    // Parse the JSON output
    try {
      const inventory = JSON.parse(stdout);
      return NextResponse.json({
        datastores: inventory.datastores || [],
        networks: inventory.networks || [],
        clusters: inventory.clusters || [],
        datacenters: inventory.datacenters || [],
      });
    } catch {
      return NextResponse.json(
        { error: "Failed to parse inventory output from holorouter", output: stdout },
        { status: 500 }
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to query VMware inventory";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
