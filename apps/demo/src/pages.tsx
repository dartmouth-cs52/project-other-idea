import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useParams } from "react-router";
import { Icon } from "./icons";

const PROJECTS = [
  { id: "prj_8f2c91ab", name: "Checkout API", env: "Production", updated: "2 hours ago" },
  { id: "prj_1d77e04c", name: "Mobile backend", env: "Staging", updated: "Yesterday" },
  { id: "prj_93ab5521", name: "Data pipeline", env: "Production", updated: "3 days ago" },
];

export function Overview() {
  return (
    <div>
      <h1>Overview</h1>
      <div className="cards">
        <div className="card">
          <div className="muted">Requests today</div>
          <div className="stat">1.2M</div>
        </div>
        <div className="card">
          <div className="muted">Error rate</div>
          <div className="stat">0.04%</div>
        </div>
        <div className="card">
          <div className="muted">Active projects</div>
          <div className="stat">3</div>
        </div>
      </div>
      <div className="cards">
        <div className="card">
          <h2>Service status</h2>
          <status-widget></status-widget>
        </div>
        <div className="card">
          <iframe title="Help" src="/embed/help.html" className="help-frame" />
        </div>
      </div>
    </div>
  );
}

export function Projects() {
  const [projects, setProjects] = useState(PROJECTS);
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div>
      <div className="page-head">
        <h1>Projects</h1>
        <button type="button" className="btn primary" onClick={() => dialog.current?.showModal()}>
          <Icon name="plus" size={16} /> New project
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Environment</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>
                <Link to={`/projects/${project.id}`}>{project.name}</Link>
              </td>
              <td>{project.env}</td>
              <td className="muted">{project.updated}</td>
              <td className="right">
                {/* A native popover menu. */}
                <button type="button" className="icon-btn" popoverTarget={`menu-${project.id}`}>
                  <Icon name="ellipsis-vertical" />
                </button>
                <div popover="auto" id={`menu-${project.id}`} className="popover-menu">
                  <button type="button">Rename</button>
                  <button type="button">Duplicate</button>
                  <button type="button" className="danger">
                    Delete project
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewProjectWizard
        dialog={dialog}
        onCreate={(name, env) => setProjects((list) => [...list, { id: `prj_${list.length}new`, name, env, updated: "Just now" }])}
      />
    </div>
  );
}

/** Three pages behind the same Next button, so a guide has to press it twice. */
function NewProjectWizard({ dialog, onCreate }: { dialog: RefObject<HTMLDialogElement | null>; onCreate: (name: string, env: string) => void }) {
  const [page, setPage] = useState(1);
  const [name, setName] = useState("");
  const [env, setEnv] = useState("Production");
  const close = () => {
    dialog.current?.close();
    setPage(1);
    setName("");
  };
  return (
    <dialog ref={dialog} className="modal" aria-labelledby="project-title" onClose={() => setPage(1)}>
      <h2 id="project-title">New project</h2>
      <p className="muted">Step {page} of 3</p>
      {page === 1 && (
        <label className="field">
          Project name
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Payments" />
        </label>
      )}
      {page === 2 && (
        <fieldset className="field">
          <legend>Environment</legend>
          {["Production", "Staging"].map((option) => (
            <label key={option} className="check">
              <input type="radio" name="env" checked={env === option} onChange={() => setEnv(option)} /> {option}
            </label>
          ))}
        </fieldset>
      )}
      {page === 3 && (
        <p>
          Ready to create <strong>{name || "Untitled project"}</strong> in {env}.
        </p>
      )}
      <div className="modal-actions">
        {page > 1 ? (
          <button type="button" className="btn" onClick={() => setPage(page - 1)}>
            Back
          </button>
        ) : (
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
        )}
        {page < 3 ? (
          <button type="button" className="btn primary" onClick={() => setPage(page + 1)}>
            Next
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              onCreate(name || "Untitled project", env);
              close();
            }}
          >
            Create project
          </button>
        )}
      </div>
    </dialog>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const project = PROJECTS.find((p) => p.id === id) ?? PROJECTS[0]!;
  return (
    <div>
      <h1>{project.name}</h1>
      <p className="muted">Environment: {project.env}</p>
      <div className="cards">
        <div className="card">
          <h2>Deployments</h2>
          <button type="button" className="btn">
            Redeploy
          </button>
        </div>
        <div className="card">
          <h2>Environment variables</h2>
          <button type="button" className="btn">
            Add variable
          </button>
        </div>
      </div>
    </div>
  );
}

export function Billing() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div>
      <h1>Billing</h1>
      <div className="card">
        <div className="muted">Current plan</div>
        <div className="stat">Team</div>
        <button type="button" className="btn" onClick={() => dialog.current?.showModal()}>
          Manage plan
        </button>
      </div>
      <h2>Invoices</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Sep 1</td>
            <td>$240.00</td>
            <td className="right">
              <button type="button" className="btn small">
                Download
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <dialog ref={dialog} className="modal" aria-labelledby="plan-title">
        <h2 id="plan-title">Choose a plan</h2>
        <div className="plans">
          <button type="button" className="btn">
            Starter
          </button>
          <button type="button" className="btn primary">
            Team
          </button>
          <button type="button" className="btn">
            Enterprise
          </button>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </div>
      </dialog>
    </div>
  );
}

export function GeneralSettings() {
  return (
    <div className="panel">
      <section>
        <h2>Workspace name</h2>
        <input className="input" defaultValue="Acme Inc" aria-label="Workspace name" />
      </section>
      <section>
        <h2>Region</h2>
        <select className="input" aria-label="Region" defaultValue="us-east">
          <option value="us-east">US East</option>
          <option value="eu-west">EU West</option>
          <option value="ap-south">Asia Pacific</option>
        </select>
      </section>
      {/* Filler so the danger zone sits well below the fold. */}
      {Array.from({ length: 6 }, (_, i) => (
        <section key={i}>
          <h2>Preference group {i + 1}</h2>
          <label className="check">
            <input type="checkbox" defaultChecked={i % 2 === 0} /> Email me about this
          </label>
          <p className="muted">These settings apply to everyone in the workspace.</p>
        </section>
      ))}
      <section className="danger-zone">
        <h2>Danger zone</h2>
        <button type="button" className="btn danger">
          Delete organization
        </button>
      </section>
    </div>
  );
}

export function TeamSettings() {
  const [menuOpen, setMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [invited, setInvited] = useState<string[]>([]);
  return (
    <div className="panel">
      <div className="page-head">
        <h2>Members</h2>
        <div className="account">
          <button type="button" className="icon-btn" aria-label="More actions" onClick={() => setMenuOpen((v) => !v)}>
            <Icon name="ellipsis-vertical" />
          </button>
          {menuOpen && (
            <div className="dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  dialog.current?.showModal();
                }}
              >
                Invite member
              </button>
              <button type="button" role="menuitem" onClick={() => setMenuOpen(false)}>
                Export list
              </button>
            </div>
          )}
        </div>
      </div>
      <ul className="members">
        <li>Alex Chen · Owner</li>
        <li>Sam Rivera · Admin</li>
        {invited.map((email) => (
          <li key={email}>{email} · Invited</li>
        ))}
      </ul>
      <dialog ref={dialog} className="modal" aria-labelledby="invite-title">
        <form
          method="dialog"
          onSubmit={(event) => {
            const data = new FormData(event.currentTarget);
            setInvited((list) => [...list, String(data.get("email") || "new member")]);
          }}
        >
          <h2 id="invite-title">Invite member</h2>
          <label className="field">
            Email
            <input name="email" type="email" className="input" placeholder="name@company.com" />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Send invite
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export function OrganizationProfile() {
  return (
    <div>
      <h2>Organization profile</h2>
      <label className="field">
        Display name
        <input className="input" defaultValue="Acme Inc" />
      </label>
      <button type="button" className="btn primary">
        Save
      </button>
    </div>
  );
}

export function DeveloperSettings() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [keys, setKeys] = useState([{ name: "Production", created: "Aug 12" }]);
  const [secret, setSecret] = useState("");
  return (
    <div>
      <h2>API keys</h2>
      <p className="muted">Keys let your servers call the Acme API. Treat them like passwords.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.name}>
              <td>{key.name}</td>
              <td className="muted">{key.created}</td>
              <td className="right">
                <button type="button" className="icon-btn" title="Revoke">
                  <Icon name="trash-2" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn primary" onClick={() => dialog.current?.showModal()}>
        <Icon name="plus" size={16} /> Create key
      </button>
      {secret && (
        <p className="notice">
          New key created. Copy it now, you won't see it again: <code>{secret}</code>
        </p>
      )}

      <h2 className="spaced">Webhooks</h2>
      <p className="muted">Send events to your own endpoint.</p>
      <button type="button" className="btn">
        Add endpoint
      </button>

      <dialog ref={dialog} className="modal" aria-labelledby="key-title">
        <form
          method="dialog"
          onSubmit={(event) => {
            const data = new FormData(event.currentTarget);
            const name = String(data.get("name") || "Untitled key");
            setKeys((list) => [...list, { name, created: "Today" }]);
            setSecret(`sk_live_${Math.random().toString(36).slice(2, 12)}`);
          }}
        >
          <h2 id="key-title">Create API key</h2>
          <label className="field">
            Name
            <input name="name" className="input" placeholder="e.g. CI server" />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Create
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export function SecuritySettings() {
  return (
    <div>
      <h2>Security</h2>
      <label className="check">
        <input type="checkbox" /> Require two-factor authentication
      </label>
    </div>
  );
}

export function Profile() {
  return (
    <div>
      <h1>Profile</h1>
      <label className="field">
        Full name
        <input className="input" defaultValue="Alex Chen" />
      </label>
      <button type="button" className="btn primary">
        Save profile
      </button>
    </div>
  );
}

/** A third-party style widget that renders inside an open shadow root. */
export function defineStatusWidget() {
  if (customElements.get("status-widget")) return;
  customElements.define(
    "status-widget",
    class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = `
          <style>
            div { display: flex; align-items: center; gap: 12px; font: 14px system-ui, sans-serif; }
            button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid #ccd; background: #fff; cursor: pointer; }
          </style>
          <div><span>All systems operational</span><button type="button">Refresh status</button></div>`;
      }
    },
  );
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Acme Console`;
  }, [title]);
}
