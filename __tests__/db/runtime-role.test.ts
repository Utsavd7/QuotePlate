import {
  assertRuntimeDatabaseRole,
  RuntimeDatabaseRoleError,
} from '@/lib/db/runtime-role';

function clientWithRole(input: {
  currentUser: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  hasBypassMembership: boolean;
}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([input]),
  };
}

describe('runtime database role assertion', () => {
  it('lets a later request recheck after a transient database failure', async () => {
    const client = clientWithRole({ currentUser: 'autorfp_app', rolsuper: false, rolbypassrls: false, hasBypassMembership: false });
    const disconnected = new Error('Connection interrupted');
    client.$queryRaw.mockRejectedValueOnce(disconnected);
    const first = assertRuntimeDatabaseRole(client as never);
    const concurrent = assertRuntimeDatabaseRole(client as never);
    expect(concurrent).toBe(first);
    await expect(first).rejects.toBe(disconnected);
    await expect(assertRuntimeDatabaseRole(client as never)).resolves.toBeUndefined();
    await expect(assertRuntimeDatabaseRole(client as never)).resolves.toBeUndefined();
    expect(client.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('continues to reject a known unsafe role without treating it as transient', async () => {
    const client = clientWithRole({ currentUser: 'postgres', rolsuper: true, rolbypassrls: true, hasBypassMembership: false });
    await expect(assertRuntimeDatabaseRole(client as never)).rejects.toBeInstanceOf(RuntimeDatabaseRoleError);
    await expect(assertRuntimeDatabaseRole(client as never)).rejects.toBeInstanceOf(RuntimeDatabaseRoleError);
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('accepts and caches only the exact non-bypass application role', async () => {
    const client = clientWithRole({
      currentUser: 'autorfp_app',
      rolsuper: false,
      rolbypassrls: false,
      hasBypassMembership: false,
    });

    await expect(assertRuntimeDatabaseRole(client as never)).resolves.toBeUndefined();
    await expect(assertRuntimeDatabaseRole(client as never)).resolves.toBeUndefined();
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an administrator or bypass role', async () => {
    for (const role of [
      {
        currentUser: 'postgres',
        rolsuper: true,
        rolbypassrls: true,
        hasBypassMembership: false,
      },
      {
        currentUser: 'autorfp_app',
        rolsuper: false,
        rolbypassrls: true,
        hasBypassMembership: false,
      },
      {
        currentUser: 'autorfp_app',
        rolsuper: false,
        rolbypassrls: false,
        hasBypassMembership: true,
      },
    ]) {
      const client = clientWithRole(role);
      await expect(
        assertRuntimeDatabaseRole(client as never),
      ).rejects.toMatchObject<Partial<RuntimeDatabaseRoleError>>({
        code: 'UNSAFE_DATABASE_ROLE',
      });
    }
  });
});
