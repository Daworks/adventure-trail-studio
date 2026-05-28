import { mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const apiDir = "app/api";
const disabledApiDir = ".desktop-build-disabled/api";

async function main() {
  const movedApi = await disableApiRoutes();
  try {
    await runNextBuild();
  } finally {
    if (movedApi) {
      await rename(disabledApiDir, apiDir);
      await rm(".desktop-build-disabled", { force: true, recursive: true });
    }
  }
}

async function disableApiRoutes() {
  if (!existsSync(apiDir)) return false;
  if (existsSync(disabledApiDir)) {
    throw new Error(`${disabledApiDir} already exists. Restore or remove it before building.`);
  }
  await rm(".desktop-build-disabled", { force: true, recursive: true });
  await mkdir(".desktop-build-disabled", { recursive: true });
  await rename(apiDir, disabledApiDir);
  return true;
}

function runNextBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
      env: {
        ...process.env,
        DESKTOP_EXPORT: "1",
        NEXT_PUBLIC_TOURMAP_API_BASE_URL: "http://127.0.0.1:4000",
      },
      shell: false,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`next build exited with code ${code}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
