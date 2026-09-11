import { Prisma, type PrismaClient } from '@prisma/client';

type RuntimeRoleClient = Pick<PrismaClient, '$queryRaw'>;

type RuntimeRoleRow = {
  currentUser: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  hasBypassMembership: boolean;
};

const assertions = new WeakMap<object, Promise<void>>();

export class RuntimeDatabaseRoleError extends Error {
  readonly code = 'UNSAFE_DATABASE_ROLE';

  constructor() {
    super('The application database connection is not using its restricted role.');
    this.name = 'RuntimeDatabaseRoleError';
  }
}

export function assertRuntimeDatabaseRole(client: RuntimeRoleClient) {
  const cached = assertions.get(client);
  if (cached) return cached;

  const assertion: Promise<void> = (async () => {
    const [role] = await client.$queryRaw<RuntimeRoleRow[]>(Prisma.sql`
      SELECT
        current_user::TEXT AS "currentUser",
        role.rolsuper,
        role.rolbypassrls,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles AS inherited_role
          WHERE (inherited_role.rolsuper OR inherited_role.rolbypassrls)
            AND pg_catalog.pg_has_role(
              current_user,
              inherited_role.oid,
              'MEMBER'
            )
        ) AS "hasBypassMembership"
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = current_user
    `);
    if (
      !role ||
      role.currentUser !== 'autorfp_app' ||
      role.rolsuper ||
      role.rolbypassrls ||
      role.hasBypassMembership
    ) {
      throw new RuntimeDatabaseRoleError();
    }
  })().catch((error: unknown) => {
    // Reject this request, but do not poison a warm server after a temporary
    // connection failure. A later request must successfully recheck the role.
    // A confirmed unsafe role remains a cached, closed failure.
    if (!(error instanceof RuntimeDatabaseRoleError) && assertions.get(client) === assertion) {
      assertions.delete(client);
    }
    throw error;
  });

  assertions.set(client, assertion);
  return assertion;
}
