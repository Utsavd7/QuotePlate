-- Supplier declarations are independent of verified capabilities. Existing tenant
-- RLS and table grants apply to this nullable column; no resolver is widened.
ALTER TABLE "Supplier" ADD COLUMN "tradingProfile" JSONB;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tradingProfile_size_check"
  CHECK (octet_length("tradingProfile"::text) <= 8192);
