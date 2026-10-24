const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * The library routes all sit on Postgres. A deploy without `DATABASE_URL` is a
 * supported configuration — the browser keeps the library in localStorage — so
 * those routes must answer normally instead of throwing a 503 at the page.
 */
const LIBRARY_ROUTES = [
  'src/app/api/playlists/route.ts',
  'src/app/api/playlists/[id]/route.ts',
  'src/app/api/downloads/route.ts',
  'src/app/api/library/liked/route.ts',
  'src/app/api/library/recent/route.ts',
  'src/app/api/library/followed/route.ts',
  'src/app/api/library/blocked/route.ts',
  'src/app/api/library/restore/route.ts',
];

test('no library route answers 503 when the database is simply not configured', () => {
  for (const route of LIBRARY_ROUTES) {
    const source = read(route);
    assert.doesNotMatch(
      source,
      /"Database not configured"/,
      `${route} still reports a missing database as an error`
    );
  }
});

test('every library route goes through the shared database helpers', () => {
  for (const route of LIBRARY_ROUTES) {
    const source = read(route);
    assert.match(
      source,
      /from "@\/lib\/dbResponses"/,
      `${route} does not use the shared database helpers`
    );
    assert.doesNotMatch(
      source,
      /hasDatabaseUrl/,
      `${route} still checks for a database itself instead of using the helper`
    );
  }
});

test('the shared helper answers 200 with the empty collection, not an error', () => {
  const helper = read('src/lib/dbResponses.ts');
  assert.match(helper, /export function databaseNotConfigured/);
  // The empty answer is a normal 200 — that is what stops the browser from
  // treating the app's backend as down.
  assert.match(helper, /status: 200/);
  assert.match(helper, /export async function withDatabase\b/);
  assert.match(helper, /export async function withDatabaseWrite\b/);
  // A database that is configured but broken is still a real outage.
  assert.match(helper, /export function databaseUnavailable/);
  assert.match(helper, /status: 503/);
});

test('a server that answers with an error status does not mark the backend down', () => {
  const client = read('src/lib/clientApi.ts');
  // The transport only reports "down" when there is no response at all.
  assert.match(client, /class ApiError/);
  assert.match(client, /if \(error instanceof ApiError\) return null;/);
  // Both the read and the write path keep the distinction.
  const occurrences = client.match(/if \(error instanceof ApiError\) return null;/g) || [];
  assert.equal(occurrences.length, 2, 'both get() and send() must keep the distinction');
});

test('the local library still wins when the server has nothing to add', () => {
  const local = read('src/lib/localLibrary.ts');
  assert.match(local, /export function mergeLiked/);
  assert.match(local, /export function mergePlaylists/);
  assert.match(local, /export function mergeBlocked/);
  assert.match(local, /export function mergeFollowed/);
});
