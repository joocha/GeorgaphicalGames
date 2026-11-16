// Loads backend/.env for CLI scripts when DATABASE_URL isn't already set
// (systemd/production provides the environment itself).
import { existsSync } from 'node:fs';

const envFile = new URL('../.env', import.meta.url).pathname;
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
