-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "deviceId" INTEGER;

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "modelCode" TEXT,
    "location" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "warrantyMonths" INTEGER,
    "maintenanceCycleMonths" INTEGER,
    "nextMaintenanceDate" TIMESTAMP(3),
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
