-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticketmasterId" TEXT,
    "spotifyId" TEXT,
    "genres" TEXT,
    "monthlyListeners" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "postalCode" TEXT,
    "capacity" INTEGER,
    "ticketmasterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "ticketmasterId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "onsaleStart" TIMESTAMP(3),
    "onsaleEnd" TIMESTAMP(3),
    "presaleStart" TIMESTAMP(3),
    "presaleEnd" TIMESTAMP(3),
    "faceMinUsd" DOUBLE PRECISION,
    "faceMaxUsd" DOUBLE PRECISION,
    "isSafeTix" BOOLEAN NOT NULL DEFAULT false,
    "isNonTransferable" BOOLEAN NOT NULL DEFAULT false,
    "resalePlatformRestriction" TEXT,
    "resalePriceCap" DOUBLE PRECISION,
    "primaryUrl" TEXT,
    "hiddenFromHomepage" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" TEXT,
    "artistId" TEXT,
    "venueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventIngestSource" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "raw" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventIngestSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResaleSnapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceMinUsd" DOUBLE PRECISION,
    "priceMedianUsd" DOUBLE PRECISION,
    "priceMaxUsd" DOUBLE PRECISION,
    "priceAvgUsd" DOUBLE PRECISION,
    "listingCount" INTEGER,
    "daysUntilEvent" INTEGER,
    "sectionsJson" TEXT,

    CONSTRAINT "ResaleSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Projection" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "algorithmName" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL DEFAULT '0.1.0',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectedPriceUsd" DOUBLE PRECISION NOT NULL,
    "projectedProfitUsd" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "reasoningJson" TEXT,

    CONSTRAINT "Projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "errCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_name_key" ON "Artist"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_ticketmasterId_key" ON "Artist"("ticketmasterId");

-- CreateIndex
CREATE INDEX "Artist_name_idx" ON "Artist"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_ticketmasterId_key" ON "Venue"("ticketmasterId");

-- CreateIndex
CREATE INDEX "Venue_city_state_idx" ON "Venue"("city", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_name_city_state_key" ON "Venue"("name", "city", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Event_ticketmasterId_key" ON "Event"("ticketmasterId");

-- CreateIndex
CREATE INDEX "Event_onsaleStart_idx" ON "Event"("onsaleStart");

-- CreateIndex
CREATE INDEX "Event_eventDate_idx" ON "Event"("eventDate");

-- CreateIndex
CREATE INDEX "Event_artistId_idx" ON "Event"("artistId");

-- CreateIndex
CREATE INDEX "Event_venueId_idx" ON "Event"("venueId");

-- CreateIndex
CREATE INDEX "EventIngestSource_eventId_idx" ON "EventIngestSource"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventIngestSource_source_externalId_key" ON "EventIngestSource"("source", "externalId");

-- CreateIndex
CREATE INDEX "ResaleSnapshot_eventId_capturedAt_idx" ON "ResaleSnapshot"("eventId", "capturedAt");

-- CreateIndex
CREATE INDEX "ResaleSnapshot_source_capturedAt_idx" ON "ResaleSnapshot"("source", "capturedAt");

-- CreateIndex
CREATE INDEX "Projection_eventId_computedAt_idx" ON "Projection"("eventId", "computedAt");

-- CreateIndex
CREATE INDEX "IngestionRun_source_startedAt_idx" ON "IngestionRun"("source", "startedAt");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventIngestSource" ADD CONSTRAINT "EventIngestSource_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResaleSnapshot" ADD CONSTRAINT "ResaleSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projection" ADD CONSTRAINT "Projection_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

