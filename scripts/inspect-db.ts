// Quick DB inspector. Run with `npx tsx scripts/inspect-db.ts`.
import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const [events, artists, venues, safetix, nonTransfer] = await Promise.all([
    prisma.event.count(),
    prisma.artist.count(),
    prisma.venue.count(),
    prisma.event.count({ where: { isSafeTix: true } }),
    prisma.event.count({ where: { isNonTransferable: true } }),
  ]);
  console.log({ events, artists, venues, safetix, nonTransferable: nonTransfer });

  const sample = await prisma.event.findFirst({
    include: { artist: true, venue: true },
    orderBy: { onsaleStart: "asc" },
  });
  if (sample) {
    console.log("sample event:", {
      name: sample.name,
      artist: sample.artist?.name,
      venue: sample.venue?.name,
      city: sample.venue?.city,
      state: sample.venue?.state,
      onsaleStart: sample.onsaleStart,
      eventDate: sample.eventDate,
      isSafeTix: sample.isSafeTix,
      isNonTransferable: sample.isNonTransferable,
      faceMinUsd: sample.faceMinUsd,
      faceMaxUsd: sample.faceMaxUsd,
    });
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
