BEGIN;
CREATE TABLE "SupplierPortal" (
 "id" TEXT PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "supplierId" TEXT NOT NULL,
 "tokenDigest" CHAR(64) NOT NULL UNIQUE,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "revokedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SupplierPortal_tenantId_id_key" UNIQUE ("tenantId", "id"),
 CONSTRAINT "SupplierPortal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierPortal_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "Supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierPortal_tenantId_supplierId_key" UNIQUE ("tenantId", "supplierId")
);
CREATE INDEX "SupplierPortal_tenantId_expiresAt_idx" ON "SupplierPortal" ("tenantId", "expiresAt");
ALTER TABLE "SupplierPortal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierPortal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierPortal" FOR ALL TO autorfp_app USING ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), ''));
REVOKE ALL ON "SupplierPortal" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "SupplierPortal" TO autorfp_app;
GRANT SELECT ON "SupplierPortal" TO autorfp_backup;
CREATE TABLE "SupplierCollaboration" (
 "id" TEXT PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "supplierId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" BETWEEN 1 AND 51),
 "revisions" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SupplierCollaboration_tenantId_id_key" UNIQUE ("tenantId", "id"),
 CONSTRAINT "SupplierCollaboration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierCollaboration_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "Supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierCollaboration_tenantId_requestId_fkey" FOREIGN KEY ("tenantId", "requestId") REFERENCES "ProcurementRequest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierCollaboration_tenantId_supplierId_requestId_key" UNIQUE ("tenantId", "supplierId", "requestId"),
 CONSTRAINT "SupplierCollaboration_revisions_size_check" CHECK (octet_length("revisions"::TEXT) <= 131072),
 CHECK (jsonb_typeof("revisions") = 'array' AND jsonb_array_length("revisions") <= 50)
);
CREATE INDEX "SupplierCollaboration_tenantId_requestId_idx" ON "SupplierCollaboration" ("tenantId", "requestId");
ALTER TABLE "SupplierCollaboration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierCollaboration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierCollaboration" FOR ALL TO autorfp_app USING ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), ''));
REVOKE ALL ON "SupplierCollaboration" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "SupplierCollaboration" TO autorfp_app;
GRANT SELECT ON "SupplierCollaboration" TO autorfp_backup;
CREATE TABLE "SupplierDemandShare" (
 "id" TEXT PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "supplierId" TEXT NOT NULL,
 "planId" TEXT NOT NULL,
 "planVersion" INTEGER NOT NULL CHECK ("planVersion" > 0),
 "serviceAt" TIMESTAMP(3) NOT NULL,
 "items" JSONB NOT NULL,
 "withdrawnAt" TIMESTAMP(3),
 "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SupplierDemandShare_tenantId_id_key" UNIQUE ("tenantId", "id"),
 CONSTRAINT "SupplierDemandShare_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierDemandShare_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "Supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierDemandShare_tenantId_planId_fkey" FOREIGN KEY ("tenantId", "planId") REFERENCES "ServicePlan"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierDemandShare_tenantId_supplierId_planId_key" UNIQUE ("tenantId", "supplierId", "planId"),
 CONSTRAINT "SupplierDemandShare_items_size_check" CHECK (octet_length("items"::TEXT) <= 131072),
 CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") <= 100)
);
CREATE INDEX "SupplierDemandShare_tenantId_supplierId_sharedAt_idx" ON "SupplierDemandShare" ("tenantId", "supplierId", "sharedAt");
CREATE INDEX "SupplierDemandShare_tenantId_planId_idx" ON "SupplierDemandShare" ("tenantId", "planId");
ALTER TABLE "SupplierDemandShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierDemandShare" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierDemandShare" FOR ALL TO autorfp_app USING ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), ''));
REVOKE ALL ON "SupplierDemandShare" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "SupplierDemandShare" TO autorfp_app;
GRANT SELECT ON "SupplierDemandShare" TO autorfp_backup;
DO $owner$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE (rolsuper OR rolbypassrls) AND pg_catalog.pg_has_role(current_user, oid, 'USAGE')) THEN
 RAISE EXCEPTION 'Portal resolver requires a row-security-bypassing owner'; END IF;
END $owner$;
CREATE FUNCTION autorfp_private.autorfp_supplier_portal_by_digest(lookup_digest TEXT)
RETURNS TABLE ("tenantId" TEXT, "portalId" TEXT)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
 SELECT p."tenantId", p."id" FROM public."SupplierPortal" p
 JOIN public."Supplier" s ON s."tenantId" = p."tenantId" AND s."id" = p."supplierId"
 JOIN public."Tenant" t ON t."id" = p."tenantId"
 WHERE pg_catalog.octet_length(lookup_digest) = 64
 AND pg_catalog.translate(lookup_digest, '0123456789abcdef', '') = ''
 AND p."tokenDigest" = lookup_digest::CHAR(64)
 AND p."revokedAt" IS NULL AND p."expiresAt" > pg_catalog.clock_timestamp()
 AND s."isActive" AND t."isActive" LIMIT 1
$function$;
REVOKE ALL ON FUNCTION autorfp_private.autorfp_supplier_portal_by_digest(TEXT) FROM PUBLIC, autorfp_app;
DO $acl$
DECLARE target_role TEXT; mode TEXT;
BEGIN
 FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'authenticator'] LOOP
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION autorfp_private.autorfp_supplier_portal_by_digest(TEXT) FROM %I', target_role);
   EXECUTE format('REVOKE ALL ON TABLE public."SupplierPortal", public."SupplierCollaboration", public."SupplierDemandShare" FROM %I', target_role);
  END IF;
 END LOOP;
 SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'direct' ELSE 'inherited' END INTO mode FROM pg_catalog.pg_roles WHERE rolname = current_user;
 EXECUTE format('COMMENT ON FUNCTION autorfp_private.autorfp_supplier_portal_by_digest(TEXT) IS %L', 'quoteplate:rls-owner-attestation:' || mode || ':' || current_user);
END $acl$;
GRANT EXECUTE ON FUNCTION autorfp_private.autorfp_supplier_portal_by_digest(TEXT) TO autorfp_app;
COMMIT;
