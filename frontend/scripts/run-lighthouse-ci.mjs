import { spawn } from "node:child_process";
import process from "node:process";
import { chromium } from "playwright";

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["lhci", "autorun", "--config=./lighthouserc.cjs"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CHROME_PATH: chromium.executablePath(),
    },
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
