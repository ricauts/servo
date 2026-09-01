import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid, can } from "@/lib/permissions";
import KbSourcesPanel from "@/components/kb/KbSourcesPanel";
import { READ_ONLY_ROLE_SQL } from "@/lib/kb/sources/sql";
import { S3_LEAST_PRIVILEGE } from "@/lib/kb/sources/least-privilege";

export const dynamic = "force-dynamic";

export default async function KbSourcesPage() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kb.sources.manage");
  if (denied) return denied;

  const sources = await db.dataSource.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      <h1 className="font-heading text-[20px] font-bold tracking-tight">Data sources</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
        INDEX mode: crawled records arrive INTO the Servo database as ordinary
        documents, readable only through the source ceiling — a source grant
        alone entitles nothing, and a document path alone reaches nothing
        source-backed. The crawler runs in the same single Node process as the
        desk; there is no connector service.
      </p>

      <KbSourcesPanel
        sources={sources.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind as "S3" | "POSTGRES",
          status: s.status,
          statusError: s.statusError,
          lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
          lastCompleteSyncAt: s.lastCompleteSyncAt?.toISOString() ?? null,
          syncEveryMin: s.syncEveryMin,
          maxRows: s.maxRows,
          scopeJson: s.scopeJson,
          configJson: s.configJson,
        }))}
        leastPrivilege={[
          { kind: "S3", text: S3_LEAST_PRIVILEGE },
          { kind: "POSTGRES", text: READ_ONLY_ROLE_SQL },
        ]}
        syncHint="Sync is triggered by this page's button or by POST /api/kb/sources/:id/sync from your own scheduler — Servo itself never schedules a crawl."
      />
      {can(user, "kb.view") ? null : null}
    </div>
  );
}
