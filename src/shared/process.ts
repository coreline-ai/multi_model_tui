import { spawn, type ChildProcess } from "node:child_process";

export function spawnNodeModule(entryPath: string, mode: "ts" | "js"): ChildProcess {
  const args = mode === "ts" ? ["--import", "tsx/esm", entryPath] : [entryPath];
  return spawn(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
}
