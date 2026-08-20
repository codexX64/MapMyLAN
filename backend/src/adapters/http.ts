// Small dependency-free HTTP client, able to tolerate a self-signed
// certificate — the case for every local network device — and to keep session
// cookies across calls.

import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  verifyTls?: boolean;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, any>;
  text: string;
  json: <T = any>() => T | null;
}

export class HttpSession {
  private cookies = new Map<string, string>();
  private extra: Record<string, string> = {};

  setHeader(k: string, v: string) { this.extra[k] = v; }
  getCookie(name: string) { return this.cookies.get(name); }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb(setCookie?: string[] | string) {
    if (!setCookie) return;
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const raw of list) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  request(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
    const u = new URL(url);
    const isTls = u.protocol === "https:";
    const payload = opts.body == null ? undefined
      : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(payload ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(payload)) } : {}),
      ...this.extra,
      ...(opts.headers || {}),
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;

    return new Promise((resolve, reject) => {
      const req = (isTls ? https : http).request(
        {
          hostname: u.hostname,
          port: u.port || (isTls ? 443 : 80),
          path: u.pathname + u.search,
          method: opts.method || "GET",
          headers,
          rejectUnauthorized: opts.verifyTls === true,
          timeout: opts.timeoutMs ?? 8000,
        },
        (res) => {
          this.absorb(res.headers["set-cookie"]);
          let text = "";
          res.on("data", (c) => { text += c; });
          res.on("end", () => resolve({
            status: res.statusCode || 0,
            headers: res.headers as any,
            text,
            json: <T,>() => { try { return JSON.parse(text) as T; } catch { return null; } },
          }));
        },
      );
      req.on("timeout", () => { req.destroy(new Error("Request timed out")); });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}
