export const config = { runtime: "edge" };

// Clean base target (remove trailing slash)
const TARGET_ROOT = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// Headers that must be stripped out
const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

/**
 * Build destination URL using native URL parser
 * More reliable than manual string slicing
 */
function resolveDestination(inputUrl) {
  const parsed = new URL(inputUrl);
  return TARGET_ROOT + parsed.pathname + parsed.search;
}

/**
 * Clone headers while filtering unwanted ones
 * Also reconstruct client IP forwarding
 */
function transformHeaders(sourceHeaders) {
  const nextHeaders = new Headers();
  let clientAddress = null;

  for (const [name, value] of sourceHeaders) {
    if (HOP_BY_HOP_HEADERS.has(name) || name.startsWith("x-vercel-")) {
      continue;
    }

    // Capture IP info
    if (name === "x-real-ip") {
      clientAddress = value;
      continue;
    }

    if (name === "x-forwarded-for") {
      clientAddress ||= value;
      continue;
    }

    nextHeaders.set(name, value);
  }

  // Reapply IP if detected
  if (clientAddress) {
    nextHeaders.set("x-forwarded-for", clientAddress);
  }

  return nextHeaders;
}

/**
 * Check if HTTP method supports body
 */
const hasPayload = (method) =>
  method !== "GET" && method !== "HEAD";

/**
 * Main handler
 */
export default async function edgeGateway(req) {
  if (!TARGET_ROOT) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", {
      status: 500,
    });
  }

  try {
    const destination = resolveDestination(req.url);
    const preparedHeaders = transformHeaders(req.headers);
    const method = req.method;

    return await fetch(destination, {
      method,
      headers: preparedHeaders,
      body: hasPayload(method) ? req.body : undefined,
      duplex: "half",
      redirect: "manual",
    });
  } catch (err) {
    // Minimal but useful logging
    console.error("relay error:", err);

    return new Response("Bad Gateway: Tunnel Failed", {
      status: 502,
    });
  }
}
