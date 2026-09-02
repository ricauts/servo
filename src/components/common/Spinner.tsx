import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Spinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Loader2
      size={size}
      className={cn("animate-spin text-primary-strong", className)}
      aria-label="Loading"
    />
  );
}
