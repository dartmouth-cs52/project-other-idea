import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Icon } from "./icons";

// "Acme Console": a developer dashboard that is confusing on purpose.
// Icon-only navigation, settings nested three levels deep, an account menu
// behind initials, native dialogs and popovers, a shadow-DOM widget and an
// iframe. Haptic has to cope with all of it.

export function Layout() {
  return (
    <div className="app">
      <aside className="rail">
        <Link to="/" className="logo" aria-label="Acme home">
          ▲
        </Link>
        <nav className="rail-nav">
          {/* Labels differ on purpose: title, aria-label, or nothing at all. */}
          <NavLink to="/" end title="Overview" className="rail-link">
            <Icon name="home" />
          </NavLink>
          <NavLink to="/projects" className="rail-link">
            <Icon name="folder-kanban" />
          </NavLink>
          <NavLink to="/billing" aria-label="Billing" className="rail-link">
            <Icon name="credit-card" />
          </NavLink>
          <NavLink to="/settings" title="Settings" className="rail-link">
            <Icon name="settings" />
          </NavLink>
        </nav>
        <button type="button" className="rail-link rail-bottom" onClick={() => alert("Docs open in a new tab.")}>
          <Icon name="circle-help" />
        </button>
      </aside>
      <div className="main-col">
        <TopBar />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TopBar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const crumbs = location.pathname.split("/").filter(Boolean);
  return (
    <header className="topbar">
      <div className="crumbs">
        <span>Acme Inc</span>
        {crumbs.map((crumb) => (
          <span key={crumb}> / {crumb.replace(/-/g, " ")}</span>
        ))}
      </div>
      <div className="topbar-right">
        <label className="search">
          <Icon name="search" size={16} />
          <input placeholder="Search projects" />
        </label>
        <button type="button" className="icon-btn">
          <Icon name="bell" />
        </button>
        <div className="account" ref={menu}>
          <button type="button" className="avatar" onClick={() => setOpen((value) => !value)}>
            AC
          </button>
          {open && (
            <div className="dropdown">
              <div className="dropdown-head">alex@acme.dev</div>
              <Link to="/profile">Profile</Link>
              <Link to="/settings/organization">Organization settings</Link>
              <button type="button" onClick={() => alert("Signed out")}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function SettingsLayout() {
  return (
    <div>
      <h1>Settings</h1>
      <div className="tabs" role="tablist">
        <NavLink to="/settings" end className="tab">
          General
        </NavLink>
        <NavLink to="/settings/team" className="tab">
          Team
        </NavLink>
        <NavLink to="/settings/organization" className="tab">
          Organization
        </NavLink>
      </div>
      <Outlet />
    </div>
  );
}

export function OrganizationLayout() {
  return (
    <div className="split">
      <nav className="subnav" aria-label="Organization">
        <NavLink to="/settings/organization" end>
          Profile
        </NavLink>
        <NavLink to="/settings/organization/developer">Developer</NavLink>
        <NavLink to="/settings/organization/security">Security</NavLink>
      </nav>
      <section className="panel">
        <Outlet />
      </section>
    </div>
  );
}
