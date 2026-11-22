// Camera plans (#61): drawn from the client card, kept in coverage_plans,
// and printed as a page of the offer's PDF.
const assert = require("node:assert/strict");
const { seed, at } = require("./seed");

// a point on the plan, in metres, as a point on the screen
const toScreen = (page, x, y) => page.evaluate(([x, y]) => {
  const svg = document.getElementById("pl-svg"), pt = svg.createSVGPoint();
  pt.x = x; pt.y = y;
  const q = pt.matrixTransform(svg.getScreenCTM());
  return [q.x, q.y];
}, [x, y]);
const tapPlan = async (page, x, y) => { const [sx, sy] = await toScreen(page, x, y); await page.mouse.click(sx, sy); };
const reach = (page) => page.locator("#pl-panel .pl-reads b").allInnerTexts();
const seen = async (page) => parseInt(await page.locator("#pl-seen").innerText(), 10);
const walls = (page) => page.evaluate(() => pe.p.walls.length);

// what planBlank() draws, with one camera at the gate
const PLAN = {
  v: 1, w: 24, h: 18, street: "bottom", night: false, bg: null,
  shapes: [{ id: "s1", kind: "house", x: 7, y: 5, w: 10, h: 8, label: "" }], walls: [],
  marks: [{ id: "m1", label: "Порта", x: 12, y: 17.5 }],
  cams: [{ id: "c1", n: 1, name: "Порта", x: 12, y: 16, h: -90, lens: 2.8, mp: 4, ir: 30, article_id: null, model: "" }],
};

module.exports = {
  "draw a plan from the client card: reach, a wall, Remove, Undo, Save": async (t) => {
    const { page, table } = await t.open({ db: seed() });
    await page.evaluate(() => openClientCard("client-1"));
    await page.locator("#sheet").getByRole("button", { name: "Draw a camera plan" }).click();
    await page.locator("#pl-svg").scrollIntoViewIfNeeded();

    // a camera in the top-left corner of the yard, looking down the plot
    await page.getByRole("button", { name: "+ Camera", exact: true }).click();
    await tapPlan(page, 3, 2);
    assert.equal(await page.locator("#pl-cams").innerText(), "1");
    assert.deepEqual(await page.evaluate(() => { const c = pe.p.cams[0]; return [c.x, c.y, c.lens, c.mp]; }), [3, 2, 2.8, 4]);
    assert.deepEqual(await reach(page), ["4.1 m", "8.1 m", "16.2 m"], "4 MP, 2.8 mm: face, person, activity");
    await page.locator("#pl-panel").getByRole("button", { name: "3.6 mm" }).click();
    assert.deepEqual(await reach(page), ["5.8 m", "11.6 m", "23 m"], "4 MP, 3.6 mm: face, person, activity");

    // a wall across the camera's view hides part of the yard
    const open = await seen(page);
    assert.ok(open > 0, "the camera sees some of the yard");
    await page.getByRole("button", { name: "+ Wall", exact: true }).click();
    await tapPlan(page, 0.5, 4);
    await tapPlan(page, 6, 4);
    assert.equal(await walls(page), 1);
    const walled = await seen(page);
    assert.ok(walled < open, `the wall lowers "Yard seen" (${open}% → ${walled}%)`);

    // Remove takes the wall away; Undo brings it back
    await page.locator("#pl-panel").getByRole("button", { name: "Remove" }).click();
    assert.equal(await walls(page), 0);
    assert.equal(await seen(page), open);
    await page.locator("#pl-undo").click();
    assert.equal(await walls(page), 1);
    assert.equal(await seen(page), walled);

    // Save writes the plan under the client
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => (window.__db.coverage_plans || []).length === 1);
    const [row] = await table("coverage_plans");
    assert.equal(row.client_id, "client-1");
    assert.equal(row.offer_id, null);
    assert.equal(row.cams, 1);
    assert.equal(row.in_offer, true);
    assert.equal(row.plan.walls.length, 1);
    assert.deepEqual([row.plan.cams[0].lens, row.plan.cams[0].mp], [3.6, 4]);
    await page.waitForFunction((id) => state.plans.some((p) => p.id === id), row.id);
  },

  "the offer PDF carries the plan as a page of its own, unless left out": async (t) => {
    const plan = { id: "plan-1", client_id: "client-1", offer_id: "offer-1", job_id: null, title: "Куќа и двор",
      plan: PLAN, cams: 1, in_offer: true, created_by: "u1", created_at: at(-1), updated_at: at(-1) };
    const { page } = await t.open({ db: { ...seed(), coverage_plans: [plan] } });
    const sheet = () => page.evaluate(() => offerSheetHtml(state.offers.find((o) => o.id === "offer-1")));

    const html = await sheet();
    assert.ok(html.includes("pv-break"), "the plan starts on a new page");
    assert.ok(html.includes("План на камери — Куќа и двор"), "with its heading");
    assert.ok(html.includes("2.8 mm · 4 MP") && html.includes("4.1 m"), "and the camera's reach");

    await page.evaluate(async () => { window.__db.coverage_plans[0].in_offer = false; await refreshAll(["plans"]); });
    const without = await sheet();
    assert.ok(!without.includes("pv-break") && !without.includes("План на камери"), "a plan left out of the offer is not printed");
  },

  "before migration 0013 the client card offers no camera plans": async (t) => {
    const { page } = await t.open({ db: seed(), missing: ["coverage_plans", "coverage_plan_images"] });
    assert.ok(await page.evaluate(() => state.noTable.has("plans")), "the missing table is noticed");
    await page.evaluate(() => openClientCard("client-1"));
    assert.match(await page.locator("#sheet h2").innerText(), /Петар Петровски/, "the client card is open");
    assert.equal(await page.locator("#sheet").getByText("Draw a camera plan").count(), 0);
  },
};
