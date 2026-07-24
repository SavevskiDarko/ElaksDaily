// Elaks Ops — push sender
// Runs on a schedule (every 5 min). Sends:
//  1. task reminders (tasks with remind=true, due today at/past due_time)
//  2. daily digest at the configured hour (today's tasks + low stock)
//  3. low-stock alerts (once per day per article)
//
// Secrets needed (supabase secrets set):
//  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

// Skopje local time
function nowLocal(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Skopje" }),
  );
}
const pad = (n: number) => String(n).padStart(2, "0");

async function sendToAll(title: string, body: string, tag: string, allow: ((r: any) => boolean) | null = null) {
  const { data: subs } = await db.from("push_subscriptions").select("*");
  const { data: rr } = await db.from("user_roles").select("*");
  const rowOf = new Map((rr ?? []).map((r) => [r.user_id, r]));
  for (const s of subs ?? []) {
    if (allow) {
      const r = s.user_id ? rowOf.get(s.user_id) : null;
      if (!r || !allow(r)) continue;
    }
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ title, body, tag }), { urgency: "high", TTL: 3600 });
    } catch (e: any) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.from("push_subscriptions").delete().eq("id", s.id); // expired
      }
    }
  }
}

Deno.serve(async (req) => {
  const SECRET = Deno.env.get("PUSH_SECRET");
  if (SECRET && req.headers.get("x-push-key") !== SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const now = nowLocal();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dow = now.getDay();
  const dom = now.getDate();

  // ---- 1. task reminders ----
  const { data: tasks } = await db.from("tasks").select("*")
    .eq("remind", true).not("due_time", "is", null);
  for (const t of tasks ?? []) {
    const isToday =
      t.due_date === today ||
      t.recurrence === "daily" ||
      (t.recurrence === "weekly" && ((t.recur_days?.length ? t.recur_days : [t.recur_dow]).includes(dow))) ||
      (t.recurrence === "monthly" && t.recur_dom === dom);
    const doneToday = t.recurrence ? t.last_done === today : t.done;
    if (isToday && !doneToday && t.reminded_on !== today &&
        t.due_time.slice(0, 5) <= hhmm) {
      const who = t.assigned_to
        ? (r: any) => r.role === "owner" || r.user_id === t.assigned_to
        : (r: any) => r.role === "owner" || (r.task_contexts ?? []).includes(t.context);
      await sendToAll("Reminder", `${t.title} (${t.due_time.slice(0, 5)})`, `task-${t.id}`, who);
      await db.from("tasks").update({ reminded_on: today }).eq("id", t.id);
    }
  }

  // ---- 2. low stock (once per article per day) ----
  const { data: stock } = await db.from("article_stock").select("*").eq("active", true);
  const low = (stock ?? []).filter((a) =>
    a.min_stock > 0 && a.stock <= a.min_stock && a.low_alerted_on !== today
  );
  for (const a of low) {
    await sendToAll("Low stock", `${a.name}: ${a.stock} ${a.unit} (min. ${a.min_stock})`, `low-${a.id}`, (r) => r.role === "owner" || !!r.see_elaks);
    await db.from("articles").update({ low_alerted_on: today }).eq("id", a.id);
  }

  // ---- 3. daily digest ----
  const { data: hourRow } = await db.from("app_settings").select("value").eq("key", "digest_hour").single();
  const { data: sentRow } = await db.from("app_settings").select("value").eq("key", "digest_sent_on").single();
  const digestHour = String(hourRow?.value ?? "07:30").replace(/"/g, "");
  const sentOn = String(sentRow?.value ?? "").replace(/"/g, "");
  if (hhmm >= digestHour && sentOn !== today) {
    const openToday = (tasks0: any[]) =>
      tasks0.filter((t) => {
        const isToday = t.due_date === today || t.recurrence === "daily" ||
          (t.recurrence === "weekly" && ((t.recur_days?.length ? t.recur_days : [t.recur_dow]).includes(dow))) ||
          (t.recurrence === "monthly" && t.recur_dom === dom) ||
          (t.due_date && t.due_date < today && !t.done && !t.recurrence);
        const doneToday = t.recurrence ? t.last_done === today : t.done;
        return isToday && !doneToday;
      });
    const { data: all } = await db.from("tasks").select("*");
    const open = openToday(all ?? []);
    const byCtx = (c: string) => open.filter((t) => t.context === c).length;
    const lowCount = (stock ?? []).filter((a) => a.min_stock > 0 && a.stock <= a.min_stock).length;
    let body = `Work: ${byCtx("work")} · Elaks: ${byCtx("elaks")} · Personal: ${byCtx("personal")} · Apts: ${byCtx("apts")}`;
    if (lowCount) body += ` · Low stock: ${lowCount}`;
    await sendToAll("Good morning — today", body, "digest", (r) => r.role === "owner");
    await db.from("app_settings").update({ value: today }).eq("key", "digest_sent_on");
  }


  // ---- 4. unpaid bills reminder (once per month, from the configured day) ----
  try {
    const { data: cfg } = await db.from("app_settings").select("key, value").in("key", ["bills_day", "bills_sent_on"]);
    const get = (k: string) => String((cfg ?? []).find((r: any) => r.key === k)?.value ?? "").replace(/"/g, "");
    const billsDay = parseInt(get("bills_day")) || 5;
    const month = today.slice(0, 7);
    if (dom >= billsDay && hhmm >= digestHour && get("bills_sent_on") !== month) {
      const { data: apts } = await db.from("apartments").select("id").eq("active", true);
      const { data: bs } = await db.from("bills").select("paid").eq("month", month + "-01");
      const TYPES = 6;
      const need = (apts ?? []).length * TYPES;
      const paidN = (bs ?? []).filter((b: any) => b.paid).length;
      const unpaid = Math.max(0, need - paidN);
      if (unpaid > 0) {
        await sendToAll("Bills to pay", `${unpaid} unpaid for ${month}`, "bills",
          (r) => r.role === "owner" || !!r.see_apts);
      }
      await db.from("app_settings").upsert({ key: "bills_sent_on", value: month }, { onConflict: "key" });
    }
  } catch (e) { console.error("bills reminder", e); }

  // ---- 5. offer follow-up: sent and quiet for 5+ days ----
  try {
    const { data: offers } = await db.from("offers")
      .select("id, number, offer_date, followup_sent, clients(name)").eq("status", "sent");
    for (const o of offers ?? []) {
      if (o.followup_sent) continue;
      const days = Math.floor((Date.parse(today) - Date.parse(o.offer_date)) / 86400000);
      if (days >= 5) {
        await sendToAll("Follow up offer", `${o.number} · ${o.clients?.name ?? ""} — sent ${days} days ago`,
          `off-${o.id}`, (r) => r.role === "owner" || !!r.see_elaks);
        await db.from("offers").update({ followup_sent: today }).eq("id", o.id);
      }
    }
  } catch (e) { console.error("offer follow-up", e); }

  return new Response("ok");
});
