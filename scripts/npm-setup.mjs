/** npm legacy account bootstrap — password is generated in-process, written ONLY to a
 *  local file, never printed to stdout (filtered), never sent to chat. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const USERNAME = process.env.NPM_USER;
const EMAIL = process.env.NPM_EMAIL;
const PW_FILE = process.env.NPM_PW_FILE;
if (!USERNAME || !EMAIL || !PW_FILE) { console.log("missing env"); process.exit(2); }

const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*";
let pw = "";
const bytes = randomBytes(24);
for (let i = 0; i < 24; i++) pw += alphabet[bytes[i] % alphabet.length];
writeFileSync(PW_FILE, pw, "utf8");

const child = spawn("npm.cmd", ["adduser", "--auth-type=legacy", "--registry=https://registry.npmjs.org"], { shell: true });
const feed = (chunk) => {
  const s = chunk.toString();
  if (/Username:/i.test(s)) child.stdin.write(USERNAME + "\n");
  else if (/Password:/i.test(s)) child.stdin.write(pw + "\n");
  else if (/Email/i.test(s)) child.stdin.write(EMAIL + "\n");
  else if (/npm error|npm warn|logged in|success/i.test(s)) {
    process.stdout.write(s.split(/\r?\n/).map((l) => (l.includes(pw) ? l.replaceAll(pw, "***") : l)).join("\n"));
  }
};
child.stdout.on("data", feed);
child.stderr.on("data", feed);
child.on("close", (code) => { console.log("EXIT=" + code); process.exit(code ?? 1); });
setTimeout(() => { child.kill(); console.log("EXIT=timeout"); process.exit(3); }, 45000);
