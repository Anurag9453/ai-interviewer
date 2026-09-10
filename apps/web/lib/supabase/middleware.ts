import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/auth"];

// Manual/E2E verification only — off by default, never set in a real
// deployment. Lets /interview render against the client-side mock session
// without a live Supabase project. Auth for the real (LiveKit-backed)
// interview flow is unaffected; this only widens PUBLIC_PATHS.
if (process.env.NEXT_PUBLIC_E2E_MOCK === "1") PUBLIC_PATHS.push("/interview");

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // Short-circuit before touching Supabase at all — the E2E-mock path has no
  // real project configured, and constructing the client on an empty
  // URL/key throws synchronously.
  if (isPublic) return response;

  // Missing Supabase config used to throw synchronously inside
  // createServerClient (both values were passed with `!`), turning every
  // protected request into an opaque 500. A misconfigured deployment now says
  // so: 503 with the variable names only, and the same JSON-vs-redirect split
  // used for an unauthenticated caller below.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    const missingEnv = [
      ...(supabaseUrl ? [] : ["NEXT_PUBLIC_SUPABASE_URL"]),
      ...(supabaseKey ? [] : ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]),
    ];
    console.error("auth middleware cannot run: Supabase config missing", { missingEnv });
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "auth_not_configured", missingEnv }, { status: 503 });
    }
    return new NextResponse("Service temporarily unavailable", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Required: a response that sets auth cookies must never be cached
          // by a CDN, or one user's token gets served to another.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Must run before any response is generated, or a token refresh that lands
  // after the response is committed is lost and every request re-refreshes.
  // getClaims() validates the JWT signature; getSession() must never be
  // trusted in server code.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn) {
    // An API caller needs a JSON 401, not a redirect. Redirecting a fetch()
    // to /login makes it follow the 307 and receive an HTML page, so the
    // caller's `res.json()` throws and the UI reports a generic network
    // error instead of "your session expired" — reproducible by letting a
    // session lapse and clicking any action.
    //
    // Every /api route already performs its own auth check, so this branch is
    // defence in depth rather than the only gate; it stays in place (instead
    // of excluding /api from the matcher) so a future route that forgets its
    // check still fails closed.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
