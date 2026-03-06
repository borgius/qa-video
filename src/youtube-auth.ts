import { google } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createServer, IncomingMessage, ServerResponse } from 'http';

const CONFIG_DIR = join(homedir(), '.qa-video');
const CREDENTIALS_PATH = join(CONFIG_DIR, 'client_secret.json');
const TOKENS_PATH = join(CONFIG_DIR, 'tokens.json');
const SCOPES = [
  'https://www.googleapis.com/auth/youtube',  // full access: upload, read, update tags
];
const REDIRECT_PORT = 3000;

async function loadCredentials(credentialsPath?: string): Promise<{ clientId: string; clientSecret: string }> {
  const credsPath = credentialsPath ?? CREDENTIALS_PATH;

  if (!existsSync(credsPath)) {
    throw new Error(
      `Credentials not found at ${credsPath}\n` +
      `\nTo set up YouTube uploads:\n` +
      `  1. Go to https://console.cloud.google.com\n` +
      `  2. Create a project and enable the YouTube Data API v3\n` +
      `  3. Create an OAuth 2.0 "Desktop app" credential\n` +
      `  4. Download the JSON and save it as:\n` +
      `     ${CREDENTIALS_PATH}`
    );
  }

  const raw = JSON.parse(await readFile(credsPath, 'utf-8'));
  const creds = raw.installed || raw.web;
  if (!creds?.client_id || !creds?.client_secret) {
    throw new Error('Invalid client_secret.json — expected "installed" or "web" credentials');
  }

  return { clientId: creds.client_id, clientSecret: creds.client_secret };
}

function createOAuth2Client(clientId: string, clientSecret: string, port: number): OAuth2Client {
  return new google.auth.OAuth2(clientId, clientSecret, `http://localhost:${port}`);
}

/** Find a free TCP port starting from the preferred one. */
function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(preferred, () => {
      const addr = server.address() as { port: number };
      server.close(() => resolve(addr.port));
    });
    server.on('error', () => {
      // preferred is taken — ask the OS for any free port
      const fallback = createServer();
      fallback.listen(0, () => {
        const addr = fallback.address() as { port: number };
        fallback.close(() => resolve(addr.port));
      });
      fallback.on('error', reject);
    });
  });
}

/** Wait for the OAuth callback on localhost, extract the auth code. */
function waitForAuthCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url!, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Authentication denied.</h2><p>You can close this tab.</p>');
        server.close();
        reject(new Error(`OAuth denied: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Authenticated!</h2><p>You can close this tab and return to the terminal.</p>');
        server.close();
        resolve(code);
      }
    });

    server.listen(port, () => {});
    server.on('error', reject);
  });
}

/** Run the interactive OAuth2 flow: opens browser, waits for callback, saves tokens. */
export async function runAuthFlow(credentialsPath?: string): Promise<void> {
  const { clientId, clientSecret } = await loadCredentials(credentialsPath);

  const port = await findFreePort(REDIRECT_PORT);
  const oauth2 = createOAuth2Client(clientId, clientSecret, port);

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n  Opening browser for Google authentication...\n');

  // Dynamic import for ESM-only `open` package
  const { default: open } = await import('open');
  await open(authUrl);

  console.log(`  If the browser didn't open, visit:\n  ${authUrl}\n`);

  const code = await waitForAuthCode(port);
  const { tokens } = await oauth2.getToken(code);

  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2));

  console.log(`\n  Authenticated successfully!`);
  console.log(`  Tokens saved to ${TOKENS_PATH}\n`);
}

/** Load saved tokens and return an authenticated OAuth2Client. */
export async function getAuthenticatedClient(credentialsPath?: string): Promise<OAuth2Client> {
  const { clientId, clientSecret } = await loadCredentials(credentialsPath);
  const oauth2 = createOAuth2Client(clientId, clientSecret, REDIRECT_PORT);

  if (!existsSync(TOKENS_PATH)) {
    throw new Error(
      `Not authenticated. Run "qa-video auth" first to set up YouTube access.`
    );
  }

  const tokens = JSON.parse(await readFile(TOKENS_PATH, 'utf-8'));

  // Check if saved tokens have the required scopes
  const tokenScope = tokens.scope as string | undefined;
  if (tokenScope) {
    const granted = tokenScope.split(' ');
    const missing = SCOPES.filter(s => !granted.includes(s));
    if (missing.length > 0) {
      throw new Error(
        `YouTube token is missing required scopes.\n` +
        `  Run "qa-video auth" to re-authenticate with updated permissions.`
      );
    }
  }

  oauth2.setCredentials(tokens);

  // Proactively refresh if the access token is missing or expired
  const expiry = tokens.expiry_date as number | undefined;
  if (!tokens.access_token || (expiry && expiry < Date.now() + 10_000)) {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      const merged = { ...tokens, ...credentials };
      await writeFile(TOKENS_PATH, JSON.stringify(merged, null, 2));
      oauth2.setCredentials(merged);
    } catch (err: any) {
      const isInvalidGrant =
        err?.message?.includes('invalid_grant') ||
        err?.response?.data?.error === 'invalid_grant';
      if (isInvalidGrant) {
        throw new Error(
          `YouTube tokens have expired or been revoked.\n` +
          `  Run "qa-video auth" to re-authenticate.`,
        );
      }
      throw err;
    }
  }

  // Persist refreshed tokens
  oauth2.on('tokens', async (newTokens: Credentials) => {
    const merged = { ...tokens, ...newTokens };
    await writeFile(TOKENS_PATH, JSON.stringify(merged, null, 2));
  });

  return oauth2;
}
