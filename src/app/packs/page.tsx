import { Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { packsState } from "@/lib/packs/state";
import EmptyState from "@/components/common/EmptyState";
import PageHeader from "@/components/shell/PageHeader";
import PacksBrowser from "@/components/packs/PacksBrowser";

export const dynamic = "force-dynamic";

/** Packs (kb-lib-5): the curated catalog of what Servo connects to, and
 *  the local plugin bundles — with this install's state on every card. */
export default async function PacksPage() {
  const user = await getCurrentUser();
  if (!can(user, "packs.view")) {
    return (
      <>
        <PageHeader title="Packs" description="Connectors, extraction lanes, models, tools and bundles." />
        <div className="p-4 md:p-8">
          <EmptyState icon={Lock} title="Agent access required" hint="Only admins and agents can browse the catalog." />
        </div>
      </>
    );
  }
  const data = await packsState();
  return (
    <div>
      <PageHeader
        title="Packs"
        description="Everything Servo can connect to, extract with, call and load — curated in this repository, with what is configured on this install. Nothing here is fetched from anywhere."
      />
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
        <PacksBrowser initial={data} canManage={can(user, "packs.manage")} />
      </div>
    </div>
  );
}
