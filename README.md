# The Trendify AI Portfolio

A lightweight public portfolio for **The Trendify AI**.

## Purpose

This repository hosts a simple editorial-style landing page that introduces The Trendify AI, its work areas, and its current focus while the full platform is being prepared.

## Focus areas

- AI automation systems
- Content publishing workflows
- E-commerce intelligence tools
- Digital products and templates
- Writing and research
- Governed project building

## Custom domain

```text
www.thetrendifyai.com
```

## Deployment

This site is intended to run as a static portfolio with a Vercel serverless contact endpoint at:

```text
/api/contact
```

The production contact endpoint is implemented in:

```text
api/contact.js
```

The contact form uses Cloudflare Turnstile for bot verification and Upstash Redis REST for persistent short-term rate limiting.

Required environment variables:

```text
CONTACT_FORM_WEBHOOK_URL
TURNSTILE_SECRET_KEY
REDIS_HOST
REDIS_PORT
```

`CONTACT_FORM_WEBHOOK_TOKEN` is optional and should only be set when the receiving webhook requires bearer-token authentication.

Optional environment variables:

```text
CONTACT_FORM_WEBHOOK_TOKEN
CONTACT_RATE_LIMIT_WINDOW_SECONDS
CONTACT_RATE_LIMIT_MAX_ATTEMPTS
CONTACT_RATE_LIMIT_BLOCK_SECONDS
```

Default rate limiting policy:

```text
CONTACT_RATE_LIMIT_WINDOW_SECONDS=600
CONTACT_RATE_LIMIT_MAX_ATTEMPTS=5
CONTACT_RATE_LIMIT_BLOCK_SECONDS=600
```

`contact.html` contains the public Turnstile site-key placeholder:

```text
REPLACE_WITH_TURNSTILE_SITE_KEY
```

Replace that placeholder with the public Turnstile site key from Cloudflare. Do not put `TURNSTILE_SECRET_KEY` or any other secret in `contact.html`, and do not commit real secret values.

Local static preview can show the pages, but it does not fully test `/api/contact` unless the site is run with Vercel local tooling or a compatible serverless environment.

GitHub Pages alone cannot run `/api/contact` or any Node/serverless backend. If the site is deployed to GitHub Pages only, the contact form backend will not work.

`server.js` remains a local legacy prototype/reference. Production contact delivery should use `api/contact.js`.

The endpoint keeps the honeypot and validation checks, verifies Turnstile server-side, and uses Upstash Redis REST to reduce public-form abuse. This is practical spam reduction for a public contact form, not a full enterprise bot-management system.
