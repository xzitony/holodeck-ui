import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { executeCommand } from "@/lib/ssh";

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

    // For configs with an Instance, fetch instance details to check for Site B
    for (const cfg of configs) {
      if (cfg.Instance) {
        try {
          const instResult = await executeCommand(
            `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = "PlainText"; Get-HoloDeckInstance -InstanceID "${cfg.Instance}" | ConvertTo-Json -Depth 3'`,
            undefined,
            10000
          );
          const instOut = stripAnsi(instResult.stdout).trim();
          try {
            const inst = JSON.parse(instOut);
            cfg.hasSiteB = inst.SiteB && Object.keys(inst.SiteB).length > 0 ? "true" : "false";
          } catch {
            // Try text parsing
            const lines = instOut.split("\n").map((l: string) => l.trim());
            const siteBLine = lines.find((l: string) => /^SiteB\s*:/.test(l));
            const siteBValue = siteBLine?.replace(/^SiteB\s*:\s*/, "").trim() || "";
            cfg.hasSiteB = siteBValue && siteBValue !== "" ? "true" : "false";
          }
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
