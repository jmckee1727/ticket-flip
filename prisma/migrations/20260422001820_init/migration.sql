-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ticketmasterId" TEXT,
    "spotifyId" TEXT,
    "genres" TEXT,
    "monthlyListeners" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "postalCode" TEXT,
    "capacity" INTEGER,
    "ticketmasterId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketmasterId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "eventDate" DATETIME NOT NULL,
    "onsaleStart" DATETIME,
    "onsaleEnd" DATETIME,
    "presaleStart" DATETIME,
    "presaleEnd" DATETIME,
    "faceMinUsd" REAL,
    "faceMaxUsd" REAL,
    "isSafeTix" BOOLEAN NOT NULL DEFAULT false,
    "isNonTransferable" BOOLEAN NOT NULL DEFAULT false,
    "resalePlatformRestriction" TEXT,
    "resalePriceCap" REAL,
    "primaryUrl" TEXT,
    "hiddenFromHomepage" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" TEXT,
    "artistId" TEXT,
    "venueId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventIngestSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "raw" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventIngestSource_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResaleSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceMinUsd" REAL,
    "priceMedianUsd" REAL,
    "priceMaxUsd" REAL,
    "priceAvgUsd" REAL,
    "listingCount" INTEGER,
    "daysUntilEvent" INTEGER,
    "sectionsJson" TEXT,
    CONSTRAINT "ResaleSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Projection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "algorithmName" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL DEFAULT '0.1.0',
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectedPriceUsd" REAL NOT NULL,
    "projectedProfitUsd" REAL,
    "confidence" REAL,
    "reasoningJson" TEXT,
    CONSTRAINT "Projection_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "errCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT
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
