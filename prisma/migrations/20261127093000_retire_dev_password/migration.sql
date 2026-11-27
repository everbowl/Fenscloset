-- Security item 3: the published one-time dev password is retired. A row that still carries it, or that spent it without
-- setting a real password since, loses that hash and must choose a password through a reset link; sessions opened with it end.
DELETE FROM "Session" WHERE "usedDevPassword" = true;
UPDATE "Person" SET "passwordHash" = NULL, "mustChangePassword" = true WHERE "devPasswordActive" = true;
UPDATE "Person" SET "passwordHash" = NULL WHERE "devPasswordUsedAt" IS NOT NULL AND "mustChangePassword" = true;
UPDATE "Person" SET "devPasswordActive" = false WHERE "devPasswordActive" = true;
