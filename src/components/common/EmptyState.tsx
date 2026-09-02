import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export default function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-6 py-14 text-center">
      <Icon size={26} strokeWidth={1.5} className="text-muted-foreground" />
      <div className="font-heading text-[14px] font-medium text-foreground">
        {title}
      </div>
      {hint && (
        <div className="max-w-sm font-sans text-[12.5px] text-muted-foreground">
          {hint}
        </div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
