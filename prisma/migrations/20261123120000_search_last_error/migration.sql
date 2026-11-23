-- A failed store search used to leave a Looking-for line "Searching the stores…" forever (review E C3) and the brand
-- feed silent (B5): both rows now keep the reason, cleared by the next search that works.
ALTER TABLE "Want" ADD COLUMN "lastError" TEXT;
ALTER TABLE "BrandFeed" ADD COLUMN "lastError" TEXT;
