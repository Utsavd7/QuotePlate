import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

const POSTGRES_IMAGE = 'postgres:16.4-alpine';
const POSTGRES_PORT = 5432;
const CONTAINER_STARTUP_TIMEOUT_MS = 60_000;
const PRISMA_COMMAND_TIMEOUT_MS = 45_000;
const LOCAL_POSTGRES_STARTUP_TIMEOUT_MS = 20_000;
const projectRoot = path.resolve(__dirname, '../../..');
const prismaCli = path.join(projectRoot, 'node_modules/prisma/build/index.js');
const prismaSchema = path.join(projectRoot, 'prisma/schema.prisma');
const migrationOrder = [
  '20260827000100_lean_baseline',
  '20260827000200_launch_schema',
  '20260827000300_forced_rls',
  '20260827000400_member_invitations',
  '20260827000500_menu_recipe_retirement',
  '20260827000600_public_supplier_grants',
  '20260827000700_quote_integrity',
  '20260827000800_award_snapshot_capacity',
  '20260827000900_minimal_launch_columns',
  '20260827001000_backup_role',
  '20260827001100_minimal_rate_limit_bucket',
  '20260827001200_current_user_credentials',
  '20260831000100_compact_nine_table_schema',
  '20260904000100_award_receiving',
  '20260907000100_service_planning',
  '20260907000200_supplier_collaboration',
  '20260908000100_supplier_trading_profile',
] as const;

export type PostgresHarness = {
  databaseUrl: string;
  migrateTo: (migrationName: (typeof migrationOrder)[number]) => Promise<void>;
  applyMigrationAs: (
    migrationName: (typeof migrationOrder)[number],
    databaseUrl: string,
  ) => Promise<void>;
};

function runPrisma(args: string[], databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DIRECT_URL: databaseUrl,
        NO_COLOR: '1',
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, PRISMA_COMMAND_TIMEOUT_MS);

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(new Error(`Prisma command timed out after ${PRISMA_COMMAND_TIMEOUT_MS}ms`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Prisma command failed with exit code ${code}\n${stdout}${stderr}`.trim(),
          ),
        );
        return;
      }

      resolve();
    });
  });
}

async function deployMigrations(databaseUrl: string): Promise<void> {
  await runPrisma(['migrate', 'deploy', '--schema', prismaSchema], databaseUrl);
  await runPrisma(
    [
      'migrate',
      'diff',
      '--from-schema-datasource',
      prismaSchema,
      '--to-schema-datamodel',
      prismaSchema,
      '--exit-code',
    ],
    databaseUrl,
  );
}

function createHarness(databaseUrl: string): PostgresHarness {
  let migratedThrough = -1;

  return {
    databaseUrl,
    async applyMigrationAs(migrationName, roleDatabaseUrl) {
      const migrationPath = path.join(
        projectRoot,
        'prisma/migrations',
        migrationName,
        'migration.sql',
      );
      await runPrisma(
        ['db', 'execute', '--url', roleDatabaseUrl, '--file', migrationPath],
        roleDatabaseUrl,
      );
    },
    async migrateTo(migrationName) {
      const targetIndex = migrationOrder.indexOf(migrationName);
      if (targetIndex < migratedThrough) {
        throw new Error(
          `Cannot migrate backwards from ${migrationOrder[migratedThrough]} to ${migrationName}`,
        );
      }

      for (let index = migratedThrough + 1; index <= targetIndex; index += 1) {
        const migrationPath = path.join(
          projectRoot,
          'prisma/migrations',
          migrationOrder[index],
          'migration.sql',
        );
        await runPrisma(
          ['db', 'execute', '--schema', prismaSchema, '--file', migrationPath],
          databaseUrl,
        );
        migratedThrough = index;
      }
    },
  };
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a local PostgreSQL port'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function runLocalCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, NO_COLOR: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      output += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, LOCAL_POSTGRES_STARTUP_TIMEOUT_MS);

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new Error(
            `${command} timed out after ${LOCAL_POSTGRES_STARTUP_TIMEOUT_MS}ms`,
          ),
        );
      } else if (code !== 0) {
        reject(new Error(`${command} failed with exit code ${code}\n${output}`));
      } else {
        resolve();
      }
    });
  });
}

async function withLocalPostgres(
  run: (harness: PostgresHarness) => Promise<void>,
): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'autorfp-postgres-'));
  const dataDirectory = path.join(temporaryRoot, 'data');
  const socketDirectory = path.join(temporaryRoot, 'socket');
  const port = await reservePort();
  let postgres: ReturnType<typeof spawn> | undefined;

  try {
    await mkdir(socketDirectory);
    await runLocalCommand('initdb', [
      '--auth=trust',
      '--encoding=UTF8',
      '--no-locale',
      '--username=autorfp',
      '-D',
      dataDirectory,
    ]);

    postgres = spawn(
      'postgres',
      [
        '-D',
        dataDirectory,
        '-h',
        '127.0.0.1',
        '-p',
        String(port),
        '-k',
        socketDirectory,
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, NO_COLOR: '1' },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let startupOutput = '';
    postgres.stdout?.setEncoding('utf8');
    postgres.stderr?.setEncoding('utf8');
    postgres.stdout?.on('data', (chunk: string) => {
      startupOutput += chunk;
    });
    postgres.stderr?.on('data', (chunk: string) => {
      startupOutput += chunk;
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Local PostgreSQL timed out after ${LOCAL_POSTGRES_STARTUP_TIMEOUT_MS}ms\n${startupOutput}`,
          ),
        );
      }, LOCAL_POSTGRES_STARTUP_TIMEOUT_MS);

      const inspectOutput = () => {
        if (startupOutput.includes('database system is ready to accept connections')) {
          clearTimeout(timeout);
          resolve();
        }
      };
      postgres?.stdout?.on('data', inspectOutput);
      postgres?.stderr?.on('data', inspectOutput);
      postgres?.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      postgres?.once('close', (code) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Local PostgreSQL exited before startup with code ${code}\n${startupOutput}`,
          ),
        );
      });
    });

    const databaseUrl =
      `postgresql://autorfp@127.0.0.1:${port}/postgres?schema=public`;
    await run(createHarness(databaseUrl));
  } finally {
    if (postgres && postgres.exitCode === null) {
      const stopped = new Promise<void>((resolve) => {
        postgres?.once('close', () => resolve());
      });
      postgres.kill('SIGTERM');
      const forceStop = setTimeout(() => postgres?.kill('SIGKILL'), 5_000);
      await stopped;
      clearTimeout(forceStop);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function withPostgres(
  run: (harness: PostgresHarness) => Promise<void>,
): Promise<void> {
  const username = 'autorfp';
  const database = 'autorfp_test';
  const password = randomBytes(24).toString('hex');
  let container: StartedTestContainer | undefined;

  try {
    container = await new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({
        POSTGRES_DB: database,
        POSTGRES_PASSWORD: password,
        POSTGRES_USER: username,
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(
        Wait.forLogMessage(
          /database system is ready to accept connections/,
          2,
        ),
      )
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
      .start();

    const host = container.getHost();
    const urlHost = host.includes(':') ? `[${host}]` : host;
    const databaseUrl =
      `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}` +
      `@${urlHost}:${container.getMappedPort(POSTGRES_PORT)}` +
      `/${encodeURIComponent(database)}?schema=public`;

    await run(createHarness(databaseUrl));
  } catch (error) {
    if (
      !container &&
      error instanceof Error &&
      error.message.includes('Could not find a working container runtime strategy')
    ) {
      await withLocalPostgres(run);
      return;
    }
    throw error;
  } finally {
    await container?.stop();
  }
}

export async function withMigratedPostgres(
  run: (databaseUrl: string) => Promise<void>,
): Promise<void> {
  await withPostgres(async ({ databaseUrl }) => {
    await deployMigrations(databaseUrl);
    await run(databaseUrl);
  });
}
