import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { csrfProtection } from "./csrf";
import { lireCookies, extraireJeton, SESSION_COOKIE, CSRF_COOKIE } from "./auth";

function fakeReq(method: string, cookie?: string, csrfHeader?: string): Request {
  return {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(csrfHeader ? { "x-csrf-token": csrfHeader } : {}),
    },
  } as unknown as Request;
}

function fakeRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res as Response & { statusCode: number };
}

describe("csrfProtection", () => {
  it("lets safe methods through", () => {
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(fakeReq("GET", `${SESSION_COOKIE}=abc`), fakeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("lets requests through when there is no session cookie (Bearer/API)", () => {
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(fakeReq("POST"), fakeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks a state change when the CSRF header is missing", () => {
    const next = vi.fn() as unknown as NextFunction;
    const res = fakeRes();
    csrfProtection(fakeReq("POST", `${SESSION_COOKIE}=s; ${CSRF_COOKIE}=tok`), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("blocks a state change when the CSRF header does not match", () => {
    const next = vi.fn() as unknown as NextFunction;
    const res = fakeRes();
    csrfProtection(fakeReq("POST", `${SESSION_COOKIE}=s; ${CSRF_COOKIE}=tok`, "wrong"), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("allows a state change when the CSRF header matches the cookie", () => {
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(fakeReq("POST", `${SESSION_COOKIE}=s; ${CSRF_COOKIE}=tok`, "tok"), fakeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("cookie helpers", () => {
  it("parses a cookie header", () => {
    expect(lireCookies({ headers: { cookie: "a=1; mapmylan_session=JWT; b=2" } } as any))
      .toMatchObject({ a: "1", mapmylan_session: "JWT", b: "2" });
  });

  it("prefers the session cookie over a Bearer header", () => {
    const req = { headers: { cookie: `${SESSION_COOKIE}=fromCookie`, authorization: "Bearer fromHeader" } } as any;
    expect(extraireJeton(req)).toBe("fromCookie");
  });

  it("falls back to the Bearer header when no cookie is present", () => {
    const req = { headers: { authorization: "Bearer fromHeader" } } as any;
    expect(extraireJeton(req)).toBe("fromHeader");
  });

  it("returns null when neither is present", () => {
    expect(extraireJeton({ headers: {} } as any)).toBeNull();
  });
});
