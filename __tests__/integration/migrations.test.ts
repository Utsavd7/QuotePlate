import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { withMigratedPostgres, withPostgres } from './setup/postgres';

const currentTables = [
  'AuditEvent',
  'Award',
  'Menu',
  'ProcurementRequest',
  'RateLimitBucket',
  'ServicePlan',
  'ServicePlanRevision',
  'Supplier',
  'SupplierCollaboration',
  'SupplierDemandShare',
  'SupplierPortal',
  'SupplierRequest',
  'Tenant',
  'User',
];

const legacyTables = [
  'AuditEvent',
  'Award',
  'AwardLine',
  'ExternalIdentity',
  'Ingredient',
  'Invitation',
  'Menu',
  'ProcurementRequest',
  'RateLimitBucket',
  'Recipe',
  'RequestItem',
  'Supplier',
  'SupplierQuote',
  'SupplierQuoteItem',
  'SupplierRequest',
  'Tenant',
  'User',
];

const compactMigration = '20260831000100_compact_nine_table_schema' as const;

test('deploys every migration to an empty PostgreSQL database without schema drift', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    try {
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `;
      const migrations = await prisma.$queryRaw<
        Array<{
          migration_name: string;
          finished_at: Date | null;
          rolled_back_at: Date | null;
        }>
      >`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at
      `;

      expect(tables.map(({ tablename }) => tablename).sort()).toEqual([
        ...currentTables,
        '_prisma_migrations',
      ].sort());
      expect(migrations).toEqual([
        expect.objectContaining({
          migration_name: '20260827000100_lean_baseline',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000200_launch_schema',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000300_forced_rls',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000400_member_invitations',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000500_menu_recipe_retirement',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000600_public_supplier_grants',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000700_quote_integrity',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000800_award_snapshot_capacity',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827000900_minimal_launch_columns',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827001000_backup_role',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827001100_minimal_rate_limit_bucket',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260827001200_current_user_credentials',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: compactMigration,
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260904000100_award_receiving',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260907000100_service_planning',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260907000200_supplier_collaboration',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
        expect.objectContaining({
          migration_name: '20260908000100_supplier_trading_profile',
          finished_at: expect.any(Date),
          rolled_back_at: null,
        }),
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });
});

function ownerGuard(migration: string) {
  const sql = readFileSync(
    path.resolve(__dirname, `../../prisma/migrations/${migration}/migration.sql`),
    'utf8',
  );
  return sql.slice(
    sql.indexOf('DO $migration_owner$'),
    sql.indexOf('$migration_owner$;') + '$migration_owner$;'.length,
  );
}

test('early owner guards accept inherited bypass capability without provider usernames', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    await migrateTo('20260827000200_launch_schema');
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await admin.$executeRawUnsafe(
        'CREATE ROLE neon_superuser_compat NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOLOGIN',
      );
      await admin.$executeRawUnsafe(
        'CREATE ROLE neon_launch_owner NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS NOLOGIN',
      );
      await admin.$executeRawUnsafe(
        'GRANT neon_superuser_compat TO neon_launch_owner',
      );
      await admin.$executeRawUnsafe(
        'CREATE SCHEMA autorfp_private AUTHORIZATION neon_launch_owner',
      );
      for (const table of legacyTables) {
        await admin.$executeRawUnsafe(
          `ALTER TABLE public."${table}" OWNER TO neon_launch_owner`,
        );
      }

      for (const migration of [
        '20260827000300_forced_rls',
        '20260827000400_member_invitations',
        '20260827000500_menu_recipe_retirement',
        '20260827000600_public_supplier_grants',
      ]) {
        await expect(
          admin.$transaction(async (transaction) => {
            await transaction.$executeRawUnsafe('SET LOCAL ROLE neon_launch_owner');
            await transaction.$executeRawUnsafe(ownerGuard(migration));
          }),
        ).resolves.toBeUndefined();
      }
    } finally {
      await admin.$disconnect();
    }
  });
});

test('forced-RLS migration runs as a managed Postgres owner without true superuser', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo, applyMigrationAs }) => {
    await migrateTo('20260827000200_launch_schema');
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const password = 'managed_owner_test_password';
    const managedOwnerUrl = new URL(databaseUrl);
    managedOwnerUrl.username = 'managed_migration_owner';
    managedOwnerUrl.password = password;

    try {
      await admin.$executeRawUnsafe(
        `CREATE ROLE managed_migration_owner LOGIN NOSUPERUSER NOCREATEDB CREATEROLE INHERIT NOREPLICATION BYPASSRLS PASSWORD '${password}'`,
      );
      await admin.$executeRawUnsafe(
        'ALTER SCHEMA public OWNER TO managed_migration_owner',
      );
      const [{ database_name }] = await admin.$queryRaw<
        Array<{ database_name: string }>
      >`SELECT current_database() AS database_name`;
      await admin.$executeRawUnsafe(
        `GRANT CREATE ON DATABASE "${database_name.replaceAll('"', '""')}" TO managed_migration_owner`,
      );
      for (const table of legacyTables) {
        await admin.$executeRawUnsafe(
          `ALTER TABLE public."${table}" OWNER TO managed_migration_owner`,
        );
      }

      await expect(
        applyMigrationAs(
          '20260827000300_forced_rls',
          managedOwnerUrl.toString(),
        ),
      ).resolves.toBeUndefined();

      const [runtimeRole] = await admin.$queryRaw<
        Array<{
          rolcanlogin: boolean;
          rolsuper: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolinherit: boolean;
          rolreplication: boolean;
          rolbypassrls: boolean;
        }>
      >`
        SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
               rolreplication, rolbypassrls
        FROM pg_catalog.pg_roles
        WHERE rolname = 'autorfp_app'
      `;

      expect(runtimeRole).toEqual({
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolbypassrls: false,
      });
    } finally {
      await admin.$disconnect();
    }
  });
});

test('all migrations run as a managed Postgres database owner without true superuser', async () => {
  await withPostgres(async ({ databaseUrl, applyMigrationAs }) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const password = 'managed_database_owner_test_password';
    const managedOwnerUrl = new URL(databaseUrl);
    managedOwnerUrl.username = 'managed_database_owner';
    managedOwnerUrl.password = password;

    try {
      await admin.$executeRawUnsafe(
        `CREATE ROLE managed_database_owner LOGIN NOSUPERUSER NOCREATEDB CREATEROLE INHERIT NOREPLICATION BYPASSRLS PASSWORD '${password}'`,
      );
      await admin.$executeRawUnsafe(
        'CREATE ROLE autorfp_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS',
      );
      await admin.$executeRawUnsafe(
        'GRANT autorfp_backup TO managed_database_owner WITH ADMIN OPTION',
      );
      const [{ database_name }] = await admin.$queryRaw<
        Array<{ database_name: string }>
      >`SELECT current_database() AS database_name`;
      await admin.$executeRawUnsafe(
        `ALTER DATABASE "${database_name.replaceAll('"', '""')}" OWNER TO managed_database_owner`,
      );

      for (const migration of [
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
        compactMigration,
      ] as const) {
        await applyMigrationAs(migration, managedOwnerUrl.toString());
      }

      const roles = await admin.$queryRaw<
        Array<{
          rolname: string;
          rolcanlogin: boolean;
          rolsuper: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolinherit: boolean;
          rolreplication: boolean;
          rolbypassrls: boolean;
        }>
      >`
        SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
               rolinherit, rolreplication, rolbypassrls
        FROM pg_catalog.pg_roles
        WHERE rolname IN ('autorfp_app', 'autorfp_backup')
        ORDER BY rolname
      `;

      expect(roles).toEqual([
        {
          rolname: 'autorfp_app',
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
        },
        {
          rolname: 'autorfp_backup',
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: true,
        },
      ]);
      const [functionOwners] = await admin.$queryRaw<
        Array<{
          function_count: bigint;
          owners_bypass_rls: boolean;
          owned_by_migration_role: boolean;
        }>
      >`
        SELECT COUNT(*) AS function_count,
               bool_and(owner.rolsuper OR owner.rolbypassrls)
                 AS owners_bypass_rls,
               bool_and(owner.rolname = 'managed_database_owner')
                 AS owned_by_migration_role
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
        WHERE namespace.nspname = 'autorfp_private'
      `;
      expect(functionOwners).toEqual({
        function_count: BigInt(7),
        owners_bypass_rls: true,
        owned_by_migration_role: true,
      });
    } finally {
      await admin.$disconnect();
    }
  });
});

test('compact replacement empirically rejects inherited-only RLS bypass', async () => {
  const sql = readFileSync(
    path.resolve(
      __dirname,
      `../../prisma/migrations/${compactMigration}/migration.sql`,
    ),
    'utf8',
  );
  const guardStart = sql.indexOf('DO $compact_schema_guard$');
  const bypassError = sql.indexOf(
    'Compact schema migration requires a row-security-bypassing owner',
  );
  const firstTableRead = sql.indexOf('FROM public."Tenant"');
  const guardEnd = sql.indexOf('$compact_schema_guard$;', guardStart);
  const firstDestructive = sql.search(/\n(?:REVOKE|DROP|ALTER)\s/);

  expect(sql).toMatch(/^BEGIN;\s+DO \$compact_schema_guard\$/);
  expect(guardStart).toBeGreaterThan('BEGIN;'.length);
  expect(bypassError).toBeGreaterThan(guardStart);
  expect(firstTableRead).toBeGreaterThan(bypassError);
  expect(sql.slice(guardStart, guardEnd)).not.toMatch(
    /ALTER ROLE|DISABLE ROW LEVEL SECURITY/,
  );
  expect(sql.slice(guardStart, guardEnd)).toContain('pg_temp.autorfp_rls_probe');
  expect(sql.slice(guardStart, guardEnd)).toContain('ON COMMIT DROP');
  expect(sql.slice(guardStart, guardEnd)).toContain('FORCE ROW LEVEL SECURITY');
  expect(sql.slice(guardStart, guardEnd)).toContain("'USAGE'");
  expect(firstDestructive).toBeGreaterThan(guardStart);

  await withPostgres(async ({ databaseUrl, migrateTo, applyMigrationAs }) => {
    await migrateTo('20260827001200_current_user_credentials');
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const bypassRole = 'compact_provider_bypass';
    const inheritedRole = 'compact_inherited_bypass_owner';
    const inheritedPassword = 'compact-inherited-bypass-password';
    const setOnlyRole = 'compact_set_only_owner';
    const setOnlyPassword = 'compact-set-only-owner-password';
    const transferOwnership = (role: string) => prisma.$executeRawUnsafe(`DO $transfer_compact_ownership$
      DECLARE target RECORD;
      BEGIN
        EXECUTE pg_catalog.format(
          'GRANT CREATE ON DATABASE %I TO ${role}', current_database()
        );
        FOR target IN
          SELECT pg_catalog.format(
            'ALTER TABLE public.%I OWNER TO ${role}', tablename
          ) AS statement
          FROM pg_catalog.pg_tables WHERE schemaname = 'public'
        LOOP EXECUTE target.statement; END LOOP;
        FOR target IN
          SELECT pg_catalog.format(
            'ALTER TYPE public.%I OWNER TO ${role}', type.typname
          ) AS statement
          FROM pg_catalog.pg_type AS type
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = type.typnamespace
          WHERE namespace.nspname = 'public' AND type.typtype = 'e'
        LOOP EXECUTE target.statement; END LOOP;
        FOR target IN
          SELECT pg_catalog.format(
            'ALTER FUNCTION %s OWNER TO ${role}', procedure.oid::REGPROCEDURE
          ) AS statement
          FROM pg_catalog.pg_proc AS procedure
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = procedure.pronamespace
          WHERE namespace.nspname = 'autorfp_private'
        LOOP EXECUTE target.statement; END LOOP;
        ALTER SCHEMA autorfp_private OWNER TO ${role};
        ALTER SCHEMA public OWNER TO ${role};
      END
    $transfer_compact_ownership$`);

    try {
      await prisma.tenant.create({
        data: {
          id: 'guarded-tenant',
          name: 'Guarded Kitchen',
          addressLine: '1 Safe Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pin: '400001',
          phone: '9000000001',
        },
      });

      await expect(
        applyMigrationAs(compactMigration, databaseUrl),
      ).rejects.toThrow(
        'Compact schema migration requires an empty pre-launch database',
      );

      for (const statement of [
        `CREATE ROLE ${bypassRole} NOLOGIN BYPASSRLS`,
        `CREATE ROLE ${inheritedRole} LOGIN INHERIT NOBYPASSRLS PASSWORD '${inheritedPassword}'`,
        `CREATE ROLE ${setOnlyRole} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${setOnlyPassword}'`,
        `GRANT ${bypassRole} TO ${inheritedRole}`,
        `GRANT ${bypassRole} TO ${setOnlyRole}`,
      ]) await prisma.$executeRawUnsafe(statement);

      const membership = await prisma.$queryRawUnsafe<
        Array<{ role: string; usable: boolean }>
      >(`
        SELECT member.rolname AS role,
               pg_catalog.pg_has_role(member.oid, bypass.oid, 'USAGE') AS usable
        FROM pg_catalog.pg_roles AS member
        CROSS JOIN pg_catalog.pg_roles AS bypass
        WHERE member.rolname IN ('${inheritedRole}', '${setOnlyRole}')
          AND bypass.rolname = '${bypassRole}'
        ORDER BY member.rolname
      `);
      expect(membership).toEqual([
        { role: inheritedRole, usable: true },
        { role: setOnlyRole, usable: false },
      ]);

      await transferOwnership(inheritedRole);
      const inheritedUrl = new URL(databaseUrl);
      inheritedUrl.username = inheritedRole;
      inheritedUrl.password = inheritedPassword;
      const inheritedOwner = new PrismaClient({
        datasources: { db: { url: inheritedUrl.toString() } },
      });
      try {
        await expect(inheritedOwner.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM public."Tenant" WHERE "id" = 'guarded-tenant'
        `).resolves.toEqual([]);
      } finally {
        await inheritedOwner.$disconnect();
      }
      await expect(
        applyMigrationAs(compactMigration, inheritedUrl.toString()),
      ).rejects.toThrow(
        'Compact schema migration requires a row-security-bypassing owner',
      );

      await transferOwnership(setOnlyRole);
      const setOnlyUrl = new URL(databaseUrl);
      setOnlyUrl.username = setOnlyRole;
      setOnlyUrl.password = setOnlyPassword;
      await expect(
        applyMigrationAs(compactMigration, setOnlyUrl.toString()),
      ).rejects.toThrow(
        'Compact schema migration requires a row-security-bypassing owner',
      );

      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_catalog.pg_tables
        WHERE schemaname = 'public' ORDER BY tablename
      `;
      expect(tables.map(({ tablename }) => tablename)).toEqual(legacyTables);
      const rows = await prisma.$queryRaw<Array<{ name: string }>>`
        SELECT "name" FROM public."Tenant"
        WHERE "id" = 'guarded-tenant'
      `;
      expect(rows).toEqual([{ name: 'Guarded Kitchen' }]);
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('minimal-column migration retains its non-bypass table-owner regression', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo, applyMigrationAs }) => {
    await migrateTo('20260827000800_award_snapshot_capacity');
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const role = 'minimal_columns_owner';
    const password = 'minimal-columns-owner-password';

    try {
      for (const statement of [
        `INSERT INTO "Tenant" ("id", "name", "addressLine", "city", "state", "pin", "phone", "updatedAt") VALUES ('tenant-owner-test', 'Owner Test Kitchen', '2 Market Road', 'Mumbai', 'Maharashtra', '400002', '9000000002', CURRENT_TIMESTAMP)`,
        `INSERT INTO "Menu" ("id", "tenantId", "name", "updatedAt") VALUES ('menu-owner-test', 'tenant-owner-test', 'Owner test menu', CURRENT_TIMESTAMP)`,
        `INSERT INTO "Recipe" ("id", "tenantId", "menuId", "name", "position", "retiredAt") VALUES ('recipe-owner-active', 'tenant-owner-test', 'menu-owner-test', 'Current dish', 0, NULL), ('recipe-owner-retired', 'tenant-owner-test', 'menu-owner-test', 'Old dish', 1, CURRENT_TIMESTAMP)`,
        `INSERT INTO "Ingredient" ("id", "tenantId", "recipeId", "name", "quantity", "unit", "position") VALUES ('ingredient-owner-retired', 'tenant-owner-test', 'recipe-owner-retired', 'Rice', 1.000, 'KILOGRAM', 0)`,
      ]) await admin.$executeRawUnsafe(statement);
      await admin.$executeRawUnsafe(`
        CREATE ROLE ${role} LOGIN PASSWORD '${password}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
      `);
      await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      for (const table of ['Recipe', 'RequestItem', 'Supplier']) {
        await admin.$executeRawUnsafe(`ALTER TABLE "${table}" OWNER TO ${role}`);
      }

      const ownerUrl = new URL(databaseUrl);
      ownerUrl.username = role;
      ownerUrl.password = password;
      await applyMigrationAs(
        '20260827000900_minimal_launch_columns',
        ownerUrl.toString(),
      );

      const recipes = await admin.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Recipe" ORDER BY "id"
      `;
      expect(recipes).toEqual([{ id: 'recipe-owner-active' }]);
      const retiredIngredients = await admin.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "Ingredient"
        WHERE "id" = 'ingredient-owner-retired'
      `;
      expect(retiredIngredients).toEqual([{ count: BigInt(0) }]);
    } finally {
      await admin.$disconnect();
    }
  });
});

test('forced-RLS migration rejects a pre-created runtime role with privileged membership', async () => {
  await withPostgres(async ({ databaseUrl, migrateTo }) => {
    await migrateTo('20260827000200_launch_schema');
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await admin.$executeRawUnsafe(
        'CREATE ROLE provider_console_admin NOLOGIN BYPASSRLS',
      );
      await admin.$executeRawUnsafe(
        'CREATE ROLE autorfp_app LOGIN INHERIT NOBYPASSRLS',
      );
      await admin.$executeRawUnsafe(
        'GRANT provider_console_admin TO autorfp_app',
      );

      await expect(
        migrateTo('20260827000300_forced_rls'),
      ).rejects.toThrow(/must not inherit a row-security-bypassing role/i);
    } finally {
      await admin.$disconnect();
    }
  });
});
