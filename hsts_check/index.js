#!/usr/bin/env node

/**
 * HSTS Header Checker CLI
 * Checks if a URL sets the Strict-Transport-Security (HSTS) header
 */

const https = require("https");
const http = require("http");
const readline = require("readline");
const { URL } = require("url");

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
};

const c = (color, text) => `${colors[color]}${text}${colors.reset}`;

function parseHSTS(headerValue) {
  if (!headerValue) return null;

  const result = {
    raw: headerValue,
    maxAge: null,
    includeSubDomains: false,
    preload: false,
  };

  const parts = headerValue.split(";").map((p) => p.trim().toLowerCase());

  for (const part of parts) {
    if (part.startsWith("max-age=")) {
      result.maxAge = parseInt(part.split("=")[1], 10);
    } else if (part === "includesubdomains") {
      result.includeSubDomains = true;
    } else if (part === "preload") {
      result.preload = true;
    }
  }

  return result;
}

function formatMaxAge(seconds) {
  if (seconds === null) return c("red", "missing");
  if (seconds === 0) return c("red", "0 (HSTS disabled!)");

  const days = Math.floor(seconds / 86400);
  const years = (seconds / 31536000).toFixed(1);

  let label = "";
  if (days < 30) label = c("yellow", `${days} days — too short`);
  else if (days < 180) label = c("yellow", `${days} days — acceptable`);
  else label = c("green", `${days} days (~${years} years) — good`);

  return `${seconds}s  →  ${label}`;
}

function makeRequest(urlString) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      return reject(new Error(`Invalid URL: "${urlString}"`));
    }

    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "HEAD",
      headers: { "User-Agent": "hsts-checker/1.0" },
      timeout: 8000,
    };

    const req = lib.request(options, (res) => {
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        isHttps,
        finalUrl: urlString,
        redirected: false,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out after 8 seconds"));
    });

    req.on("error", reject);
    req.end();
  });
}

async function checkWithRedirects(urlString, maxRedirects = 5) {
  let currentUrl = urlString;
  const redirectChain = [];

  for (let i = 0; i <= maxRedirects; i++) {
    const result = await makeRequest(currentUrl);

    // Follow redirects
    if ([301, 302, 307, 308].includes(result.statusCode) && result.headers.location) {
      const location = result.headers.location;
      const nextUrl = location.startsWith("http")
        ? location
        : new URL(location, currentUrl).href;

      redirectChain.push({
        from: currentUrl,
        to: nextUrl,
        code: result.statusCode,
        hstsOnRedirect: result.headers["strict-transport-security"] || null,
      });

      currentUrl = nextUrl;
      continue;
    }

    return { ...result, redirectChain, finalUrl: currentUrl };
  }

  throw new Error("Too many redirects (max 5)");
}

function printSeparator() {
  console.log(c("gray", "─".repeat(60)));
}

async function checkUrl(rawInput) {
  // Auto-prepend https:// if no protocol given
  let urlString = rawInput.trim();
  if (!urlString.match(/^https?:\/\//i)) {
    urlString = "https://" + urlString;
    console.log(c("gray", `  → Assuming HTTPS: ${urlString}`));
  }

  console.log();
  console.log(c("bold", `  Checking: ${c("cyan", urlString)}`));
  printSeparator();

  let result;
  try {
    result = await checkWithRedirects(urlString);
  } catch (err) {
    console.log(c("red", `  ✗ Error: ${err.message}\n`));
    return;
  }

  // Redirect chain
  if (result.redirectChain.length > 0) {
    console.log(c("bold", "  Redirect chain:"));
    for (const r of result.redirectChain) {
      const proto = r.from.startsWith("https") ? c("green", "HTTPS") : c("yellow", "HTTP ");
      const arrow = c("gray", "→");
      console.log(`    ${proto}  ${c("gray", r.from)}  ${arrow}  (${r.code})`);
      if (r.hstsOnRedirect) {
        console.log(c("yellow", `         ↳ HSTS set on redirect response: ${r.hstsOnRedirect}`));
      }
    }
    console.log(`    ${result.finalUrl.startsWith("https") ? c("green", "HTTPS") : c("yellow", "HTTP ")}  ${c("gray", result.finalUrl)}  ${c("gray", `(${result.statusCode} final)`)}`);
    console.log();
  }

  // Protocol warning
  if (!result.isHttps) {
    console.log(c("red", "  ⚠  Final URL is HTTP — HSTS only works over HTTPS."));
    console.log(c("red", "     Browsers will NOT enforce HSTS from an HTTP response.\n"));
  }

  // HSTS header
  const hstsRaw = result.headers["strict-transport-security"];
  const hsts = parseHSTS(hstsRaw);

  if (!hsts) {
    console.log(c("red", "  ✗ Strict-Transport-Security header: NOT PRESENT"));
    console.log();
    console.log(c("yellow", "  Impact:"));
    console.log("    • Browser will NOT upgrade future HTTP requests to HTTPS automatically.");
    console.log("    • Users typing the domain without https:// may be served over HTTP.");
    console.log("    • Vulnerable to SSL stripping attacks on first connection.");
    console.log();
  } else {
    console.log(c("green", "  ✓ Strict-Transport-Security header found!\n"));
    console.log(`  ${c("bold", "Raw value:")}  ${c("cyan", hsts.raw)}\n`);

    console.log(`  ${c("bold", "max-age:")}          ${formatMaxAge(hsts.maxAge)}`);
    console.log(
      `  ${c("bold", "includeSubDomains:")} ${
        hsts.includeSubDomains ? c("green", "✓ yes") : c("yellow", "✗ no — subdomains not covered")
      }`
    );
    console.log(
      `  ${c("bold", "preload:")}          ${
        hsts.preload ? c("green", "✓ yes — eligible for browser preload list") : c("gray", "✗ no")
      }`
    );
    console.log();

    // Verdict
    if (hsts.maxAge === 0) {
      console.log(c("red", "  ✗ VERDICT: HSTS is effectively DISABLED (max-age=0 revokes it)."));
    } else if (hsts.maxAge !== null && hsts.maxAge >= 31536000) {
      console.log(c("green", "  ✓ VERDICT: Strong HSTS — future HTTP access will be blocked by browsers."));
    } else if (hsts.maxAge !== null) {
      console.log(c("yellow", "  ~ VERDICT: Weak HSTS — header present but max-age is below recommended 1 year."));
    }

    // Preload eligibility hint
    if (!hsts.preload || !hsts.includeSubDomains || hsts.maxAge < 31536000) {
      console.log();
      console.log(c("gray", "  Preload list requirements (hstspreload.org):"));
      console.log(`    ${hsts.maxAge >= 31536000 ? c("green", "✓") : c("red", "✗")} max-age ≥ 31536000 (1 year)`);
      console.log(`    ${hsts.includeSubDomains ? c("green", "✓") : c("red", "✗")} includeSubDomains`);
      console.log(`    ${hsts.preload ? c("green", "✓") : c("red", "✗")} preload directive`);
    }
    console.log();
  }

  // All response headers (optional detail)
  console.log(c("gray", "  Security-relevant headers:"));
  const secHeaders = [
    "strict-transport-security",
    "content-security-policy",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
  ];
  for (const h of secHeaders) {
    const val = result.headers[h];
    if (val) {
      console.log(`    ${c("gray", h + ":")} ${c("white", val)}`);
    }
  }
  console.log();
}

async function main() {
  console.log();
  console.log(c("bold", c("cyan", "  🔒 HSTS Header Checker")));
  console.log(c("gray", "  Checks if a site sets Strict-Transport-Security"));
  console.log(c("gray", '  Type a URL and press Enter. Type "exit" to quit.\n'));

  // If URL passed as CLI argument, check it and exit
  const argUrl = process.argv[2];
  if (argUrl) {
    await checkUrl(argUrl);
    process.exit(0);
  }

  // Interactive REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c("cyan", "  URL > "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      console.log(c("gray", "\n  Goodbye!\n"));
      rl.close();
      process.exit(0);
    }

    await checkUrl(input);
    printSeparator();
    console.log();
    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
}

main().catch((err) => {
  console.error(c("red", `Fatal: ${err.message}`));
  process.exit(1);
});