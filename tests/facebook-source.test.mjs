import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import {
  navigateFacebookPhoto,
  readFacebookPermalink,
  readFacebookPosts,
} from "../server/infrastructure/facebook-source.mjs";

test("public feed extraction keeps post text and observed photo links together", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
   <article><div><div>Wednesday 11 November 2026 at 17:47</div><a href="https://web.facebook.com/ledcm2/posts/one?ref=feed">1d</a></div><p>ขายทอดตลาดทรัพย์ วันที่ 5 พฤศจิกายน 2569</p><p data-ad-comet-preview="message">ขายทอดตลาดทรัพย์ วันที่ 12 พฤศจิกายน 2569</p><a href="https://web.facebook.com/photo?fbid=123&set=pcb.1">photo one</a></article>
   <article><a href="https://web.facebook.com/ledcm2/posts/two">yesterday</a><p>ขายทอดตลาดทรัพย์ วันที่ 5 พฤศจิกายน 2569</p><a href="https://web.facebook.com/photo/?fbid=456&set=pcb.2">photo two</a><a href="https://web.facebook.com/photo/?fbid=457&set=pcb.2" aria-label="15 remaining items">more</a><a href="https://web.facebook.com/photo/?fbid=456&set=pcb.2&ref=extra">duplicate</a></article>
   <article><a href="https://web.facebook.com/ledcm2/posts/other">other</a><p>กิจกรรมสำนักงาน</p><a href="https://web.facebook.com/photo?fbid=789">photo</a></article>
  </main>`);
    const posts = await readFacebookPosts(page);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].url, "https://web.facebook.com/ledcm2/posts/one");
    assert.match(posts[0].text, /12 พฤศจิกายน/);
    assert.equal(posts[0].publishedOn, "2026-11-11");
    assert.doesNotMatch(posts[0].text, /5 พฤศจิกายน/);
    assert.equal(posts[0].photoUrls.length, 1);
    assert.match(posts[0].photoUrls[0], /fbid=123/);
    assert.match(posts[1].photoUrls[0], /fbid=456/);
    assert.equal(posts[1].photoUrls.length, 2);
    assert.match(posts[1].albumStart, /fbid=457/);
    assert.equal(posts[1].expectedPhotos, 17);
  } finally {
    await browser.close();
  }
});

test("identifies the requested public album when Facebook changes its timestamp link", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <link rel="canonical" href="https://web.facebook.com/ledcm2/posts/sale-results/789/">
      <article><a href="https://web.facebook.com/ledcm2/posts/unrelated">today</a><p>ขายทอดตลาดทรัพย์ วันที่ 12 พฤศจิกายน 2569</p><a href="https://web.facebook.com/photo/?fbid=111&set=pcb.1">photo</a></article>
      <article><a href="https://web.facebook.com/ledcm2/posts/differentId">today</a><p>ขายทอดตลาดทรัพย์ วันที่ 5 พฤศจิกายน 2569</p><a href="https://web.facebook.com/photo/?fbid=222&set=pcb.789">photo</a></article>`);
    const album = await readFacebookPermalink(
      page,
      "https://web.facebook.com/ledcm2/posts/originalId",
    );
    assert.match(album.text, /5 พฤศจิกายน/);
    assert.match(album.photoUrls[0], /fbid=222/);
  } finally {
    await browser.close();
  }
});

test("refreshes the current public photo and dismisses the prompt before advancing", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const current = new URL(
      "https://web.facebook.com/photo/?fbid=456&set=pcb.2",
    );
    let loads = 0;
    await page.route("https://web.facebook.com/photo/**", async (route) => {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body:
          ++loads === 1
            ? `<button onclick="document.querySelector('dialog').showModal()">Next photo</button><dialog>See more on Facebook</dialog>`
            : `<dialog open>See more on Facebook <button onclick="this.closest('dialog').close()">Close</button></dialog><button onclick="history.pushState({}, '', '?fbid=457&set=pcb.2')">Next photo</button>`,
      });
    });
    await page.goto(current.href);
    assert.deepEqual(await navigateFacebookPhoto(page, current), {
      advanced: true,
      loginRequired: false,
    });
    assert.equal(loads, 2);
    assert.equal(new URL(page.url()).searchParams.get("fbid"), "457");
  } finally {
    await browser.close();
  }
});
