import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const targetTriple = process.argv[2] ?? process.env.TAURI_TARGET_TRIPLE ?? hostTriple();
const exeSuffix = targetTriple.includes("windows") ? ".exe" : "";
const source = join("backend", "target", "release", `tourmap-api${exeSuffix}`);
const destination = join("src-tauri", "binaries", `tourmap-api-${targetTriple}${exeSuffix}`);

await run("cargo", ["build", "--release"], { cwd: "backend" });
await mkdir(join("src-tauri", "binaries"), { recursive: true });
await copyFile(source, destination);
console.log(`Prepared Tauri sidecar: ${destination}`);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

function hostTriple() {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin";
  if (process.platform === "darwin") return "x86_64-apple-darwin";
  if (process.platform === "win32") return "x86_64-pc-windows-msvc";
  if (process.platform === "linux") return "x86_64-unknown-linux-gnu";
  throw new Error(`Unsupported host for sidecar naming: ${process.platform}/${process.arch}`);
}
