# Tightening security for user accounts (Cinematch / Cinemastro)

Notes for **reducing abuse** and **duplicate accounts** (one person, many logins) used to inflate or skew ratings. This is a **product + engineering** roadmap, not legal advice.

---

## Goal

- Make **casual** multi-account rating **more expensive** (time, friction, cost).
- Accept that **determined** attackers cannot be stopped 100% without a **strong identity anchor** (verified phone, government ID, paid instrument, etc.).

---

## Likely direction (team preference)

1. **Sign in with Apple** and/or **Sign in with Google** (OAuth via **Supabase Auth**).
   - Many users have a **primary** Apple or Google account; creating extras is more annoying than new throwaway emails.
   - Configure providers in Supabase Dashboard; wire the client to `signInWithOAuth` / deep-link or PKCE return URL as per Supabase docs.

2. **CAPTCHA** on **account creation** (or first sensitive action), especially if **email/password** remains available.
   - Examples: **Cloudflare Turnstile**, **hCaptcha**, **reCAPTCHA** — pick one, gate the signup or “create account” submit path.
   - Helps with **automated** signups; less help against a human making two OAuth accounts.

3. **Optional later: phone verification (SMS OTP)** via **Supabase Auth Phone** + an SMS provider (e.g. Twilio).
   - Stronger **one-person** binding than email alone; adds **cost**, **deliverability**, and **compliance** (transactional OTP vs marketing SMS).

---

## Layers that help even without phone

| Layer | What it does |
|--------|----------------|
| **Verified email** | One account per verified inbox; weak vs disposable email and `+` aliases. |
| **OAuth (Apple / Google)** | Raises bar vs unlimited free email signups. |
| **CAPTCHA** | Blocks scripted signups. |
| **Rate limits** | Per IP / per device fingerprint (soft); cap signups or burst ratings from new accounts. |
| **Account age / trust weighting** | New accounts count less in aggregates until history exists (ties to **Bayesian** / trust tiers on the backlog). |
| **Behavioral review** | Flag clusters (many new accounts, same subnet, same targets); manual or automated review. |
| **ToS** | One person → one account; right to merge or close duplicates. |

---

## Duplicate ratings: what we’re really defending

- **Global** title scores vs **circle-only** averages may need **different** strictness (circles are smaller; abuse hurts more per capita).
- Decide whether **OAuth-only** signup is required for new users, or **OAuth + email** with CAPTCHA on both paths.

---

## Implementation checklist (when building)

- [ ] Enable **Google** / **Apple** in Supabase Auth; set redirect URLs for prod and preview (Vercel).
- [ ] Add **CAPTCHA** to the signup flow (server-side verify token where the provider requires it).
- [ ] Review **email/password** policy: keep, hide, or require CAPTCHA + email verify only.
- [ ] Document **privacy** copy: what we collect (OAuth profile, optional phone) and why.
- [ ] (Optional) **Phone** provider + Supabase Phone auth + UX for “Verify phone” in Profile.

---

## References in-repo

- Session priorities: **`HANDOFF.md`** (What’s next).
- Passdown snapshot: **`PASSDOWN-NEXT-CHAT.md`**.

*Last updated: 2026-04-20*
