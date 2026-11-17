// A card form built from the real React, Radix and cmdk, the way Northpine's
// card wizard builds it (testbed/src/ui/form.tsx and inputs.tsx): controlled
// inputs, a Radix Select in "popper" position, a Radix Popover holding a cmdk
// list with a search box, Radix radio cards, a checkbox and a switch, tabs,
// and a dropdown menu with a submenu. What React holds is written out in
// #state after every change, so a test reads the app's own state.
import { Command } from "cmdk";
import { Checkbox, DropdownMenu, Popover, RadioGroup, Select, Switch, Tabs } from "radix-ui";
import { useState } from "react";
import { createRoot } from "react-dom/client";

const FIRST = ["Malika", "Maya", "Sam", "Priya", "Jonas", "Aiko", "Tomas", "Lena", "Omar", "Grace", "Ravi", "Chen"];
const LAST = ["Cummerata", "Okafor", "Lindqvist", "Haddad", "Moreau", "Tanaka", "Silva", "Novak"];
const TITLES = ["Finance", "Design", "Sales", "Support"];
const PEOPLE = FIRST.flatMap((first, i) => LAST.map((last, j) => ({ value: `p${i}-${j}`, label: `${first} ${last}`, hint: TITLES[(i + j) % TITLES.length] })));
const INTERVALS = [
  { value: "daily", label: "Per day" },
  { value: "weekly", label: "Per week" },
  { value: "monthly", label: "Per month" },
  { value: "yearly", label: "Per year" },
  { value: "total", label: "Total" },
];

const field = { display: "flex", flexDirection: "column", gap: 4, marginBottom: 14, width: 320 };
const trigger = { display: "flex", justifyContent: "space-between", alignItems: "center", height: 32, padding: "0 10px", border: "1px solid #999", borderRadius: 6, background: "#fff", cursor: "pointer", width: "100%" };
const panel = { background: "#fff", border: "1px solid #ccc", borderRadius: 8, boxShadow: "0 4px 16px #0003", zIndex: 70 };
const item = { padding: "6px 10px", cursor: "pointer", outline: "none" };

function Cardholder({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = PEOPLE.find((p) => p.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" id="holder" role="combobox" aria-expanded={open} aria-label="Cardholder" style={trigger}>
          <span>{current?.label ?? "Search people…"}</span>
          <span aria-hidden="true">⇅</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={{ ...panel, width: 320 }}>
          <Command loop>
            <Command.Input placeholder="Type a name…" style={{ width: "100%", height: 36, border: 0, borderBottom: "1px solid #ddd", padding: "0 10px", boxSizing: "border-box", outline: "none" }} />
            <Command.List style={{ maxHeight: 220, overflowY: "auto", padding: 4 }}>
              <Command.Empty>No matches.</Command.Empty>
              {PEOPLE.map((p) => (
                <Command.Item
                  key={p.value}
                  value={`${p.label} ${p.hint} ${p.value}`}
                  onSelect={() => {
                    onChange(p.value);
                    setOpen(false);
                  }}
                  style={{ ...item, display: "flex", gap: 8 }}
                >
                  <span>{p.label}</span>
                  <span style={{ marginLeft: "auto", color: "#888" }}>{p.hint}</span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function App() {
  const [state, setState] = useState({ who: "me", holder: null, name: "", amount: "", interval: "", lock: false, online: false, tab: "general", country: "", theme: "light", action: "" });
  const set = (key, value) => setState((s) => ({ ...s, [key]: value }));
  return (
    <form onSubmit={(e) => e.preventDefault()} style={{ padding: 8 }}>
      <RadioGroup.Root id="who" value={state.who} onValueChange={(v) => set("who", v)} style={{ display: "flex", gap: 8, marginBottom: 14 }} aria-label="Who is it for">
        {[
          ["me", "For me"],
          ["someone", "For someone else"],
        ].map(([value, label]) => (
          <RadioGroup.Item key={value} id={`who-${value}`} value={value} style={{ padding: 12, border: "1px solid #999", borderRadius: 8, background: "#fff", cursor: "pointer" }}>
            {label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {state.who === "someone" ? (
        <div style={field}>
          <label htmlFor="holder">Cardholder</label>
          <Cardholder value={state.holder} onChange={(v) => set("holder", v)} />
        </div>
      ) : null}
      <div style={field}>
        <label htmlFor="name">Card name</label>
        <input id="name" value={state.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div style={field}>
        <label htmlFor="amount">Spending limit</label>
        <input id="amount" inputMode="decimal" placeholder="0.00" value={state.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} />
      </div>
      <div style={field}>
        <label htmlFor="interval">Resets</label>
        <Select.Root value={state.interval || undefined} onValueChange={(v) => set("interval", v)}>
          <Select.Trigger id="interval" aria-label="Limit interval" style={trigger}>
            <Select.Value placeholder="Pick an interval" />
            <Select.Icon>▾</Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content position="popper" sideOffset={4} style={{ ...panel, minWidth: "var(--radix-select-trigger-width)", maxHeight: 288 }}>
              <Select.Viewport style={{ padding: 4 }}>
                {INTERVALS.map((o) => (
                  <Select.Item key={o.value} value={o.value} style={item}>
                    <Select.ItemText>{o.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>
      <div style={field}>
        <label htmlFor="country">Country</label>
        <select id="country" value={state.country} onChange={(e) => set("country", e.target.value)}>
          <option value="">Pick a country</option>
          <option value="pt">Portugal</option>
          <option value="no">Norway</option>
          <option value="jp">Japan</option>
        </select>
      </div>
      <p style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Checkbox.Root id="lock" checked={state.lock} onCheckedChange={(v) => set("lock", v === true)} style={{ width: 16, height: 16, border: "1px solid #666", borderRadius: 4, background: "#fff", padding: 0 }}>
          <Checkbox.Indicator>✓</Checkbox.Indicator>
        </Checkbox.Root>
        <label htmlFor="lock">Lock to one merchant</label>
      </p>
      <p style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label htmlFor="online">Online payments</label>
        <Switch.Root id="online" checked={state.online} onCheckedChange={(v) => set("online", v)} style={{ width: 36, height: 20, borderRadius: 999, border: 0, background: state.online ? "#36c" : "#bbb", position: "relative" }}>
          <Switch.Thumb style={{ display: "block", width: 16, height: 16, borderRadius: 999, background: "#fff", transform: state.online ? "translateX(18px)" : "translateX(2px)" }} />
        </Switch.Root>
      </p>
      <Tabs.Root value={state.tab} onValueChange={(v) => set("tab", v)}>
        <Tabs.List aria-label="Settings">
          <Tabs.Trigger id="tab-general" value="general">
            General
          </Tabs.Trigger>
          <Tabs.Trigger id="tab-access" value="access">
            Access
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="general">General settings</Tabs.Content>
        <Tabs.Content value="access">Access settings</Tabs.Content>
      </Tabs.Root>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger id="more" style={{ marginTop: 14 }}>
          More
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content sideOffset={4} style={{ ...panel, padding: 4, minWidth: 180 }}>
            <DropdownMenu.Item id="rename" style={item} onSelect={() => set("action", "rename")}>
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger id="theme" style={item}>
                Theme
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent sideOffset={2} style={{ ...panel, padding: 4, minWidth: 140 }}>
                  <DropdownMenu.RadioGroup value={state.theme} onValueChange={(v) => set("theme", v)}>
                    <DropdownMenu.RadioItem id="theme-light" value="light" style={item}>
                      Light
                    </DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem id="theme-dark" value="dark" style={item}>
                      Dark
                    </DropdownMenu.RadioItem>
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Item id="duplicate" style={item} onSelect={() => set("action", "duplicate")}>
              Duplicate
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <pre id="state">{JSON.stringify(state)}</pre>
    </form>
  );
}

const root = document.createElement("div");
root.id = "root";
document.body.append(root);
createRoot(root).render(<App />);
