// The skills KPI tile (reb-06): three numbers with "n/a" for the
// not-applicable cases — no completed resolver runs in the window means the
// informed rate is undefined, no enabled skills means coverage is undefined.
// shareAsPct (labels.ts) is the discipline: null renders a word, never NaN.

import { shareAsPct } from "@/lib/labels";

export default function SkillsTile({
  skills,
}: {
  skills: {
    skillInformedRunRate: number | null;
    skillsDistilledThisMonth: number;
    skillCoverage: number | null;
  };
}) {
  return (
    <dl className="grid grid-cols-3 gap-2 font-sans text-sm">
      <div className="flex flex-col gap-0.5">
        <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          informed runs
        </dt>
        <dd className="font-heading text-lg font-semibold text-foreground">
          {shareAsPct(skills.skillInformedRunRate)}
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          distilled · month
        </dt>
        <dd className="font-heading text-lg font-semibold text-foreground">
          {skills.skillsDistilledThisMonth}
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          coverage
        </dt>
        <dd className="font-heading text-lg font-semibold text-foreground">
          {shareAsPct(skills.skillCoverage)}
        </dd>
      </div>
    </dl>
  );
}
