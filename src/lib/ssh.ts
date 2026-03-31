import { Client, type ConnectConfig } from "ssh2";
import { exec } from "child_process";
import { prisma } from "./db";

interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

// Persistent connection singleton
let activeConn: Client | null = null;
let connReady = false;
let connConfigKey = ""; // tracks config to detect changes

function getConfigKey(cfg: SSHConfig): string {
  return `${cfg.host}:${cfg.port}:${cfg.username}`;
}

async function getSSHConfigFromDB(): Promise<SSHConfig | null> {
  const configs = await prisma.globalConfig.findMany({
    where: {
      key: { in: ["ssh_host", "ssh_port", "ssh_username", "ssh_password"] },
    },
  });

  const configMap = new Map(configs.map((c) => [c.key, c.value]));
  const host = configMap.get("ssh_host");
  const username = configMap.get("ssh_username");

  if (!host || !username) return null;

  return {
    host,
    port: parseInt(configMap.get("ssh_port") || "22", 10),
    username,
    password: configMap.get("ssh_password"),
  };
}

function getConnection(sshConfig: SSHConfig): Promise<Client> {
  const key = getConfigKey(sshConfig);

  // Reuse existing connection if config hasn't changed and it's still alive
  if (activeConn && connReady && connConfigKey === key) {
    return Promise.resolve(activeConn);
  }

  // Clean up stale connection
  if (activeConn) {
    try {
      activeConn.end();
    } catch {
      // ignore
    }
    activeConn = null;
    connReady = false;
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();

    const connectConfig: ConnectConfig = {
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    if (sshConfig.password) {
      connectConfig.password = sshConfig.password;
    }

    conn
      .on("ready", () => {
        activeConn = conn;
        connReady = true;
        connConfigKey = key;
        resolve(conn);
      })
      .on("error", (err) => {
        activeConn = null;
        connReady = false;
        reject(new Error(`SSH connection error: ${err.message}`));
      })
      .on("close", () => {
        if (activeConn === conn) {
          activeConn = null;
          connReady = false;
        }
      })
      .connect(connectConfig);
  });
}

export async function executeCommand(
  command: string,
  onData?: (data: string, stream: "stdout" | "stderr") => void,
  timeoutMs: number = 300000
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const sshConfig = await getSSHConfigFromDB();
  if (!sshConfig) {
    throw new Error(
      "SSH connection not configured. A Super Admin must configure the holorouter connection."
    );
  }

  let conn: Client;
  try {
    conn = await getConnection(sshConfig);
  } catch (err) {
    // If reuse failed, force a fresh connection
    activeConn = null;
    connReady = false;
    conn = await getConnection(sshConfig);
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    conn.exec(command, { pty: { cols: 200, rows: 50, term: "xterm" } }, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        // Connection may be dead, reset it
        activeConn = null;
        connReady = false;
        reject(err);
        return;
      }

      stream
        .on("close", (code: number) => {
          clearTimeout(timer);
          if (!timedOut) {
            resolve({ exitCode: code ?? 0, stdout, stderr });
          }
        })
        .on("data", (data: Buffer) => {
          const text = data.toString();
          stdout += text;
          onData?.(text, "stdout");
        })
        .stderr.on("data", (data: Buffer) => {
          const text = data.toString();
          stderr += text;
          onData?.(text, "stderr");
        });
    });
  });
}

// ── tmux-based background execution (runs locally, SSH into holorouter) ──

/**
 * Run a command locally (not over SSH). Used for local tmux management.
 */
function execLocal(cmd: string, timeoutMs = 15000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: err?.code ?? 0,
      });
    });
  });
}

/**
 * Build an sshpass/ssh command string to run a remote command on the holorouter.
 * The resulting command can be run locally (e.g. inside a local tmux session).
 */
async function buildSSHCommand(remoteCommand: string): Promise<string> {
  const sshConfig = await getSSHConfigFromDB();
  if (!sshConfig) {
    throw new Error("SSH connection not configured.");
  }

  // Force terminal size on the remote end so PowerShell doesn't complain about ListView
  const sizedCommand = `stty cols 200 rows 50 2>/dev/null; ${remoteCommand}`;
  const port = sshConfig.port || 22;
  const sshOpts = `-tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${port}`;

  if (sshConfig.password) {
    // Use sshpass for password-based auth
    const escapedPass = sshConfig.password.replace(/'/g, "'\\''");
    return `sshpass -p '${escapedPass}' ssh ${sshOpts} ${sshConfig.username}@${sshConfig.host} '${sizedCommand.replace(/'/g, "'\\''")}'`;
  }

  // Key-based auth (no password)
  return `ssh ${sshOpts} ${sshConfig.username}@${sshConfig.host} '${sizedCommand.replace(/'/g, "'\\''")}'`;
}

/**
 * Spawn a long-running command inside a LOCAL tmux session that SSHs into the holorouter.
 * Returns immediately after starting — the process runs independently.
 */
export async function spawnTmuxSession(
  sessionName: string,
  command: string
): Promise<void> {
  const sshCmd = await buildSSHCommand(command);
  const escapedSshCmd = sshCmd.replace(/'/g, "'\\''");
  // Use remain-on-exit so the pane stays alive after the command finishes,
  // allowing us to capture output even if the command fails/exits quickly.
  const tmuxCmd = `tmux new-session -d -x 200 -y 50 -s '${sessionName}' '${escapedSshCmd}' \\; set remain-on-exit on`;
  const result = await execLocal(tmuxCmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to start tmux session: ${result.stderr || result.stdout}`);
  }
}

/**
 * Check if the command in a local tmux session is still running.
 * With remain-on-exit, the session persists after the command exits,
 * so we check the pane's dead flag rather than session existence.
 */
export async function isTmuxSessionAlive(sessionName: string): Promise<boolean> {
  // First check if session exists at all
  const hasSession = await execLocal(
    `tmux has-session -t '${sessionName}' 2>/dev/null && echo 'yes' || echo 'no'`
  );
  if (!hasSession.stdout.includes("yes")) return false;

  // Check if the pane is still running (not dead from remain-on-exit)
  const paneStatus = await execLocal(
    `tmux list-panes -t '${sessionName}' -F '#{pane_dead}' 2>/dev/null`
  );
  // pane_dead is "1" when the command has exited, "0" when still running
  return paneStatus.stdout.trim() === "0";
}

/**
 * Capture the current output from a local tmux session pane.
 * Returns the last `lines` lines of output.
 */
export async function captureTmuxOutput(
  sessionName: string,
  lines: number = 500
): Promise<string> {
  const result = await execLocal(
    `tmux capture-pane -t '${sessionName}' -p -S -${lines} 2>/dev/null || echo '[session ended]'`
  );
  return result.stdout;
}

/**
 * Kill a local tmux session.
 */
export async function killTmuxSession(sessionName: string): Promise<void> {
  await execLocal(`tmux kill-session -t '${sessionName}' 2>/dev/null || true`);
}

/**
 * Build the DeveloperMode environment variable block from Global Config.
 * Returns a PowerShell script snippet that sets all $env: variables.
 */
export async function buildDeveloperModeEnvBlock(
  site: "a" | "b" = "a",
  overrides?: {
    datastoreName?: string;
    trunkPortGroupName?: string;
    trunkPortGroupNameSiteB?: string;
    clusterName?: string;
    dcName?: string;
  }
): Promise<string> {
  const configs = await prisma.globalConfig.findMany({
    where: {
      key: {
        in: [
          "depot_type",
          "offline_depot_ip",
          "offline_depot_port",
          "offline_depot_username",
          "offline_depot_password",
          "offline_depot_protocol",
          "online_depot_token",
          "datastore_name",
          "trunk_port_group_name_site_a",
          "trunk_port_group_name_site_b",
          "cluster_name",
          "dc_name",
        ],
      },
    },
  });

  const configMap = new Map(configs.map((c) => [c.key, c.value]));
  const lines: string[] = [];

  const depotType = configMap.get("depot_type") || "Offline";

  if (depotType === "Online") {
    const token = configMap.get("online_depot_token");
    if (token) lines.push(`$env:brcm_build_token = "${token}"`);
    lines.push(`$env:enable_proxy = "n"`);
  } else {
    // Offline depot
    const ip = configMap.get("offline_depot_ip");
    const port = configMap.get("offline_depot_port") || "443";
    const user = configMap.get("offline_depot_username");
    const pass = configMap.get("offline_depot_password");
    const proto = configMap.get("offline_depot_protocol") || "https";

    if (ip) lines.push(`$env:offline_depot_ip = "${ip}"`);
    if (port) lines.push(`$env:offline_depot_port = "${port}"`);
    if (user) lines.push(`$env:offline_depot_username = "${user}"`);
    if (pass) lines.push(`$env:offline_depot_password = "${pass}"`);
    if (proto) lines.push(`$env:offline_depot_protocol = "${proto}"`);
  }

  const datastore = overrides?.datastoreName || configMap.get("datastore_name");
  const trunkPg = (site === "b" ? overrides?.trunkPortGroupNameSiteB : null)
    || overrides?.trunkPortGroupName
    || (site === "b"
      ? configMap.get("trunk_port_group_name_site_b")
      : configMap.get("trunk_port_group_name_site_a"));
  const cluster = overrides?.clusterName || configMap.get("cluster_name");
  const dc = overrides?.dcName || configMap.get("dc_name");

  if (datastore) lines.push(`$env:datastore_name = "${datastore}"`);
  if (trunkPg) lines.push(`$env:trunk_port_group_name = "${trunkPg}"`);
  if (cluster) lines.push(`$env:cluster_name = "${cluster}"`);
  if (dc) lines.push(`$env:dc_name = "${dc}"`);

  return lines.join("; ");
}

// ── Depot Appliance SSH helpers ──────────────────────────────────────────────

async function getDepotSSHConfig(): Promise<SSHConfig | null> {
  const configs = await prisma.globalConfig.findMany({
    where: {
      key: { in: ["offline_depot_ip", "depot_ssh_port", "depot_ssh_username", "depot_ssh_password"] },
    },
  });
  const m = new Map(configs.map((c) => [c.key, c.value]));
  const host = m.get("offline_depot_ip");
  const username = m.get("depot_ssh_username");
  if (!host || !username) return null;
  return {
    host,
    port: parseInt(m.get("depot_ssh_port") || "22", 10),
    username,
    password: m.get("depot_ssh_password"),
  };
}

function buildSSHCommandFromConfig(cfg: SSHConfig, remoteCommand: string): string {
  const port = cfg.port || 22;
  const sshOpts = `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -p ${port}`;
  const escaped = remoteCommand.replace(/'/g, "'\\''");
  if (cfg.password) {
    const escapedPass = cfg.password.replace(/'/g, "'\\''");
    return `sshpass -p '${escapedPass}' ssh ${sshOpts} ${cfg.username}@${cfg.host} '${escaped}'`;
  }
  return `ssh ${sshOpts} ${cfg.username}@${cfg.host} '${escaped}'`;
}

/**
 * Execute a command on the depot appliance via SSH. For short-lived commands.
 */
export async function executeDepotCommand(
  command: string,
  timeoutMs = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cfg = await getDepotSSHConfig();
  if (!cfg) throw new Error("Depot appliance SSH not configured.");
  const sshCmd = buildSSHCommandFromConfig(cfg, command);
  return execLocal(sshCmd, timeoutMs);
}

/**
 * Spawn a long-running command on the depot appliance inside a local tmux session.
 */
export async function spawnDepotTmuxSession(
  sessionName: string,
  command: string
): Promise<void> {
  const cfg = await getDepotSSHConfig();
  if (!cfg) throw new Error("Depot appliance SSH not configured.");
  const sshCmd = buildSSHCommandFromConfig(cfg, command);
  const escapedSshCmd = sshCmd.replace(/'/g, "'\\''");
  const tmuxCmd = `tmux new-session -d -x 200 -y 50 -s '${sessionName}' '${escapedSshCmd}' \\; set remain-on-exit on`;
  const result = await execLocal(tmuxCmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to start tmux session: ${result.stderr || result.stdout}`);
  }
}

export async function testDepotConnection(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const result = await executeDepotCommand("echo 'depot-ok'", 10000);
    if (result.stdout.includes("depot-ok")) {
      return { success: true, message: "Connected to depot appliance" };
    }
    return { success: false, message: "Unexpected response from depot appliance" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function testConnection(): Promise<{
  success: boolean;
  message: string;
}> {
  // Force fresh connection for testing
  activeConn?.end();
  activeConn = null;
  connReady = false;

  try {
    const result = await executeCommand("echo 'connection-ok'", undefined, 10000);
    if (result.stdout.includes("connection-ok")) {
      return { success: true, message: "Connected to holorouter" };
    }
    return { success: false, message: "Unexpected response from holorouter" };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
