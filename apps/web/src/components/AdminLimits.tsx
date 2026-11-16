import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Files, Gauge, HardDriveUpload, RotateCcw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError } from "@/lib/api";
import {
  fetchAdminLimits,
  saveAdminLimits,
  type AdminLimit,
  type AdminLimitKey,
} from "@/lib/admin-api";
import { formatBytes } from "@/lib/utils";

const GB = 1024 ** 3;
const TB = 1024 ** 4;
const UNITS = { MB: 1024 ** 2, GB, TB } as const;
type Unit = keyof typeof UNITS;

/** Quick picks per setting. The custom field takes any other value. */
const PRESETS: Record<AdminLimitKey, number[]> = {
  FILE_MAX_SIZE: [2 * GB, 5 * GB, 10 * GB, 50 * GB, 100 * GB, TB],
  FILE_UPLOAD_QUOTA_BYTES: [0, 10 * GB, 50 * GB, 100 * GB, TB],
  FILE_MAX_FILES_PER_UPLOAD: [10, 50, 200, 1000],
};

const ICONS: Record<AdminLimitKey, ReactNode> = {
  FILE_MAX_SIZE: <HardDriveUpload />,
  FILE_UPLOAD_QUOTA_BYTES: <Gauge />,
  FILE_MAX_FILES_PER_UPLOAD: <Files />,
};

/** The biggest unit that shows a value as a whole or short number. */
function splitBytes(bytes: number): { amount: string; unit: Unit } {
  const unit: Unit = bytes >= TB && bytes % (TB / 4) === 0 ? "TB" : bytes >= GB ? "GB" : "MB";
  const amount = bytes / UNITS[unit];
  return { amount: String(Number.isInteger(amount) ? amount : Number(amount.toFixed(2))), unit };
}

/**
 * The limits an admin can change while the server runs: the size of one upload, the quota per
 * address and the number of files per upload. A change applies to the next upload.
 */
export function AdminLimits({ onError }: { onError: (err: unknown) => void }) {
  const { t } = useTranslation();
  const [limits, setLimits] = useState<AdminLimit[] | null>(null);

  useEffect(() => {
    fetchAdminLimits().then(setLimits).catch(onError);
  }, [onError]);

  const save = async (key: AdminLimitKey, value: number | null) => {
    try {
      setLimits(await saveAdminLimits({ [key]: value }));
      toast.success(value === null ? t("admin.limitReset") : t("admin.limitSaved"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        toast.error(t("admin.limitInvalid"), { id: "admin-limit" });
      } else {
        onError(err);
      }
    }
  };

  if (!limits) return <Skeleton className="h-96 w-full rounded-[20px]" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.limitsTitle")}</CardTitle>
        <CardDescription>{t("admin.limitsText")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {limits.map((limit) => (
          <LimitRow key={limit.key} limit={limit} onSave={save} />
        ))}
      </CardContent>
    </Card>
  );
}

function LimitRow({
  limit,
  onSave,
}: {
  limit: AdminLimit;
  onSave: (key: AdminLimitKey, value: number | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const bytes = limit.kind === "bytes";
  const show = (n: number) =>
    bytes ? (n === 0 && limit.key === "FILE_UPLOAD_QUOTA_BYTES" ? t("admin.quotaOff") : formatBytes(n)) : String(n);

  const presets = PRESETS[limit.key];
  const isPreset = presets.includes(limit.value);
  const initial = bytes ? splitBytes(limit.value || GB) : { amount: String(limit.value), unit: "GB" as Unit };
  const [amount, setAmount] = useState(isPreset ? "" : initial.amount);
  const [unit, setUnit] = useState<Unit>(initial.unit);
  const [busy, setBusy] = useState(false);

  const custom = Number(amount.replace(",", "."));
  const customValue = bytes ? Math.round(custom * UNITS[unit]) : Math.round(custom);
  const customValid =
    amount.trim() !== "" &&
    Number.isFinite(custom) &&
    custom >= 0 &&
    customValue >= limit.min &&
    customValue <= limit.max;

  const run = async (value: number | null) => {
    setBusy(true);
    await onSave(limit.key, value);
    setBusy(false);
  };

  return (
    <div className="space-y-3 rounded-[18px] bg-well p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-primary-text [&_svg]:h-5 [&_svg]:w-5">{ICONS[limit.key]}</span>
          <div>
            <div className="font-medium">{t(`admin.limit_${limit.key}`)}</div>
            <div className="text-xs text-muted-foreground">{t(`admin.limitHelp_${limit.key}`)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="accent">{show(limit.value)}</Badge>
          {limit.overridden && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => run(null)}
              aria-label={t("admin.limitResetTo", { value: show(limit.envDefault) })}
            >
              <RotateCcw />
              {t("admin.limitDefault", { value: show(limit.envDefault) })}
            </Button>
          )}
        </div>
      </div>

      <ToggleGroup
        type="single"
        value={isPreset ? String(limit.value) : ""}
        onValueChange={(v) => v && !busy && run(Number(v))}
        aria-label={t(`admin.limit_${limit.key}`)}
      >
        {presets.map((p) => (
          <ToggleGroupItem key={p} value={String(p)}>
            {show(p)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (customValid) void run(customValue);
        }}
      >
        <span className="text-sm text-muted-foreground sm:w-16">{t("admin.limitCustom")}</span>
        <div className="flex flex-1 gap-2">
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={bytes ? "250" : "500"}
            aria-label={t("admin.limitCustom")}
            aria-invalid={amount.trim() !== "" && !customValid}
            className="flex-1"
          />
          {bytes && (
            <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
              <SelectTrigger className="w-24" aria-label={t("admin.limitUnit")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(UNITS) as Unit[]).map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button type="submit" disabled={!customValid || busy}>
          <Save />
          {t("admin.limitSave")}
        </Button>
      </form>
      {amount.trim() !== "" && !customValid && (
        <p className="text-xs text-destructive-text">
          {t("admin.limitRange", { min: show(limit.min), max: show(limit.max) })}
        </p>
      )}
    </div>
  );
}
