# F4 — Deploy `xom-appetite-frontend` + provision `xomappetite.xomware.com`

**Status:** Draft (do not execute without explicit approval)
**Owner:** Dominick
**Parent epic:** `docs/features/xom-appetite-rollout/PLAN.md`
**Decision (locked):** Match the existing stack — S3 + CloudFront + ACM + Route53. Same hosting pattern as `xomware.com` (see `xomware-frontend/.github/workflows/deploy-frontend.yml`).

## Goal

Get the Next.js meals frontend live at `https://xomappetite.xomware.com`, fully integrated into the existing AWS-based stack so there's only one deploy story to maintain.

## Constraint: Next.js + S3

The current `meals-frontend` is Next.js 15. **Next.js by default needs a Node.js server runtime** (server components, server actions, ISR, etc.). To deploy to S3 + CloudFront (static hosting), we must:

1. **Configure static export** — set `output: 'export'` in `next.config.ts`. This produces a static `out/` directory. Restrictions:
   - No server components (must be client components or static generation only)
   - No server actions
   - No `app/api/*` routes
   - No middleware
   - `next/image` requires `unoptimized: true`

The current code uses SWR (client-side data fetching) and a single API call to `api.xomware.com` — looks compatible. **Audit needed:** verify no server-only features are in use before committing to this path.

If audit fails, alternatives:
- Switch to Vite + React (loses Next.js, simpler hosting)
- Use Vercel (introduces non-AWS dep — Dominick rejected this)
- Use AWS Amplify Hosting (handles Next.js SSR natively, more AWS surface area)

## Infra additions in `xom-appetite-infrastructure` (post-rename) or `xomware-infrastructure`

**Decision needed:** does the frontend's hosting live in the *app's* infra repo or in the shared `xomware-infrastructure` repo (which presumably owns `xomware.com`)? Looking at convention, `xomware.com` is hosted from S3 bucket `s3://xomware.com` per the workflow above — that lives somewhere. **Action: confirm where `xomware.com`'s CloudFront + Route53 are managed before adding `xomappetite.*`.**

Assuming we add to whichever repo owns the existing `xomware.com` distribution:

### F4.1 — S3 bucket

```hcl
resource "aws_s3_bucket" "xom_appetite_web" {
  bucket = "xomappetite.xomware.com"
}

resource "aws_s3_bucket_public_access_block" "xom_appetite_web" {
  bucket                  = aws_s3_bucket.xom_appetite_web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

CloudFront accesses S3 via Origin Access Control (OAC), not public bucket. Bucket policy grants `cloudfront.amazonaws.com` `s3:GetObject` scoped by source ARN.

### F4.2 — ACM certificate

Must be in **us-east-1** for CloudFront. If `xomware.com` already has a wildcard cert (`*.xomware.com`), reuse it. If not:

```hcl
resource "aws_acm_certificate" "xom_appetite" {
  provider          = aws.us_east_1
  domain_name       = "xomappetite.xomware.com"
  validation_method = "DNS"
}
```

Validation records added to Route53 hosted zone for `xomware.com`.

### F4.3 — CloudFront distribution

```hcl
resource "aws_cloudfront_distribution" "xom_appetite" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = ["xomappetite.xomware.com"]

  origin {
    origin_id                = "s3-xomappetite"
    domain_name              = aws_s3_bucket.xom_appetite_web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.xom_appetite.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-xomappetite"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  # SPA-style 404 → 200 with index.html, for client-side routing
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.xom_appetite.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
}
```

### F4.4 — Route53 record

```hcl
resource "aws_route53_record" "xom_appetite" {
  zone_id = data.aws_route53_zone.xomware.zone_id
  name    = "xomappetite.xomware.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.xom_appetite.domain_name
    zone_id                = aws_cloudfront_distribution.xom_appetite.hosted_zone_id
    evaluate_target_health = false
  }
}
```

Plus an `AAAA` alias record for IPv6.

## Frontend repo work (`meals-frontend` / `xom-appetite-frontend`)

### F4.5 — `next.config.ts`

```ts
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};
```

### F4.6 — Audit for server-only features

```bash
# Run before committing to static export
grep -rn "use server\|app/api\|getServerSideProps\|next/headers" src/
```

If any matches, file fixes per file before proceeding.

### F4.7 — Deploy workflow `.github/workflows/deploy-frontend.yml`

Mirror `xomware-frontend/.github/workflows/deploy-frontend.yml` with these substitutions:

| Field | Value |
|---|---|
| S3 bucket | `xomappetite.xomware.com` |
| Build output dir | `./out` (Next.js static export) |
| Build command | `npm run build` |
| CloudFront alias query | `xomappetite.xomware.com` |
| Invalidation paths | `/` `/index.html` (and any other entry routes the app uses) |

### F4.8 — Env vars in CI

```
NEXT_PUBLIC_API_URL=https://api.xomware.com
NEXT_PUBLIC_AUTH_HASH=<from secret>
```

`NEXT_PUBLIC_AUTH_HASH` is currently the auth model — surfacing it in client-side code means it's visible to anyone who inspects bundle. **Personal app**, so acceptable. Flag for future hardening if it ever goes multi-user.

## xomware.com landing page update

After deploy succeeds, the card status flips from `coming-soon` to `live`:

```diff
- status: 'coming-soon',
+ status: 'live',
```

In `xomware-frontend/src/app/components/landing/landing.component.ts`. Single-line change, ship after sanity check.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Static export incompatibility with Next.js features in use | High | F4.6 audit before any AWS work |
| ACM cert validation hangs (wrong DNS account / hosted zone) | Medium | Confirm Route53 hosted zone for xomware.com is in the same account |
| CloudFront propagation delay (15–40 min) | Low | Just wait |
| `NEXT_PUBLIC_AUTH_HASH` leaked in bundle | Low (personal) | Re-architect to backend session if ever multi-user |

## Suggested sequence (with approval gates)

1. **F4.6 audit** — local only. No risk. **→ approve to continue**
2. **F4.5** — set `output: 'export'`, run `npm run build`, verify `out/` builds and is browseable locally (`npx serve out/`). **→ approve to continue**
3. **Provision AWS** (F4.1–F4.4 in Terraform, plan + apply). **→ approve before apply**
4. **CI workflow** (F4.7–F4.8). Test via `workflow_dispatch`. **→ approve before push to main**
5. **Cutover to live** — flip card status on xomware.com. **→ approve**

## Done when

- [ ] `https://xomappetite.xomware.com` returns the Next.js app
- [ ] Login + meal list fetch works against `api.xomware.com`
- [ ] xomware.com card shows status `live`, click goes to working app
