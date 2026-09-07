import { readFileSync, existsSync } from 'node:fs';
const file = 'prisma/migrations/20260907000200_supplier_collaboration/migration.sql';
test('collaboration migration provides forced tenant isolation, backup grants and digest-only resolver', () => {
  expect(existsSync(file)).toBe(true);
  const sql = readFileSync(file, 'utf8');
  for (const table of ['SupplierPortal', 'SupplierCollaboration', 'SupplierDemandShare']) {
    expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    expect(sql).toContain(`CREATE POLICY tenant_isolation ON "${table}"`);
  }
  expect(sql).toContain('SECURITY DEFINER');
  expect(sql).toContain('SET search_path = pg_catalog');
  expect(sql).toContain('autorfp_backup');
  expect(sql).toContain('clock_timestamp()');
});
