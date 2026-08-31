// The exemplar gate (cat-02, canon: docs/design/data-fabric.md "Exemplars —
// conditional, doubly gated"). A value is stored only if BOTH hold: its
// field is INTERNAL (never SHAPE_ONLY, never UNKNOWN — this module applies
// the gate itself and does not trust the caller to have filtered), and the
// value survived the in-source k floor — a domain member, not a record.
//
// min/max are VALUES, and the same rule applies to them: temporal and
// INTERNAL numeric fields carry bounds; a SHAPE_ONLY numeric carries only
// its digit-count range, because max(net_pay) is one identifiable person's
// salary.

import type { Classification, ColumnShape, Sensitivity, TopKValue } from "@/lib/catalog/classify";

export interface ExemplarInput {
  classification: Pick<Classification, "semanticType" | "sensitivity">;
  /** The k-floored top-K list as it arrived. The floor is re-applied here
   *  — defence in depth against a caller that forgot. */
  topK: TopKValue[];
  kFloor: number;
  topKCap: number;
}

/**
 * Emit exemplars. [] for any SHAPE_ONLY or UNKNOWN field regardless of what
 * the caller passed; for an INTERNAL field, only values with count >= kFloor,
 * capped at topKCap, in the order they arrived (the source's frequency
 * order). A value below the floor appears in NO output field.
 */
export function gateExemplars(input: ExemplarInput): TopKValue[] {
  const { sensitivity } = input.classification;
  if (sensitivity !== "INTERNAL") return [];
  return input.topK
    .filter((v) => v.count >= input.kFloor)
    .slice(0, input.topKCap);
}

const NUMERIC_TYPE = /numeric|decimal|integer|int\b|bigint|real|double|float|money/i;
const TEMPORAL_TYPE = /date|timestamp|time\b/i;

/**
 * What a numeric/temporal field may carry. Temporal and INTERNAL numerics
 * emit min/max (from the shape, as strings); a SHAPE_ONLY numeric — a
 * salary, a compensation, anything the classifier refused to clear — emits
 * ONLY the digit-count range, never a bound. `minLength`/`maxLength` are
 * lengths, not values, and are always safe; the digit range is derived
 * from them for numeric fields.
 */
export function numericBounds(
  classification: Pick<Classification, "semanticType" | "sensitivity">,
  declaredType: string,
  shape: ColumnShape,
): { kind: "bounds"; min: string; max: string } | { kind: "digitRange"; minDigits: number; maxDigits: number } | { kind: "none" } {
  const numeric = NUMERIC_TYPE.test(declaredType);
  const temporal = TEMPORAL_TYPE.test(declaredType) || classification.semanticType === "TEMPORAL";
  if (classification.sensitivity !== "INTERNAL") {
    if (numeric || temporal) {
      return { kind: "digitRange", minDigits: shape.minLength, maxDigits: shape.maxLength };
    }
    return { kind: "none" };
  }
  if (numeric && shape.minValue !== null && shape.maxValue !== null) {
    return { kind: "bounds", min: shape.minValue, max: shape.maxValue };
  }
  if (temporal && shape.minValue !== null && shape.maxValue !== null) {
    return { kind: "bounds", min: shape.minValue, max: shape.maxValue };
  }
  return { kind: "none" };
}

export type { Sensitivity, TopKValue };
