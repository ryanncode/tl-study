/**
 * cloudflare-worker.js
 * 
 * Serverless Relay for exchanging GitHub OAuth Web Flow codes for an Access Token.
 * This secures the CLIENT_SECRET in the Cloudflare environment rather than exposing it to the browser.
 * 
 * Setup in Cloudflare Workers:
 * 1. Set environment variable: GITHUB_CLIENT_ID
 * 2. Set environment variable: GITHUB_CLIENT_SECRET
 */

export default {
  // In-memory store for basic rate limiting across a single edge node
  rateLimitMap: new Map(),

  async fetch(request, env, ctx) {
    // Basic Spam Prevention (Rate Limiting)
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    
    if (ip !== "unknown" && request.method === "POST") {
      const record = this.rateLimitMap.get(ip) || { count: 0, lastRequest: 0, firstRequest: now };
      
      // Reset if it's been more than 24 hours since their first request
      if (now - record.firstRequest > 86400000) {
        record.count = 0;
        record.firstRequest = now;
      }

      // Increasing timeout: 2 seconds per previous request, max 30 seconds
      const timeoutNeeded = Math.min(record.count * 2000, 30000); 
      const timeSinceLast = now - record.lastRequest;

      if (timeSinceLast < timeoutNeeded) {
        return new Response(JSON.stringify({ error: `Rate limit exceeded. Please wait ${Math.ceil((timeoutNeeded - timeSinceLast) / 1000)} seconds.` }), { 
          status: 429,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // Large maximum limit per 24h window (e.g., 50 authentications)
      if (record.count >= 50) {
        return new Response(JSON.stringify({ error: "Maximum daily authentication limit exceeded." }), { 
          status: 429,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      record.count++;
      record.lastRequest = now;
      this.rateLimitMap.set(ip, record);
    }

    // Handle CORS Preflight (OPTIONS request)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Only POST requests are allowed.", { status: 405 });
    }

    try {
      const { code } = await request.json();

      if (!code) {
        return new Response("Missing 'code' parameter.", { status: 400 });
      }

      // Exchange the code for an access token
      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "TL-Study-Serverless-Relay"
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: code
        })
      });

      const tokenData = await tokenResponse.json();

      // Return the token to the frontend with CORS headers
      return new Response(JSON.stringify(tokenData), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
};
