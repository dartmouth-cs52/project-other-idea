-- Verified routes (issue 13). For a question on a screen, which control was
-- right, so the same question on the same screen can be answered without
-- asking the model.
--
-- A route is learned from the model's answer and trusted once a guide that
-- used it finished. Only a trusted route is ever served, and only when
-- exactly one control on the live page matches it. Every site starts in
-- shadow mode: routes are looked up and compared with the model's answer, so
-- the numbers that decide whether to serve them come from real guides.

create table routes (
  site_id text not null references sites(id) on delete cascade,
  -- The question, as guides.question_key has it: masked, lower case, no punctuation.
  goal_key text not null,
  -- The screen: the normalized path, the open dialog if any, and the control the previous step used ('' on a first step).
  path text not null,
  dialog text not null default '',
  after_key text not null default '',
  -- The control: role, label, icon and link target, masked, as routeKey() in src/server/routes.ts makes it,
  -- and where it sits, such as "nav > Account", which tells apart two controls with the same label.
  target_key text not null,
  target_context text not null default '',
  target_role text not null,
  target_label text not null,
  say text not null,
  status text not null check (status in ('continue', 'done')),
  -- Trusted once a guide that used it finished. Served only while trusted.
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  -- How many finished guides used it, and how many times the model's answer replaced it.
  uses int not null default 0,
  repairs int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, goal_key, path, dialog, after_key)
);

-- off: no lookups. shadow: look up and compare, the model still answers. serve: answer from trusted routes.
alter table sites add column routes_mode text not null default 'shadow' check (routes_mode in ('off', 'shadow', 'serve'));

-- What each step needs to learn and confirm routes, and what the lookup found:
-- miss (no route), unconfirmed (not trusted yet), unmatched (trusted, but not exactly one control on the page matched),
-- agreed or disagreed (shadow: the model chose the same control or not), served (answered from the route).
-- Null when no lookup was made, such as after a wrong click.
alter table steps
  add column target_key text,
  add column after_key text,
  add column dialog text,
  add column route text check (route in ('miss', 'unconfirmed', 'unmatched', 'agreed', 'disagreed', 'served'));
