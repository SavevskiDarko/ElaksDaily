// A small database with some of everything, for tests that want the screens
// filled rather than empty. seed() returns a fresh copy each time; change or
// add to it in the test. Rows carry the columns the later migrations add
// (tasks.habit, offers.show_total, apartments.rent_mode, ...) so the app takes
// its "migration has been run" paths.

const { TIMEZONE } = require("./harness");

// a date n days from today, as the app (in TIMEZONE) sees today
const day = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE", { timeZone: TIMEZONE }); };
const at = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

function seed() {
  const camera = {
    id: "art-cam4", code: "DS-2CD1043G2-I", name: "Hikvision IP камера 4MP 2.8mm", category: "CCTV", unit: "ком",
    min_stock: 2, purchase_price: 2900, sell_price: 4200, supplier: "Alarm Centar", specs: "4MP, 2.8 mm, IR 30 m, PoE",
    active: true, low_alerted_on: null, created_at: at(-60), image_thumb: null, vat_rate: 18, supplier_code: null,
    cam_type: "ip", mp: 4,
  };
  const cable = {
    id: "art-cable", code: "UTP5E", name: "UTP кабел Cat5e", category: "Cables", unit: "m",
    min_stock: 100, purchase_price: 12, sell_price: 25, supplier: "Alarm Centar", specs: "",
    active: true, low_alerted_on: null, created_at: at(-60), image_thumb: null, vat_rate: 18, supplier_code: null,
    cam_type: null, mp: null,
  };
  const items = [
    { article_id: camera.id, name: camera.name, specs: camera.specs, unit: "ком", qty: 4, price: 4200, cost: 2900, vat: 18 },
    { article_id: cable.id, name: cable.name, specs: "", unit: "m", qty: null, price: 25, cost: 12, vat: 18 },
    { free: true, name: "Монтажа, подесување и обука", specs: "", unit: "ком", qty: null, price: 3000 },
  ];
  return {
    clients: [
      { id: "client-1", name: "Петар Петровски", contact: "Петар", phone: "070 123 456", email: "petar@example.test",
        address: "Партизанска 1, Скопје", note: null, active: true, created_at: at(-40) },
      { id: "client-2", name: "Market Plus DOOEL", contact: "Ана", phone: "071 222 333", email: null,
        address: "Илинденска 20, Тетово", note: null, active: true, created_at: at(-20) },
    ],
    articles: [camera, cable].map(({ id, cam_type, mp, active }) => ({ id, cam_type, mp, active })),
    article_stock: [{ ...camera, stock: 6 }, { ...cable, stock: 250 }],
    offers: [
      { id: "offer-1", number: new Date().getFullYear() + "-001", title: "Видео надзор куќа", system: "CCTV", client_id: "client-1",
        offer_date: day(-3), validity: 15, status: "sent", items, total_note: null, grand_total: 19800, stock_deducted: false,
        created_at: at(-3), followup_sent: null, paid_at: null, paid_method: null, paid_amount: 0, created_by: "u1", show_total: true },
    ],
    tasks: [
      { id: "task-1", title: "Јави се на Петар", context: "elaks", due_date: day(0), due_time: "10:00", recurrence: null,
        done: false, last_done: null, notes: null, created_at: at(-1), checklist: null, assigned_to: null, recur_days: null,
        recur_every: 1, priority: true, client_id: "client-1", photo_thumb: null, owner_uid: "u1", created_by: "u1", habit: false },
      { id: "task-2", title: "Water the plants", context: "personal", due_date: day(-1), due_time: null, recurrence: "daily",
        done: false, last_done: day(-2), notes: null, created_at: at(-30), checklist: null, assigned_to: null, recur_days: null,
        recur_every: 1, priority: false, photo_thumb: null, owner_uid: "u1", created_by: "u1", habit: true },
    ],
    accounts: [
      { id: "acct-cash", name: "Cash", opening_balance: 0, sort: 0, active: true, created_at: at(-90), payout_delay_days: 0 },
    ],
    apartments: [
      { id: "apt-1", name: "Centar 12", address: "Македонија 12, Скопје", size_m2: 48, notes: null, active: true, created_at: at(-200),
        opening_balance: 0, nightly_rate: 2500, checkout_time: "11:00:00", feed_token: null, cleaning_cost: 600,
        rent_mode: "short", tenant_pays_bills: false, account_openings: {}, bills_back_from: null },
    ],
    stays: [
      { id: "stay-1", apartment_id: "apt-1", guest_name: "John Smith", check_in: day(-1), check_out: day(2), amount: 7500,
        notes: null, created_at: at(-10), source: "booking", external_uid: null, feed_id: null, account_id: "acct-cash",
        arrived_at: null, commission: 0, cleaning_cost: 600, guest_phone: null },
    ],
    policies: [
      { id: "pol-1", holder_name: "Марија Јованова", policy_no: "AO-1001", kind: "АО", insurer: "Евроинс", client_id: null,
        phone: "072 444 555", start_date: day(-340), end_date: day(25), amount: 6200, note: null, active: true, created_at: at(-340),
        reminded_days: [], photo_thumb: null, commission: 900, has_green_card: false, green_card_no: null, green_card_end: null,
        gc_reminded_days: [], renewed_from: null, green_card_price: 0, remit_statement_id: null, comm_statement_id: null,
        gc_commission: 0, plate: "SK-1234-AB" },
    ],
    sites: [
      { id: "site-1", client_id: "client-1", name: "Куќа Петровски", address: "Партизанска 1, Скопје", recorder: "NVR 8ch",
        channels: 8, camera_count: 4, hdd_tb: 2, active: true, created_at: at(-40) },
    ],
    jobs: [
      { id: "job-1", title: "Монтажа камери — Петровски", offer_id: "offer-1", client_id: "client-1", site_id: "site-1",
        address: "Партизанска 1, Скопје", scheduled_on: day(2), scheduled_time: "09:00", assigned_to: null, status: "scheduled",
        started_at: null, done_at: null, note: null, created_at: at(-2), created_by: "u1" },
    ],
    invoices: [
      { id: "inv-1", number: new Date().getFullYear() + "-001", invoice_date: day(-30), due_date: day(-15), client_id: "client-2",
        offer_id: null, job_id: null, items: [{ name: "Сервис", qty: 1, price: 2400, vat: 18 }], total: 2400, net: 2033.9, vat: 366.1,
        paid_on: null, paid_method: null, note: null, cancelled: false, created_at: at(-30), created_by: "u1" },
    ],
  };
}

module.exports = { seed, day, at };
