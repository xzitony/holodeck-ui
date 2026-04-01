import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { executeCommand } from "@/lib/ssh";

/**
 * GET /api/holodeck-configs — list all locally-tracked HoloDeck configs
 * Includes local metadata (description, notes) plus cached config data.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await prisma.holoDeckConfig.findMany({
    orderBy: { configId: "asc" },
  });

  // Parse cached JSON to extract useful summary fields
  const enriched = configs.map((c) => {
    let summary: Record<string, unknown> = {};
    if (c.cachedJson) {
      try {
        const json = JSON.parse(c.cachedJson);
        summary = extractConfigSummary(json);
      } catch {
        // ignore parse errors
      }
    }
    return {
      id: c.id,
      configId: c.configId,
      description: c.description,
      notes: c.notes,
      lastSynced: c.lastSynced,
      createdAt: c.createdAt,
      ...summary,
    };
  });

  return NextResponse.json({ configs: enriched });
}

/**
 * PUT /api/holodeck-configs — update local metadata for a config
 * Body: { configId, description?, notes? }
 * labadmin+ only
 */
export async function PUT(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "user") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { configId, description, notes } = body;

  if (!configId || typeof configId !== "string") {
    return NextResponse.json({ error: "configId is required" }, { status: 400 });
  }

  const existing = await prisma.holoDeckConfig.findUnique({
    where: { configId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Config not found locally" }, { status: 404 });
  }

  const updated = await prisma.holoDeckConfig.update({
    where: { configId },
    data: {
      ...(description !== undefined && { description }),
      ...(notes !== undefined && { notes }),
    },
  });

  return NextResponse.json({ config: updated });
}

/**
 * POST /api/holodeck-configs — create a new config on the holorouter
 *
 * Body: { targetHost, username, password, description? }
 *
 * Runs New-HoloDeckConfig on the holorouter via SSH. This copies the default
 * template (/holodeck-runtime/templates/config.json) to a new config file
 * with the provided target host credentials. The config is then imported
 * and cached locally. labadmin+ only.
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
  const description = (body.description || "").trim();

  if (!targetHost || !username || !password) {
    return NextResponse.json(
      { error: "targetHost, username, and password are required." },
      { status: 400 }
    );
  }

  // Sanitize inputs — only allow safe characters
  if (!/^[a-zA-Z0-9._-]+$/.test(targetHost)) {
    return NextResponse.json({ error: "Invalid targetHost format" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9._@\\/-]+$/.test(username)) {
    return NextResponse.json({ error: "Invalid username format" }, { status: 400 });
  }

  try {
    // Build the PowerShell script — use single-quoted strings for user inputs
    // to avoid variable expansion, with internal quotes doubled per PS rules
    const psPassword = password.replace(/'/g, "''");
    const psDesc = (description || "").replace(/'/g, "''");

    let psScript = `$PSStyle.OutputRendering = "PlainText"; New-HoloDeckConfig -TargetHost '${targetHost}' -UserName '${username}' -Password '${psPassword}'`;
    if (description) {
      psScript += ` -Description '${psDesc}'`;
    }
    psScript += ` | ConvertTo-Json -Depth 3`;

    // Encode as base64 UTF-16LE for pwsh -EncodedCommand to avoid all shell quoting issues
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    const createResult = await executeCommand(
      `pwsh -NonInteractive -EncodedCommand ${encoded}`,
      undefined,
      30000
    );

    // Check for command failure
    const stdout = stripAnsi(createResult.stdout).trim();
    const stderr = stripAnsi(createResult.stderr).trim();

    if (createResult.exitCode !== 0) {
      const errorDetail = stderr || stdout || "Unknown error";
      return NextResponse.json(
        { error: `Config creation failed: ${errorDetail}`, output: stdout, stderr },
        { status: 500 }
      );
    }

    // Try to parse the output to find the new ConfigID
    let newConfigId: string | null = null;

    try {
      const parsed = JSON.parse(stdout);
      // Output may be a single object or an array (New-HoloDeckConfig emits
      // multiple objects — e.g. a FileInfo + the config summary). Search for
      // the first element that has a ConfigID property.
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        if (item?.ConfigID || item?.configId) {
          newConfigId = item.ConfigID || item.configId;
          break;
        }
      }
    } catch {
      // Not valid JSON — try to find ConfigID from text/log output
      // e.g. "[SUCCESS] HoloDeckConfig qev2 is generated successfully!"
      const match = stdout.match(/HoloDeckConfig\s+(\S+)\s+is generated/i)
        || stdout.match(/ConfigID\s*:\s*(.+)/i);
      if (match) {
        newConfigId = match[1].trim();
      }
    }

    if (!newConfigId) {
      // The command ran but we couldn't parse the ConfigID.
      // Try listing configs to find the newest one.
      const listResult = await executeCommand(
        `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = "PlainText"; Get-HoloDeckConfig | ConvertTo-Json -Depth 3'`,
        undefined,
        20000
      );
      const listOut = stripAnsi(listResult.stdout).trim();
      try {
        const configs = JSON.parse(listOut);
        const arr = Array.isArray(configs) ? configs : [configs];
        // Find configs that match our target host and pick the last one
        const matching = arr.filter(
          (c: Record<string, string>) =>
            c.TargetHost === targetHost || c.targetHost === targetHost
        );
        if (matching.length > 0) {
          newConfigId = matching[matching.length - 1].ConfigID || matching[matching.length - 1].configId;
        }
      } catch {
        // fall through
      }
    }

    // If we still couldn't find a config, treat as failure
    if (!newConfigId) {
      return NextResponse.json(
        { error: "Config command ran but no configuration was created. Check target host and credentials.", output: stdout, stderr },
        { status: 500 }
      );
    }

    // Now import and cache the new config if we found its ID
    let cachedJson: string | null = null;
    if (newConfigId) {
      try {
        const importResult = await executeCommand(
          `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = "PlainText"; Import-HoloDeckConfig -ConfigID "${newConfigId}" | Out-Null; $config | ConvertTo-Json -Depth 100'`,
          undefined,
          20000
        );
        const importOut = stripAnsi(importResult.stdout).trim();
        JSON.parse(importOut); // validate
        cachedJson = importOut;
      } catch {
        // couldn't import full JSON
      }

      // Upsert into local DB
      const existing = await prisma.holoDeckConfig.findUnique({
        where: { configId: newConfigId },
      });

      if (existing) {
        await prisma.holoDeckConfig.update({
          where: { configId: newConfigId },
          data: {
            description: description || existing.description,
            cachedJson: cachedJson || existing.cachedJson,
            lastSynced: new Date(),
          },
        });
      } else {
        await prisma.holoDeckConfig.create({
          data: {
            configId: newConfigId,
            description: description || "",
            cachedJson,
            lastSynced: new Date(),
          },
        });
      }
    }

    return NextResponse.json({
      message: newConfigId
        ? `Config "${newConfigId}" created on holorouter and cached locally`
        : "Config created on holorouter (could not determine ConfigID — run Sync to refresh)",
      configId: newConfigId,
      output: stdout,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create config" },
      { status: 500 }
    );
  }
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x7e]|\x1b\].*?(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[>=<]|\x1b\[\?[0-9;]*[a-zA-Z]|\r/g, "");
}

/**
 * Extract useful summary fields from a full config JSON
 */
function extractConfigSummary(json: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  // Version info
  if (json.VCFVersion) summary.vcfVersion = json.VCFVersion;
  if (json.Version) summary.vcfVersion = json.Version;

  // Instance info
  if (json.Instance) summary.instance = json.Instance;
  if (json.ConfigID) summary.remoteConfigId = json.ConfigID;

  // Target host and credentials (from Target object in config JSON)
  const target = json.Target as Record<string, unknown> | undefined;
  if (json.TargetHost) summary.targetHost = json.TargetHost;
  if (target?.hostname) summary.targetHost = target.hostname;
  if (target?.username) summary.targetUsername = target.username;
  if (target?.datastore) summary.targetDatastore = target.datastore;
  if (target?.["networkPortGroup-a"]) summary.targetPortGroup = target["networkPortGroup-a"];

  // Site info
  if (json.SiteB && typeof json.SiteB === "object" && Object.keys(json.SiteB as object).length > 0) {
    summary.hasSiteB = true;
  }

  // vSAN Mode
  if (json.vSANMode) summary.vsanMode = json.vSANMode;

  // Depot type — check both top-level and nested in vcf-installer
  if (json.DepotType) summary.depotType = json.DepotType;
  const sddcSiteA = (json["holodeck-sddc"] as Record<string, unknown>)?.["Site-A"] as Record<string, unknown> | undefined;
  if (!summary.depotType && sddcSiteA) {
    const installer = sddcSiteA["vcf-installer"] as Record<string, unknown> | undefined;
    if (installer?.depotType) summary.depotType = (installer.depotType as string).charAt(0).toUpperCase() + (installer.depotType as string).slice(1);
  }

  // VCF version from Site-A sddc spec
  if (!summary.vcfVersion && sddcSiteA?.version) summary.vcfVersion = sddcSiteA.version;

  // DNS Domain
  if (json.DNSDomain) summary.dnsDomain = json.DNSDomain;
  if (!summary.dnsDomain && sddcSiteA?.domain) summary.dnsDomain = sddcSiteA.domain;

  // Description from config (not our local one)
  if (json.Description) summary.remoteDescription = json.Description;
  if (json.description) summary.remoteDescription = json.description;

  return summary;
}
