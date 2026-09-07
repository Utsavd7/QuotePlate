BEGIN;
CREATE TABLE "ServicePlan" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0), "serviceAt" TIMESTAMP(3) NOT NULL,
 "menuId" TEXT NOT NULL, "menuVersion" INTEGER NOT NULL, "menuSnapshot" JSONB NOT NULL,
 "document" JSONB NOT NULL, "requestId" TEXT, "createdByUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ServicePlan_tenantId_id_key" UNIQUE ("tenantId", "id"),
 CONSTRAINT "ServicePlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ServicePlan_tenantId_menuId_fkey" FOREIGN KEY ("tenantId", "menuId") REFERENCES "Menu"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ServicePlan_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ServicePlan_tenantId_requestId_fkey" FOREIGN KEY ("tenantId", "requestId") REFERENCES "ProcurementRequest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ServicePlan_document_size_check" CHECK (octet_length("document"::TEXT) <= 524288), CONSTRAINT "ServicePlan_menuSnapshot_size_check" CHECK (octet_length("menuSnapshot"::TEXT) <= 1048576)
);
CREATE INDEX "ServicePlan_tenantId_serviceAt_idx" ON "ServicePlan"("tenantId", "serviceAt");
CREATE TABLE "ServicePlanRevision" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "planId" TEXT NOT NULL,
 "version" INTEGER NOT NULL CHECK ("version" > 0), "document" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ServicePlanRevision_tenantId_planId_version_key" UNIQUE ("tenantId", "planId", "version"),
 CONSTRAINT "ServicePlanRevision_tenantId_planId_fkey" FOREIGN KEY ("tenantId", "planId") REFERENCES "ServicePlan"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ServicePlanRevision_document_size_check" CHECK (octet_length("document"::TEXT) <= 524288)
);
ALTER TABLE "ServicePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServicePlan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ServicePlanRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServicePlanRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServicePlan" FOR ALL TO autorfp_app USING ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), ''));
CREATE POLICY tenant_isolation ON "ServicePlanRevision" FOR ALL TO autorfp_app USING ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')) WITH CHECK ("tenantId" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), ''));
GRANT SELECT, INSERT, UPDATE ON "ServicePlan" TO autorfp_app;
GRANT SELECT, INSERT ON "ServicePlanRevision" TO autorfp_app;
ALTER TABLE "Award" DROP CONSTRAINT "Award_receiving_size_check";
ALTER TABLE "Award" ADD CONSTRAINT "Award_receiving_size_check"
 CHECK (octet_length("receiving"::TEXT) <= 1048576);
GRANT SELECT ON TABLE public."ServicePlan", public."ServicePlanRevision" TO autorfp_backup;
COMMIT;
