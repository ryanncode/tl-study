/**
 * cloudflare-worker.js
 * 
 * Serverless Relay for exchanging GitHub OAuth Web Flow codes for an Access Token.
 * Also acts as a secure API Gateway for Private Cohort Boards, enforcing identity
 * binding and strict path constraints to prevent arbitrary writes.
 */

const ALLOWED_ORIGINS = [
  "https://study.thing.rodeo",
  "https://thing.rodeo",
  "http://localhost:3907"
];

function getCorsHeaders(origin) {
  const isAllowed = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  // In-memory store for basic rate limiting across a single edge node
  rateLimitMap: new Map(),

  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = getCorsHeaders(origin);

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
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // Large maximum limit per 24h window (e.g., 50 authentications)
      if (record.count >= 50) {
        return new Response(JSON.stringify({ error: "Maximum daily authentication limit exceeded." }), { 
          status: 429,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      record.count++;
      record.lastRequest = now;
      this.rateLimitMap.set(ip, record);
    }

    // Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    try {
      // Route: GET /?action=cohort_read
      if (request.method === "GET" && action === "cohort_read") {
        return await this.handleCohortRead(request, url, env, corsHeaders);
      }

      // POST Routes
      if (request.method !== "POST" && request.method !== "PUT") {
        return new Response("Method not allowed.", { status: 405, headers: corsHeaders });
      }

      const body = await request.json();
      const postAction = body.action || action;

      // Route: OAuth Token Exchange
      if (postAction === "oauth") {
        return await this.handleOAuth(body, env, corsHeaders);
      }
      
      // Route: Publish to Cohort
      if (postAction === "cohort_publish") {
        return await this.handleCohortPublish(request, body, env, corsHeaders);
      }

      return new Response("Unknown action.", { status: 400, headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  },

  async handleOAuth(body, env, corsHeaders) {
    if (!body.code) return new Response("Missing 'code'", { status: 400, headers: corsHeaders });
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "TL-Study" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: body.code })
    });
    return new Response(JSON.stringify(await res.json()), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  },

  // AES-GCM Server-Side Encryption Helpers
  async deriveKey(secret) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "PBKDF2" }, false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("tl-study-salt"), iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  },

  async verifyGithubIdentity(authHeader) {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Missing or invalid Authorization header.");
    }
    const res = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": authHeader,
        "User-Agent": "TL-Study-Proxy",
        "Accept": "application/vnd.github.v3+json"
      }
    });
    if (!res.ok) throw new Error("Failed to verify GitHub token.");
    const userData = await res.json();
    if (!userData.login) throw new Error("GitHub token did not return a valid user identity.");
    return userData.login;
  },

  async handleCohortPublish(request, body, env, corsHeaders) {
    if (!env.GITHUB_COHORT_PAT) throw new Error("Server not configured for cohort proxy.");
    if (!env.TARGET_REPO) throw new Error("Server missing TARGET_REPO configuration.");
    
    const username = await this.verifyGithubIdentity(request.headers.get("Authorization"));
    
    let { topic, cohortId, problemId, payload, sha, encryptionMode } = body;
    if (!topic || !problemId) throw new Error("Missing topic or problemId.");
    
    const safeCohortId = cohortId || 'default';
    if (/[^a-zA-Z0-9\-_]/.test(topic) || /[^a-zA-Z0-9\-_]/.test(safeCohortId) || /[^a-zA-Z0-9\-_]/.test(problemId)) {
        throw new Error("Invalid path components.");
    }

    const path = `cohort_data/${topic}/${safeCohortId}/${problemId}/${username}.json`;
    let contentToStore = JSON.stringify(payload);

    if (encryptionMode === "server") {
      const cohortKeyName = safeCohortId ? "KEY_" + safeCohortId.toUpperCase().replace(/[^A-Z0-9]/g, '_') : "COHORT_ENCRYPTION_KEY";
      const secret = env[cohortKeyName] || env.COHORT_ENCRYPTION_KEY;
      if (!secret) throw new Error(`Server encryption key missing for cohort ${safeCohortId}.`);
      
      const key = await this.deriveKey(secret);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(contentToStore);
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, encoded);
      
      // Store as base64 JSON payload
      contentToStore = JSON.stringify({
        encrypted: true,
        iv: btoa(String.fromCharCode(...iv)),
        data: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
      });
    }

    const githubApiUrl = `https://api.github.com/repos/${env.TARGET_REPO}/contents/${path}`;
    const putBody = {
      message: `Cohort publish via proxy for ${username}`,
      content: btoa(unescape(encodeURIComponent(contentToStore)))
    };
    if (sha) putBody.sha = sha;

    const res = await fetch(githubApiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_COHORT_PAT}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TL-Study-Proxy'
      },
      body: JSON.stringify(putBody)
    });

    return new Response(JSON.stringify(await res.json()), {
      status: res.status,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  },

  async handleCohortRead(request, url, env, corsHeaders) {
    if (!env.GITHUB_COHORT_PAT) throw new Error("Server not configured for cohort proxy.");
    if (!env.TARGET_REPO) throw new Error("Server missing TARGET_REPO configuration.");
    
    // Auth is optional for reading public cohorts, but could be strictly required if needed.
    // For now, we enforce strict pathing to neutralize the arbitrary read vulnerability.
    
    const topic = url.searchParams.get("topic");
    const cohortId = url.searchParams.get("cohortId") || "default";
    const problemId = url.searchParams.get("problemId");
    const targetUsername = url.searchParams.get("targetUsername");
    const encryptionMode = url.searchParams.get("encryptionMode");
    
    if (!topic || !problemId) throw new Error("Missing topic or problemId.");
    
    if (/[^a-zA-Z0-9\-_]/.test(topic) || /[^a-zA-Z0-9\-_]/.test(cohortId) || /[^a-zA-Z0-9\-_]/.test(problemId)) {
        throw new Error("Invalid path components.");
    }

    let path = `cohort_data/${topic}/${cohortId}/${problemId}`;
    if (targetUsername) {
        if (/[^a-zA-Z0-9\-_]/.test(targetUsername)) throw new Error("Invalid username format.");
        path += `/${targetUsername}.json`;
    }
    
    const githubApiUrl = `https://api.github.com/repos/${env.TARGET_REPO}/contents/${path}`;
    const res = await fetch(githubApiUrl, {
      headers: {
        'Authorization': `Bearer ${env.GITHUB_COHORT_PAT}`,
        'User-Agent': 'TL-Study-Proxy',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!res.ok) return new Response(JSON.stringify(await res.json()), { status: res.status, headers: { "Content-Type": "application/json", ...corsHeaders } });
    
    const fileData = await res.json();
    
    // If it's a directory listing (array), return it as is
    if (Array.isArray(fileData)) {
       return new Response(JSON.stringify(fileData), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // It's a single file
    let content = decodeURIComponent(escape(atob(fileData.content)));
    
    if (encryptionMode === "server") {
      try {
        const parsed = JSON.parse(content);
        const cohortKeyName = cohortId ? "KEY_" + cohortId.toUpperCase().replace(/[^A-Z0-9]/g, '_') : "COHORT_ENCRYPTION_KEY";
        const secret = env[cohortKeyName] || env.COHORT_ENCRYPTION_KEY;

        if (parsed.encrypted && secret) {
          const key = await this.deriveKey(secret);
          const iv = new Uint8Array(atob(parsed.iv).split("").map(c => c.charCodeAt(0)));
          const data = new Uint8Array(atob(parsed.data).split("").map(c => c.charCodeAt(0)));
          const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data);
          content = new TextDecoder().decode(decrypted);
        }
      } catch (e) {
        // Fallback to raw if decryption fails or not encrypted
      }
    }

    fileData.content = btoa(unescape(encodeURIComponent(content)));
    return new Response(JSON.stringify(fileData), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};
