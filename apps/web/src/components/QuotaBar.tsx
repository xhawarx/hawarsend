import { useTranslation } from "react-i18next";
import { HardDrive } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { QuotaStatus } from "@/lib/api";
import { cn, formatBytes, formatRemainingMs } from "@/lib/utils";

/** Hours and minutes until the quota resets, never seconds. */
function formatResetIn(resetsAt: string): string {
  const remaining = Math.max(0, new Date(resetsAt).getTime() - Date.now());
  return formatRemainingMs(Math.max(60_000, remaining - (remaining % 60_000)));
}

interface QuotaBarProps {
  quota: QuotaStatus | null;
}

export function QuotaBar({ quota }: QuotaBarProps) {
  const { t } = useTranslation();

  if (!quota || !quota.enabled) return null;

  const percentage = Math.min(100, Math.round((quota.used / quota.limit) * 100));
  const exceeded = quota.used >= quota.limit;

  return (
    <div className="rounded-2xl bg-well px-4 py-3">
      <div className="flex items-center justify-between text-[13px]">
        <span className="flex items-center gap-1.5 font-medium">
          <HardDrive className="h-4 w-4 text-primary-text" />
          {t("quota.title")}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatBytes(quota.used)} / {formatBytes(quota.limit)}
        </span>
      </div>
      <Progress
        value={percentage}
        className={cn("mt-2 h-1.5", exceeded && "[&>div]:bg-destructive")}
      />
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        {exceeded ? (
          <span className="font-medium text-destructive-text">
            {t("quota.exceeded")}
          </span>
        ) : (
          <span>
            {t("quota.remaining", { size: formatBytes(quota.remaining) })}
          </span>
        )}
        {quota.resetsAt && (
          <span>{t("quota.resetsIn", { time: formatResetIn(quota.resetsAt) })}</span>
        )}
      </div>
    </div>
  );
}
