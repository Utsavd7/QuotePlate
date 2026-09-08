import { NextResponse } from 'next/server';
import { Prisma, type PrismaClient } from '@prisma/client';

import { assertRuntimeDatabaseRole } from '@/lib/db/runtime-role';
import { validateRuntimeEnvironment } from '@/lib/env';

type ReadinessDatabaseClient = Pick<PrismaClient, '$queryRaw'>;

type ReadinessDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  checkDatabase: () => Promise<unknown>;
  timeoutMs: number;
};

function healthResponse(status: 200 | 503, state: 'ready' | 'unavailable') {
  return NextResponse.json(
    { status: state },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

async function within<T>(work: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Readiness timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function checkRuntimeDatabase(client: ReadinessDatabaseClient) {
  await assertRuntimeDatabaseRole(client);
  const [migration] = await client.$queryRaw<Array<{ migrationReady: boolean }>>(
    Prisma.sql`
      SELECT (
        (
          SELECT array_agg(tablename::TEXT ORDER BY tablename)
          FROM pg_catalog.pg_tables
          WHERE schemaname = 'public'
            AND tablename <> pg_catalog.concat('_prisma', '_migrations')
        ) = ARRAY[
          'AuditEvent', 'Award', 'Menu', 'ProcurementRequest',
          'RateLimitBucket', 'ServicePlan', 'ServicePlanRevision', 'Supplier', 'SupplierCollaboration', 'SupplierDemandShare', 'SupplierPortal', 'SupplierRequest', 'Tenant', 'User'
        ]::TEXT[]
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public."Supplier"')
            AND attribute.attname = 'verifiedByUserId'
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attname IN (
            'legacyPasswordSalt', 'sourceIngredientId'
          )
            AND attribute.attrelid IN (
              to_regclass('public."User"'),
              to_regclass('public."Supplier"')
            )
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_namespace AS namespace
          WHERE namespace.nspname = 'autorfp_private'
            AND pg_catalog.obj_description(
              namespace.oid,
              'pg_namespace'
            ) = 'quoteplate:migration:20260831000100_compact_nine_table_schema'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS backup_table
          JOIN pg_catalog.pg_namespace AS backup_namespace
            ON backup_namespace.oid = backup_table.relnamespace
          WHERE backup_namespace.nspname = 'public'
            AND backup_table.relkind IN ('r', 'p')
            AND backup_table.relname <> pg_catalog.concat('_prisma', '_migrations')
            AND NOT pg_catalog.has_table_privilege(
              'autorfp_backup', backup_table.oid, 'SELECT'
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM (
            VALUES
              ('AuditEvent_metadata_size_check', 'AuditEvent', 'metadata', '16384'),
              ('Award_allocationLines_size_check', 'Award', 'allocationLines', '2097152'),
              ('Award_deliverySnapshot_size_check', 'Award', 'deliverySnapshot', '16384'),
              ('Award_supplierSnapshots_size_check', 'Award', 'supplierSnapshots', '2097152'),
              ('Award_receiving_size_check', 'Award', 'receiving', '1048576'),
              ('Menu_document_size_check', 'Menu', 'document', '524288'),
              ('ProcurementRequest_deliveryDetails_size_check', 'ProcurementRequest', 'deliveryDetails', '16384'),
              ('ProcurementRequest_items_size_check', 'ProcurementRequest', 'items', '524288'),
              ('ProcurementRequest_sourcing_size_check', 'ProcurementRequest', 'sourcing', '65536'),
              ('ServicePlan_document_size_check', 'ServicePlan', 'document', '524288'),
              ('ServicePlan_menuSnapshot_size_check', 'ServicePlan', 'menuSnapshot', '1048576'),
              ('ServicePlanRevision_document_size_check', 'ServicePlanRevision', 'document', '524288'),
              ('Supplier_capabilities_size_check', 'Supplier', 'capabilities', '65536'),
              ('SupplierCollaboration_revisions_size_check', 'SupplierCollaboration', 'revisions', '131072'),
              ('SupplierDemandShare_items_size_check', 'SupplierDemandShare', 'items', '131072'),
              ('SupplierRequest_quoteRevisions_size_check', 'SupplierRequest', 'quoteRevisions', '2097152')
          ) AS expected(constraint_name, table_name, column_name, byte_cap)
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_constraint AS constraint_catalog
            JOIN pg_catalog.pg_class AS table_catalog
              ON table_catalog.oid = constraint_catalog.conrelid
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = table_catalog.relnamespace
            WHERE namespace.nspname = 'public'
              AND table_catalog.relname = expected.table_name
              AND constraint_catalog.contype = 'c'
              AND constraint_catalog.convalidated
              AND constraint_catalog.conname = expected.constraint_name
              AND pg_catalog.replace(
                pg_catalog.replace(
                  pg_catalog.regexp_replace(
                    pg_catalog.pg_get_expr(
                      constraint_catalog.conbin,
                      constraint_catalog.conrelid
                    ),
                    '[[:space:]()"]',
                    '',
                    'g'
                  ),
                  'pg_catalog.',
                  ''
                ),
                '::character varying',
                '::text'
              ) = 'octet_length' || expected.column_name
                  || '::text<=' || expected.byte_cap
          )
        )
        AND (
          SELECT COUNT(*) = 8
            AND pg_catalog.bool_and(procedure.prosecdef)
            AND pg_catalog.bool_and(
              procedure.proconfig = ARRAY['search_path=pg_catalog']::TEXT[]
            )
            AND pg_catalog.bool_and(
              (
                (owner_role.rolsuper OR owner_role.rolbypassrls)
                AND pg_catalog.obj_description(procedure.oid, 'pg_proc') =
                  pg_catalog.format(
                    'quoteplate:rls-owner-attestation:direct:%s',
                    owner_role.rolname
                  )
              )
              OR (
                NOT (owner_role.rolsuper OR owner_role.rolbypassrls)
                AND EXISTS (
                  SELECT 1
                  FROM pg_catalog.pg_roles AS bypass_role
                  WHERE (bypass_role.rolsuper OR bypass_role.rolbypassrls)
                    AND pg_catalog.pg_has_role(
                      owner_role.oid,
                      bypass_role.oid,
                      'USAGE'
                    )
                )
                AND pg_catalog.obj_description(procedure.oid, 'pg_proc') =
                  pg_catalog.format(
                    'quoteplate:rls-owner-attestation:inherited:%s',
                    owner_role.rolname
                  )
              )
            )
            AND pg_catalog.bool_and(
              EXISTS (
                SELECT 1
                FROM pg_catalog.aclexplode(
                  COALESCE(
                    procedure.proacl,
                    pg_catalog.acldefault('f', procedure.proowner)
                  )
                ) AS permission
                WHERE permission.grantee = 'autorfp_app'::pg_catalog.regrole
                  AND permission.privilege_type = 'EXECUTE'
              )
            )
            AND pg_catalog.bool_and(
              NOT EXISTS (
                SELECT 1
                FROM pg_catalog.aclexplode(
                  COALESCE(
                    procedure.proacl,
                    pg_catalog.acldefault('f', procedure.proowner)
                  )
                ) AS permission
                WHERE permission.privilege_type = 'EXECUTE'
                  AND permission.grantee NOT IN (
                    procedure.proowner,
                    'autorfp_app'::pg_catalog.regrole
                  )
              )
            )
          FROM pg_catalog.pg_proc AS procedure
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = procedure.pronamespace
          JOIN pg_catalog.pg_roles AS owner_role
            ON owner_role.oid = procedure.proowner
          WHERE namespace.nspname = 'autorfp_private'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            'autorfp_auth_credentials_by_email',
            'autorfp_auth_identity_by_email',
            'autorfp_auth_identity_by_google_subject',
            'autorfp_invitation_tenant_by_digest',
            'autorfp_supplier_application_grant_by_digest',
            'autorfp_supplier_grant_by_digest',
            'autorfp_supplier_portal_by_digest',
            'autorfp_user_email_exists'
          ]::TEXT[]) AS expected(function_name)
          WHERE to_regprocedure(
            'autorfp_private.' || expected.function_name || '(text)'
          ) IS NULL
        )
        AND (
          SELECT COUNT(*) = 13
            AND pg_catalog.bool_and(table_catalog.relrowsecurity)
            AND pg_catalog.bool_and(table_catalog.relforcerowsecurity)
          FROM pg_catalog.pg_class AS table_catalog
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = table_catalog.relnamespace
          WHERE namespace.nspname = 'public'
            AND table_catalog.relname = ANY(ARRAY[
              'AuditEvent', 'Award', 'Menu', 'ProcurementRequest',
              'ServicePlan', 'ServicePlanRevision', 'Supplier', 'SupplierCollaboration', 'SupplierDemandShare', 'SupplierPortal', 'SupplierRequest', 'Tenant', 'User'
            ]::TEXT[])
        )
        AND (
          SELECT COUNT(*) = 13
          FROM pg_catalog.pg_policy AS policy_catalog
          JOIN pg_catalog.pg_class AS table_catalog
            ON table_catalog.oid = policy_catalog.polrelid
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = table_catalog.relnamespace
          WHERE namespace.nspname = 'public'
            AND policy_catalog.polname = 'tenant_isolation'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM (
            VALUES
              ('Tenant', 'id'),
              ('User', 'tenantId'),
              ('Menu', 'tenantId'),
              ('ServicePlan', 'tenantId'),
              ('ServicePlanRevision', 'tenantId'),
              ('Supplier', 'tenantId'),
              ('ProcurementRequest', 'tenantId'),
              ('SupplierCollaboration', 'tenantId'),
              ('SupplierDemandShare', 'tenantId'),
              ('SupplierPortal', 'tenantId'),
              ('SupplierRequest', 'tenantId'),
              ('Award', 'tenantId'),
              ('AuditEvent', 'tenantId')
          ) AS expected(table_name, tenant_column)
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policy AS policy_catalog
            JOIN pg_catalog.pg_class AS table_catalog
              ON table_catalog.oid = policy_catalog.polrelid
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = table_catalog.relnamespace
            JOIN pg_catalog.pg_roles AS policy_role
              ON policy_role.rolname = 'autorfp_app'
            WHERE namespace.nspname = 'public'
              AND table_catalog.relname = expected.table_name
              AND policy_catalog.polname = 'tenant_isolation'
              AND policy_catalog.polcmd = '*'
              AND policy_catalog.polpermissive
              AND policy_catalog.polroles = ARRAY[policy_role.oid]::OID[]
              AND pg_catalog.replace(
                pg_catalog.replace(
                  pg_catalog.regexp_replace(
                    pg_catalog.pg_get_expr(
                      policy_catalog.polqual,
                      policy_catalog.polrelid
                    ),
                    '[[:space:]()"]',
                    '',
                    'g'
                  ),
                  'pg_catalog.',
                  ''
                ),
                '::text',
                ''
              ) = expected.tenant_column
                  || pg_catalog.concat(
                    '=NULLIFcurrent_setting',
                    pg_catalog.quote_literal('app.tenant_id'),
                    ',true,',
                    pg_catalog.quote_literal('')
                  )
              AND pg_catalog.replace(
                pg_catalog.replace(
                  pg_catalog.regexp_replace(
                    pg_catalog.pg_get_expr(
                      policy_catalog.polwithcheck,
                      policy_catalog.polrelid
                    ),
                    '[[:space:]()"]',
                    '',
                    'g'
                  ),
                  'pg_catalog.',
                  ''
                ),
                '::text',
                ''
              ) = expected.tenant_column
                  || pg_catalog.concat(
                    '=NULLIFcurrent_setting',
                    pg_catalog.quote_literal('app.tenant_id'),
                    ',true,',
                    pg_catalog.quote_literal('')
                  )
          )
        )
        AND NOT (
          SELECT table_catalog.relrowsecurity OR table_catalog.relforcerowsecurity
          FROM pg_catalog.pg_class AS table_catalog
          WHERE table_catalog.oid = to_regclass('public."RateLimitBucket"')
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = 'autorfp_app'
            AND role.rolcanlogin
            AND NOT role.rolsuper
            AND NOT role.rolcreatedb
            AND NOT role.rolcreaterole
            AND NOT role.rolinherit
            AND NOT role.rolreplication
            AND NOT role.rolbypassrls
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = 'autorfp_backup'
            AND role.rolcanlogin
            AND NOT role.rolsuper
            AND NOT role.rolcreatedb
            AND NOT role.rolcreaterole
            AND NOT role.rolinherit
            AND NOT role.rolreplication
            AND role.rolbypassrls
        )
      ) AS "migrationReady"
    `,
  );
  if (!migration?.migrationReady) {
    throw new Error('The required database migration is not ready.');
  }
}

export function createReadinessHandler(
  dependencies: ReadinessDependencies,
) {
  return async function readiness() {
    try {
      validateRuntimeEnvironment(dependencies.environment);
      await within(dependencies.checkDatabase(), dependencies.timeoutMs);
      return healthResponse(200, 'ready');
    } catch {
      return healthResponse(503, 'unavailable');
    }
  };
}
