import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { waitForCapture } from '../../apps/cli/src/interactive-capture';

test('human capture waits for interaction, removes host controls and cancels cleanly', async () => {
  const browser = await chromium.launch({
    headless: process.env.SPACE_TEST_HEADED_CAPTURE !== '1',
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    page.setDefaultTimeout(4000);
    await page.setContent(
      '<iframe srcdoc="<button onclick=\'this.textContent=123\'>Play</button>"></iframe>',
    );
    let finished = false;
    const pending = waitForCapture(page).then(() => {
      finished = true;
    });
    await page.getByRole('button', { name: 'Capture this moment' }).waitFor();
    expect(finished).toBe(false);
    await page.frameLocator('iframe').getByRole('button', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Capture this moment' }).click();
    await pending;
    expect(await page.getByText('Close this window', { exact: false }).count()).toBe(0);
    expect(await page.frameLocator('iframe').getByRole('button').textContent()).toBe('123');
    const cancelPage = await browser.newPage();
    cancelPage.setDefaultTimeout(4000);
    await cancelPage.setContent('<iframe></iframe>');
    const cancelled = waitForCapture(cancelPage, { durationMs: 2000, startMs: 0, actions: [] });
    const outcome = cancelled.catch((error) => error);
    await cancelPage.getByRole('button', { name: 'Record the next 2 seconds' }).waitFor();
    await cancelPage.close();
    expect(await outcome).toMatchObject({ code: 'CAPTURE_CANCELLED' });
  } finally {
    await browser.close();
  }
}, 15000);
