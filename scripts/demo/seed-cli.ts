import { PrismaClient } from '@prisma/client';
import { seedDemoRestaurant } from './seed-demo';

async function main() {
  if (process.env.DEMO_SEED_CONFIRMATION !== 'SEED_QUOTEPLATE_INTERNAL_DEMO_ONLY') throw new Error('The internal demo seed confirmation is required.');
  const password = process.env.QUOTEPLATE_DEMO_PASSWORD;
  if (!password || password.length < 16) throw new Error('Configure a demo password of at least 16 characters.');
  if (!process.env.DATABASE_URL) throw new Error('The direct database connection is required.');
  const client = new PrismaClient();
  try {
    const result = await seedDemoRestaurant(client, password, new Date());
    console.log(JSON.stringify(result));
  } finally { await client.$disconnect(); }
}
main().catch(() => {
  // Never print a database URL, password, ORM query or a connection error payload.
  console.error('Internal demo setup failed. Verify the release schema, password and fixed demo identity. No automatic reset was attempted.');
  process.exitCode = 1;
});
