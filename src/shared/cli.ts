import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;

export async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-lc", `command -v ${command}`], {
      timeout: 5_000,
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

export async function runCliCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd: string,
  pseudoTty = false
): Promise<{ stdout: string; stderr: string }> {
  let file = command;
  let finalArgs = args;

  if (pseudoTty && process.platform === "darwin") {
    file = "sh";
    const shellEscape = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
    const commandString = [command, ...args].map(shellEscape).join(" ");
    finalArgs = ["-lc", `script -q /dev/null ${commandString} </dev/null`];
  }

  const result = await execFileAsync(file, finalArgs, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    encoding: "utf8",
  });

  return {
    stdout: stripAnsi(result.stdout ?? ""),
    stderr: stripAnsi(result.stderr ?? ""),
  };
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function extractJsonPayload<T>(output: string): T | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Keep going.
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(first, last + 1)) as T;
  } catch {
    return null;
  }
}
