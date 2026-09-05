import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ArrowLeft, Lock } from "lucide-react";
import EmptyState from "@/components/common/EmptyState";
import PageHeader from "@/components/shell/PageHeader";
import KbSourcesPanel from "@/components/kb/KbSourcesPanel";
import { BTN_OUTLINE } from "@/components/kb/kb-controls";
import { READ_ONLY_ROLE_SQL } from "@/lib/kb/sources/sql";
import { S3_LEAST_PRIVILEGE } from "@/lib/kb/sources/least-privilege";

export const dynamic = "force-dynamic";

export default async function KbSourcesPage() {
  const user = await getCurrentUser();
  // A PAGE cannot return a Response (the build's page-type check rejects
  // it) — the gate renders the same refusal surface the KB itself uses;
  // the API routes answer 403, asserted at the route level.
  if (!can(user, "kb.sources.manage")) {
    return (
      <>
        <PageHeader title="Data sources" description="External records under the source ceiling." />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Administrator access required"
            hint="Source management is an admin surface; the nav entry is already absent for other roles, and the sync and purge routes answer 403."
          />
        </div>
      </>
    );
  }

  const sources = await db.dataSource.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div>
      <PageHeader
        title="Data sources"
        description="INDEX mode: crawled records arrive INTO the Servo database as ordinary documents, readable only through the source ceiling — a source grant alone entitles nothing, and a document path alone reaches nothing source-backed. The crawler runs in the same single Node process as the desk; there is no connector service."
        actions={
          <Link href="/kb" className={BTN_OUTLINE}>
            <ArrowLeft size={13} /> Library
          </Link>
        }
      />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
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
      </div>
    </div>
  );
}
