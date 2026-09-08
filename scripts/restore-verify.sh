#!/bin/sh
set -eu

umask 077

fail() {
  printf 'Restore verification refused: %s\n' "$1" >&2
  exit 1
}

backup_file=${1:-}
[ -f "$backup_file" ] || fail 'an encrypted backup file is required'
case "$backup_file" in
  *.dump.gz.age) : ;;
  *) fail 'backup file must end in .dump.gz.age' ;;
esac

[ -n "${RESTORE_DATABASE_URL:-}" ] || fail 'RESTORE_DATABASE_URL is required'
[ -n "${AGE_IDENTITY_FILE:-}" ] || fail 'AGE_IDENTITY_FILE is required'
[ -f "$AGE_IDENTITY_FILE" ] || fail 'AGE_IDENTITY_FILE must name a readable file'

database_without_query=${RESTORE_DATABASE_URL%%\?*}
database_name=${database_without_query##*/}
printf '%s\n' "$database_name" | grep -Eq '^quoteplate_restore_[a-z0-9_]+$' \
  || fail 'target database name must start with quoteplate_restore_ and be disposable'

for command_name in age gzip pg_restore psql mktemp grep node; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done

connection_service_file=$(mktemp "${TMPDIR:-/tmp}/quoteplate-restore-service.XXXXXX")
cleanup_connection_service() {
  rm -f "$connection_service_file"
}
trap cleanup_connection_service EXIT HUP INT TERM

RESTORE_SERVICE_FILE="$connection_service_file" node -e '
const { writeFileSync } = require("node:fs");
try {
const url = new URL(process.env.RESTORE_DATABASE_URL);
if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) process.exit(2);
const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
if (!database || !url.hostname) process.exit(2);
const parameters = new Map([
  ["host", decodeURIComponent(url.hostname)],
  ["dbname", database],
]);
if (url.port) parameters.set("port", url.port);
if (url.username) parameters.set("user", decodeURIComponent(url.username));
if (url.password) parameters.set("password", decodeURIComponent(url.password));
for (const [key, value] of url.searchParams) {
  if (new Set(["schema", "connection_limit"]).has(key)) continue;
  if (!/^[a-z_]+$/.test(key)) process.exit(2);
  parameters.set(key, value);
}
const lines = ["[quoteplate_restore]"];
for (const [key, value] of parameters) {
  if (/[\r\n\0]/.test(value) || /^[ \t]|[ \t\v\f]$/.test(value)) process.exit(2);
  lines.push(key + "=" + value);
}
writeFileSync(process.env.RESTORE_SERVICE_FILE, lines.join("\n") + "\n", { mode: 0o600 });
} catch {
  process.exit(2);
}
' || fail 'RESTORE_DATABASE_URL could not be converted to a private libpq service'

unset RESTORE_DATABASE_URL PGDATABASE
PGSERVICEFILE=$connection_service_file
PGSERVICE=quoteplate_restore
export PGSERVICEFILE PGSERVICE

connected_database=$(psql \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --command='SELECT current_database();') \
  || fail 'could not identify the disposable restore database'
[ "$connected_database" = "$database_name" ] \
  || fail 'connected database did not match the validated disposable database name'

ensure_restore_owner() {
  reattest_functions=${1:-0}
  restore_owner_safe=$(psql \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --quiet \
    --command="BEGIN;
CREATE TEMPORARY TABLE pg_temp.autorfp_restore_rls_probe (
  marker BOOLEAN NOT NULL
) ON COMMIT DROP;
INSERT INTO pg_temp.autorfp_restore_rls_probe (marker) VALUES (true);
ALTER TABLE pg_temp.autorfp_restore_rls_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE pg_temp.autorfp_restore_rls_probe FORCE ROW LEVEL SECURITY;
CREATE POLICY autorfp_restore_rls_probe_deny
ON pg_temp.autorfp_restore_rls_probe
USING (false)
WITH CHECK (false);
DO \$quoteplate_restore_owner_check\$
DECLARE
  attestation TEXT;
  function_count INTEGER;
  functions_have_restore_owner BOOLEAN;
  owner_mode TEXT;
  owner_name TEXT;
  target RECORD;
BEGIN
  SELECT
    connection_role.rolname,
    CASE
      WHEN connection_role.rolsuper OR connection_role.rolbypassrls
        THEN 'direct'
      ELSE 'inherited'
    END
  INTO owner_name, owner_mode
  FROM pg_catalog.pg_roles AS connection_role
  WHERE connection_role.rolname = CURRENT_USER
    AND pg_catalog.to_regclass('pg_catalog.pg_roles') IS NOT NULL
    AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS bypass_role
    WHERE (bypass_role.rolsuper OR bypass_role.rolbypassrls)
      AND (
        bypass_role.oid = connection_role.oid
        OR pg_catalog.pg_has_role(
          connection_role.oid,
          bypass_role.oid,
          'USAGE'
        )
      )
    )
    AND EXISTS (
    SELECT 1 FROM pg_temp.autorfp_restore_rls_probe WHERE marker
    );

  IF owner_name IS NULL THEN
    RAISE EXCEPTION 'restore connection must bypass row security';
  END IF;

  IF $reattest_functions = 1 THEN
    SELECT
      COUNT(*),
      pg_catalog.bool_and(
        procedure.proowner = CURRENT_USER::pg_catalog.regrole
      )
    INTO function_count, functions_have_restore_owner
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'autorfp_private';

    IF function_count <> 8
       OR COALESCE(functions_have_restore_owner, false) = false
    THEN
      RAISE EXCEPTION 'restored security functions must be owned by the restore connection role';
    END IF;

    attestation := pg_catalog.format(
      'quoteplate:rls-owner-attestation:%s:%s',
      owner_mode,
      owner_name
    );
    FOR target IN
      SELECT procedure.oid::pg_catalog.regprocedure AS identity
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'autorfp_private'
    LOOP
      EXECUTE pg_catalog.format(
        'COMMENT ON FUNCTION %s IS %L',
        target.identity,
        attestation
      );
    END LOOP;

  END IF;
END
\$quoteplate_restore_owner_check\$;
SELECT 1;
COMMIT;") \
    || fail 'could not verify the disposable restore owner'
  [ "$restore_owner_safe" = '1' ] \
    || fail 'restore connection must be a row-security-bypassing owner'
}

recreate_restore_default_privileges() {
  psql \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command="DO \$restore_default_privileges\$
DECLARE
  grantee_sql TEXT;
  target RECORD;
  target_role TEXT;
BEGIN
  FOREACH target_role IN ARRAY ARRAY[
    'PUBLIC', 'autorfp_app', 'autorfp_backup', 'anon', 'authenticated',
    'service_role', 'dashboard_user', 'authenticator'
  ]
  LOOP
    IF target_role = 'PUBLIC' OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role
    ) THEN
      grantee_sql := CASE
        WHEN target_role = 'PUBLIC' THEN 'PUBLIC'
        ELSE pg_catalog.quote_ident(target_role)
      END;
      FOR target IN
        SELECT * FROM (VALUES
          ('', 'EXECUTE', 'FUNCTIONS'),
          ('IN SCHEMA public', 'ALL PRIVILEGES', 'TABLES'),
          ('IN SCHEMA public', 'ALL PRIVILEGES', 'SEQUENCES'),
          ('IN SCHEMA public', 'ALL PRIVILEGES', 'FUNCTIONS'),
          ('IN SCHEMA autorfp_private', 'ALL PRIVILEGES', 'TABLES'),
          ('IN SCHEMA autorfp_private', 'ALL PRIVILEGES', 'SEQUENCES'),
          ('IN SCHEMA autorfp_private', 'ALL PRIVILEGES', 'FUNCTIONS')
        ) AS revocation(scope, privileges, objects)
      LOOP
        EXECUTE pg_catalog.format(
          'ALTER DEFAULT PRIVILEGES %s REVOKE %s ON %s FROM %s',
          target.scope,
          target.privileges,
          target.objects,
          grantee_sql
        );
      END LOOP;
    END IF;
  END LOOP;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO autorfp_backup;
END
\$restore_default_privileges\$;"
}

ensure_restricted_runtime_role() {
  psql \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command="DO \$autorfp_runtime_role\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_app'
  ) THEN
    CREATE ROLE autorfp_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'autorfp_app'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'autorfp_app has unsafe role attributes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_app')
  ) THEN
    RAISE EXCEPTION 'autorfp_app must not inherit membership in another role';
  END IF;
END
\$autorfp_runtime_role\$;"

  psql \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command="DO \$autorfp_backup_role\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_backup'
  ) THEN
    CREATE ROLE autorfp_backup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'autorfp_backup'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR NOT rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'autorfp_backup has unsafe role attributes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members
    WHERE member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'autorfp_backup')
  ) THEN
    RAISE EXCEPTION 'autorfp_backup must not inherit membership in another role';
  END IF;
END
\$autorfp_backup_role\$;"

  psql \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command="DO \$autorfp_probe_role_memberships\$
DECLARE
  current_is_super BOOLEAN;
  server_version_num INTEGER := current_setting('server_version_num')::INTEGER;
  target_role TEXT;
BEGIN
  SELECT rolsuper INTO current_is_super
  FROM pg_catalog.pg_roles
  WHERE rolname = CURRENT_USER;

  FOREACH target_role IN ARRAY ARRAY['autorfp_app', 'autorfp_backup']
  LOOP
    IF server_version_num >= 160000 THEN
      IF NOT pg_catalog.pg_has_role(CURRENT_USER, target_role, 'SET') THEN
        EXECUTE pg_catalog.format(
          'GRANT %I TO %I WITH INHERIT FALSE, SET TRUE, ADMIN FALSE',
          target_role,
          CURRENT_USER
        );
      END IF;
      IF NOT pg_catalog.pg_has_role(CURRENT_USER, target_role, 'SET') THEN
        RAISE EXCEPTION 'restore connection lacks SET access';
      END IF;
    ELSIF NOT current_is_super THEN
      IF NOT pg_catalog.pg_has_role(CURRENT_USER, target_role, 'MEMBER') THEN
        IF (
          SELECT rolinherit FROM pg_catalog.pg_roles
          WHERE rolname = CURRENT_USER
        ) THEN
          RAISE EXCEPTION 'non-inheriting membership is unavailable';
        END IF;
        EXECUTE pg_catalog.format(
          'GRANT %I TO %I',
          target_role,
          CURRENT_USER
        );
      END IF;
      IF NOT pg_catalog.pg_has_role(CURRENT_USER, target_role, 'MEMBER') THEN
        RAISE EXCEPTION 'restore connection lacks role membership';
      END IF;
    END IF;
  END LOOP;
END
\$autorfp_probe_role_memberships\$;" \
    || fail 'restore connection must be able to SET ROLE to autorfp_app and autorfp_backup'
}

ensure_restore_owner
ensure_restricted_runtime_role

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/quoteplate-restore.XXXXXX")
compressed_file="$temporary_directory/quoteplate.dump.gz"
dump_file="$temporary_directory/quoteplate.dump"
filtered_restore_sql="$temporary_directory/quoteplate.filtered.sql"
restore_sql="$temporary_directory/quoteplate.sql"
restore_started=0

clear_disposable_database() {
  psql \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command='DROP SCHEMA IF EXISTS autorfp_private CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
}

cleanup() {
  if [ "$restore_started" -eq 1 ]; then
    clear_disposable_database >/dev/null 2>&1 || true
  fi
  rm -f \
    "$compressed_file" "$dump_file" "$filtered_restore_sql" \
    "$restore_sql" "$connection_service_file"
  rmdir "$temporary_directory" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$compressed_file" "$backup_file"
gzip -dc "$compressed_file" > "$dump_file"

restore_started=1
clear_disposable_database
: > "$restore_sql"
pg_restore \
  --exit-on-error \
  --no-owner \
  --file="$restore_sql" \
  "$dump_file"

RESTORE_SQL="$restore_sql" FILTERED_RESTORE_SQL="$filtered_restore_sql" node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const source = readFileSync(process.env.RESTORE_SQL, "utf8");
const filtered = source
  .split("\n")
  .filter((line) => !/^ALTER DEFAULT PRIVILEGES FOR ROLE .*;$/.test(line))
  .join("\n");
if (/^ALTER DEFAULT PRIVILEGES/m.test(filtered)) process.exit(2);
writeFileSync(process.env.FILTERED_RESTORE_SQL, filtered, { mode: 0o600 });
' || fail 'archive default privileges could not be scoped to the restore owner'

# The private libpq service keeps the credential out of process arguments.
psql \
  --set=ON_ERROR_STOP=1 \
  --quiet \
  --dbname=service=quoteplate_restore \
  --file="$filtered_restore_sql" \
  || fail 'archive contents could not be restored'

recreate_restore_default_privileges
ensure_restore_owner 1

verification_result=$(psql \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --command="SELECT CASE WHEN
  to_regclass('public.\"_prisma_migrations\"') IS NOT NULL
  AND ARRAY(
    SELECT tablename::TEXT
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  ) = ARRAY[
    'AuditEvent', 'Award', 'Menu', 'ProcurementRequest', 'RateLimitBucket',
    'ServicePlan', 'ServicePlanRevision', 'Supplier', 'SupplierCollaboration', 'SupplierDemandShare', 'SupplierPortal', 'SupplierRequest', 'Tenant', 'User'
  ]::TEXT[]
  AND NOT (
    SELECT COUNT(*) = 17
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
  )
  AND EXISTS (
    SELECT 1
    FROM public.\"_prisma_migrations\"
    WHERE migration_name = '20260831000100_compact_nine_table_schema'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM public.\"_prisma_migrations\"
    WHERE migration_name = '20260827001000_backup_role'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM public.\"_prisma_migrations\"
    WHERE migration_name = '20260908000100_supplier_trading_profile'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
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
    FROM (VALUES
      ('AuditEvent_metadata_size_check', 'AuditEvent', 'metadata', '16384'),
      ('Award_allocationLines_size_check', 'Award', 'allocationLines', '2097152'),
      ('Award_deliverySnapshot_size_check', 'Award', 'deliverySnapshot', '16384'),
      ('Award_receiving_size_check', 'Award', 'receiving', '1048576'),
      ('Award_supplierSnapshots_size_check', 'Award', 'supplierSnapshots', '2097152'),
      ('Menu_document_size_check', 'Menu', 'document', '524288'),
      ('ProcurementRequest_deliveryDetails_size_check', 'ProcurementRequest', 'deliveryDetails', '16384'),
      ('ProcurementRequest_items_size_check', 'ProcurementRequest', 'items', '524288'),
      ('ProcurementRequest_sourcing_size_check', 'ProcurementRequest', 'sourcing', '65536'),
      ('ServicePlan_document_size_check', 'ServicePlan', 'document', '524288'),
      ('ServicePlan_menuSnapshot_size_check', 'ServicePlan', 'menuSnapshot', '1048576'),
      ('ServicePlanRevision_document_size_check', 'ServicePlanRevision', 'document', '524288'),
      ('Supplier_capabilities_size_check', 'Supplier', 'capabilities', '65536'),
      ('Supplier_tradingProfile_size_check', 'Supplier', 'tradingProfile', '8192'),
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
              '[[:space:]()\"]',
              '',
              'g'
            ),
            'pg_catalog.',
            ''
          ),
          '::character varying',
          '::text'
        ) IN (
          'octet_length' || expected.column_name
            || '::text<=' || expected.byte_cap,
          expected.column_name || 'ISNULLORoctet_length'
            || expected.column_name || '::text<=' || expected.byte_cap
        )
    )
  )
  AND (
    SELECT COUNT(*) = 8
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'autorfp_private'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('autorfp_auth_credentials_by_email', 'text'),
      ('autorfp_auth_identity_by_email', 'text'),
      ('autorfp_auth_identity_by_google_subject', 'text'),
      ('autorfp_invitation_tenant_by_digest', 'text'),
      ('autorfp_supplier_application_grant_by_digest', 'text'),
      ('autorfp_supplier_grant_by_digest', 'text'),
      ('autorfp_supplier_portal_by_digest', 'text'),
      ('autorfp_user_email_exists', 'text')
    ) AS expected(function_name, argument_signature)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
      WHERE procedure.oid = pg_catalog.to_regprocedure(
          pg_catalog.format(
            'autorfp_private.%I(%s)',
            expected.function_name,
            expected.argument_signature
          )
        )
        AND procedure.prosecdef
        AND procedure.proconfig = ARRAY['search_path=pg_catalog']::TEXT[]
        AND procedure.proowner = CURRENT_USER::pg_catalog.regrole
        AND (
          owner_role.rolsuper
          OR owner_role.rolbypassrls
          OR (
            procedure.proowner = CURRENT_USER::pg_catalog.regrole
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
          )
        )
        AND pg_catalog.obj_description(procedure.oid, 'pg_proc') =
          pg_catalog.format(
            'quoteplate:rls-owner-attestation:%s:%s',
            CASE
              WHEN owner_role.rolsuper OR owner_role.rolbypassrls
                THEN 'direct'
              ELSE 'inherited'
            END,
            owner_role.rolname
          )
        AND EXISTS (
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
        AND NOT EXISTS (
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
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS defaults
    WHERE defaults.defaclrole <> CURRENT_USER::pg_catalog.regrole
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS defaults
    WHERE defaults.defaclrole = CURRENT_USER::pg_catalog.regrole
      AND defaults.defaclnamespace = 0
      AND defaults.defaclobjtype = 'f'
  )
  AND ARRAY(
    SELECT pg_catalog.concat_ws(
      ':',
      namespace.nspname,
      defaults.defaclobjtype,
      grantee.rolname,
      permission.privilege_type
    )
    FROM pg_catalog.pg_default_acl AS defaults
    LEFT JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      defaults.defaclacl
    ) AS permission
    LEFT JOIN pg_catalog.pg_roles AS grantee
      ON grantee.oid = permission.grantee
    WHERE defaults.defaclrole = CURRENT_USER::pg_catalog.regrole
      AND permission.grantee <> CURRENT_USER::pg_catalog.regrole
    ORDER BY 1
  ) = ARRAY['public:r:autorfp_backup:SELECT']::TEXT[]
  AND (
    SELECT COUNT(*) = 13
      AND bool_and(table_catalog.relrowsecurity)
      AND bool_and(table_catalog.relforcerowsecurity)
    FROM pg_catalog.pg_class AS table_catalog
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = table_catalog.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_catalog.relname = ANY(ARRAY[
        'AuditEvent', 'Award', 'Menu', 'ProcurementRequest',
        'ServicePlan', 'ServicePlanRevision', 'Supplier', 'SupplierCollaboration', 'SupplierDemandShare', 'SupplierPortal', 'SupplierRequest', 'Tenant', 'User'
      ])
  )
  AND NOT (
    SELECT table_catalog.relrowsecurity OR table_catalog.relforcerowsecurity
    FROM pg_catalog.pg_class AS table_catalog
    WHERE table_catalog.oid = to_regclass('public.\"RateLimitBucket\"')
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
    FROM (VALUES
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
              '[[:space:]()\"]',
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
              '[[:space:]()\"]',
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
THEN 1 ELSE 0 END;")
[ "$verification_result" = '1' ] || fail 'restored database did not contain the supplier collaboration schema contract'

runtime_verification_result=$(psql \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --quiet \
  --command="BEGIN;
SET LOCAL ROLE autorfp_app;
SET LOCAL app.tenant_id = 'quoteplate-restore-verification-no-tenant';
SELECT CASE WHEN
  to_regclass('public.\"Tenant\"') IS NOT NULL
  AND has_schema_privilege(current_user, 'public', 'USAGE')
  AND has_schema_privilege(current_user, 'autorfp_private', 'USAGE')
  AND has_table_privilege(current_user, 'public.\"Tenant\"', 'SELECT')
  AND has_function_privilege(
    current_user,
    'autorfp_private.autorfp_auth_credentials_by_email(text)',
    'EXECUTE'
  )
  AND pg_catalog.row_security_active('public.\"Tenant\"'::regclass)
  AND (SELECT COUNT(*) FROM public.\"Tenant\") = 0
  AND NOT EXISTS (
    SELECT 1
    FROM autorfp_private.autorfp_auth_credentials_by_email(NULL::TEXT)
  )
THEN 1 ELSE 0 END;
COMMIT;")
[ "$runtime_verification_result" = '1' ] \
  || fail 'restored runtime grants or tenant row security were unusable'

backup_verification_result=$(psql \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --quiet \
  --command="BEGIN;
SET LOCAL ROLE autorfp_backup;
SELECT CASE WHEN
  to_regclass('public.\"Tenant\"') IS NOT NULL
  AND has_schema_privilege(current_user, 'public', 'USAGE')
  AND (
    SELECT bool_and(has_table_privilege(current_user, relation.oid, 'SELECT'))
      AND NOT bool_or(has_table_privilege(
        current_user,
        relation.oid,
        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ))
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'autorfp_private'
      AND has_function_privilege(current_user, procedure.oid, 'EXECUTE')
  )
THEN 1 ELSE 0 END;
COMMIT;")
[ "$backup_verification_result" = '1' ] \
  || fail 'restored backup grants were not read-only'

printf 'Disposable restore verified and scheduled for immediate cleanup.\n'
