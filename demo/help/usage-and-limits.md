---
title: Usage and limits
url: https://help.acme.example/articles/usage-and-limits
updated: 2026-10-21
---

# Usage and limits

Your usage for the current month is on the Overview page, in the Usage this month card. It reads, for example, "12,480 requests of 50,000 included." To get there, press Overview in the bar at the top of any page.

A request is one call received by any of your deployed projects. All the projects in a workspace share one total. A request counts whether your project answers it successfully or with an error. Deploys, and anything you do in Acme Console, do not count.

The count is brought up to date about every 10 minutes. It resets to zero on the 1st of each month, at midnight UTC. Requests you did not use are not carried over to the next month.

Each plan includes a number of requests a month, and sets how many projects and people a workspace can have. Starter includes 5,000 requests, 1 project and 2 people. Team includes 50,000 requests, 10 projects and 10 people. Business includes 500,000 requests, 50 projects and 50 people. The owner counts as one of the people.

When a workspace has used all its included requests, further requests are refused with a 429 response until the count resets or the workspace moves to a larger plan. Your projects and settings stay as they are.

The workspace owner gets an email when usage reaches 80% of the included requests, and another at 100%.

Moving to a larger plan raises the limit straight away. Requests already used that month still count. Changing plan is covered in the article Plans and billing.
