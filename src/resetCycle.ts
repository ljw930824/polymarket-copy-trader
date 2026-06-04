import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./shared/config.js";
import { createMakerSimulationState, createSimulationState, emptyRisk } from "./shared/store.js";
import type { AppState } from "./shared/types.js";

const statePath = "data/state.json";

async function main(): Promise<void> {
  const config = loadConfig();
  const raw = await readFile(statePath, "utf8");
  const state = JSON.parse(raw) as AppState;
  const now = Date.now();
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const archiveDir = join("data", "archives");
  const archivePath = join(archiveDir, `state-${stamp}.json`);

  await mkdir(archiveDir, { recursive: true });
  await writeFile(archivePath, JSON.stringify(state, null, 2));

  const next: AppState = {
    ...state,
    updatedAt: now,
    cycleStartedAt: now,
    signals: [],
    orders: [],
    risk: emptyRisk(),
    simulation: createSimulationState(config.simInitialCashUsdc),
    makerSimulation: createMakerSimulationState(config.makerSimInitialCashUsdc),
    lastError: undefined
  };

  await writeFile(statePath, JSON.stringify(next, null, 2));
  console.log(
    JSON.stringify(
      {
        archivePath,
        cycleStartedAt: now,
        initialCash: config.simInitialCashUsdc,
        makerInitialCash: config.makerSimInitialCashUsdc
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
