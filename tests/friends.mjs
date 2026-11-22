import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const bin = process.env.POCKETBASE_BIN;
assert.ok(bin, 'Set POCKETBASE_BIN to a PocketBase 0.40.6 executable.');
const repo = resolve(import.meta.dirname, '..');
const temp = resolve(tmpdir());
const root = await mkdtemp(join(temp, 'daytrace-friends-'));
const oldMigrations = join(root, 'old-migrations');
const database = join(root, 'data');
await mkdir(oldMigrations);
await copyFile(join(repo, 'pb_migrations/1795100000_diary.js'), join(oldMigrations, '1795100000_diary.js'));
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
listener.close();
await once(listener, 'close');
const url = 'http://127.0.0.1:' + port + '/api/';
let child;
let logs = '';

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill();
  await closed;
}
async function start(migrations) {
  logs = '';
  child = spawn(bin, ['serve', '--http=127.0.0.1:' + port, '--dir=' + database,
    '--migrationsDir=' + migrations, '--hooksDir=' + join(repo, 'pb_hooks'), '--automigrate=false'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => logs += chunk);
  child.on('error', error => { logs += error.message; });
  for (let i = 0; i < 80; i++) {
    if (await fetch(url + 'health').then(r => r.ok).catch(() => false)) return;
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 125));
  }
  throw new Error(logs || 'Test server did not start.');
}
async function api(path, { method = 'GET', body, as, status = 200, binary = false } = {}) {
  const headers = as ? { Authorization: as.token } : {};
  if (body && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url + path, { method, headers, body });
  if (res.status !== status) assert.fail(method + ' ' + path + ': expected ' + status + ', got ' + res.status + ' ' + await res.text());
  if (binary) return Buffer.from(await res.arrayBuffer());
  if (res.headers.get('content-type')?.includes('application/json')) return res.json();
}
const users = 'collections/users/records';
const days = 'collections/diary_days/records';
const atmospheres = 'collections/day_atmospheres/records';
const friends = 'collections/friendships/records';
const share = 'daytrace/';
async function account(name) {
  const values = { email: name + '@example.test', password: 'DayTrace-Test-NotARealAccount-2026' };
  const record = await api(users, { method: 'POST', body: { ...values, passwordConfirm: values.password } });
  const auth = await api('collections/users/auth-with-password', {
    method: 'POST', body: { identity: values.email, password: values.password },
  });
  return { id: record.id, token: auth.token };
}

const secret = 'Только в личной записи';
const entry = { date: '2026-11-22', text: secret, meta: { title: 'Личное название' } };
const palette = ['#123456', '#345678', '#342116', '#b89571', '#e0d4be'];
const fingerprint = { palette, bpm: 89, mood_v: 0.2, mood_e: 0.33, mood_label: 'quiet', weather: { condition: 'rain', temperature: 5 } };
const photo = await readFile(join(repo, 'demo/photos/autumnCocoa.jpg'));
const audio = await readFile(join(repo, 'demo/music/clear-air.mp3'));

try {
  await start(oldMigrations);
  const a = await account('alina'), b = await account('bolat'), c = await account('stranger');
  const files = new FormData();
  files.set('owner', a.id);
  files.set('dayKey', 'legacy-day');
  files.set('entry', JSON.stringify(entry));
  files.append('pictures', new Blob([photo], { type: 'image/jpeg' }), 'p0_photo.jpg');
  files.append('originals', new Blob([photo], { type: 'image/jpeg' }), 'p0_original.jpg');
  files.set('cover', new Blob([photo], { type: 'image/jpeg' }), 'cover.jpg');
  files.set('audio', new Blob([audio], { type: 'audio/mpeg' }), 'track.mp3');
  const day = await api(days, { method: 'POST', as: a, body: files });
  const path = days + '/' + day.id;
  const projection = atmospheres + '/' + day.id;
  await stop();
  await start(join(repo, 'pb_migrations'));

  const invite = await api(share + 'invites', { method: 'POST', as: a, status: 201 });
  const invitation = { token: invite.token };
  await api(share + 'invites/accept', { method: 'POST', body: invitation, status: 401 });
  await api(share + 'invites/accept', { method: 'POST', as: a, body: invitation, status: 400 });
  await api(friends, { method: 'POST', as: b, body: { user_a: a.id, user_b: b.id }, status: 403 });
  const pair = await api(share + 'invites/accept', { method: 'POST', as: b, body: invitation });
  await api(share + 'invites/accept', { method: 'POST', as: c, body: invitation, status: 404 });
  assert.deepEqual(await api(share + 'friends', { as: a }), [{ id: b.id, name: 'bolat', friendship: pair.friendship }]);
  assert.deepEqual(await api(share + 'friends', { as: b }), [{ id: a.id, name: 'alina', friendship: pair.friendship }]);
  assert.equal((await api(path, { as: a })).visibility, 'private');
  await api(path, { as: b, status: 404 });
  await api(projection, { as: b, status: 404 });
  assert.equal((await api(days, { as: b })).items.length, 0);
  const latest = await api(days + '?sort=-entry.date,-entry.created&fields=entry&perPage=1', { as: a });
  assert.equal(latest.items[0].entry.date, entry.date);

  const fileToken = (await api('files/token', { method: 'POST', as: b })).token;
  const assetNames = [day.pictures[0], day.originals[0], day.cover, day.audio];
  const asset = name => 'files/diary_days/' + day.id + '/' + name + '?token=' + encodeURIComponent(fileToken);
  for (const name of assetNames) await api(asset(name), { as: b, status: 404 });
  const change = (visibility, extra = {}) => api(path, { method: 'PATCH', as: a, body: { visibility, ...extra } });
  await change('atmosphere', { atmosphere_input: fingerprint });
  const summary = await api(projection + '?expand=day,owner', { as: b });
  assert.deepEqual(summary.palette, palette);
  assert.equal(summary.bpm, 89);
  assert.equal(summary.mood_label, 'quiet');
  assert.deepEqual(summary.weather_summary, { condition: 'rain', temperature: 5 });
  assert.equal(summary.date, entry.date);
  for (const field of ['entry', 'day', 'pictures', 'originals', 'cover', 'audio']) assert.ok(!(field in summary), field);
  assert.ok(!JSON.stringify(summary).includes(secret));
  assert.equal(summary.expand?.day, undefined);
  const privateFilter = new URLSearchParams({ filter: 'day.entry.text = "' + secret + '"' });
  await api(atmospheres + '?' + privateFilter, { as: b, status: 400 });
  await api(path, { as: b, status: 404 });
  await api(projection, { as: c, status: 404 });
  for (const name of assetNames) await api(asset(name), { as: b, status: 404 });
  await api(projection, { status: 404 });
  await api(projection, { method: 'PATCH', as: b, body: { visibility: 'full' }, status: 403 });

  await change('full');
  assert.equal((await api(path, { as: b })).entry.text, secret);
  await api(path, { method: 'PATCH', as: b, body: { entry }, status: 404 });
  await api(path, { as: c, status: 404 });
  for (const [index, name] of assetNames.entries()) assert.deepEqual(await api(asset(name), { as: b, binary: true }), index === 3 ? audio : photo);

  const heat = share + 'heat/' + day.id;
  await api(heat, { method: 'POST', as: b, body: { kind: 'color', value: palette[0] }, status: 201 });
  assert.deepEqual(await api(heat, { as: a }), [{ name: 'bolat', kind: 'color', value: palette[0] }]);
  await api(heat, { method: 'POST', as: b, body: { kind: 'track', value: 'clear-air' }, status: 201 });
  assert.deepEqual(await api(heat, { as: a }), [{ name: 'bolat', kind: 'track', value: 'clear-air' }]);
  assert.deepEqual(await api(heat, { as: c }), []);
  await api(heat, { method: 'POST', as: c, body: { kind: 'color', value: palette[0] }, status: 404 });
  await api(heat, { method: 'POST', as: b, body: { kind: 'track', value: 'other' }, status: 400 });

  const dirty = { ...fingerprint, palette: [secret], weather: { condition: secret, temperature: secret }, mood_label: secret };
  await change('atmosphere', { atmosphere_input: dirty });
  const sanitized = await api(projection, { as: b });
  assert.equal(sanitized.palette.length, 5);
  assert.ok(!JSON.stringify(sanitized).includes(secret));
  for (const name of assetNames) await api(asset(name), { as: b, status: 404 });
  await change('private');
  await api(projection, { as: b, status: 404 });
  await api(path, { as: b, status: 404 });
  await api(heat, { method: 'POST', as: b, body: { kind: 'color', value: palette[0] }, status: 404 });
  await change('full');
  await api(friends + '/' + pair.friendship, { as: b, method: 'DELETE', status: 204 });
  assert.deepEqual(await api(share + 'friends', { as: a }), []);
  await api(path, { as: b, status: 404 });
  await api(projection, { as: b, status: 404 });
  for (const name of assetNames) await api(asset(name), { as: b, status: 404 });
  console.log('PASS: migration, invitation, visibility, protected files, warmth and revocation.');
} catch (error) {
  console.error(logs.split('\n').slice(-12).join('\n').replace(/token=[^\s]+/g, 'token=[hidden]'));
  throw error;
} finally {
  await stop();
  if (dirname(root) === temp && root.startsWith(join(temp, 'daytrace-friends-'))) await rm(root, { recursive: true, force: true });
}
