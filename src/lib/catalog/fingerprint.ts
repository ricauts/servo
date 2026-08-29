// The structural fingerprint (cat-03): what "this dataset changed" means.
// Hashes the STRUCTURAL part only — for SQL sources, the level, fqn, and
// the ordered columns with types, nullability, PK and FK; for object
// storage, the prefix, the extension histogram and the power-of-two-
// bucketed object count. Everything that is an ESTIMATE — row counts,
// reltuples, stats, most-common values — is excluded on purpose: a fresh
// ANALYZE with different numbers is not a change, and the tests pin that.

import { sha256Canonical } from "@/lib/catalog/tier1-sql";

/** Structural column facts — exactly what the fingerprint covers per
 *  column, and nothing else. */
export interface StructuralColumn {
  name: string;
  declaredType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  references: string | null;
}

export interface SqlStructure {
  kind: "sql";
  level: "SOURCE" | "DATASET" | "FIELD";
  fqn: string;
  columns: StructuralColumn[]; // order matters: column order is structure
}

export interface ObjectStorageStructure {
  kind: "object-storage";
  prefix: string;
  /** extension → count histogram. */
  extensions: Record<string, number>;
  /** Total object count, bucketed to a power of two so churn inside the
   *  same order of magnitude is not a structural change. */
  objectCount: number;
}

export type Structure = SqlStructure | ObjectStorageStructure;

/** Bucket to the nearest power of two (>=1): 0 → 1, 5 → 4, 12 000 → 8 192. */
export function bucketPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.floor(Math.log2(n));
}

/** The fingerprint of a structure: sha256 over canonical JSON (sorted
 *  keys), stable across runs and across ANALYZE churn — because nothing
 *  volatile is part of the input. */
export function fingerprint(structure: Structure): string {
  if (structure.kind === "sql") {
    return sha256Canonical({
      kind: "sql",
      level: structure.level,
      fqn: structure.fqn,
      columns: structure.columns.map((c) => ({
        name: c.name,
        declaredType: c.declaredType,
        nullable: c.nullable,
        isPrimaryKey: c.isPrimaryKey,
        references: c.references,
      })),
    });
  }
  return sha256Canonical({
    kind: "object-storage",
    prefix: structure.prefix,
    extensions: Object.fromEntries(
      Object.entries(structure.extensions).sort(([a], [b]) => a.localeCompare(b)),
    ),
    objectCountBucket: bucketPowerOfTwo(structure.objectCount),
  });
}

/** Project a Profile (tier 1) down to the structural input. */
export function structureOf(profile: {
  level: "SOURCE" | "DATASET" | "FIELD";
  fqn: string;
  columns: Array<{
    name: string;
    declaredType: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    references: string | null;
  }>;
}): SqlStructure {
  return {
    kind: "sql",
    level: profile.level,
    fqn: profile.fqn,
    columns: profile.columns.map((c) => ({
      name: c.name,
      declaredType: c.declaredType,
      nullable: c.nullable,
      isPrimaryKey: c.isPrimaryKey,
      references: c.references,
    })),
  };
}
