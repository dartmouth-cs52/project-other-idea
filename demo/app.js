// Just enough behavior for the demo pages to feel like an app. Nothing is saved.
const $ = (id) => document.getElementById(id);
const say = (id, text) => { if ($(id)) $(id).textContent = text; };

const menu = $("account-menu");
$("account-button").addEventListener("click", (event) => {
  menu.hidden = !menu.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!menu.hidden));
});

$("new-project")?.addEventListener("click", () => $("project-dialog").showModal());
$("project-dialog")?.addEventListener("close", (event) => {
  const dialog = event.currentTarget;
  if (dialog.returnValue !== "create") return;
  const item = document.createElement("li");
  item.textContent = dialog.querySelector("input").value;
  $("projects").append(item);
});

$("edit-payment")?.addEventListener("click", () => $("payment-dialog").showModal());
$("payment-dialog")?.addEventListener("close", (event) => {
  if (event.currentTarget.returnValue === "save") say("billing-result", "Payment method updated.");
});
$("change-plan")?.addEventListener("click", () => say("billing-result", "Plan changes are switched off in this demo."));

$("invite")?.addEventListener("submit", (event) => {
  event.preventDefault();
  say("invite-result", "Invite sent.");
  event.currentTarget.reset();
});
$("general")?.addEventListener("submit", (event) => {
  event.preventDefault();
  say("general-result", "Settings saved.");
});
$("two-factor")?.addEventListener("change", (event) => say("security-result", event.currentTarget.checked ? "Two-factor authentication is now required." : "Two-factor authentication is no longer required."));
$("new-key")?.addEventListener("click", () => {
  const item = document.createElement("li");
  item.textContent = "New key, created just now";
  $("keys").append(item);
  say("security-result", "API key created.");
});
