import { AlertTriangle, Bell, Building2, Code2, CreditCard, Landmark, Plug, ScrollText, Shield, User, type LucideIcon } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { cn } from "@/lib/cn";
import { NativeSelect } from "@/ui/form";

interface SettingsLink {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const SETTINGS_NAV: { group: string; items: SettingsLink[] }[] = [
  {
    group: "Personal",
    items: [
      { to: "/settings/profile", label: "Profile", icon: User },
      { to: "/settings/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    group: "Company",
    items: [
      { to: "/settings/company", label: "Company details", icon: Building2 },
      { to: "/settings/entities", label: "Entities", icon: Landmark },
      { to: "/settings/billing", label: "Billing and plan", icon: CreditCard },
    ],
  },
  {
    group: "Security",
    items: [
      { to: "/settings/security", label: "Security", icon: Shield },
      { to: "/settings/integrations", label: "Integrations", icon: Plug },
      { to: "/settings/developer", label: "Developers", icon: Code2 },
      { to: "/settings/audit", label: "Audit log", icon: ScrollText },
    ],
  },
  { group: "", items: [{ to: "/settings/danger", label: "Danger zone", icon: AlertTriangle }] },
];

export function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = SETTINGS_NAV.flatMap((g) => g.items).find((i) => location.pathname.startsWith(i.to))?.to ?? "";
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      {/* On small screens the section list becomes a native select. */}
      <div className="md:hidden">
        <label htmlFor="settings-section" className="mb-1.5 block text-[12px] font-medium text-ink-3">
          Settings section
        </label>
        <NativeSelect id="settings-section" value={current} onChange={(e) => navigate(e.target.value)}>
          {SETTINGS_NAV.map((g) => (
            <optgroup key={g.group || "danger"} label={g.group || "Other"}>
              {g.items.map((i) => (
                <option key={i.to} value={i.to}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </div>

      {/* Sticky under the top bar while the page scrolls. */}
      <nav aria-label="Settings" className="sticky top-20 hidden w-52 shrink-0 flex-col gap-4 md:flex">
        <p className="px-2 text-[15px] font-semibold">Settings</p>
        {SETTINGS_NAV.map((g) => (
          <div key={g.group || "danger"} className={cn("flex flex-col gap-0.5", !g.group && "border-t border-line pt-3")}>
            {g.group ? <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">{g.group}</p> : null}
            {g.items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:bg-sunken hover:text-ink",
                    isActive && "bg-panel font-medium text-ink shadow-xs ring-1 ring-line",
                    i.to === "/settings/danger" && "text-danger hover:text-danger",
                  )
                }
              >
                <i.icon className="size-4 shrink-0" strokeWidth={1.75} />
                {i.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="w-full min-w-0 flex-1 pb-24">
        <Outlet />
      </div>
    </div>
  );
}
