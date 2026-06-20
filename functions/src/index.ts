import { initializeApp } from "firebase-admin/app";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { config } from "./config";
import { runCleanup } from "./cleanup";
import { version } from "../package.json";

initializeApp();

export const cleanupStaleData = onSchedule(
  { schedule: "0 2 * * *", timeZone: "UTC" },
  async () => {
    console.log("Starting cleanup run", { version, dryRun: config.DRY_RUN });
    const result = await runCleanup(config);
    console.log("Cleanup complete", JSON.stringify(result, null, 2));
  }
);
