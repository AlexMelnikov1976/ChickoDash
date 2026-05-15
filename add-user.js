#!/usr/bin/env node

/**
 * Добавить нового пользователя в KV USERS namespace
 *
 * Usage: node add-user.js <email> [--admin]
 *
 * Examples:
 *   node add-user.js lena_loor@mail.ru
 *   node add-user.js admin@example.com --admin
 */

const { execSync } = require('child_process');

const email = process.argv[2];
const isAdmin = process.argv.includes('--admin');

if (!email || !email.includes('@')) {
  console.error('❌ Usage: node add-user.js <email> [--admin]');
  console.error('');
  console.error('Example:');
  console.error('  node add-user.js lena_loor@mail.ru');
  console.error('  node add-user.js admin@example.com --admin');
  process.exit(1);
}

const userId = email.split('@')[0].replace(/[^a-z0-9._-]/gi, '_');
const userData = JSON.stringify({
  email,
  user_id: userId,
  is_admin: isAdmin,
  created_at: new Date().toISOString(),
});

try {
  console.log(`📝 Adding user: ${email}`);
  console.log(`   user_id: ${userId}`);
  console.log(`   is_admin: ${isAdmin}`);

  const cmd = `npx wrangler kv key put --binding USERS --remote "user:${email}" '${userData}'`;
  execSync(cmd, { stdio: 'inherit' });

  console.log('✅ User added successfully!');
  console.log('');
  console.log(`User can now login at:`);
  console.log(`  https://chicko-api-proxy.chicko-api.workers.dev`);
  console.log(`  Email: ${email}`);
} catch (error) {
  console.error('❌ Error adding user:', error.message);
  process.exit(1);
}
