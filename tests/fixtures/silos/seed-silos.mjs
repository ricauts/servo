// The fed-01 fixture generator: two silos over one throwaway schema, with
// LITERAL primary keys (ds_7f3, ds_2a1, ds_9c4) so the ORDER BY d.id
// tie-break makes runs byte-identical. Run from the repo root against the
// test template clone; the test harness rebuilds from this seed.
export const SILO_FIXTURES = {
  exact: { id: "ds_7f3", name: "public.payroll_exact", chunks: 3, entity: "INV-2024-113" },
  wide: { id: "ds_2a1", name: "public.payroll_wide", chunks: 34 },
  export: { id: "ds_9c4", name: "public.payroll_csv_export", chunks: 3, nearDuplicateOf: "ds_7f3" },
};
