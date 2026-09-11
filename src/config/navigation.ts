import {
  LayoutDashboard,
  Database,
  ArrowLeftRight,
  UploadCloud,
  DownloadCloud,
  KeyRound,
  Bell,
  Settings,
  ShieldCheck,
  Building2,
  Users,
  Layers,
  Share2,
  Boxes,
  Activity,
  GitBranch,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Data Products", href: "/datasets", icon: Database },
  { label: "Entitlements", href: "/entitlements", icon: ShieldCheck },
  { label: "Subscriptions", href: "/subscriptions", icon: Boxes },
  { label: "Exchanges", href: "/exchanges", icon: ArrowLeftRight },
  { label: "Upload Data", href: "/upload", icon: UploadCloud },
  { label: "Downloads", href: "/downloads", icon: DownloadCloud },
  { label: "API Access", href: "/api-access", icon: KeyRound },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Settings", href: "/settings", icon: Settings },
];

/**
 * The Admin Console's LHS nav — everything a superuser can reach lives
 * under this single list (see `src/app/admin/` and
 * `src/components/layout/admin-shell.tsx`). A superuser has no
 * organization/tenant, so this is intentionally a separate nav rather
 * than an addition to `PRIMARY_NAV`.
 */
export const ADMIN_NAV: NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Organizations", href: "/admin/organizations", icon: Building2 },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Data Products", href: "/admin/data-products", icon: Database },
  { label: "Data Relationships", href: "/admin/data-relationships", icon: Share2 },
  { label: "Lakehouse Ingestion", href: "/admin/lakehouse", icon: Layers },
  { label: "Observability", href: "/admin/observability", icon: Activity },
  { label: "Product Versions", href: "/admin/catalog", icon: GitBranch },
  { label: "Platform Settings", href: "/admin/settings", icon: Settings },
];
