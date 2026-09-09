import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
test('Both download links reference the same versioned release and filename',()=>{
  const urls=[...html.matchAll(/href="([^"]+\.dmg)"/g)].map(m=>m[1]);
  assert.equal(urls.length,2);assert.equal(new Set(urls).size,1);
  assert.equal(urls[0],'https://github.com/rirachii/chirpberry/releases/download/v0.1.0/Chirpberry-0.1.0-macOS-arm64.dmg');
  assert.equal([...html.matchAll(/download="Chirpberry-0\.1\.0-macOS-arm64\.dmg"/g)].length,2);
});
test('Installation requirements are visible without client-side JavaScript',()=>{
  assert.equal([...html.matchAll(/brew install --cask rirachii\/tap\/chirpberry/g)].length,2);
  for(const text of ['macOS 26+','Apple Silicon','not notarized by Apple','Valsea API key and credits required']) assert.ok(html.includes(text));
});
test('Page landmarks and local hash destinations exist',()=>{
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  for(const [,hash]of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.has(hash),hash);
  assert.equal([...html.matchAll(/<h1\b/g)].length,1);
  assert.ok(html.includes('<main id="main">'));
});
