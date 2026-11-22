// Every tab opens, in both languages, with some of everything in the database.
const assert = require("node:assert/strict");
const { seed } = require("./seed");

async function everyTab(t, lang) {
  const app = await t.open({ db: seed(), lang });
  const { page } = app;
  const tabs = await page.$$eval(".tabbar button", (bs) => bs.map((b) => ({ tab: b.dataset.tab, shown: b.style.display !== "none" })));
  assert.ok(tabs.length >= 7, `expected the seven tabs, found ${tabs.length}`);
  assert.deepEqual(tabs.filter((x) => !x.shown), [], "the owner sees every tab");
  // there and back, so each one is also opened from another
  for (const { tab } of [...tabs, ...tabs.slice().reverse()]) {
    await page.click(`.tabbar button[data-tab="${tab}"]`);
    const now = await page.evaluate(() => ({ tab: state.tab, view: document.querySelector(".view.on")?.id,
      text: document.querySelector(".view.on")?.innerText.trim().length || 0 }));
    assert.equal(now.tab, tab);
    assert.equal(now.view, "v-" + tab, `the ${tab} view is the one showing`);
    assert.ok(now.text > 0, `the ${tab} view has something on it`);
  }
  return app;
}

// the screen is in the language chosen: the Elaks chips and the title of Tasks
// (the app translates a moment after it renders, so these wait for it)
async function speaks(page, lang, { offers, tasks }) {
  assert.equal(await page.evaluate(() => document.documentElement.lang), lang);
  await page.click('.tabbar button[data-tab="elaks"]');
  await page.locator("#v-elaks").getByText(offers, { exact: true }).first().waitFor({ timeout: 5000 });
  await page.click('.tabbar button[data-tab="today"]');
  await page.waitForFunction((w) => document.getElementById("bar-title").textContent === w, tasks, { timeout: 5000 });
}

module.exports = {
  "every tab opens in English": async (t) => {
    const { page } = await everyTab(t, "en");
    await speaks(page, "en", { offers: "Offers", tasks: "Tasks" });
  },

  "every tab opens in Macedonian": async (t) => {
    const { page } = await everyTab(t, "mk");
    await speaks(page, "mk", { offers: "Понуди", tasks: "Задачи" });
  },
};
