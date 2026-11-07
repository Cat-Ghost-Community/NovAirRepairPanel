import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { isSameOriginMutation } from "../src/lib/request-security";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "repaid-security-"));
process.env.REPAID_DATA_DIR = directory;
process.env.REPAID_DEMO_MODE = "0";
let db: ReturnType<typeof import("../src/lib/db/schema").getDb>;
let owner: number;
let technician: number;
before(async () => {
  const { getDb } = await import("../src/lib/db/schema");
  const { hashPassword } = await import("../src/lib/auth");
  db = getDb();
  db.prepare("INSERT INTO branches(name,code) VALUES('مرکزی','MAIN')").run();
  owner = Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES('مالک','owner@test.local',?,'owner',1)").run(hashPassword("a-long-test-password")).lastInsertRowid);
  technician = Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES('تکنسین','tech@test.local','invalid','technician',1)").run().lastInsertRowid);
});
after(() => { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("request origin boundary", () => {
  it("rejects invalid and oversized JSON using the actual streamed body", async () => {
    const { readJson } = await import("../src/lib/api");
    for (const body of ["null", "[]", "{broken"]) {
      await assert.rejects(() => readJson(new NextRequest("http://app.test/api/test", { method:"POST", body })), { status:400 });
    }
    await assert.rejects(() => readJson(new NextRequest("http://app.test/api/test", { method:"POST", body:JSON.stringify({value:"x".repeat(1024*1024)}) })), { status:413 });
  });
  it("rejects malformed, null, cross-scheme and cross-origin writes including DELETE", () => {
    for (const origin of ["null", "invalid", "https://evil.test", "https://app.test"]) {
      assert.equal(isSameOriginMutation(new Request("http://app.test/api/test", { method: "DELETE", headers: { origin } })), false);
    }
    assert.equal(isSameOriginMutation(new Request("http://app.test/api/test", { method: "POST", headers: { origin: "http://app.test" } })), true);
    assert.equal(isSameOriginMutation(new Request("http://app.test/api/test", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })), false);
  });
});

describe("authentication and server authorization", () => {
  it("salts new passwords and verifies legacy hashes without breaking existing accounts", async () => {
    const { hashPassword, verifyPassword } = await import("../src/lib/auth");
    const a = hashPassword("test-password");
    assert.notEqual(a, hashPassword("test-password"));
    assert.equal(verifyPassword("test-password", a), true);
    assert.equal(verifyPassword("wrong", a), false);
    const old = crypto.scryptSync("legacy-password", "repaid-static-salt", 32).toString("hex");
    assert.equal(verifyPassword("legacy-password", old), true);
    assert.equal(verifyPassword("legacy-password", "bad-format"), false);
  });
  it("stores token digests and rejects invalid or expired sessions", async () => {
    const { createSession, getSessionByToken, destroySession } = await import("../src/lib/auth");
    const token = createSession(owner);
    assert.equal(db.prepare("SELECT token FROM sessions WHERE token=?").get(token), undefined);
    assert.equal(getSessionByToken(token)?.user.id, owner);
    db.prepare("UPDATE sessions SET expires_at='invalid'").run();
    assert.equal(getSessionByToken(token), null);
    const replacement = createSession(owner);
    destroySession(replacement);
    assert.equal(getSessionByToken(replacement), null);
  });
  it("explicit denial overrides wildcard allow in server and client checks", async () => {
    const { canForUser, effectivePermissions } = await import("../src/lib/auth");
    const { hasPerm } = await import("../src/lib/perms-shared");
    db.prepare("INSERT INTO user_permissions(user_id,perm,effect) VALUES(?,'repairs.*','allow'),(?,'repairs.edit','deny')").run(technician, technician);
    assert.equal(canForUser("technician", "repairs.edit", technician), false);
    assert.equal(hasPerm(effectivePermissions("technician", technician), "repairs.edit"), false);
    assert.equal(canForUser("technician", "repairs.view", technician), true);
  });
  it("limits concurrent attempts using real persisted counters", async () => {
    const { authenticate } = await import("../src/lib/login");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => authenticate("missing@test.local", "incorrect")));
    const statuses = results.map(r => r.status === "rejected" ? r.reason.status : 200);
    assert.equal(statuses.filter(s => s === 401).length, 5);
    assert.equal(statuses.filter(s => s === 429).length, 3);
  });
  it("upgrades legacy credentials after real successful authentication", async () => {
    const { authenticate } = await import("../src/lib/login");
    const { getSessionByToken } = await import("../src/lib/auth");
    const hash = crypto.scryptSync("legacy-password", "repaid-static-salt", 32).toString("hex");
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, owner);
    const token = await authenticate(" OWNER@test.local ", "legacy-password");
    assert.equal(getSessionByToken(token)?.user.id, owner);
    assert.match(String(db.prepare("SELECT password_hash FROM users WHERE id=?").get(owner)?.password_hash), /^scrypt\$/);
  });
  it("prevents regular staff from changing user accounts and permissions", async () => {
    const { createSession } = await import("../src/lib/auth");
    const { POST } = await import("../src/app/api/users/route");
    const response = await POST(new NextRequest("http://app.test/api/users", { method: "POST", headers: { cookie: `repaid_session=${createSession(technician)}`, "content-type": "application/json" }, body: JSON.stringify({ role: "owner" }) }));
    assert.equal(response.status, 403);
  });
  it("rejects invalid monetary values instead of silently replacing them with zero", async () => {
    const { validate } = await import("../src/lib/api");
    for (const value of ["bad", Infinity, NaN, {}, [], 1e30, -1]) assert.throws(() => validate.amount(value));
    assert.equal(validate.amount("1200"), 1200);
  });
  it("requires staff branches, invalidates deactivated sessions and preserves the last active owner", async () => {
    const { POST } = await import("../src/app/api/users/route");
    const { PATCH } = await import("../src/app/api/users/[id]/route");
    const { createSession, getSessionByToken } = await import("../src/lib/auth");
    const cookie = `repaid_session=${createSession(owner)}`;
    const req = (method: string, body: unknown) => new NextRequest("http://app.test/api/users", {method,headers:{cookie,"content-type":"application/json"},body:JSON.stringify(body)});
    const input={name:"کارمند",email:"staff@test.local",password:"staff-password-123",role:"technician"};
    assert.equal((await POST(req("POST",input))).status,400);
    const response=await POST(req("POST",{...input,branch_id:1}));
    assert.equal(response.status,201);
    const {id}=await response.json();
    const staffToken=createSession(id);
    assert.equal((await PATCH(req("PATCH",{is_active:false}),{params:Promise.resolve({id:String(id)})})).status,200);
    assert.equal(getSessionByToken(staffToken),null);
    assert.equal((await PATCH(req("PATCH",{is_active:false}),{params:Promise.resolve({id:String(owner)})})).status,400);
    assert.equal(db.prepare("SELECT is_active FROM users WHERE id=?").get(owner)?.is_active,1);
  });
});

describe("durable credentials and backup", () => {
  it("production readiness requires a canonical origin and secure cookie configuration", async () => {
    const { GET } = await import("../src/app/api/health/ready/route");
    const { sessionCookie } = await import("../src/lib/auth");
    const names = ["NODE_ENV", "APP_ORIGIN", "REPAID_ENCRYPTION_KEY", "REPAID_COOKIE_SECURE"];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    try {
      Object.assign(process.env, {NODE_ENV:"production", APP_ORIGIN:"https://app.test", REPAID_ENCRYPTION_KEY:"a".repeat(64)});
      Reflect.deleteProperty(process.env,"REPAID_COOKIE_SECURE");
      assert.equal((await GET()).status,200);
      assert.equal(sessionCookie("token").secure,true);
      Reflect.deleteProperty(process.env,"APP_ORIGIN");
      assert.equal((await GET()).status,503);
      Object.assign(process.env,{APP_ORIGIN:"https://app.test",REPAID_COOKIE_SECURE:"0"});
      assert.equal((await GET()).status,503);
    } finally {
      for (const name of names) if(previous[name]===undefined) Reflect.deleteProperty(process.env,name); else process.env[name]=previous[name];
    }
  });
  it("encrypts with a private key, preserves text and detects tampering", async () => {
    const { encryptCredential, decryptCredential } = await import("../src/lib/secrets");
    const encrypted = encryptCredential("گذرواژه ۱۲۳ test");
    assert.match(encrypted, /^v2\./);
    assert.equal(decryptCredential(encrypted), "گذرواژه ۱۲۳ test");
    const values = encrypted.split(".");
    values[2] = Buffer.from("tampered").toString("base64");
    assert.throws(() => decryptCredential(values.join(".")));
  });
  it("backs up committed WAL data into an independently valid database", async () => {
    const { verifiedSnapshot } = await import("../src/lib/backup");
    const { DatabaseSync } = await import("node:sqlite");
    db.prepare("INSERT INTO settings(key,value) VALUES('backup-proof','ثبت‌شده')").run();
    const snapshot = await verifiedSnapshot(db);
    const filename = path.join(directory, "restore-test.db");
    fs.writeFileSync(filename, snapshot);
    const restored = new DatabaseSync(filename, { readOnly: true });
    try {
      assert.equal(restored.prepare("SELECT value FROM settings WHERE key='backup-proof'").get()?.value, "ثبت‌شده");
      assert.equal(restored.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    } finally { restored.close(); }
  });
});
