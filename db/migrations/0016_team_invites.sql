-- The dashboard's Team page (web/worker/team.ts): an owner or admin adds
-- someone by approving their address for the company, and the approval is
-- the invitation. Their first sign-in puts them in the organization as a
-- member, as for anyone approved (joinOrganization in web/worker/db.ts).
--
-- invited_by is the Neon Auth user who added them. It sets an invite apart
-- from the approvals the team made from access requests: only an invite can
-- be taken back from the Team page, and invites are what the daily limit on
-- adding people counts.
alter table approvals add column invited_by text;
create index approvals_organization on approvals (organization_id);
