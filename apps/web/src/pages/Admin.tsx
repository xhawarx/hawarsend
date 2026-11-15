import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Brush,
  ChevronLeft,
  ChevronRight,
  FileText,
  HardDrive,
  Inbox,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  StickyNote,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError } from "@/lib/api";
import {
  adminLogin,
  adminLogout,
  deleteAdminItem,
  fetchAdminItems,
  fetchAdminSession,
  fetchAdminSettings,
  fetchAdminStats,
  runAdminCleanup,
  type AdminItem,
  type AdminKind,
  type AdminSettings,
  type AdminStats,
} from "@/lib/admin-api";
import { formatBytes } from "@/lib/utils";

type SessionState = "loading" | "disabled" | "login" | "ready";

/**
 * The web admin panel. It shows and deletes what the server stores: IDs, sizes, counters and
 * times. Contents, names and keys never reach the server, so the panel cannot show them either.
 */
export function AdminPage() {
  const [state, setState] = useState<SessionState>("loading");

  useEffect(() => {
    fetchAdminSession()
      .then((s) => setState(!s.enabled ? "disabled" : s.authenticated ? "ready" : "login"))
      .catch(() => setState("disabled"));
  }, []);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-5xl space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-1/3 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-[28px]" />
      </div>
    );
  }
  if (state === "disabled") return <AdminDisabled />;
  if (state === "login") return <AdminLogin onDone={() => setState("ready")} />;
  return <AdminDashboard onLogout={() => setState("login")} />;
}

function AdminHeader({ title, intro, actions }: { title: string; intro: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1
          data-slot="hero-title"
          className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[38px]"
        >
          {title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{intro}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

function AdminDisabled() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl">
      <Card data-emphasis="main">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t("admin.disabledTitle")}
          </CardTitle>
          <CardDescription>{t("admin.disabledText")}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      await adminLogin(password);
      setPassword("");
      onDone();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      toast.error(t(status === 429 ? "admin.loginLocked" : "admin.loginFailed"), {
        id: "admin-login",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <AdminHeader title={t("admin.title")} intro={t("admin.loginIntro")} />
      <Card data-emphasis="main">
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-password">{t("admin.password")}</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={!password || busy}>
              <KeyRound />
              {t("admin.login")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="text-primary-text [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
          {label}
        </div>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        toast.error(t("admin.sessionExpired"), { id: "admin-session" });
        onLogout();
        return;
      }
      toast.error(t("admin.loadFailed"), { id: "admin-load" });
    },
    [onLogout, t],
  );

  const loadStats = useCallback(() => {
    fetchAdminStats().then(setStats).catch(handleError);
  }, [handleError]);

  useEffect(() => {
    loadStats();
    fetchAdminSettings().then(setSettings).catch(handleError);
  }, [loadStats, handleError]);

  const logout = async () => {
    await adminLogout().catch(() => undefined);
    onLogout();
  };

  const cleanup = async () => {
    setCleaning(true);
    try {
      const { removed } = await runAdminCleanup();
      toast.success(t("admin.cleanupDone", { count: removed }));
      loadStats();
    } catch (err) {
      handleError(err);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminHeader
        title={t("admin.title")}
        intro={t("admin.intro")}
        actions={
          <>
            <Button variant="outline" onClick={cleanup} disabled={cleaning}>
              <Brush />
              {t("admin.cleanup")}
            </Button>
            <Button variant="ghost" onClick={logout}>
              <LogOut />
              {t("admin.logout")}
            </Button>
          </>
        }
      />

      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Upload />}
            label={t("admin.statUploads")}
            value={String(stats.uploads.active)}
            detail={t("admin.statUploadsDetail", {
              total: stats.uploads.total,
              downloads: stats.uploads.downloads,
            })}
          />
          <StatCard
            icon={<StickyNote />}
            label={t("admin.statNotes")}
            value={String(stats.notes.active)}
            detail={t("admin.statNotesDetail", { total: stats.notes.total, views: stats.notes.views })}
          />
          <StatCard
            icon={<Inbox />}
            label={t("admin.statRequests")}
            value={String(stats.requests.open)}
            detail={t("admin.statRequestsDetail", {
              total: stats.requests.total,
              uploads: stats.requests.uploads,
            })}
          />
          <StatCard
            icon={<HardDrive />}
            label={t("admin.statStorage")}
            value={formatBytes(stats.storageBytes)}
            detail={t("admin.statStorageDetail", { active: formatBytes(stats.uploads.activeSize) })}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-[20px]" />
          ))}
        </div>
      )}

      <Card className="border-primary-line bg-primary-soft">
        <CardContent className="flex items-start gap-3 pt-6 text-sm">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-text" />
          <p className="text-muted-foreground">{t("admin.zeroKnowledge")}</p>
        </CardContent>
      </Card>

      <Tabs defaultValue="uploads" className="space-y-4">
        <TabsList aria-label={t("admin.title")}>
          <TabsTrigger value="uploads">
            <FileText />
            {t("admin.tabUploads")}
          </TabsTrigger>
          <TabsTrigger value="notes">
            <StickyNote />
            {t("admin.tabNotes")}
          </TabsTrigger>
          <TabsTrigger value="requests">
            <Inbox />
            {t("admin.tabRequests")}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 />
            {t("admin.tabSettings")}
          </TabsTrigger>
        </TabsList>
        {(["uploads", "notes", "requests"] as const).map((kind) => (
          <TabsContent key={kind} value={kind}>
            <ItemList kind={kind} onError={handleError} onChanged={loadStats} />
          </TabsContent>
        ))}
        <TabsContent value="settings">
          <SettingsList settings={settings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function usage(kind: AdminKind, item: AdminItem): string {
  if (kind === "uploads") return `${item.downloadCount ?? 0} / ${item.maxDownloads ?? 0}`;
  if (kind === "notes") return `${item.viewCount ?? 0} / ${item.maxViews || "∞"}`;
  return `${item.finishedUploads ?? 0} / ${item.maxUploads ?? 0}`;
}

function ItemList({
  kind,
  onError,
  onChanged,
}: {
  kind: AdminKind;
  onError: (err: unknown) => void;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [loadedAt, setLoadedAt] = useState(0);
  const [pending, setPending] = useState<AdminItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "expired">("all");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    fetchAdminItems(kind, page)
      .then((res) => {
        setItems(res.items);
        setPageSize(res.pageSize);
        setLoadedAt(Date.now());
      })
      .catch(onError)
      .finally(() => setRefreshing(false));
  }, [kind, page, onError]);

  useEffect(load, [load]);

  const refresh = () => {
    setRefreshing(true);
    load();
    onChanged();
  };

  const date = (ms: number) =>
    new Date(ms).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });

  const confirmDelete = async () => {
    if (!pending) return;
    setDeleting(true);
    try {
      await deleteAdminItem(kind, pending.id);
      toast.success(t("admin.deleted"));
      setPending(null);
      load();
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setDeleting(false);
    }
  };

  if (!items) return <Skeleton className="h-64 w-full rounded-[20px]" />;

  const isExpired = (item: AdminItem) => item.expiresAt < loadedAt || item.closed === true;
  const needle = query.trim().toLowerCase();
  const shown = items.filter(
    (item) =>
      (!needle || item.id.includes(needle)) &&
      (status === "all" || (status === "expired") === isExpired(item)),
  );

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("admin.search")}
              aria-label={t("admin.search")}
              className="pl-9"
            />
          </div>
          <ToggleGroup
            type="single"
            variant="segmented"
            value={status}
            onValueChange={(v) => v && setStatus(v as typeof status)}
            aria-label={t("admin.filter")}
          >
            <ToggleGroupItem value="all">{t("admin.filterAll")}</ToggleGroupItem>
            <ToggleGroupItem value="active">{t("admin.active")}</ToggleGroupItem>
            <ToggleGroupItem value="expired">{t("admin.expired")}</ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("admin.refresh")}
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          </Button>
        </div>
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {items.length === 0 ? t("admin.empty") : t("admin.noMatch")}
          </p>
        ) : (
          <ScrollArea viewportClassName="max-h-[60vh]">
            <ul className="divide-y divide-border">
              {shown.map((item) => {
                const expired = isExpired(item);
                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <code className="block truncate font-mono text-xs text-foreground">
                        {item.id}
                      </code>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge>{formatBytes(item.size)}</Badge>
                        {item.fileCount !== undefined && (
                          <Badge>{t("admin.files", { count: item.fileCount })}</Badge>
                        )}
                        <Badge>{usage(kind, item)}</Badge>
                        {item.hasPassword && (
                          <Badge variant="accent">
                            <Lock />
                            {t("admin.password")}
                          </Badge>
                        )}
                        <Badge variant={expired ? "warning" : "accent"}>
                          {expired ? t("admin.expired") : t("admin.active")}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground sm:w-48 sm:text-right">
                      <div>{t("admin.created", { date: date(item.createdAt) })}</div>
                      <div>{t("admin.expires", { date: date(item.expiresAt) })}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("admin.delete")}
                      onClick={() => setPending(item)}
                    >
                      <Trash2 className="text-destructive-text" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t("admin.page", { page: page + 1 })}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={t("admin.previous")}
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("admin.next")}
              disabled={items.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("admin.deleteText", { id: pending?.id ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              {t("admin.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              <Trash2 />
              {t("admin.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function formatSetting(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "number" && /Size|Bytes/.test(key)) return formatBytes(value);
  if (value === null || value === undefined) return "-";
  return String(value);
}

function SettingsList({ settings }: { settings: AdminSettings | null }) {
  const { t } = useTranslation();
  if (!settings) return <Skeleton className="h-64 w-full rounded-[20px]" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.settingsTitle")}</CardTitle>
        <CardDescription>{t("admin.settingsText")}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {Object.entries(settings).map(([key, value]) => (
            <div key={key} className="rounded-xl bg-well px-3 py-2">
              <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
              <dd className="break-all text-sm">{formatSetting(key, value)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
