import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { executeCommand } from "@/lib/ssh";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await executeCommand(
      `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = "PlainText"; Get-HoloDeckConfig | ConvertTo-Json -Depth 3'`,
      undefined,
      15000
    );

    // Strip ANSI/PTY escape sequences from raw output
    const stdout = stripAnsi(result.stdout).trim();

    // Try parsing as JSON first
    let configs: Record<string, string>[];
    try {
      const parsed = JSON.parse(stdout);
      configs = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Fallback: parse the text output line by line
      configs = parseTextOutput(stdout);
    }

    // Use stored instanceJson from DB to check for Site B (avoids extra SSH calls)
    const dbConfigs = await prisma.holoDeckConfig.findMany({
      select: { configId: true, instanceJson: true },
    });
    const instanceByConfig = new Map(
      dbConfigs.map((c) => [c.configId, c.instanceJson])
    );

    for (const cfg of configs) {
      const configId = cfg.ConfigID || cfg.configId;
      const storedInstance = configId ? instanceByConfig.get(configId) : null;

      if (storedInstance) {
        try {
          const inst = JSON.parse(storedInstance);
          cfg.hasSiteB = inst.SiteB && (typeof inst.SiteB === "object" ? Object.keys(inst.SiteB).length > 0 : !!inst.SiteB) ? "true" : "false";
        } catch {
          cfg.hasSiteB = "false";
        }
      } else {
        cfg.hasSiteB = "false";
      }
    }

    return NextResponse.json({ configs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch configs" },
      { status: 500 }
    );
  }
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x7e]|\x1b\].*?(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[>=<]|\x1b\[\?[0-9;]*[a-zA-Z]|\r/g, "");
}

function parseTextOutput(text: string): Array<Record<string, string>> {
  // Parse PowerShell's default key:value format output
  const configs: Array<Record<string, string>> = [];
  let current: Record<string, string> = {};

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      if (Object.keys(current).length > 0) {
        configs.push(current);
        current = {};
      }
      continue;
    }

    const match = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (match) {
      current[match[1]] = match[2].trim();
    }
  }

  if (Object.keys(current).length > 0) {
    configs.push(current);
  }

  return configs;
}
