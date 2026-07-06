# AGENTS.md - Portfolio Website

## Project Identity

This repository/folder is the standalone The Trendify AI portfolio/static website.

Project path:

`D:\Turki\Trendify\LocalServer\portfolio`

## Scope Boundary

This project is not:

- n8n Content Factory
- Content Publishing Automation
- Universal Project Builder
- any backend automation workflow repo

Do not use rules from neighboring project folders, and do not modify unrelated projects.

## Main Files

- `index.html`: English homepage and default page.
- `ar.html`: Arabic homepage.
- `contact.html`: English contact page using the backend endpoint and Cloudflare Turnstile.
- `style.css`: shared styling for the website.
- `favicon.svg` and any `assets` or image files: static site assets only.

## Contact Flow

- `contact.html` must submit to `/api/contact`.
- The form method must remain `post`.
- Cloudflare Turnstile must remain present unless the owner explicitly says otherwise.
- FormSubmit must not be reintroduced.
- Do not modify `contact.html` unless the task explicitly targets the contact page.

## Language Structure

- English default page: `index.html`.
- Arabic page: `ar.html`.
- Arabic uses `lang="ar"` and `dir="rtl"`.
- A language switch exists between `index.html` and `ar.html`.
- The contact page remains English for now unless the owner explicitly requests otherwise.

## Design Rules

- Do not redesign unless explicitly asked.
- Preserve the current visual identity.
- Preserve images unless the task explicitly targets images.
- Preserve nav, links, cards, badges/status rows unless the task explicitly targets them.
- Make minimal changes only.

## Git Rules

- Do not commit, push, deploy, or upload unless the owner explicitly authorizes it in the current task.
- Verification tasks must be read-only.
- If committing is authorized, stage only the explicitly approved files.

## Safety Rules

- Do not touch DNS/email setup.
- Do not modify unrelated projects.
- Do not use rules from neighboring project folders.
- If a task conflicts with this file, stop and report the conflict.

## Reporting Rules

Every final report should include:

- Files modified
- Whether `contact.html` was touched
- Whether the backend/contact/Turnstile flow was touched
- Whether FormSubmit is absent
- Whether commit/push/deploy/upload was performed
