---
title: API keys
url: https://help.acme.example/articles/api-keys
updated: 2026-09-08
---

# API keys

An API key lets the Acme command line tool and your own scripts act for your workspace without anyone signing in. You need one to deploy.

API keys are on the Security tab of Settings. To create one:

1. Press the round "A" button at the top right and choose Settings.
2. Press the Security tab.
3. In the API keys section, press Create API key, below the list of keys.

The page shows "API key created." and the key is added to the list as "New key", with when it was created. The list never shows a key's secret value.

The secret is sent once, to the workspace owner's email address, as a link that can be opened one time within 24 hours. After that it cannot be read again by anyone, including Acme support. Keep it somewhere safe, such as a password manager. If you lose it, create another key and update your tools.

A key belongs to the workspace, not to a person or a project. It works for every project in both regions, and it keeps working if the person who was using it leaves the workspace. Keys do not expire, and they are not affected by the two-factor authentication requirement.

A key cannot be switched off from Acme Console. If a key may have been seen by someone outside your team, the owner should write to support and we switch it off, normally within one business day. Create the replacement key first, so that your deploys are not interrupted.
