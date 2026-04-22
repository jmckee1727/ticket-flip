import type { Event } from "@/generated/prisma/client";

interface ResellabilityBadgesProps {
  event: Event;
}

export function ResellabilityBadges({ event }: ResellabilityBadgesProps) {
  const badges: Array<{ label: string; color: string; tooltip: string }> = [];

  if (event.isSafeTix) {
    badges.push({
      label: "SafeTix",
      color: "bg-yellow-100 text-yellow-800",
      tooltip: "Fan Protect (SafeTix) - verified tickets only",
    });
  }

  if (event.isNonTransferable) {
    badges.push({
      label: "Non-transferable",
      color: "bg-red-100 text-red-800",
      tooltip: "Tickets cannot be transferred to other users",
    });
  }

  if (event.resalePlatformRestriction) {
    badges.push({
      label: "TM Marketplace only",
      color: "bg-orange-100 text-orange-800",
      tooltip: `Resale restricted to ${event.resalePlatformRestriction}`,
    });
  }

  if (badges.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${badge.color}`}
          title={badge.tooltip}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}
