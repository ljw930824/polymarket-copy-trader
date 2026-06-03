import express from "express";
import pino from "pino";
import { loadConfig } from "./shared/config.js";
import { JsonStateStore } from "./shared/store.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new JsonStateStore();
  const app = express();

  app.use(
    express.static("public", {
      etag: false,
      lastModified: false,
      setHeaders: (response) => {
        response.setHeader("Cache-Control", "no-store");
      }
    })
  );

  app.get("/api/state", async (_request, response) => {
    const state = await store.read(config.mode);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json({
      ...state,
      servedAt: Date.now(),
      secretsLoaded: config.mode === "live",
      privateKey: undefined
    });
  });

  app.listen(config.port, () => {
    logger.info({ port: config.port }, "dashboard listening");
  });
}

main().catch((error) => {
  logger.error({ err: error }, "dashboard crashed");
  process.exitCode = 1;
});
