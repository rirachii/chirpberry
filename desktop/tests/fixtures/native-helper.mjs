import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [log, mode = 'hang-exit'] = process.argv.slice(2);
const record = event => appendFileSync(log, JSON.stringify({ pid: process.pid, ...event }) + '\n');
record({ event: 'started' });
setInterval(() => {}, 1000);
const input = createInterface({ input: process.stdin });
input.on('close', () => {
  record({ event: 'stdin-closed' });
  if (mode === 'late-shortcut') process.stdout.write(JSON.stringify({ event: 'shortcut', action: 1 }) + '\n');
  if (mode === 'graceful') process.exit(0);
});
input.on('line', line => {
  const { id, command, arguments: args } = JSON.parse(line);
  record({ event: 'request', command });
  if (command === 'exit') process.exit(0);
  if (command === 'hang' || mode === 'hang-start' && command === 'audio.start' || mode === 'hang-stop' && command === 'audio.stop') return;
  if (command === 'audio.stop' && mode === 'stop-frame') process.stdout.write(JSON.stringify({ event: 'audio', channel: 'Microphone', pcm: 'AAA=', level: 0 }) + '\n');
  const result = command === 'shortcuts.configure' ? { fn: false, failures: [] } : command === 'calendar.upcoming' ? [] : { pid: process.pid, version: 1 };
  process.stdout.write(JSON.stringify({ id, result }) + '\n');
  if (command === 'shortcuts.configure' && args?.enabled) process.stdout.write(JSON.stringify({ event: 'shortcut', action: 1 }) + '\n');
});
