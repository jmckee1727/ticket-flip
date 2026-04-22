#!/usr/bin/env tsx
// Seed the database with fixture data
// Thin wrapper that calls the ingestion script with --use-fixture flag

import { spawn } from "child_process";
import * as path from "path";

const scriptPath = path.join(process.cwd(), "scripts/ingest-ticketmaster.ts");

// Run with --use-fixture
const child = spawn("tsx", [scriptPath, "--use-fixture"], {
  stdio: "inherit",
  cwd: process.cwd(),
});

child.on("error", (err) => {
  console.error("Error running ingestion:", err);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
