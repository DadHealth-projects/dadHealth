// Run against a LOCAL development server only. No real form submissions.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.PRELAUNCH_LOCAL_URL || 'http://localhost:8080';
assert.equal(new URL(base).hostname, 'localhost');
const routes = ['/', '/howitworks', '/free-and-pro', '/dad-circles', '/about', '/waitlist', '/business', '/business/contact', '/support', '/privacy', '/terms', '/eula', '/cookies', '/privacy-request', '/auth/reset-password', '/bond', '/community', '/fitness', '/home', '/mind', '/pricing', '/progress', '/settings'];
const artifacts = new URL('../.next/prelaunch-review/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const findings = [];
let checks = 0;
try {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' && route.request().method() === 'GET') return route.continue();
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of routes) {
      const response = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90000 });
      assert.ok(response, `Expected an HTTP navigation response for ${path}`);
      assert.equal(response.status(), 200, path);
      await page.locator('body').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const scan = () => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        clipped: Array.from(document.querySelectorAll('h1,h2,h3,p,button,label,a')).filter(el => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1);
        }).map(el => el.textContent.trim().slice(0, 60)),
      });
      let normal = await page.evaluate(scan);
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      let large = await page.evaluate(scan);
      findings.push({ path, width, normal, text200: large });
      checks++;
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      if (['/', '/waitlist', '/dad-circles'].includes(path)) await page.screenshot({ path: new URL(`${path.replaceAll('/', '') || 'home'}-${width}.png`, artifacts).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(base, { waitUntil: 'networkidle' });
  const choices = page.locator('section[aria-label="Analytics cookie choices"]');
  await choices.waitFor();
  assert.equal(await choices.evaluate(el => getComputedStyle(el).position), 'fixed'); checks++;
  assert.equal(await choices.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  }), true); checks++;
  assert.equal(await page.locator('#about').evaluate(el => el.nextElementSibling.querySelector('h2')?.textContent.trim()), 'Dad Circles'); checks++;
  const noticeHandle = await choices.elementHandle();
  for (const [label, path] of [['How it works', '/howitworks'], ['Free & Pro', '/free-and-pro']]) {
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL(base + path);
    await choices.waitFor();
    assert.equal(await choices.count(), 1); checks++;
    assert.equal(await choices.evaluate((el, original) => el === original, noticeHandle), true); checks++;
    assert.equal(await page.evaluate(() => localStorage.getItem('dadhealth.analytics-consent')), null); checks++;
  }
  await page.getByRole('link', { name: 'Dad Health home', exact: true }).first().click();
  await page.waitForURL(base + '/');
  assert.equal(await choices.evaluate((el, original) => el === original, noticeHandle), true); checks++;
  await page.locator('footer').scrollIntoViewIfNeeded();
  assert.equal(await choices.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && getComputedStyle(el).overflowY === 'auto';
  }), true); checks++;
  assert.equal(await page.evaluate(() => localStorage.getItem('dadhealth.analytics-consent')), null); checks++;
  assert.equal(await page.locator('#gtm-script').count(), 0); checks++;
  const consentButtons = await choices.locator('button').evaluateAll(buttons => buttons.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, color: getComputedStyle(el).backgroundColor })));
  assert.ok(Math.abs(consentButtons[0].width - consentButtons[1].width) < 1 && consentButtons.every(button => button.height >= 44) && consentButtons[0].color === consentButtons[1].color); checks++;
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('dadhealth.analytics-consent')), 'denied'); checks++;
  await page.getByRole('button', { name: 'Cookie Settings', exact: true }).click();
  await choices.waitFor();
  assert.equal(await choices.evaluate(el => el === document.activeElement), true); checks++;
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('dadhealth.analytics-consent')), 'granted'); checks++;
  await page.getByRole('button', { name: 'Cookie Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.evaluate(() => localStorage.getItem('dadhealth.analytics-consent')), 'denied'); checks++;
  await page.locator('main a[href="#waitlist"]').click();
  assert.equal(await page.locator('#waitlist').evaluate(el => el.getBoundingClientRect().top >= 0), true); checks++;
  await page.goto(base + '/waitlist', { waitUntil: 'networkidle' });
  assert.equal(await choices.count(), 0); checks++;
  await page.getByRole('button', { name: 'Cookie Settings', exact: true }).click();
  await choices.waitFor();
  assert.equal(await choices.evaluate(el => el === document.activeElement && getComputedStyle(el).position === 'fixed'), true); checks++;
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  assert.equal(await page.locator('#waitlist-website').isVisible(), false); checks++;
  await page.locator('#waitlist-email').focus();
  await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'waitlist-website'); checks++;
  let submissions = 0;
  await page.route('**/api/waitlist', route => {
    submissions++;
    const payload = route.request().postDataJSON();
    assert.equal(payload.website, '');
    return route.fulfill({ status: submissions === 1 ? 502 : 200, contentType: 'application/json', body: '{}' });
  });
  await page.locator('#waitlist-email').fill('invalid');
  await page.locator('button[type="submit"]').click();
  assert.equal(submissions, 0); checks++;
  await page.locator('#waitlist-email').fill('test@example.invalid');
  await page.locator('button[type="submit"]').click();
  await page.getByRole('alert').filter({ hasText: 'We could not join' }).waitFor(); checks++;
  await page.locator('button[type="submit"]').click();
  await page.getByRole('status').filter({ hasText: 'Your request has been sent' }).waitFor(); checks++;
  assert.equal(submissions, 2); checks++;
  const layoutFindings = findings.filter(row => row.normal.overflow || row.normal.clipped.length || row.text200.overflow || row.text200.clipped.length);
  console.log(JSON.stringify({ checksPassed: checks, viewportCases: findings.length, layoutFindings }, null, 2));
  assert.equal(layoutFindings.length, 0, 'Review responsive layout findings above');
} finally {
  await writeFile(new URL('results.json', artifacts), JSON.stringify({ checks, findings }, null, 2));
  await browser.close();
}
