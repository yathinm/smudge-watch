# SmudgeWatch

SmudgeWatch monitors official Jellycat and Nordstrom Smudge Monkey listings and
sends deduplicated restock alerts by email.

## Development

Requirements:

- Node.js 22 or newer
- A Cloudflare account for deployment
- A Resend account for email delivery

Install dependencies and run the checks:

```sh
npm install
npm run check
```

Copy `.env.example` to `.env` for local credentials. `.env` and Wrangler secret
files are ignored by Git and must never be committed.
