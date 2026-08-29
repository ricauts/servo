// src/lib/catalog/datasource-contract.ts — the ONLY shared surface between
// the catalog area (cat-*) and the connection layer (xds-*), per
// docs/design/data-fabric.md "The one coupling point".
//
// CatalogEntry.dataSourceId is a PLAIN STRING with no foreign key until the
// merge, deliberately: the connection layer's row ids do not exist yet, and
// a forward dependency would either dangle or block eight items on work
// this section does not own. The connection layer provides two relations
// naming the DataSources a principal may read; this module declares their
// NAMES, their column shape, and a FIXTURE implementation (migration
// 0007_catalog creates the two empty views) used by every offline test in
// this section. The merge that lands both sections adds the FK and swaps
// the fixture for the real views in one migration, and changes nothing
// else. If the connection layer instead expresses DataSource grants as a
// third nullable target on KbGrant, these two names are still the only
// thing that changes.

/** (dataSourceId, userId) — the human-readable DataSources. */
export const DS_READABLE_BY_HUMAN = "datasource_readable_by_human";

/** (dataSourceId, agentId) — the agent-readable DataSources. */
export const DS_READABLE_BY_AGENT = "datasource_readable_by_agent";

/** The fixture shape both relations carry. Empty until the merge: a card
 *  whose source nobody may read is DARK, which is the only safe default. */
export interface DsReadableRow {
  dataSourceId: string;
  /** userId on the human relation, agentId on the agent one. */
  principalId: string;
}
