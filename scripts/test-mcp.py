#!/usr/bin/env python3
"""Exercise the bundled read-only MCP protocol against an isolated notebook."""
import json
from pathlib import Path
import subprocess
import tempfile
import uuid

root = Path(__file__).resolve().parents[1]
binary = root / 'macOS/.build/debug/chirpberry-mcp'
with tempfile.TemporaryDirectory(prefix='chirpberry-mcp-test-') as folder:
    meeting_id = str(uuid.uuid4()).upper()
    document = dict(schemaVersion=1, id=meeting_id, title='Launch across languages',
                    createdAt='2026-09-09T00:00:00Z', updatedAt='2026-09-09T00:00:00Z',
                    notebook='Tests', notes='The launch is Friday.', enhancedNotes='', actions=[], segments=[],
                    speakerNames={}, template='meeting_minutes', targetLanguage='english', vocabulary='',
                    attendees=[], duration=0, isTrashed=False, isPinned=False)
    path = Path(folder) / f'{meeting_id}.json'
    path.write_text(json.dumps(document))
    process = subprocess.Popen([str(binary), '--directory', folder], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    def request(identifier, method, params):
        process.stdin.write(json.dumps(dict(jsonrpc='2.0', id=identifier, method=method, params=params)) + '\n')
        process.stdin.flush()
        response = json.loads(process.stdout.readline())
        assert response['id'] == identifier
        return response['result']
    assert request(1, 'initialize', {'protocolVersion':'2025-06-18'})['protocolVersion'] == '2025-06-18'
    tools = request(2, 'tools/list', {})['tools']
    assert {t['name'] for t in tools} == {'search_meetings', 'get_meeting'}
    assert all(t['annotations']['readOnlyHint'] for t in tools)
    search = request(3, 'tools/call', {'name':'search_meetings','arguments':{'query':'Friday'}})
    assert json.loads(search['content'][0]['text'])[0]['id'] == meeting_id
    assert 'The launch is Friday.' in request(4, 'tools/call', {'name':'get_meeting','arguments':{'id':meeting_id}})['content'][0]['text']
    assert request(5, 'tools/call', {'name':'get_meeting','arguments':{'id':'../../credentials'}})['isError']
    document['isTrashed'] = True; path.write_text(json.dumps(document))
    assert request(6, 'tools/call', {'name':'get_meeting','arguments':{'id':meeting_id}})['isError']
    assert json.loads(request(7, 'tools/call', {'name':'search_meetings','arguments':{'query':''}})['content'][0]['text']) == []
    process.stdin.close(); process.wait(timeout=10)
    assert process.returncode == 0
print('MCP initialization, discovery, search, reads, invalid IDs, and trash boundaries passed.')
