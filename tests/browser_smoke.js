// Hosted preflight for the same Python child, Chrome binary and driver used by the E2E suites.
'use strict';
const {spawn, execFileSync} = require('node:child_process');
const {once} = require('node:events');
const {createInterface} = require('node:readline');
const path = require('node:path');
const {realpathSync, existsSync} = require('node:fs');
const {chromium} = require('playwright-core');
const {isolatedEnv} = require('./isolation.js');

async function main() {
  const root = path.resolve(__dirname, '..');
  const settings = {CURIVEN_PORT: process.env.CURIVEN_PORT || '0', CURIVEN_PROVIDER: 'none'};
  const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {encoding:'utf8'}).trim();
  const version = execFileSync(python, ['--version'], {encoding:'utf8'}).trim();
  if (process.env.pythonLocation) {
    const expected = path.join(process.env.pythonLocation, 'bin', 'python3');
    const identity = existsSync(expected) ? realpathSync(python) === realpathSync(expected) : 'unknown';
    console.log('Python matches resolved setup-python executable: ' + identity);
  }
  const configured = ['http_proxy','https_proxy','all_proxy','no_proxy','node_use_env_proxy']
    .filter(key => Object.keys(process.env).some(k => k.toLowerCase() === key));
  console.log(`${version}; Node ${process.version}; Playwright ${require('playwright-core/package.json').version}; proxy variables present: ${configured.join(',') || 'none'}`);

  const bypass = (process.env.no_proxy || process.env.NO_PROXY || '').split(',').map(entry => entry.trim());
  console.log('Explicit NO_PROXY entry for 127.0.0.1 or *: ' + (bypass.includes('127.0.0.1') || bypass.includes('*')));

  const child = spawn(python, ['server.py'], {cwd:root, env:isolatedEnv(settings), stdio:['ignore','pipe','pipe']});
  const closed = once(child, 'close');
  const lines = createInterface({input:child.stdout});
  let errno = '', browser, stage = 'server startup';
  child.stderr.on('data', chunk => { errno = String(chunk).match(/Errno \d+/)?.[0] || errno; });
  try {
    const [line] = await Promise.race([
      once(lines, 'line', {signal:AbortSignal.timeout(10000)}),
      closed.then(([code,signal]) => { throw Error(`server exited ${code ?? signal} ${errno}`); })
    ]);
    const base = line.match(/^CURIVEN → (http:\/\/127\.0\.0\.1:\d+) \|/)?.[1];
    if (!base) throw Error('invalid startup announcement');
    console.log(`Python listening on ${base}`);
    stage = 'direct Node HTTP';
    const asset = base + '/tokens.css';
    const direct = await fetch(asset, {signal:AbortSignal.timeout(5000), redirect:'error'});
    if (direct.status !== 200) throw Error('HTTP ' + direct.status);
    await direct.body.cancel();
    console.log('Direct HTTP 200');
    stage = 'Chromium launch';
    browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true});
    console.log('Chrome ' + browser.version());
    const page = await browser.newPage();
    stage = 'Chromium static navigation';
    const response = await page.goto(asset, {timeout:10000});
    if (response.status() !== 200) throw Error('HTTP ' + response.status());
    console.log('Chromium static HTTP 200');
    stage = 'mocked application navigation';
    await page.route('**/api/**', route => route.fulfill({json:{online:false, installed:[]}}));
    await page.goto(base, {timeout:10000});
    await page.locator('#onboarding').waitFor({timeout:5000});
    console.log('Mocked onboarding visible');
  } catch (err) {
    // Emit only a short category/code, never request data, proxy URLs or child stderr.
    const timedOut = err.name === 'TimeoutError' || err.cause?.name === 'TimeoutError';
    const detail = timedOut ? (stage === 'server startup' ? 'readiness deadline 10s' : 'request deadline') :
      (typeof err.cause?.code === 'string' && err.cause.code) || err.message.match(/net::ERR_\w+|server exited [\w -]+|HTTP \d+/)?.[0] || err.name;
    throw Error(`${stage} failed (${detail}; child ${child.exitCode ?? child.signalCode ?? 'running'})`);
  } finally {
    child.kill();
    lines.close();
    await Promise.all([closed, browser?.close()]);
  }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
