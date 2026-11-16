---
title: Deploys
url: https://help.acme.example/articles/deploys
updated: 2026-06-23
---

# Deploys

A deploy puts a new version of a project live. Deploys are started from your own computer or build system with the Acme command line tool, using one of the workspace's API keys. Acme Console shows the result; it has no button for starting a deploy.

On the Overview page, the Latest deploy card names the project that was deployed most recently and says how long ago it went live, for example "storefront-api went live 2 hours ago". The card covers every project in the workspace and counts successful deploys only. Its View projects link opens the Projects page.

A deploy usually takes about 2 minutes. The version that is already live keeps answering requests until the new one is ready, so there is no gap in service.

If a deploy fails, nothing changes: the previous version stays live. The command line tool prints the reason.

Each project runs one deploy at a time. A second deploy to the same project waits until the first has finished.

The workspace owner gets an email for every deploy, successful or failed, giving the project, the result and the time. The time is written in the workspace time zone.

Any teammate who has been given an API key can deploy to any project in the workspace. Deploys do not count as requests, so you can still deploy after the workspace has reached its request limit for the month.

There is no separate way to undo a deploy. To go back to an earlier version, deploy that version again.
