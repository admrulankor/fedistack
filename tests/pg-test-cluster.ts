import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface EphemeralPgCluster {
  connectionString: string;
  stop: () => void;
}

function isExecutableInPath(binaryName: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const ext = process.platform === "win32" ? ".exe" : "";

  for (const dir of pathEnv.split(separator)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, `${binaryName}${ext}`);
    if (fs.existsSync(candidate)) {
      return true;
    }
  }
  return false;
}

export function resolvePostgresBinary(name: "initdb" | "pg_ctl"): string {
  if (isExecutableInPath(name)) {
    return name;
  }

  if (process.platform === "win32") {
    const pgRoots = Array.from(
      new Set([
        ...(process.env.ProgramFiles
          ? [path.join(process.env.ProgramFiles, "PostgreSQL")]
          : []),
        "C:\\Program Files\\PostgreSQL"
      ])
    );

    for (const pgRoot of pgRoots) {
      if (!fs.existsSync(pgRoot)) {
        continue;
      }
      const entries = fs
        .readdirSync(pgRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => {
          const numA = Number.parseInt(a, 10);
          const numB = Number.parseInt(b, 10);
          if (Number.isNaN(numA) && Number.isNaN(numB)) {
            return b.localeCompare(a);
          }
          if (Number.isNaN(numA)) return 1;
          if (Number.isNaN(numB)) return -1;
          return numB - numA;
        });

      for (const versionDir of entries) {
        const candidate = path.join(pgRoot, versionDir, "bin", `${name}.exe`);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return name;
}

export function startEphemeralPostgresCluster(): EphemeralPgCluster {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fedistack-pg-test-"));
  const dataDir = path.join(tmpRoot, "data");
  const socketDir = path.join(tmpRoot, "socket");
  const logFile = path.join(tmpRoot, "postgres.log");
  fs.mkdirSync(socketDir, { recursive: true });

  const port = 55432 + Math.floor(Math.random() * 2000);
  const initdbBin = resolvePostgresBinary("initdb");
  const pgCtlBin = resolvePostgresBinary("pg_ctl");

  execFileSync(
    initdbBin,
    [
      "-D",
      dataDir,
      "-U",
      "postgres",
      "--auth=trust",
      "--no-instructions",
      "--encoding=UTF8"
    ],
    { stdio: "pipe" }
  );

  const pgOptions =
    process.platform === "win32"
      ? `-F -p ${port} -h 127.0.0.1`
      : `-F -p ${port} -k ${socketDir} -h 127.0.0.1`;

  try {
    // Use stdio: "ignore" because pg_ctl spawns a background postgres server
    // that may inherit open stdout/stderr pipes and cause execFileSync to block.
    execFileSync(
      pgCtlBin,
      ["-D", dataDir, "-l", logFile, "-o", pgOptions, "-w", "start"],
      { stdio: "ignore" }
    );
  } catch (err) {
    const pgLog = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf8")
      : "(no postgres.log produced)";
    throw new Error(
      `Failed to start ephemeral PostgreSQL cluster: ${
        err instanceof Error ? err.message : String(err)
      }\n${pgLog}`
    );
  }

  const connectionString = `postgresql://postgres@127.0.0.1:${port}/postgres`;

  return {
    connectionString,
    stop: () => {
      try {
        execFileSync(pgCtlBin, ["-D", dataDir, "-m", "immediate", "stop"], {
          stdio: "pipe"
        });
      } catch {
        // Ignore shutdown errors on cleanup
      }
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  };
}
