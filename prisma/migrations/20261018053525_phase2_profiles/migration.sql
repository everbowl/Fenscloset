-- CreateTable
CREATE TABLE "MeasurementKind" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasurementKind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleWord" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyProfile" (
    "personId" TEXT NOT NULL,
    "fitNotes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BodyProfile_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "BodyMeasurement" (
    "personId" TEXT NOT NULL,
    "kindId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BodyMeasurement_pkey" PRIMARY KEY ("personId","kindId")
);

-- CreateTable
CREATE TABLE "BodySizeByBrand" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "categoryId" TEXT,
    "size" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BodySizeByBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyPhoto" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyDataGrant" (
    "ownerId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,

    CONSTRAINT "BodyDataGrant_pkey" PRIMARY KEY ("ownerId","viewerId")
);

-- CreateTable
CREATE TABLE "ShopForGrant" (
    "ownerId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,

    CONSTRAINT "ShopForGrant_pkey" PRIMARY KEY ("ownerId","shopperId")
);

-- CreateTable
CREATE TABLE "MinorBodyImageApproval" (
    "minorId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinorBodyImageApproval_pkey" PRIMARY KEY ("minorId")
);

-- CreateTable
CREATE TABLE "_PersonToStyleWord" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PersonToStyleWord_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_favoriteStores" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_favoriteStores_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_lovedColors" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_lovedColors_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_avoidColors" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_avoidColors_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_favoriteBrands" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_favoriteBrands_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementKind_name_key" ON "MeasurementKind"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StyleWord_name_key" ON "StyleWord"("name");

-- CreateIndex
CREATE INDEX "BodySizeByBrand_personId_idx" ON "BodySizeByBrand"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "BodyPhoto_bucketKey_key" ON "BodyPhoto"("bucketKey");

-- CreateIndex
CREATE INDEX "BodyPhoto_personId_idx" ON "BodyPhoto"("personId");

-- CreateIndex
CREATE INDEX "_PersonToStyleWord_B_index" ON "_PersonToStyleWord"("B");

-- CreateIndex
CREATE INDEX "_favoriteStores_B_index" ON "_favoriteStores"("B");

-- CreateIndex
CREATE INDEX "_lovedColors_B_index" ON "_lovedColors"("B");

-- CreateIndex
CREATE INDEX "_avoidColors_B_index" ON "_avoidColors"("B");

-- CreateIndex
CREATE INDEX "_favoriteBrands_B_index" ON "_favoriteBrands"("B");

-- AddForeignKey
ALTER TABLE "BodyProfile" ADD CONSTRAINT "BodyProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMeasurement" ADD CONSTRAINT "BodyMeasurement_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMeasurement" ADD CONSTRAINT "BodyMeasurement_kindId_fkey" FOREIGN KEY ("kindId") REFERENCES "MeasurementKind"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodySizeByBrand" ADD CONSTRAINT "BodySizeByBrand_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodySizeByBrand" ADD CONSTRAINT "BodySizeByBrand_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyPhoto" ADD CONSTRAINT "BodyPhoto_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyDataGrant" ADD CONSTRAINT "BodyDataGrant_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyDataGrant" ADD CONSTRAINT "BodyDataGrant_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopForGrant" ADD CONSTRAINT "ShopForGrant_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopForGrant" ADD CONSTRAINT "ShopForGrant_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinorBodyImageApproval" ADD CONSTRAINT "MinorBodyImageApproval_minorId_fkey" FOREIGN KEY ("minorId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinorBodyImageApproval" ADD CONSTRAINT "MinorBodyImageApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PersonToStyleWord" ADD CONSTRAINT "_PersonToStyleWord_A_fkey" FOREIGN KEY ("A") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PersonToStyleWord" ADD CONSTRAINT "_PersonToStyleWord_B_fkey" FOREIGN KEY ("B") REFERENCES "StyleWord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_favoriteStores" ADD CONSTRAINT "_favoriteStores_A_fkey" FOREIGN KEY ("A") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_favoriteStores" ADD CONSTRAINT "_favoriteStores_B_fkey" FOREIGN KEY ("B") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_lovedColors" ADD CONSTRAINT "_lovedColors_A_fkey" FOREIGN KEY ("A") REFERENCES "Color"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_lovedColors" ADD CONSTRAINT "_lovedColors_B_fkey" FOREIGN KEY ("B") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_avoidColors" ADD CONSTRAINT "_avoidColors_A_fkey" FOREIGN KEY ("A") REFERENCES "Color"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_avoidColors" ADD CONSTRAINT "_avoidColors_B_fkey" FOREIGN KEY ("B") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_favoriteBrands" ADD CONSTRAINT "_favoriteBrands_A_fkey" FOREIGN KEY ("A") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_favoriteBrands" ADD CONSTRAINT "_favoriteBrands_B_fkey" FOREIGN KEY ("B") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

