#!/usr/bin/env node
// Create or update a teacher/admin account from the command line.
// Usage:
//   npm run admin:create -- --email you@school.at --name "Your Name" --password "at-least-10-chars"
//   npm run admin:create -- --email t@school.at --name "T" --password "..." --role teacher
import process from 'node:process';
import { initDb, run } from '../server/db.js';
import { createUser, findUserByEmail, hashPassword } from '../server/lib/auth.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function usage() {
  console.log(`Usage: node scripts/create-admin.mjs --email <email> --name <name> --password <min 10 chars> [--role admin|teacher]

If the email already exists, its password/role are updated (useful for password resets).`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const email = String(args.email || process.env.ADMIN_EMAIL || '').trim();
const password = String(args.password || process.env.ADMIN_PASSWORD || '');
const name = String(args.name || process.env.ADMIN_NAME || 'Administrator').trim();
const role = args.role === 'teacher' ? 'teacher' : 'admin';

if (!email || !password) {
  usage();
  process.exit(1);
}

initDb();

try {
  const existing = findUserByEmail(email);
  if (existing) {
    run(
      'UPDATE users SET password_hash = ?, role = ?, name = COALESCE(?, name), disabled = 0 WHERE id = ?',
      hashPassword(password),
      role,
      args.name ? name : null,
      existing.id,
    );
    console.log(`Updated existing account: ${email} (role: ${role})`);
  } else {
    const user = createUser({ email, name, role, password });
    console.log(`Created ${role} account: ${user.email} (${user.name})`);
  }
} catch (err) {
  console.error(`Could not create account: ${err.message}`);
  if (err.message === 'weak_password') console.error('Password must be at least 10 characters.');
  if (err.message === 'invalid_email') console.error('Please provide a valid email address.');
  process.exitCode = 1;
}
