import { cn, initials } from "@/lib/utils";

export default function Avatar({
  name,
  color,
  size = 24,
  className,
  isAi = false,
}: {
  name: string;
  color: string;
  size?: number;
  className?: string;
  isAi?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-mono font-semibold text-white",
        isAi ? "rounded-md" : "rounded-full",
        className,
      )}
      style={{
        backgroundColor: color,
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.38)),
      }}
      title={name}
    >
      {isAi ? "⚙" : initials(name)}
    </span>
  );
}
