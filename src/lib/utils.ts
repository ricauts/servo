import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** JSON.stringify that survives BigInt values coming from raw SQL queries
 * (COUNT(*) through $queryRawUnsafe is BigInt on Postgres too). */
export function jsonSafe(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? Number(v) : v,
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
