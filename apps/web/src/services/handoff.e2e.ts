// SPDX-License-Identifier: AGPL-3.0-or-later
// The handoff into Klimper, end to end, in a real browser (TASK-065): a passkey wallet is made on
// the dev server by a virtual authenticator with PRF, Klimper's own receiver
// (klimper/src/lib/clapandpayHandoff.ts) makes the request, the /connect page approves it with a
// fresh passkey prompt, and what comes back must decrypt to the key of the address the page shows.
// Needs Google Chrome; run on purpose: `pnpm e2e:handoff`. CHROME_PATH picks another binary.
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveUnhardened,
  encodeAddress,
  publicKey,
  type SecretKey,
  standardPuzzleHash,
  syntheticSecretKey,
  TESTNET11,
} from '@ge/chia';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';
// The receiving side exactly as Klimper ships it, not the package's copy of it.
import { createHandoffRequest } from '../../../../../klimper/src/lib/clapandpayHandoff';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WALLET_PATH = [12381, 8444, 2, 0];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The first address of the standard wallet path, from a master secret key, as Sage derives it. */
function firstAddress(masterSkHex: string): string {
  const master = Uint8Array.from(Buffer.from(masterSkHex, 'hex'));
  const walletSk = WALLET_PATH.reduce<SecretKey>(deriveUnhardened, master);
  const puzzleHash = standardPuzzleHash(publicKey(syntheticSecretKey(walletSk)));
  return encodeAddress(puzzleHash, TESTNET11.addressPrefix);
}

/** Just enough of the Chrome DevTools protocol: one page, commands and events. */
class Page {
  private id = 0;
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>();
  readonly console: string[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      const id = message.id as number | undefined;
      if (id !== undefined) {
        this.pending.get(id)?.(message);
        this.pending.delete(id);
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.console.push(JSON.stringify(message.params).slice(0, 400));
      }
    });
  }

  static async connect(port: number): Promise<Page> {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
          type: string;
          webSocketDebuggerUrl: string;
        }[];
        const target = targets.find((t) => t.type === 'page');
        if (target) {
          const socket = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((resolve) => socket.addEventListener('open', resolve));
          return new Page(socket);
        }
      } catch {
        // Chrome is still starting.
      }
      await sleep(200);
    }
    throw new Error('Chrome did not start');
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (message) =>
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message),
      );
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T>(expression: string): Promise<T> {
    const reply = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const result = reply.result as { result: { value: T }; exceptionDetails?: unknown };
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  /** Waits until `expression` is truthy in the page, and returns it. */
  async waitFor<T>(expression: string, what: string, ms = 20_000): Promise<T> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const value = await this.eval<T>(expression).catch(() => null);
      if (value) return value;
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${what}; page errors: ${this.console.join('\n')}`);
  }

  /** Clicks the first button whose text contains `text`. */
  click(text: string): Promise<boolean> {
    return this.waitFor(
      `(() => { const b = [...document.querySelectorAll('button')].find((b) => !b.disabled && b.textContent.includes(${JSON.stringify(text)})); if (b) { b.click(); return true; } return false; })()`,
      `a button "${text}"`,
    );
  }

  close() {
    this.socket.close();
  }
}

let server: ViteDevServer;
let chrome: ChildProcess;
let profile: string;
let page: Page;
let origin: string;

beforeAll(async () => {
  server = await createServer({
    root: WEB_ROOT,
    configFile: join(WEB_ROOT, 'vite.config.ts'),
    mode: 'development',
    server: { port: 0, host: 'localhost' },
    logLevel: 'error',
  });
  await server.listen();
  origin = (server.resolvedUrls?.local[0] ?? '').replace(/\/$/, '');

  profile = mkdtempSync(join(tmpdir(), 'ge-handoff-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  page = await Page.connect(port);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  // A platform authenticator that does what Face ID does, including the PRF extension.
  await page.send('WebAuthn.enable', { enableUI: false });
  await page.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });
  // The page copies the answer to the clipboard; keep it where the test can read it.
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `navigator.clipboard.writeText = (text) => { window.__copied = text; return Promise.resolve(); };`,
  });
}, 60_000);

afterAll(async () => {
  page?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    await exited;
  }
  await server?.close();
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

it.skipIf(!existsSync(CHROME))(
  'hands a passkey wallet made on the dev server to Klimper',
  async () => {
    // 1. A person opens the page for the first time and makes a wallet with a passkey.
    await page.send('Page.navigate', { url: `${origin}/` });
    await page.waitFor(`document.querySelector('.first-run__open')`, 'the first-run envelope');
    await page.eval(`document.querySelector('.first-run__open').click()`);
    await page.click('Start fresh');
    await page.waitFor(
      `!document.querySelector('.first-run')`,
      'the wallet to open after "Start fresh"',
      30_000,
    );

    // 2. Klimper asks for it: one-time key pair, the page's /connect address.
    const request = await createHandoffRequest(origin);
    expect(request.url.startsWith(`${origin}/connect?v=1&k=`)).toBe(true);
    await page.send('Page.navigate', { url: request.url });
    const shown = await page.waitFor<string>(
      `document.querySelector('.connect__code strong')?.textContent`,
      'the check code',
    );
    expect(shown.replace(/\s/g, '')).toBe(request.checkCode);

    // 3. The person says yes; the passkey is asked again; the page offers the answer to copy.
    await page.click('Yes, it is me');
    await page.click('Copy');
    const answer = await page.waitFor<string>('window.__copied', 'the copied answer');

    // 4. Klimper opens it: only this request can, and it is the page's wallet.
    const payload = await request.open(answer);
    expect(payload.network).toBe('testnet11');
    expect(payload.masterSk).toMatch(/^[0-9a-f]{64}$/);
    expect(firstAddress(payload.masterSk)).toBe(payload.address);

    // 5. Another Klimper, or anybody else holding the text, gets nothing.
    const other = await createHandoffRequest(origin);
    await expect(other.open(answer)).rejects.toMatchObject({ code: 'wrong_receiver' });
  },
  120_000,
);
