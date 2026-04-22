import { format, formatDistanceToNow } from "date-fns";

/**
 * Format a date to a human-readable string with timezone awareness
 */
export function formatDate(date: Date): string {
  return format(date, "MMM d, yyyy");
}

/**
 * Format a date-time with local timezone
 */
export function formatDateTime(date: Date): string {
  return format(date, "MMM d, yyyy h:mm a");
}

/**
 * Get relative time hint (e.g., "in 3 days", "Tomorrow 10am")
 */
export function getRelativeTimeHint(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.ceil(diffHours / 24);

  if (diffDays === 1) {
    return `Tomorrow ${format(date, "h:mm a")}`;
  }
  if (diffDays <= 3) {
    return `in ${diffDays} days`;
  }
  if (diffDays <= 7) {
    return `in ${diffDays} days`;
  }
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Format money values
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format a price range
 */
export function formatPriceRange(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  if (min === null && max === null) return "—";
  if (min === null || min === undefined) {
    if (max === null || max === undefined) return "—";
    return formatMoney(max);
  }
  if (max === null || max === undefined) {
    return formatMoney(min);
  }
  return `${formatMoney(min)}–${formatMoney(max)}`;
}
