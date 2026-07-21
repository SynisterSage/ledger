import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serverSource = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const mcpSource = await readFile(new URL('./server.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../migrations/091_mcp_oauth_connectivity.sql', import.meta.url), 'utf8');
const workspaceSwitchMigration = await readFile(new URL('../../migrations/093_mcp_workspace_switch_sessions.sql', import.meta.url), 'utf8');

test('MCP OAuth discovery and bearer challenge are backend-owned', () => {
  assert.match(serverSource, /\.well-known\/oauth-protected-resource/);
  assert.match(serverSource, /\.well-known\/oauth-authorization-server/);
  assert.match(serverSource, /\.well-known\/openai-apps-challenge/);
  assert.match(serverSource, /WWW-Authenticate/);
  assert.match(serverSource, /MCP_OAUTH_RESOURCE/);
  assert.match(serverSource, /app\.post\('\/mcp'/);
});

test('MCP OAuth advertises only implemented PKCE and grants', () => {
  assert.match(serverSource, /grant_types_supported: \['authorization_code', 'refresh_token'\]/);
  assert.match(serverSource, /code_challenge_methods_supported: \['S256'\]/);
  assert.match(serverSource, /code_challenge_method/);
  assert.match(serverSource, /grant_type === 'authorization_code'/);
  assert.match(serverSource, /grant_type === 'refresh_token'/);
});

test('OAuth persistence separates clients, codes, access tokens, and refresh tokens', () => {
  for (const table of ['mcp_oauth_clients', 'mcp_oauth_authorization_requests', 'mcp_oauth_authorization_codes', 'mcp_oauth_access_tokens', 'mcp_oauth_refresh_tokens']) assert.match(migration, new RegExp(table));
  assert.match(migration, /code_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /code_challenge_method TEXT NOT NULL CHECK \(code_challenge_method = 'S256'\)/);
});

test('OAuth redirect validation rejects wildcard, fragment, and non-HTTPS production callbacks', () => {
  assert.match(serverSource, /parsed\.hash/);
  assert.match(serverSource, /parsed\.hostname\.includes\('\*'\)/);
  assert.match(serverSource, /parsed\.protocol !== 'https:'/);
  assert.match(serverSource, /localhost/);
});

test('MCP exposes workspace-scoped bounded note search', () => {
  assert.match(mcpSource, /server\.registerTool\('search_notes'/);
  assert.match(mcpSource, /requireScope\('notes:read'\)/);
  assert.match(mcpSource, /queryTable\('notes'/);
  assert.match(mcpSource, /content_html\.ilike/);
  assert.match(mcpSource, /dateFrom/);
  assert.match(mcpSource, /nextCursor/);
  assert.match(mcpSource, /server\.registerTool\('list_notes'/);
});

test('MCP exposes append-only note writing with note scope and concurrency controls', () => {
  assert.match(mcpSource, /server\.registerTool\('append_to_note'/);
  assert.match(mcpSource, /mutation\('append_to_note', 'notes:write'/);
  assert.match(mcpSource, /expectedUpdatedAt/);
  assert.match(mcpSource, /The resulting note is too long/);
  assert.match(mcpSource, /content_html: contentHtml/);
});

test('MCP exposes project metadata reads and explicit project creation', () => {
  assert.match(mcpSource, /server\.registerTool\('get_project'/);
  assert.match(mcpSource, /server\.registerTool\('create_project'/);
  assert.match(mcpSource, /mutation\('create_project', 'projects:write'/);
  assert.match(serverSource, /'projects:write'/);
});

test('MCP workspace switching requires a browser-approved one-time session', () => {
  assert.match(mcpSource, /server\.registerTool\('switch_workspace'/);
  assert.match(serverSource, /createMcpWorkspaceSwitchSession/);
  assert.match(serverSource, /workspace-switches\/.*approve/);
  assert.match(serverSource, /mcp_connection_workspaces.*update/);
  assert.match(workspaceSwitchMigration, /mcp_workspace_switch_sessions/);
  assert.match(workspaceSwitchMigration, /user_code_hash/);
});

test('Ledger workspace context includes bounded planning context', () => {
  assert.match(mcpSource, /recentNotes:/);
  assert.match(mcpSource, /dueToday:/);
  assert.match(mcpSource, /overdueTasks:/);
  assert.match(mcpSource, /nextActions:/);
  assert.match(mcpSource, /upcomingEvents:/);
  assert.match(mcpSource, /hasScope\('notes:read'\)/);
  assert.doesNotMatch(mcpSource, /events', 'id, title, description,/);
});
