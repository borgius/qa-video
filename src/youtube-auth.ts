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
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

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

function createOAuth2Client(clientId: string, clientSecret: string): OAuth2Client {
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

/** Wait for the OAuth callback on localhost, extract the auth code. */
function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
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

    server.listen(REDIRECT_PORT, () => {});
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${REDIRECT_PORT} is in use. Close the process using it and try again.`));
      } else {
        reject(err);
      }
    });
  });
}

/** Run the interactive OAuth2 flow: opens browser, waits for callback, saves tokens. */
export async function runAuthFlow(credentialsPath?: string): Promise<void> {
  const { clientId, clientSecret } = await loadCredentials(credentialsPath);
  const oauth2 = createOAuth2Client(clientId, clientSecret);

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

  const code = await waitForAuthCode();
  const { tokens } = await oauth2.getToken(code);

  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2));

  console.log(`\n  Authenticated successfully!`);
  console.log(`  Tokens saved to ${TOKENS_PATH}\n`);
}

/** Load saved tokens and return an authenticated OAuth2Client. */
export async function getAuthenticatedClient(credentialsPath?: string): Promise<OAuth2Client> {
  const { clientId, clientSecret } = await loadCredentials(credentialsPath);
  const oauth2 = createOAuth2Client(clientId, clientSecret);

  if (!existsSync(TOKENS_PATH)) {
    throw new Error(
      `Not authenticated. Run "qa-video auth" first to set up YouTube access.`
    );
  }

  const tokens = JSON.parse(await readFile(TOKENS_PATH, 'utf-8'));
  oauth2.setCredentials(tokens);

  // Persist refreshed tokens
  oauth2.on('tokens', async (newTokens: Credentials) => {
    const merged = { ...tokens, ...newTokens };
    await writeFile(TOKENS_PATH, JSON.stringify(merged, null, 2));
  });

  return oauth2;
}
