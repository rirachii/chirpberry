import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { newMeeting } from '../src/shared/meeting';
test('read-only MCP serves current notes, excludes trash, rejects invalid IDs, and leaves source files unchanged', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-mcp-'));
  const meeting = newMeeting(randomUUID()); meeting.notes = 'Remember the bilingual handoff.';
  const trash = newMeeting(randomUUID()); trash.isTrashed = true; trash.notes = 'Hidden content';
  const contents = JSON.stringify(meeting); await writeFile(path.join(directory, `${meeting.id}.json`), contents); await writeFile(path.join(directory, `${trash.id}.json`), JSON.stringify(trash));
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main/mcp.ts', '--directory', directory], { stdio: 'pipe' });
    const requests = [
      { method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { method: 'tools/call', params: { name: 'search_meetings', arguments: { query: '' } } },
      { method: 'tools/call', params: { name: 'get_meeting', arguments: { id: meeting.id } } },
      { method: 'tools/call', params: { name: 'get_meeting', arguments: { id: '../../private' } } },
      { method: 'tools/call', params: { name: 'get_meeting', arguments: { id: trash.id } } }
    ];
    let output = '', errors = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
    const done = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(errors))); });
    child.stdin.end(requests.map((request, id) => JSON.stringify({ jsonrpc: '2.0', id, ...request })).join('\n') + '\n');
    await done; const values = output.trim().split('\n').map(line => JSON.parse(line).result);
    assert.equal(values[0].capabilities.tools.listChanged, false);
    assert.equal(JSON.parse(values[1].content[0].text).length, 1); assert.match(values[2].content[0].text, /bilingual handoff/);
    assert.equal(values[3].isError, true); assert.equal(values[4].isError, true);
    assert.equal(await readFile(path.join(directory, `${meeting.id}.json`), 'utf8'), contents);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
