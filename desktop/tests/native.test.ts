import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MacAudioInput, NativeBridge } from '../src/main/native';

async function helper(t: TestContext, mode = 'hang-exit', recoverAfterFailure = false) {
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(path.resolve('test-results/native-lifecycle-'));
  const log = path.join(directory, 'helper.jsonl');
  const bridge = new NativeBridge(process.execPath, [path.resolve('tests/fixtures/native-helper.mjs'), log, mode], 150, recoverAfterFailure);
  t.after(async () => { await bridge.destroy(); await rm(directory, { recursive: true, force: true }); });
  const events = async (): Promise<{ pid: number; event: string; command?: string }[]> => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const waitFor = async (command: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const request = (await events()).find(event => event.command === command);
      if (request) return request.pid;
      await delay(10);
    }
    assert.fail(`Synthetic helper did not receive ${command}`);
  };
  return { bridge, events, waitFor };
}
function assertExited(pid: number) {
  assert.throws(() => process.kill(pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
}

test('destroy waits for a hung child to exit and remains terminal and idempotent', async t => {
  const { bridge, events } = await helper(t);
  const { pid } = await bridge.request<{ pid: number }>('ping');
  const started = performance.now();
  const first = bridge.destroy();
  assert.equal(bridge.destroy(), first);
  let finished = false; void first.then(() => { finished = true; });
  await delay(20);
  assert.equal(finished, false);
  assert.doesNotThrow(() => process.kill(pid, 0));
  await first;
  assertExited(pid);
  assert.ok(performance.now() - started < 3000);
  await assert.rejects(bridge.request('audio.stop'), /closed/);
  assert.equal((await events()).filter(event => event.event === 'started').length, 1);
  assert.ok((await events()).some(event => event.event === 'stdin-closed'));
});

test('request timeout teardown remains awaitable until the real helper exits', async t => {
  const { bridge } = await helper(t);
  const { pid } = await bridge.request<{ pid: number }>('ping');
  await assert.rejects(bridge.request('hang', {}, 30), /timed out/);
  await bridge.destroy();
  assertExited(pid);
});

test('integration retry after a permission timeout waits for teardown and uses one new helper', async t => {
  const { bridge, events } = await helper(t, 'hang-exit', true);
  const first = await bridge.request<{ pid: number }>('ping');
  await assert.rejects(bridge.request('hang', {}, 30), /timed out/);
  const retried = await Promise.all([bridge.request<{ pid: number }>('ping'), bridge.request<{ pid: number }>('ping')]);
  assertExited(first.pid);
  assert.notEqual(retried[0].pid, first.pid);
  assert.equal(retried[0].pid, retried[1].pid);
  assert.equal((await events()).filter(event => event.event === 'started').length, 2);
  assert.equal((await events()).filter(event => event.command === 'hang').length, 1, 'A timed-out command must not be replayed');
  await bridge.destroy();
  await assert.rejects(bridge.request('ping'), /closed/);
  assertExited(retried[0].pid);
});

test('app shutdown during a recovery wait prevents a replacement helper from starting', async t => {
  const { bridge, events } = await helper(t, 'hang-exit', true);
  const { pid } = await bridge.request<{ pid: number }>('ping');
  await assert.rejects(bridge.request('hang', {}, 30), /timed out/);
  const retry = bridge.request('ping');
  const rejected = assert.rejects(retry, /closed/);
  await Promise.all([bridge.destroy(), rejected]);
  assertExited(pid);
  assert.equal((await events()).filter(event => event.event === 'started').length, 1);
});

test('a retiring integration helper cannot emit a late shortcut that starts recording', async t => {
  const { bridge } = await helper(t, 'late-shortcut', true);
  let shortcuts = 0; bridge.on('shortcut', () => shortcuts++);
  await bridge.request('ping');
  await assert.rejects(bridge.request('hang', {}, 30), /timed out/);
  await bridge.request('ping');
  assert.equal(shortcuts, 0);
});

test('aborting a permission-like start retains teardown for concurrent stop callers', async t => {
  const { bridge, waitFor, events } = await helper(t, 'hang-start');
  const input = new MacAudioInput(process.execPath, () => bridge), abort = new AbortController();
  const starting = input.start(false, () => assert.fail('Synthetic helper sent audio'), () => assert.fail('Cancellation reported a capture failure'), abort.signal);
  const rejected = assert.rejects(starting, /stopped/);
  const pid = await waitFor('audio.start');
  abort.abort();
  const stopping = input.stop();
  assert.equal(input.stop(), stopping);
  let stopped = false; void stopping.then(() => { stopped = true; });
  await delay(20); assert.equal(stopped, false);
  await Promise.all([rejected, stopping]);
  assertExited(pid);
  assert.equal((await events()).filter(event => event.event === 'started').length, 1);
  assert.equal((await events()).some(event => event.command === 'audio.stop'), false);
});

test('a timed-out native stop kills and awaits its helper before rejecting', async t => {
  const { bridge, events } = await helper(t, 'hang-stop');
  const input = new MacAudioInput(process.execPath, () => bridge);
  await input.start(false, () => {}, () => {}, new AbortController().signal);
  const { pid } = await bridge.request<{ pid: number }>('ping');
  await assert.rejects(input.stop(), /timed out/);
  assertExited(pid);
  assert.equal((await events()).filter(event => event.command === 'audio.stop').length, 1);
});

test('stopping an input after its helper exits never spawns a replacement', async t => {
  const { bridge, events } = await helper(t);
  const input = new MacAudioInput(process.execPath, () => bridge);
  await input.start(false, () => {}, () => {}, new AbortController().signal);
  const { pid } = await bridge.request<{ pid: number }>('ping');
  await assert.rejects(bridge.request('exit'), /stopped/);
  await input.stop();
  assertExited(pid);
  assert.equal((await events()).filter(event => event.event === 'started').length, 1);
});

test('graceful child exit and failed spawn settle shutdown without a force-kill delay', async t => {
  const { bridge } = await helper(t, 'graceful');
  const { pid } = await bridge.request<{ pid: number }>('ping');
  await bridge.destroy(); assertExited(pid);
  const missing = new NativeBridge(path.resolve('test-results/nonexistent-helper'));
  await assert.rejects(missing.request('ping'), /stopped/);
  await missing.destroy();
});
