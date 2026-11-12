// Prisma CLI configuration (Prisma 7+). The schema no longer carries the
// connection URL; it is read here from DATABASE_URL.
//
// In production DATABASE_URL comes from the environment (systemd
// EnvironmentFile). Locally it is loaded from backend/.env if present.
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (!process.env.DATABASE_URL && existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
