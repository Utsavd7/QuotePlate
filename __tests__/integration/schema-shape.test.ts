import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { checkRuntimeDatabase } from '@/lib/health/readiness';

import { withMigratedPostgres, withPostgres } from './setup/postgres';

const applicationTables =
  'AuditEvent Award Menu ProcurementRequest RateLimitBucket ServicePlan ServicePlanRevision Supplier SupplierCollaboration SupplierDemandShare SupplierPortal SupplierRequest Tenant User'.split(
    ' ',
  );
const expectedColumns: Record<string, string> = {
  AuditEvent: 'id tenantId actorUserId action entityType entityId metadata createdAt',
  Award: 'id tenantId requestId rationale allocationLines supplierSnapshots deliverySnapshot receiving totalPaise awardedByUserId createdAt',
  Menu: 'id tenantId name sourceText status version approvedAt approvedByUserId createdByUserId createdAt updatedAt document',
  ProcurementRequest: 'id tenantId title status version menuId sourceRequestId deliveryDetails deliveryDate quoteDeadline commercialTerms openedAt awardedAt cancelledAt createdByUserId createdAt updatedAt items sourcing applicationTokenDigest applicationExpiresAt applicationRevokedAt',
  RateLimitBucket: 'keyDigest count resetAt',
  ServicePlan: 'id tenantId name version serviceAt menuId menuVersion menuSnapshot document requestId createdByUserId createdAt updatedAt',
  ServicePlanRevision: 'id tenantId planId version document createdAt',
  Supplier: 'id tenantId businessName contactName phone whatsappNumber email addressLine city state pin gstin notes isActive createdAt updatedAt relationshipType verificationStatus applicationRequestId capabilities verifiedAt verifiedByUserId tradingProfile',
  SupplierPortal: 'id tenantId supplierId tokenDigest expiresAt revokedAt createdAt updatedAt',
  SupplierCollaboration: 'id tenantId supplierId requestId version revisions createdAt updatedAt',
  SupplierDemandShare: 'id tenantId supplierId planId planVersion serviceAt items withdrawnAt sharedAt',
  SupplierRequest: 'id tenantId requestId supplierId tokenDigest expiresAt revokedAt viewedAt createdAt quoteRevision quoteRevisions updatedAt',
  Tenant: 'id name addressLine city state pin phone timezone gstin isActive createdAt updatedAt',
  User: 'id tenantId name email passwordHash role isActive lastLoginAt createdAt updatedAt googleSubject accountState invitationTokenDigest invitationExpiresAt invitationAcceptedAt invitationRevokedAt invitedByUserId tutorialVersion tutorialStep tutorialSkippedAt tutorialCompletedAt',
};
const requiredFunctions =
  'autorfp_auth_credentials_by_email autorfp_auth_identity_by_email autorfp_auth_identity_by_google_subject autorfp_invitation_tenant_by_digest autorfp_supplier_application_grant_by_digest autorfp_supplier_grant_by_digest autorfp_supplier_portal_by_digest autorfp_user_email_exists'.split(
  ' ',
  );
const jsonConstraints = [
  ['AuditEvent_metadata_size_check', 'AuditEvent', 'metadata', '16384'],
  ['Award_allocationLines_size_check', 'Award', 'allocationLines', '2097152'],
  ['Award_deliverySnapshot_size_check', 'Award', 'deliverySnapshot', '16384'],
  ['Award_supplierSnapshots_size_check', 'Award', 'supplierSnapshots', '2097152'],
  ['Award_receiving_size_check', 'Award', 'receiving', '1048576'],
  ['Menu_document_size_check', 'Menu', 'document', '524288'],
  ['ProcurementRequest_deliveryDetails_size_check', 'ProcurementRequest', 'deliveryDetails', '16384'],
  ['ProcurementRequest_items_size_check', 'ProcurementRequest', 'items', '524288'],
  ['ProcurementRequest_sourcing_size_check', 'ProcurementRequest', 'sourcing', '65536'],
  ['ServicePlan_document_size_check', 'ServicePlan', 'document', '524288'],
  ['ServicePlan_menuSnapshot_size_check', 'ServicePlan', 'menuSnapshot', '1048576'],
  ['ServicePlanRevision_document_size_check', 'ServicePlanRevision', 'document', '524288'],
  ['Supplier_capabilities_size_check', 'Supplier', 'capabilities', '65536'],
  ['Supplier_tradingProfile_size_check', 'Supplier', 'tradingProfile', '8192'],
  ['SupplierCollaboration_revisions_size_check', 'SupplierCollaboration', 'revisions', '131072'],
  ['SupplierDemandShare_items_size_check', 'SupplierDemandShare', 'items', '131072'],
  ['SupplierRequest_quoteRevisions_size_check', 'SupplierRequest', 'quoteRevisions', '2097152'],
] as const;
const tenantPolicies = [
  ['Tenant', 'id'],
  ['User', 'tenantId'],
  ['Menu', 'tenantId'],
  ['ServicePlan', 'tenantId'],
  ['ServicePlanRevision', 'tenantId'],
  ['Supplier', 'tenantId'],
  ['ProcurementRequest', 'tenantId'],
  ['SupplierCollaboration', 'tenantId'],
  ['SupplierDemandShare', 'tenantId'],
  ['SupplierPortal', 'tenantId'],
  ['SupplierRequest', 'tenantId'],
  ['Award', 'tenantId'],
  ['AuditEvent', 'tenantId'],
] as const;

async function checkReadinessAsApp(prisma: PrismaClient) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe('SET LOCAL ROLE autorfp_app');
    await checkRuntimeDatabase(transaction);
  });
}

function functionOwnerSecurity(prisma: PrismaClient) {
  return prisma.$queryRaw<Array<{ attestation: string | null; owner: string }>>`
    SELECT DISTINCT
      pg_catalog.obj_description(procedure.oid, 'pg_proc') AS attestation,
      owner.rolname AS owner
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
    WHERE namespace.nspname = 'autorfp_private'
  `;
}

function attemptRestoreWithUrl(restoreDatabaseUrl: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'quoteplate-restore-url-'));
  const backup = path.join(directory, 'backup.dump.gz.age');
  const identity = path.join(directory, 'identity.txt');
  try {
    writeFileSync(backup, 'encrypted');
    writeFileSync(identity, 'identity');
    for (const command of ['age', 'psql']) {
      const executable = path.join(directory, command);
      writeFileSync(executable, '#!/bin/sh\nexit 98\n');
      chmodSync(executable, 0o755);
    }
    return spawnSync(
      'sh',
      [path.resolve(__dirname, '../../scripts/restore-verify.sh'), backup],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          RESTORE_DATABASE_URL: restoreDatabaseUrl,
          AGE_IDENTITY_FILE: identity,
        },
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function deployMigrations(databaseUrl: string) {
  const projectRoot = path.resolve(__dirname, '../..');
  execFileSync(process.execPath, [
    path.join(projectRoot, 'node_modules/prisma/build/index.js'),
    'migrate', 'deploy', '--schema', path.join(projectRoot, 'prisma/schema.prisma'),
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      NO_COLOR: '1',
    },
  });
}

test('supplier collaboration catalog keeps fourteen bounded tables and fixed digest grants', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_catalog.pg_tables
        WHERE schemaname = 'public' ORDER BY tablename
      `;
      expect(tables.map(({ tablename }) => tablename)).toEqual(
        [...applicationTables, '_prisma_migrations'].sort(),
      );
      const columns = await prisma.$queryRaw<
        Array<{
          table_name: string;
          column_name: string;
          udt_name: string;
          is_nullable: 'YES' | 'NO';
          character_maximum_length: number | null;
        }>
      >`
        SELECT table_name, column_name, udt_name, is_nullable,
               character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
        ORDER BY table_name, ordinal_position
      `;
      for (const table of applicationTables) {
        expect(
          columns.filter((row) => row.table_name === table)
            .map((row) => row.column_name).sort(),
        ).toEqual(expectedColumns[table].split(' ').sort());
      }
      const byColumn = new Map(
        columns.map((row) => [`${row.table_name}.${row.column_name}`, row]),
      );
      for (const key of [
        'SupplierCollaboration.revisions', 'SupplierDemandShare.items', 'ServicePlan.document', 'ServicePlan.menuSnapshot', 'ServicePlanRevision.document',
        'Menu.document', 'Supplier.capabilities', 'Supplier.tradingProfile', 'ProcurementRequest.items',
        'ProcurementRequest.sourcing', 'ProcurementRequest.deliveryDetails',
        'SupplierRequest.quoteRevisions', 'Award.allocationLines',
        'Award.supplierSnapshots', 'Award.deliverySnapshot', 'Award.receiving', 'AuditEvent.metadata',
      ]) expect(byColumn.get(key)?.udt_name).toBe('jsonb');
      for (const [key, nullable] of [
        ['User.invitationTokenDigest', 'YES'],
        ['ProcurementRequest.applicationTokenDigest', 'YES'],
        ['SupplierRequest.tokenDigest', 'NO'],
        ['SupplierPortal.tokenDigest', 'NO'],
        ['RateLimitBucket.keyDigest', 'NO'],
      ]) {
        expect(byColumn.get(key)).toEqual(expect.objectContaining({
          udt_name: 'bpchar', is_nullable: nullable,
          character_maximum_length: 64,
        }));
      }
      expect(byColumn.get('Supplier.tradingProfile')).toEqual(expect.objectContaining({ udt_name: 'jsonb', is_nullable: 'YES' }));
      expect(byColumn.get('User.email')).toEqual(expect.objectContaining({
        udt_name: 'varchar', character_maximum_length: 320,
      }));
      expect(byColumn.get('ProcurementRequest.deliveryDate')?.udt_name).toBe('date');
      expect(byColumn.get('Award.totalPaise')?.udt_name).toBe('int8');
      expect(byColumn.has('RateLimitBucket.tenantId')).toBe(false);
      const enums = await prisma.$queryRaw<
        Array<{ name: string; values: string[] }>
      >`
        SELECT type.typname AS name,
               array_agg(value.enumlabel ORDER BY value.enumsortorder)::TEXT[] AS values
        FROM pg_catalog.pg_type AS type
        JOIN pg_catalog.pg_enum AS value ON value.enumtypid = type.oid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
        WHERE namespace.nspname = 'public'
        GROUP BY type.typname ORDER BY type.typname
      `;
      expect(enums).toEqual([
        { name: 'MenuStatus', values: ['DRAFT', 'APPROVED'] },
        { name: 'ProcurementRequestStatus', values: ['DRAFT', 'OPEN', 'AWARDED', 'CANCELLED'] },
        { name: 'SupplierRelationshipType', values: ['CURRENT', 'SELECTED_NEW', 'APPLICANT'] },
        { name: 'SupplierVerificationStatus', values: ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'] },
        { name: 'UserAccountState', values: ['INVITED', 'ACTIVE', 'DEACTIVATED'] },
        { name: 'UserRole', values: ['OWNER', 'MEMBER'] },
      ]);
      const checks = await prisma.$queryRaw<
        Array<{ name: string; definition: string }>
      >`
        SELECT constraint_catalog.conname AS name,
               pg_get_constraintdef(constraint_catalog.oid) AS definition
        FROM pg_catalog.pg_constraint AS constraint_catalog
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = constraint_catalog.connamespace
        WHERE namespace.nspname = 'public' AND constraint_catalog.contype = 'c'
      `;
      for (const [name, , , cap] of jsonConstraints) {
        expect(checks.find((check) => check.name === name)?.definition)
          .toMatch(new RegExp(`octet_length.*${cap}`));
      }
      expect(checks.map(({ name }) => name)).toEqual(expect.arrayContaining([
        'Award_totalPaise_check', 'Menu_version_check',
        'ProcurementRequest_version_check', 'RateLimitBucket_count_check',
        'SupplierRequest_quoteRevision_check', 'User_tutorialStep_check',
      ]));

      const foreignKeys = await prisma.$queryRaw<Array<{ path: string }>>`
        SELECT format('%s|%s|%s|%s', child.relname,
          array_to_string(array_agg(child_column.attname ORDER BY pair.ordinality), ','),
          parent.relname,
          array_to_string(array_agg(parent_column.attname ORDER BY pair.ordinality), ',')) AS path
        FROM pg_catalog.pg_constraint AS constraint_catalog
        JOIN pg_catalog.pg_class AS child ON child.oid = constraint_catalog.conrelid
        JOIN pg_catalog.pg_class AS parent ON parent.oid = constraint_catalog.confrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = child.relnamespace
        CROSS JOIN LATERAL unnest(constraint_catalog.conkey, constraint_catalog.confkey)
          WITH ORDINALITY AS pair(child_attnum, parent_attnum, ordinality)
        JOIN pg_catalog.pg_attribute AS child_column
          ON child_column.attrelid = child.oid AND child_column.attnum = pair.child_attnum
        JOIN pg_catalog.pg_attribute AS parent_column
          ON parent_column.attrelid = parent.oid AND parent_column.attnum = pair.parent_attnum
        WHERE namespace.nspname = 'public' AND constraint_catalog.contype = 'f'
        GROUP BY child.relname, parent.relname, constraint_catalog.oid
      `;
      const fkPaths = foreignKeys.map(({ path }) => path);
      for (const path of [
        'SupplierPortal|tenantId,supplierId|Supplier|tenantId,id',
        'SupplierCollaboration|tenantId,supplierId|Supplier|tenantId,id',
        'SupplierCollaboration|tenantId,requestId|ProcurementRequest|tenantId,id',
        'SupplierDemandShare|tenantId,supplierId|Supplier|tenantId,id',
        'SupplierDemandShare|tenantId,planId|ServicePlan|tenantId,id',
        'ServicePlan|tenantId,menuId|Menu|tenantId,id',
        'ServicePlan|tenantId,createdByUserId|User|tenantId,id',
        'ServicePlan|tenantId,requestId|ProcurementRequest|tenantId,id',
        'ServicePlanRevision|tenantId,planId|ServicePlan|tenantId,id',
        'User|tenantId,invitedByUserId|User|tenantId,id',
        'Menu|tenantId,approvedByUserId|User|tenantId,id',
        'Menu|tenantId,createdByUserId|User|tenantId,id',
        'Supplier|tenantId,applicationRequestId|ProcurementRequest|tenantId,id',
        'Supplier|tenantId,verifiedByUserId|User|tenantId,id',
        'ProcurementRequest|tenantId,menuId|Menu|tenantId,id',
        'ProcurementRequest|tenantId,sourceRequestId|ProcurementRequest|tenantId,id',
        'ProcurementRequest|tenantId,createdByUserId|User|tenantId,id',
        'SupplierRequest|tenantId,requestId|ProcurementRequest|tenantId,id',
        'SupplierRequest|tenantId,supplierId|Supplier|tenantId,id',
        'Award|tenantId,requestId|ProcurementRequest|tenantId,id',
        'Award|tenantId,awardedByUserId|User|tenantId,id',
        'AuditEvent|tenantId,actorUserId|User|tenantId,id',
      ]) expect(fkPaths).toContain(path);

      const indexes = await prisma.$queryRaw<Array<{ path: string }>>`
        SELECT format('%s|%s', table_catalog.relname,
          array_to_string(array_agg(attribute.attname ORDER BY key.ordinality), ',')) AS path
        FROM pg_catalog.pg_index AS index_catalog
        JOIN pg_catalog.pg_class AS table_catalog ON table_catalog.oid = index_catalog.indrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_catalog.relnamespace
        CROSS JOIN LATERAL unnest(index_catalog.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = table_catalog.oid AND attribute.attnum = key.attnum
        WHERE namespace.nspname = 'public' AND NOT index_catalog.indisprimary
        GROUP BY table_catalog.relname, index_catalog.indexrelid
      `;
      const indexPaths = indexes.map(({ path }) => path);
      expect(indexPaths).toEqual(expect.arrayContaining([
        'ServicePlan|tenantId,serviceAt', 'ServicePlanRevision|tenantId,planId,version',
        'Menu|tenantId,status,updatedAt', 'ProcurementRequest|tenantId,status,updatedAt',
        'ProcurementRequest|tenantId,createdAt', 'Supplier|tenantId,isActive,businessName',
        'Award|tenantId,createdAt', 'AuditEvent|tenantId,createdAt',
        'SupplierRequest|tenantId,requestId,supplierId',
      ]));
      for (const table of applicationTables.filter(
        (table) => !['Tenant', 'RateLimitBucket', 'ServicePlanRevision'].includes(table),
      )) expect(indexPaths).toContain(`${table}|tenantId,id`);

      const functions = await prisma.$queryRaw<
        Array<{
          name: string;
          security_definer: boolean;
          settings: string[];
          owner_bypasses_rls: boolean;
          owner_attested: boolean;
        }>
      >`
        SELECT procedure.proname AS name, procedure.prosecdef AS security_definer,
               procedure.proconfig::TEXT[] AS settings,
               (owner.rolsuper OR owner.rolbypassrls) AS owner_bypasses_rls,
               pg_catalog.obj_description(procedure.oid, 'pg_proc') =
                 pg_catalog.format(
                   'quoteplate:rls-owner-attestation:direct:%s', owner.rolname
                 ) AS owner_attested
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
        WHERE namespace.nspname = 'autorfp_private' ORDER BY procedure.proname
      `;
      expect(functions).toEqual(requiredFunctions.map((name) => ({
        name, security_definer: true, settings: ['search_path=pg_catalog'],
        owner_bypasses_rls: true, owner_attested: true,
      })));
      const backupAccess = await prisma.$queryRaw<Array<{ table_name: string; readable: boolean }>>`
        SELECT table_catalog.relname AS table_name,
          pg_catalog.has_table_privilege('autorfp_backup', table_catalog.oid, 'SELECT') AS readable
        FROM pg_catalog.pg_class AS table_catalog
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_catalog.relnamespace
        WHERE namespace.nspname = 'public'
          AND table_catalog.relkind = 'r'
          AND table_catalog.relname <> '_prisma_migrations'
        ORDER BY table_catalog.relname
      `;
      expect(backupAccess).toEqual(applicationTables.map((table_name) => ({
        table_name, readable: true,
      })));
      await checkReadinessAsApp(prisma);

      for (const statement of [
        `INSERT INTO "Tenant" ("id", "name", "addressLine", "city", "state", "pin", "phone", "updatedAt") VALUES ('compact-tenant-a', 'A', 'A', 'A', 'A', '000000', 'A', CURRENT_TIMESTAMP), ('compact-tenant-b', 'B', 'B', 'B', 'B', '000000', 'B', CURRENT_TIMESTAMP)`,
        `INSERT INTO "User" ("id", "tenantId", "name", "email", "role", "accountState", "updatedAt") VALUES ('compact-user-a', 'compact-tenant-a', 'A', 'a@example.test', 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP), ('compact-user-b', 'compact-tenant-b', 'B', 'b@example.test', 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP)`,
        `INSERT INTO "Menu" ("id", "tenantId", "name", "status", "version", "document", "createdByUserId", "updatedAt") VALUES ('compact-menu-a', 'compact-tenant-a', 'A', 'DRAFT', 1, '{}', 'compact-user-a', CURRENT_TIMESTAMP)`,
        `INSERT INTO "ProcurementRequest" ("id", "tenantId", "title", "status", "version", "items", "sourcing", "deliveryDetails", "deliveryDate", "quoteDeadline", "applicationTokenDigest", "applicationExpiresAt", "createdByUserId", "createdAt", "updatedAt") VALUES ('compact-request-a', 'compact-tenant-a', 'A', 'OPEN', 1, '{"v":1,"items":[{"id":"item-a","sourcingOverride":null}]}', '{"v":1,"default":{"v":1,"modes":["VERIFIED_NEW"],"currentSupplierIds":[],"selectedNewSupplierIds":[],"acceptVerifiedApplications":true}}', '{}', CURRENT_DATE + 2, CURRENT_TIMESTAMP + INTERVAL '1 day', repeat('a', 64), CURRENT_TIMESTAMP + INTERVAL '1 day', 'compact-user-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ]) await prisma.$executeRawUnsafe(statement);
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO "Supplier" ("id", "tenantId", "businessName", "relationshipType", "verificationStatus", "applicationRequestId", "capabilities", "updatedAt")
        VALUES ('cross-tenant', 'compact-tenant-b', 'Bad', 'APPLICANT', 'PENDING', 'compact-request-a', '{"v":1,"categories":[],"items":[]}', CURRENT_TIMESTAMP)
      `)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`
        UPDATE "Menu" SET "document" = jsonb_build_object('payload', repeat('x', 524289))
        WHERE "id" = 'compact-menu-a'
      `)).rejects.toThrow();

      const applicationGrant = () => prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe('SET LOCAL ROLE autorfp_app');
        return transaction.$queryRawUnsafe(`
          SELECT * FROM autorfp_private.autorfp_supplier_application_grant_by_digest(repeat('a', 64))
        `);
      });
      await expect(applicationGrant()).resolves.toEqual([
        { tenantId: 'compact-tenant-a', requestId: 'compact-request-a' },
      ]);

      await prisma.$executeRawUnsafe(
        `UPDATE "ProcurementRequest" SET "items" = $1::JSONB WHERE "id" = 'compact-request-a'`,
        '{"v":1,"items":[{"id":"item-a","sourcingOverride":{"v":1,"modes":["CURRENT"],"currentSupplierIds":["supplier-a"],"selectedNewSupplierIds":[],"acceptVerifiedApplications":false}}]}',
      );
      await expect(applicationGrant()).resolves.toEqual([]);

      await prisma.$executeRawUnsafe(
        `UPDATE "ProcurementRequest" SET "items" = $1::JSONB, "sourcing" = $2::JSONB WHERE "id" = 'compact-request-a'`,
        '{"v":1,"items":[{"id":"item-a","sourcingOverride":{"v":1,"modes":["VERIFIED_NEW"],"currentSupplierIds":[],"selectedNewSupplierIds":[],"acceptVerifiedApplications":true}}]}',
        '{"v":1,"default":{"v":1,"modes":["CURRENT"],"currentSupplierIds":["supplier-a"],"selectedNewSupplierIds":[],"acceptVerifiedApplications":false}}',
      );
      await expect(applicationGrant()).resolves.toEqual([
        { tenantId: 'compact-tenant-a', requestId: 'compact-request-a' },
      ]);

      await prisma.$executeRawUnsafe(
        `UPDATE "ProcurementRequest" SET "items" = $1::JSONB, "createdAt" = CURRENT_TIMESTAMP - INTERVAL '2 seconds', "quoteDeadline" = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "id" = 'compact-request-a'`,
        '{"v":1,"items":[{"id":"item-a","sourcingOverride":null}]}',
      );
      await expect(applicationGrant()).resolves.toEqual([]);
      await prisma.$executeRawUnsafe(
        `UPDATE "ProcurementRequest" SET "createdAt" = CURRENT_TIMESTAMP, "quoteDeadline" = CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE "id" = 'compact-request-a'`,
      );
      for (const sourcing of [
        '{"v":1,"default":{"v":1,"modes":["CURRENT"],"acceptVerifiedApplications":true}}',
        '{"v":1,"default":{"v":1,"modes":["VERIFIED_NEW"],"acceptVerifiedApplications":"true"}}',
        '{"v":1,"default":{"v":1,"acceptVerifiedApplications":true}}',
      ]) {
        await prisma.$executeRawUnsafe(
          `UPDATE "ProcurementRequest" SET "sourcing" = $1::JSONB WHERE "id" = 'compact-request-a'`,
          sourcing,
        );
        await expect(applicationGrant()).resolves.toEqual([]);
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('tenant policies hide and protect an empty tenant id without GUC context', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const probe = (setEmptyContext: boolean) => prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe('SET LOCAL ROLE autorfp_app');
        if (setEmptyContext) {
          await transaction.$executeRawUnsafe("SET LOCAL app.tenant_id = ''");
        }
        const rows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM public."Tenant" WHERE "id" = \'\'',
        );
        const updates = await transaction.$executeRawUnsafe(
          'UPDATE public."Tenant" SET "name" = \'Blocked\' WHERE "id" = \'\'',
        );
        return { rows, updates };
      },
    );

    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO public."Tenant" (
          "id", "name", "addressLine", "city", "state", "pin", "phone",
          "updatedAt"
        ) VALUES ('', 'Empty', 'A', 'A', 'A', '000000', '0', CURRENT_TIMESTAMP)
      `);
      await expect(probe(false)).resolves.toEqual({ rows: [], updates: 0 });
      await expect(probe(true)).resolves.toEqual({ rows: [], updates: 0 });
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('restore verification mirrors the exact service planning catalog contract', () => {
  const script = readFileSync(
    path.resolve(__dirname, '../../scripts/restore-verify.sh'),
    'utf8',
  );
  for (const values of jsonConstraints) {
    expect(script).toContain(`('${values.join("', '")}')`);
  }
  for (const values of tenantPolicies) {
    expect(script).toContain(`('${values.join("', '")}')`);
  }
  for (const name of requiredFunctions) {
    expect(script).toContain(`('${name}', 'text')`);
  }
  expect(script.match(/^ensure_restore_owner(?: 1)?$/gm)).toHaveLength(2);
  expect(script).toContain('ensure_restore_owner 1');
  expect(script).toContain('quoteplate_restore_owner_check');
  expect(script).toContain('pg_temp.autorfp_restore_rls_probe');
  expect(script).toContain('quoteplate:rls-owner-attestation:%s:%s');
  expect(script).toContain(
    'procedure.proowner = CURRENT_USER::pg_catalog.regrole',
  );
  expect(script).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE');
  expect(script).toContain('recreate_restore_default_privileges');
  expect(script).toMatch(/pg_get_expr\(\s+policy_catalog\.polqual/);
  expect(script).toMatch(/pg_get_expr\(\s+policy_catalog\.polwithcheck/);
  expect(script).toMatch(/pg_get_expr\(\s+constraint_catalog\.conbin/);
  expect(script).toMatch(
    /pg_has_role\(\s*owner_role\.oid,\s*bypass_role\.oid,\s*'USAGE'/,
  );
  expect(script).toContain('pg_catalog.aclexplode');
  expect(script).toContain('--dbname=service=quoteplate_restore');
  expect(script).not.toContain('PGDATABASE="$RESTORE_DATABASE_URL"');
  expect(script).toMatch(
    /private libpq service'\n\nunset RESTORE_DATABASE_URL PGDATABASE\n/,
  );
  expect(script).toContain('=NULLIFcurrent_setting');
});

test('malformed restore URLs never expose embedded credentials', () => {
  const secret = 'restore-password-must-not-leak';
  const result = attemptRestoreWithUrl(
    `postgresql://operator:${secret}@[invalid/quoteplate_restore_malformed`,
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    'RESTORE_DATABASE_URL could not be converted to a private libpq service',
  );
  expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
});

test.each([
  ['space', 'restore-trailing-space-secret ', 'restore-trailing-space-secret%20'],
  ['tab', 'restore-trailing-tab-secret\t', 'restore-trailing-tab-secret%09'],
  ['vertical tab', 'restore-trailing-vtab-secret\v', 'restore-trailing-vtab-secret%0B'],
  ['form feed', 'restore-trailing-formfeed-secret\f', 'restore-trailing-formfeed-secret%0C'],
])('percent-encoded trailing %s in credentials is rejected generically', (
  _kind,
  secret,
  encodedSecret,
) => {
  const result = attemptRestoreWithUrl(
    `postgresql://operator:${encodedSecret}@127.0.0.1/quoteplate_restore_whitespace`,
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    'RESTORE_DATABASE_URL could not be converted to a private libpq service',
  );
  expect(`${result.stdout}${result.stderr}`).not.toContain(secret.trim());
  expect(`${result.stdout}${result.stderr}`).not.toContain(encodedSecret);
});

test('cross-owner archives restore with target-owner function readiness', async () => {
  await withPostgres(async ({ databaseUrl }) => {
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const directory = mkdtempSync(path.join(tmpdir(), 'quoteplate-cross-owner-'));
    const restoreRole = 'archive_restore_owner';
    const targetDatabase = 'quoteplate_restore_cross_owner';
    const readinessDatabase = 'quoteplate_cross_owner_readiness';
    const restorePassword = 'restore-owner-password';
    const nativeSourceUrl = new URL(databaseUrl);
    nativeSourceUrl.searchParams.delete('schema');
    const targetUrl = new URL(databaseUrl);
    targetUrl.pathname = `/${targetDatabase}`;
    targetUrl.username = restoreRole;
    targetUrl.password = restorePassword;
    const readinessUrl = new URL(databaseUrl);
    readinessUrl.pathname = `/${readinessDatabase}`;
    const dumpFile = path.join(directory, 'archive.dump');
    const backupFile = path.join(directory, 'archive.dump.gz.age');
    const identityFile = path.join(directory, 'identity.txt');
    const toolsDirectory = path.join(directory, 'bin');
    const cloneMarker = path.join(directory, 'cloned');
    const appProbeMarker = path.join(directory, 'app-probed');
    const backupProbeMarker = path.join(directory, 'backup-probed');

    try {
      await admin.$executeRawUnsafe(`
        CREATE ROLE ${restoreRole} LOGIN PASSWORD '${restorePassword}'
          NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOREPLICATION BYPASSRLS
      `);
      const creatorUrl = new URL(nativeSourceUrl);
      creatorUrl.username = restoreRole;
      creatorUrl.password = restorePassword;
      const creator = new PrismaClient({
        datasources: { db: { url: creatorUrl.toString() } },
      });
      const [{ server_version_num: serverVersion }] = await admin.$queryRaw<
        Array<{ server_version_num: number }>
      >`SELECT current_setting('server_version_num')::INTEGER AS server_version_num`;
      try {
        await creator.$executeRawUnsafe(
          'CREATE ROLE autorfp_app LOGIN NOSUPERUSER NOCREATEDB '
          + 'NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
        );
        if (serverVersion >= 160000) {
          await creator.$executeRawUnsafe(
            'CREATE ROLE autorfp_backup LOGIN NOSUPERUSER NOCREATEDB '
            + 'NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS',
          );
        } else {
          await admin.$executeRawUnsafe(
            'CREATE ROLE autorfp_backup LOGIN NOSUPERUSER NOCREATEDB '
            + 'NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS',
          );
        }
      } finally {
        await creator.$disconnect();
      }
      if (serverVersion >= 160000) {
        const initialMemberships = await admin.$queryRawUnsafe<Array<{
          role_name: string;
          has_admin: boolean;
          has_inherit: boolean;
          has_set: boolean;
        }>>(`
          SELECT target.rolname AS role_name,
            bool_or(membership.admin_option) AS has_admin,
            bool_or(membership.inherit_option) AS has_inherit,
            bool_or(membership.set_option) AS has_set
          FROM pg_catalog.pg_auth_members AS membership
          JOIN pg_catalog.pg_roles AS target ON target.oid = membership.roleid
          WHERE membership.member = '${restoreRole}'::regrole
            AND target.rolname IN ('autorfp_app', 'autorfp_backup')
          GROUP BY target.rolname
          ORDER BY target.rolname
        `);
        expect(initialMemberships).toEqual([
          {
            role_name: 'autorfp_app', has_admin: true,
            has_inherit: false, has_set: false,
          },
          {
            role_name: 'autorfp_backup', has_admin: true,
            has_inherit: false, has_set: false,
          },
        ]);
      }
      const [setBeforeRestore] = await admin.$queryRaw<
        Array<{ can_set_both: boolean }>
      >`
        SELECT CASE WHEN current_setting('server_version_num')::INTEGER >= 160000
          THEN pg_has_role(${restoreRole}, 'autorfp_app', 'SET')
            AND pg_has_role(${restoreRole}, 'autorfp_backup', 'SET')
          ELSE pg_has_role(${restoreRole}, 'autorfp_app', 'MEMBER')
            AND pg_has_role(${restoreRole}, 'autorfp_backup', 'MEMBER')
        END AS can_set_both
      `;
      expect(setBeforeRestore).toEqual({ can_set_both: false });

      deployMigrations(databaseUrl);
      const [sourceSecurity] = await functionOwnerSecurity(admin);
      expect(sourceSecurity.attestation).toBe(
        `quoteplate:rls-owner-attestation:direct:${sourceSecurity.owner}`,
      );
      expect(sourceSecurity.owner).not.toBe(restoreRole);

      execFileSync('createdb', [
        `--maintenance-db=${nativeSourceUrl}`,
        `--owner=${restoreRole}`,
        targetDatabase,
      ]);
      const targetAdminUrl = new URL(nativeSourceUrl);
      targetAdminUrl.pathname = `/${targetDatabase}`;
      execFileSync('psql', [
        `--dbname=${targetAdminUrl}`,
        '--set=ON_ERROR_STOP=1',
        `--command=ALTER SCHEMA public OWNER TO ${restoreRole}`,
      ]);
      execFileSync('pg_dump', [
        '--format=custom',
        `--file=${dumpFile}`,
        `--dbname=${nativeSourceUrl}`,
      ]);
      const archiveList = execFileSync('pg_restore', ['--list', dumpFile], {
        encoding: 'utf8',
      });
      expect(archiveList).toMatch(/^\d+; \d+ \d+ ACL /m);
      expect(archiveList).toMatch(
        new RegExp(`DEFAULT ACL .*${sourceSecurity.owner}`),
      );
      writeFileSync(backupFile, execFileSync('gzip', ['-c', dumpFile]));
      writeFileSync(identityFile, 'test-identity');
      mkdirSync(toolsDirectory);
      const agePath = path.join(toolsDirectory, 'age');
      writeFileSync(agePath, `#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in
    --decrypt) shift ;;
    --identity) shift 2 ;;
    --output) output_file=$2; shift 2 ;;
    *) input_file=$1; shift ;;
  esac
done
cp "$input_file" "$output_file"
`);
      chmodSync(agePath, 0o755);
      const realPsql = execFileSync('which', ['psql'], { encoding: 'utf8' }).trim();
      const realCreatedb = execFileSync('which', ['createdb'], {
        encoding: 'utf8',
      }).trim();
      const psqlPath = path.join(toolsDirectory, 'psql');
      writeFileSync(psqlPath, `#!/bin/sh
set -eu
"$REAL_PSQL" "$@"
case "$*" in
  *"SET LOCAL ROLE autorfp_app"*)
    : > "$CROSS_OWNER_APP_PROBE_MARKER"
    ;;
  *"SET LOCAL ROLE autorfp_backup"*)
    : > "$CROSS_OWNER_BACKUP_PROBE_MARKER"
    if [ ! -f "$CROSS_OWNER_CLONE_MARKER" ]; then
      "$REAL_CREATEDB" \
        --maintenance-db="$CROSS_OWNER_ADMIN_URL" \
        --template="$CROSS_OWNER_TARGET_DATABASE" \
        "$CROSS_OWNER_READINESS_DATABASE"
      : > "$CROSS_OWNER_CLONE_MARKER"
    fi
    ;;
esac
`);
      chmodSync(psqlPath, 0o755);

      const restored = spawnSync(
        'sh',
        [path.resolve(__dirname, '../../scripts/restore-verify.sh'), backupFile],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${toolsDirectory}:${process.env.PATH}`,
            RESTORE_DATABASE_URL: targetUrl.toString(),
            AGE_IDENTITY_FILE: identityFile,
            REAL_PSQL: realPsql,
            REAL_CREATEDB: realCreatedb,
            CROSS_OWNER_ADMIN_URL: nativeSourceUrl.toString(),
            CROSS_OWNER_TARGET_DATABASE: targetDatabase,
            CROSS_OWNER_READINESS_DATABASE: readinessDatabase,
            CROSS_OWNER_CLONE_MARKER: cloneMarker,
            CROSS_OWNER_APP_PROBE_MARKER: appProbeMarker,
            CROSS_OWNER_BACKUP_PROBE_MARKER: backupProbeMarker,
          },
        },
      );
      expect(
        `status=${restored.status}\n${restored.stdout}${restored.stderr}`,
      ).toMatch(/^status=0\n/);
      expect(existsSync(appProbeMarker)).toBe(true);
      expect(existsSync(backupProbeMarker)).toBe(true);

      const readiness = new PrismaClient({
        datasources: { db: { url: readinessUrl.toString() } },
      });
      try {
        const functionSecurity = await functionOwnerSecurity(readiness);
        expect(functionSecurity).toEqual([{
          attestation:
            `quoteplate:rls-owner-attestation:direct:${restoreRole}`,
          owner: restoreRole,
        }]);
        expect(functionSecurity[0]?.attestation).not.toBe(
          sourceSecurity.attestation,
        );
        const [defaultAclOwner] = await readiness.$queryRaw<
          Array<{ target_owner_only: boolean }>
        >`
          SELECT pg_catalog.bool_and(
            defaults.defaclrole = ${restoreRole}::pg_catalog.regrole
          ) AS target_owner_only
          FROM pg_catalog.pg_default_acl AS defaults
        `;
        expect(defaultAclOwner).toEqual({ target_owner_only: true });
        const [setAfterRestore] = await readiness.$queryRaw<
          Array<{ can_set_both: boolean }>
        >`
          SELECT CASE WHEN current_setting('server_version_num')::INTEGER >= 160000
            THEN pg_has_role(${restoreRole}, 'autorfp_app', 'SET')
              AND pg_has_role(${restoreRole}, 'autorfp_backup', 'SET')
            ELSE pg_has_role(${restoreRole}, 'autorfp_app', 'MEMBER')
              AND pg_has_role(${restoreRole}, 'autorfp_backup', 'MEMBER')
          END AS can_set_both
        `;
        expect(setAfterRestore).toEqual({ can_set_both: true });
        if (serverVersion >= 160000) {
          const grants = await readiness.$queryRawUnsafe<Array<{
            role_name: string;
            has_admin: boolean;
            has_inherit: boolean;
            has_self_admin: boolean;
            has_set: boolean;
          }>>(`
            SELECT target.rolname AS role_name,
              bool_or(membership.admin_option) AS has_admin,
              bool_or(membership.inherit_option) AS has_inherit,
              bool_or(membership.set_option) AS has_set,
              bool_or(
                membership.admin_option
                AND membership.grantor = '${restoreRole}'::regrole
              ) AS has_self_admin
            FROM pg_catalog.pg_auth_members AS membership
            JOIN pg_catalog.pg_roles AS target
              ON target.oid = membership.roleid
            WHERE membership.member = '${restoreRole}'::regrole
              AND target.rolname IN ('autorfp_app', 'autorfp_backup')
            GROUP BY target.rolname
            ORDER BY target.rolname
          `);
          expect(grants).toEqual([
            {
              role_name: 'autorfp_app', has_admin: true, has_inherit: false,
              has_self_admin: false, has_set: true,
            },
            {
              role_name: 'autorfp_backup', has_admin: true, has_inherit: false,
              has_self_admin: false, has_set: true,
            },
          ]);
        }
        await expect(checkReadinessAsApp(readiness)).resolves.toBeUndefined();
      } finally {
        await readiness.$disconnect();
      }
    } finally {
      await admin.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test('readiness rejects service planning catalog security drift', async () => {
  await withMigratedPostgres(async (databaseUrl) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const awardPolicy = `CREATE POLICY tenant_isolation ON public."Award"
      FOR ALL TO autorfp_app
      USING ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), ''))
      WITH CHECK ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), ''))`;
    const policyDrifts: Array<[table: string | null, expression: string]> = [
      [null, ''],
      ['Award', 'TRUE'],
      ['RateLimitBucket', 'TRUE'],
    ];

    try {
      for (const [table, expression] of policyDrifts) {
        await prisma.$executeRawUnsafe(
          'DROP POLICY tenant_isolation ON public."Award"',
        );
        if (table) {
          await prisma.$executeRawUnsafe(
            `CREATE POLICY tenant_isolation ON public."${table}" `
            + `FOR ALL TO autorfp_app USING (${expression}) `
            + `WITH CHECK (${expression})`,
          );
        }
        await expect(checkReadinessAsApp(prisma)).rejects.toThrow(
          'required database migration',
        );
        if (table) {
          await prisma.$executeRawUnsafe(
            `DROP POLICY tenant_isolation ON public."${table}"`,
          );
        }
        await prisma.$executeRawUnsafe(awardPolicy);
        await expect(checkReadinessAsApp(prisma)).resolves.toBeUndefined();
      }

      await prisma.$executeRawUnsafe(
        'ALTER TABLE public."RateLimitBucket" DISABLE ROW LEVEL SECURITY',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE public."RateLimitBucket" FORCE ROW LEVEL SECURITY',
      );
      const rateLimitRls = await prisma.$queryRaw<
        Array<{ enabled: boolean; forced: boolean }>
      >`
        SELECT table_catalog.relrowsecurity AS enabled,
               table_catalog.relforcerowsecurity AS forced
        FROM pg_catalog.pg_class AS table_catalog
        WHERE table_catalog.oid = to_regclass('public."RateLimitBucket"')
      `;
      expect(rateLimitRls).toEqual([{ enabled: false, forced: true }]);
      await expect(checkReadinessAsApp(prisma)).rejects.toThrow(
        'required database migration',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE public."RateLimitBucket" NO FORCE ROW LEVEL SECURITY',
      );
      await expect(checkReadinessAsApp(prisma)).resolves.toBeUndefined();

      await prisma.$executeRawUnsafe(
        'ALTER TABLE public."Menu" DROP CONSTRAINT "Menu_document_size_check"',
      );
      await prisma.$executeRawUnsafe(`
        ALTER TABLE public."Menu" ADD CONSTRAINT "Menu_document_size_check"
        CHECK (pg_catalog.octet_length("name"::TEXT) <= 524288)
      `);
      await expect(checkReadinessAsApp(prisma)).rejects.toThrow(
        'required database migration',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE public."Menu" DROP CONSTRAINT "Menu_document_size_check"',
      );
      await prisma.$executeRawUnsafe(`
        ALTER TABLE public."Menu" ADD CONSTRAINT "Menu_document_size_check"
        CHECK (pg_catalog.octet_length("document"::TEXT) <= 524288)
      `);
      await expect(checkReadinessAsApp(prisma)).resolves.toBeUndefined();

      for (const [name, table, column, cap] of jsonConstraints.filter(
        ([name]) => name.startsWith('ServicePlan') || name.startsWith('SupplierCollaboration') || name.startsWith('SupplierDemandShare') || name === 'Award_receiving_size_check',
      )) {
        const drop = `ALTER TABLE public."${table}" DROP CONSTRAINT "${name}"`;
        const add = `ALTER TABLE public."${table}" ADD CONSTRAINT "${name}"`;
        await prisma.$executeRawUnsafe(drop);
        await expect(checkReadinessAsApp(prisma)).rejects.toThrow('required database migration');
        await prisma.$executeRawUnsafe(`${add} CHECK (octet_length("${column}"::TEXT) <= ${Number(cap) + 1})`);
        await expect(checkReadinessAsApp(prisma)).rejects.toThrow('required database migration');
        await prisma.$executeRawUnsafe(drop);
        await prisma.$executeRawUnsafe(`${add} CHECK (octet_length("${column}"::TEXT) <= ${cap}) NOT VALID`);
        await expect(checkReadinessAsApp(prisma)).rejects.toThrow('required database migration');
        await prisma.$executeRawUnsafe(`ALTER TABLE public."${table}" VALIDATE CONSTRAINT "${name}"`);
        await expect(checkReadinessAsApp(prisma)).resolves.toBeUndefined();
      }
      for (const table of ['ServicePlan', 'ServicePlanRevision', 'SupplierPortal', 'SupplierCollaboration', 'SupplierDemandShare']) {
        await prisma.$executeRawUnsafe(`ALTER TABLE public."${table}" NO FORCE ROW LEVEL SECURITY`);
        await expect(checkReadinessAsApp(prisma)).rejects.toThrow('required database migration');
        await prisma.$executeRawUnsafe(`ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`);
        await prisma.$executeRawUnsafe(`REVOKE SELECT ON public."${table}" FROM autorfp_backup`);
        await expect(checkReadinessAsApp(prisma)).rejects.toThrow('required database migration');
        await prisma.$executeRawUnsafe(`GRANT SELECT ON public."${table}" TO autorfp_backup`);
        await expect(checkReadinessAsApp(prisma)).resolves.toBeUndefined();
      }

      await prisma.$executeRawUnsafe(
        'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA autorfp_private TO PUBLIC',
      );
      await expect(checkReadinessAsApp(prisma)).rejects.toThrow(
        'required database migration',
      );
      await prisma.$executeRawUnsafe(
        'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA autorfp_private FROM PUBLIC',
      );
      await expect(checkReadinessAsApp(prisma)).resolves.toBeUndefined();

      await prisma.$executeRawUnsafe(`DO $unsafe_function_owners$
        DECLARE target RECORD;
        BEGIN
          CREATE ROLE inherited_function_bypass NOLOGIN BYPASSRLS;
          CREATE ROLE unsafe_function_owner NOLOGIN INHERIT BYPASSRLS;
          FOR target IN
            SELECT procedure.oid::REGPROCEDURE AS identity
            FROM pg_catalog.pg_proc AS procedure
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname = 'autorfp_private'
          LOOP
            EXECUTE pg_catalog.format(
              'ALTER FUNCTION %s OWNER TO unsafe_function_owner', target.identity
            );
            EXECUTE pg_catalog.format(
              'COMMENT ON FUNCTION %s IS %L',
              target.identity,
              'quoteplate:rls-owner-attestation:direct:unsafe_function_owner'
            );
          END LOOP;
        END
      $unsafe_function_owners$`);
      await expect(checkReadinessAsApp(prisma)).resolves.toBeUndefined();
      await prisma.$executeRawUnsafe(
        'ALTER ROLE unsafe_function_owner NOBYPASSRLS',
      );
      await prisma.$executeRawUnsafe(
        'GRANT inherited_function_bypass TO unsafe_function_owner',
      );
      await expect(prisma.$queryRaw<Array<{ usable: boolean }>>`
        SELECT pg_catalog.pg_has_role(
          'unsafe_function_owner', 'inherited_function_bypass', 'USAGE'
        ) AS usable
      `).resolves.toEqual([{ usable: true }]);
      await expect(checkReadinessAsApp(prisma)).rejects.toThrow(
        'required database migration',
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});
