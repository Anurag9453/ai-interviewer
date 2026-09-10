import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPublicPath, PUBLIC_PATHS } from "./supabase/middleware.js";
import { PUBLIC_FOOTER_LINKS } from "../components/PublicFooter.js";

/**
 * Coverage for the public (signed-out) surface: /about and /refund-policy.
 *
 * These are server components and the repo has no component-test harness, so
 * "renders" is asserted two ways that don't need one: the route file exists
 * and default-exports a component, and its source contains the content it is
 * supposed to contain. The routing contract — reachable while signed out — is
 * tested against the real middleware predicate.
 */

const APP_DIR = join(import.meta.dirname, "..", "app");
const PAGES = {
  about: join(APP_DIR, "about", "page.tsx"),
  refund: join(APP_DIR, "refund-policy", "page.tsx"),
} as const;

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("/about and /refund-policy route files exist and default-export a component", () => {
  for (const [name, path] of Object.entries(PAGES)) {
    const src = source(path);
    assert.match(src, /export default function/, `${name} must default-export a component`);
  }
});

test("both pages are publicly reachable while signed out", () => {
  // The real predicate the middleware uses — not a copy of the list.
  assert.equal(isPublicPath("/about"), true);
  assert.equal(isPublicPath("/refund-policy"), true);
  assert.ok(PUBLIC_PATHS.includes("/about"));
  assert.ok(PUBLIC_PATHS.includes("/refund-policy"));
});

test("adding the new public pages did not accidentally open a protected route", () => {
  for (const p of ["/dashboard", "/interviews", "/progress", "/billing", "/admin", "/interview/new"]) {
    assert.equal(isPublicPath(p), false, `${p} must still require a session`);
  }
  // A path that merely starts with the same letters must not be public.
  assert.equal(isPublicPath("/aboutus-internal"), false);
  assert.equal(isPublicPath("/refund-policy-admin"), false);
  // Nested paths under a public prefix stay public (e.g. /auth/callback).
  assert.equal(isPublicPath("/auth/callback"), true);
});

test("/interview is NOT public unless the E2E mock flag is set", () => {
  // Guards the one flag that must never be set in production.
  assert.equal(PUBLIC_PATHS.includes("/interview"), false);
  assert.equal(isPublicPath("/interview"), false);
});

test("footer links point at the real routes, and every one is publicly reachable", () => {
  const hrefs = PUBLIC_FOOTER_LINKS.map((l) => l.href);
  assert.ok(hrefs.includes("/about"), `footer missing /about: ${hrefs.join(", ")}`);
  assert.ok(hrefs.includes("/refund-policy"), `footer missing /refund-policy: ${hrefs.join(", ")}`);
  for (const href of hrefs) {
    assert.equal(isPublicPath(href), true, `footer links to ${href}, which is not public`);
  }
  for (const link of PUBLIC_FOOTER_LINKS) {
    assert.ok(link.label.trim().length > 0, "every footer link needs a visible label");
  }
});

test("the footer is rendered on all three public pages", () => {
  for (const path of [join(APP_DIR, "page.tsx"), PAGES.about, PAGES.refund]) {
    assert.match(source(path), /<PublicFooter \/>/, `${path} should render the shared public footer`);
  }
});

test("/about states what the product is, its three interview kinds, and who it's for", () => {
  const src = source(PAGES.about);
  for (const expected of [
    "practise interviews in a realistic, interactive environment", // mission statement
    "Topic-based",
    "Resume-based",
    "Your own material",
  ]) {
    assert.ok(src.includes(expected), `/about should mention: ${expected}`);
  }
  // The required disclaimers.
  assert.match(src, /not a hiring service/i);
  assert.match(src, /AI system/);
});

test("/about makes no guaranteed-outcome or perfect-accuracy claims", () => {
  const src = source(PAGES.about).toLowerCase();
  // Phrases that would be unsupported claims. Checked as phrases, because
  // the page legitimately uses the words "guarantee" and "human-level" while
  // DENYING them ("we can't promise", "don't claim human-level judgement").
  for (const banned of [
    "guaranteed job",
    "guarantee you a job",
    "guaranteed interview success",
    "guaranteed success",
    "100% accurate",
    "100% factual",
    "perfect evaluation",
    "human-level accuracy",
  ]) {
    assert.ok(!src.includes(banned), `/about must not claim: ${banned}`);
  }
});

test("/refund-policy covers every product surface it needs to", () => {
  const src = source(PAGES.refund);
  for (const expected of [
    "Unused purchases",
    "Partially used credit packs",
    "already taken",          // consumed interviews
    "Subscription renewals",
    "Duplicate or accidental charges",
    "Failed payments",
    "Technical failures",
    "top-ups",
    "Promotional",
    "Free trial",
  ]) {
    assert.ok(src.includes(expected), `/refund-policy should cover: ${expected}`);
  }
});

test("/refund-policy carries the draft disclaimer and claims no legal authority", () => {
  const src = source(PAGES.refund);
  assert.match(src, /product policy draft and may be updated/);
  assert.match(src, /not legal advice/);
  assert.match(src, /does not claim\s*\n?\s*compliance/);
});

test("/refund-policy marks unfilled values instead of fabricating them", () => {
  const src = source(PAGES.refund);
  assert.match(src, /TO BE COMPLETED/, "unfilled values must be visibly marked");
  // Things we must never invent. A fabricated support phone number or
  // registered address is worse than an obvious placeholder.
  assert.ok(!/\+\d[\d\s()-]{8,}/.test(src), "must not contain a fabricated phone number");
  assert.ok(!/\b(Pvt\.? Ltd|Private Limited|LLC|Inc\.|GmbH)\b/.test(src), "must not invent a legal entity name");
  assert.ok(!/\bwithin \d+ days\b/i.test(src), "must not state an unverified statutory refund window");
  assert.ok(!/\bgoverned by the laws of\b/i.test(src), "must not invent a governing jurisdiction");
  assert.ok(!/\b(GST|VAT) (is|of|at) \d/i.test(src), "must not invent tax treatment");
});

test("/refund-policy does not promise refunds it cannot honour", () => {
  const src = source(PAGES.refund).toLowerCase();
  assert.ok(!src.includes("full refund at any time"), "must not promise unconditional refunds");
  assert.ok(!src.includes("no questions asked"), "must not promise unconditional refunds");
  // The free trial must never be implied refundable.
  assert.match(source(PAGES.refund), /no cash value/);
});

test("neither public page contains a secret, credential, or internal identifier", () => {
  for (const [name, path] of Object.entries(PAGES)) {
    const src = source(path);
    for (const pattern of [
      /sk-ant-[A-Za-z0-9_-]{10,}/,        // Anthropic key
      /sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/, // Supabase key
      /rzp_(test|live)_[A-Za-z0-9]{6,}/,  // Razorpay key
      /postgres(ql)?:\/\/[^\s"']*:[^\s"']+@/, // DB URL with password
      /eyJ[A-Za-z0-9_-]{15,}\./,          // JWT
      /process\.env\.[A-Z_]*(SECRET|SERVICE_ROLE|API_KEY|DATABASE_URL)/, // secret env read
    ]) {
      assert.ok(!pattern.test(src), `${name} page matched a secret-shaped pattern: ${pattern}`);
    }
    // Neither page should touch the database or auth at all.
    assert.ok(!src.includes("createServiceClient"), `${name} must not use the service-role client`);
    assert.ok(!src.includes("createClient()"), `${name} must not query Supabase`);
  }
});
