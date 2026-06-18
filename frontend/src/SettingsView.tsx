import React, { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCacheStats, clearCache } from "./api/cacheApi";
import { toast } from "sonner";
import { Database, HardDrive, Trash2, RefreshCw } from "lucide-react";

interface CacheStats {
  num_files: number;
  total_size_bytes: number;
  total_size_mb: number;
  max_entries: number;
}

export function SettingsView() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await getCacheStats();
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch cache stats:", err);
      toast.error("Failed to load cache statistics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearCache();
      toast.success("Cache cleared successfully");
      await fetchStats();
    } catch (err) {
      console.error("Failed to clear cache:", err);
      toast.error("Failed to clear cache");
    } finally {
      setClearing(false);
    }
  };

  const usagePercent = stats
    ? Math.min(100, Math.round((stats.num_files / stats.max_entries) * 100))
    : 0;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <div className="flex flex-col gap-6 p-8 max-w-2xl mx-auto">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage application settings and cache.
            </p>
          </div>

          {/* Cache Management Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Result Cache</CardTitle>
              </div>
              <CardDescription>
                Analysis results are cached to disk so repeated queries return
                instantly. You can view usage or clear the entire cache below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading statistics…
                </div>
              ) : stats ? (
                <>
                  {/* Usage bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Cache usage</span>
                      <span className="font-medium">
                        {stats.num_files} / {stats.max_entries} entries
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border p-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <HardDrive className="h-3.5 w-3.5" />
                        Disk usage
                      </div>
                      <p className="text-lg font-semibold">
                        {stats.total_size_mb} MB
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <Database className="h-3.5 w-3.5" />
                        Cached entries
                      </div>
                      <p className="text-lg font-semibold">{stats.num_files}</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleClear}
                      disabled={clearing || stats.num_files === 0}
                    >
                      {clearing ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      {clearing ? "Clearing…" : "Clear Cache"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchStats}
                      disabled={loading}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Unable to load cache statistics.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default SettingsView;
