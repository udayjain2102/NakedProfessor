module.exports = {
  ci: {
    collect: {
      chromePath: process.env.CHROME_PATH,
      url: [
        "http://127.0.0.1:4173/app/select",
        "http://127.0.0.1:4173/app/professor/prof:1",
        "http://127.0.0.1:4173/app/plan/prof:1",
      ],
      startServerCommand: "npm run preview:e2e -- --host 127.0.0.1 --port 4173",
      startServerReadyPattern: "127.0.0.1:4173",
      startServerReadyTimeout: 120000,
      numberOfRuns: 1,
      settings: {
        chromeFlags: "--no-sandbox",
        preset: "desktop",
      },
    },
    assert: {
      budgetsFile: "./budgets.json",
    },
    upload: {
      target: "filesystem",
      outputDir: "./.lighthouseci",
    },
  },
};
