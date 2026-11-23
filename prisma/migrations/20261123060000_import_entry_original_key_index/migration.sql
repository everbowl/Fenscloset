-- CreateIndex (review B B8): every registered photo looks itself up by originalKey; without this the lookup scans the table.
CREATE INDEX "ImportEntry_originalKey_idx" ON "ImportEntry"("originalKey");
