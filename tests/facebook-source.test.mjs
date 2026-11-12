import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import { readFacebookPosts } from "../server/infrastructure/facebook-source.mjs";

test("public feed extraction keeps post text and observed photo links together", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
   <article><a href="https://web.facebook.com/ledcm2/posts/one?ref=feed">today</a><p>ขายทอดตลาดทรัพย์ วันที่ 12 พฤศจิกายน 2569</p><a href="https://web.facebook.com/photo?fbid=123&set=pcb.1">photo one</a></article>
   <article><a href="https://web.facebook.com/ledcm2/posts/two">yesterday</a><p>ขายทอดตลาดทรัพย์ วันที่ 5 พฤศจิกายน 2569</p><a href="https://web.facebook.com/photo/?fbid=456&set=pcb.2">photo two</a></article>
   <article><a href="https://web.facebook.com/ledcm2/posts/other">other</a><p>กิจกรรมสำนักงาน</p><a href="https://web.facebook.com/photo?fbid=789">photo</a></article>
  </main>`);
    const posts = await readFacebookPosts(page);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].url, "https://web.facebook.com/ledcm2/posts/one");
    assert.match(posts[0].text, /12 พฤศจิกายน/);
    assert.equal(posts[0].photoUrls.length, 1);
    assert.match(posts[0].photoUrls[0], /fbid=123/);
    assert.match(posts[1].photoUrls[0], /fbid=456/);
  } finally {
    await browser.close();
  }
});
