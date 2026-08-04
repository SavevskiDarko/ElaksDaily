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

async function sendToAll(title: string, body: string, tag: string, allow: ((r: any) => boolean) | null = null, taskId: string | null = null) {
  const { data: subs } = await db.from("push_subscriptions").select("*");
  const { data: rr } = await db.from("user_roles").select("*");
  const rowOf = new Map((rr ?? []).map((r) => [r.user_id, r]));
  for (const s of subs ?? []) {
    if (allow) {
      const r = s.user_id ? rowOf.get(s.user_id) : null;
      if (!r || !allow(r)) continue;
    }
    try {
      // 12h so a phone that is off or out of signal still receives it
      await webpush.sendNotification(s.sub, JSON.stringify({ title, body, tag, taskId }), { urgency: "high", TTL: 43200 });
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
      await sendToAll("Reminder", `${t.title} (${t.due_time.slice(0, 5)})`, `task-${t.id}`, who, t.id);
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
    // the per-area counts already contain these, so name them rather than
    // sending a second message that repeats the same tasks
    const lateN = open.filter((t) => !t.recurrence && t.due_date && t.due_date < today).length;
    let body = lateN ? `${lateN} overdue · ` : "";
    body += `Work: ${byCtx("work")} · Elaks: ${byCtx("elaks")} · Personal: ${byCtx("personal")} · Apts: ${byCtx("apts")}`;
    if (lowCount) body += ` · Low stock: ${lowCount}`;
    await sendToAll(`Good morning — ${open.length} today`, body, "digest", (r) => r.role === "owner");
    await db.from("app_settings").update({ value: today }).eq("key", "digest_sent_on");
  }


  // ---- 4. unpaid bills reminder (once per month, from the configured day) ----
  try {
    const { data: cfg } = await db.from("app_settings").select("key, value").in("key", ["bills_day", "bills_sent_on", "bill_types"]);
    const get = (k: string) => String((cfg ?? []).find((r: any) => r.key === k)?.value ?? "").replace(/"/g, "");
    const billsDay = parseInt(get("bills_day")) || 5;
    const month = today.slice(0, 7);
    if (dom >= billsDay && hhmm >= digestHour && get("bills_sent_on") !== month) {
      const { data: apts } = await db.from("apartments").select("id").eq("active", true);
      const { data: bs } = await db.from("bills").select("paid").eq("month", month + "-01");
      // the list of bill types lives in app_settings, written by the app,
      // so adding a type never leaves this count behind
      const rawTypes = (cfg ?? []).find((r: any) => r.key === "bill_types")?.value;
      const typeList = Array.isArray(rawTypes)
        ? rawTypes
        : (() => { try { return JSON.parse(rawTypes); } catch { return null; } })();
      const TYPES = (typeList && typeList.length) ? typeList.length : 6;
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


  // ---- 6. pull bookings from Booking.com / Airbnb calendar feeds (hourly) ----
  try {
    const { data: runRow } = await db.from("app_settings").select("value").eq("key", "ical_last_run").maybeSingle();
    const lastRun = String(runRow?.value ?? "").replace(/"/g, "");
    const mins = lastRun ? (Date.now() - Date.parse(lastRun)) / 60000 : 9999;
    if (mins >= 55) {
      await db.from("app_settings").upsert({ key: "ical_last_run", value: new Date().toISOString() }, { onConflict: "key" });
      const { data: feeds } = await db.from("ical_feeds").select("*").eq("active", true);
      const { data: apts } = await db.from("apartments").select("id, name, nightly_rate");
      const remindAt = String((await db.from("app_settings").select("value").eq("key", "stay_remind_time").maybeSingle()).data?.value ?? "09:00").replace(/"/g, "");

      for (const feed of feeds ?? []) {
        let status = "";
        try {
          const res = await fetch(feed.url, { headers: { "User-Agent": "Centrala/1.0" } });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const events = parseIcs(await res.text());
          const apt = (apts ?? []).find((a: any) => a.id === feed.apartment_id);
          const seen: string[] = [];
          let added = 0, updated = 0, clashes = 0, skippedBlocks = 0, replacedBlocks = 0;

          for (const ev of events) {
            if (!ev.uid || !ev.start || !ev.end || ev.end <= today) continue;   // ignore finished stays
            const uid = `${feed.id}:${ev.uid}`;
            seen.push(uid);
            const blocked = /not available|blocked|unavailable|^closed$/i.test(ev.summary ?? "");
            const name = cleanGuest(ev.summary ?? "", feed.source, blocked);
            const nights = Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 86400000);
            const amount = blocked ? 0 : Math.round(nights * (Number(apt?.nightly_rate) || 0));

            const { data: existing } = await db.from("stays").select("id, check_in, check_out").eq("external_uid", uid).maybeSingle();
            if (existing) {
              if (existing.check_in !== ev.start || existing.check_out !== ev.end) {
                const { error } = await db.from("stays").update({ check_in: ev.start, check_out: ev.end }).eq("id", existing.id);
                if (error) clashes++; else updated++;
              }
              continue;
            }

            // Platforms export blocks as well as reservations, and a listing that
            // imports another calendar re-exports those too — so the same nights
            // can arrive several times. A block over nights already covered adds
            // nothing; a real reservation replaces any block sitting on it.
            const { data: over } = await db.from("stays")
              .select("id, guest_name, external_uid")
              .eq("apartment_id", feed.apartment_id)
              .lt("check_in", ev.end).gt("check_out", ev.start);
            if ((over ?? []).length) {
              if (blocked) { skippedBlocks++; continue; }
              const onlyBlocks = over!.every((o: any) => (o.notes ?? "").startsWith("Blocked") || /^Blocked/i.test(o.guest_name ?? ""));
              if (onlyBlocks) {
                await db.from("stays").delete().in("id", over!.map((o: any) => o.id));
                replacedBlocks += over!.length;
              } else { clashes++; continue; }
            }

            const { data: made, error } = await db.from("stays").insert({
              apartment_id: feed.apartment_id, guest_name: name,
              check_in: ev.start, check_out: ev.end, amount,
              source: feed.source, external_uid: uid, feed_id: feed.id,
              notes: blocked ? "Blocked on " + feed.source : null,
            }).select().single();
            if (error) { clashes++; continue; }
            added++;

            // the same day-before reminder a hand-entered stay gets
            if (!blocked && ev.start > today) {
              const d = new Date(ev.start + "T12:00");
              d.setDate(d.getDate() - 1);
              const due = d.toISOString().slice(0, 10);
              await db.from("tasks").insert({
                title: `Check-in: ${name}${apt ? " \u00b7 " + apt.name : ""}`,
                context: "apts", due_date: due < today ? today : due, due_time: remindAt, remind: true,
                notes: `Arrives ${ev.start} \u00b7 leaves ${ev.end} \u00b7 ${nights} night(s) \u00b7 ${feed.source}`,
                stay_id: made.id,
              });
            }
          }

          // a reservation that vanished from the feed was cancelled
          const { data: mine } = await db.from("stays").select("id, external_uid, check_in")
            .eq("feed_id", feed.id).gte("check_in", today);
          const gone = (mine ?? []).filter((s: any) => s.external_uid && !seen.includes(s.external_uid));
          for (const g of gone) await db.from("stays").delete().eq("id", g.id);

          status = `${added} new, ${updated} changed, ${gone.length} cancelled`
            + (skippedBlocks ? `, ${skippedBlocks} duplicate block(s) ignored` : "")
            + (replacedBlocks ? `, ${replacedBlocks} block(s) replaced by a booking` : "")
            + (clashes ? `, ${clashes} clash with an existing booking` : "");
          if (added) {
            await sendToAll("New booking", `${added} from ${feed.source}${apt ? " \u00b7 " + apt.name : ""}`,
              `ical-${feed.id}`, (r) => r.role === "owner" || !!r.see_apts);
          }
        } catch (e) {
          status = "Failed: " + (e instanceof Error ? e.message : String(e));
          console.error("ical", feed.url, e);
        }
        await db.from("ical_feeds").update({ last_sync: new Date().toISOString(), last_status: status }).eq("id", feed.id);
      }
    }
  } catch (e) { console.error("ical sync", e); }


  // ---- 7. overdue nudge for the team (the owner gets this inside the digest,
  //         so sending it here as well would be the same news twice) ----
  try {
    const { data: cfgO } = await db.from("app_settings").select("key, value").in("key", ["digest_hour", "overdue_sent_on"]);
    const getO = (k: string) => String((cfgO ?? []).find((r: any) => r.key === k)?.value ?? "").replace(/"/g, "");
    const hour = getO("digest_hour") || "07:30";
    if (hhmm >= hour && getO("overdue_sent_on") !== today) {
      const { data: late } = await db.from("tasks").select("id, title, context, assigned_to")
        .is("recurrence", null).eq("done", false).lt("due_date", today);
      if ((late ?? []).length) {
        const byCtx: Record<string, number> = {};
        for (const t of late!) byCtx[t.context] = (byCtx[t.context] ?? 0) + 1;
        const body = Object.entries(byCtx).map(([c, n]) => `${c}: ${n}`).join(" \u00b7 ");
        await sendToAll(`${late!.length} task(s) overdue`, body, "overdue",
          (r) => r.role !== "owner" && Object.keys(byCtx).some((c) => (r.task_contexts ?? []).includes(c)),
          late!.length === 1 ? late![0].id : null);
      }
      await db.from("app_settings").upsert({ key: "overdue_sent_on", value: today }, { onConflict: "key" });
    }
  } catch (e) { console.error("overdue nudge", e); }

  return new Response("ok");
});

// ---- iCal helpers ----
function parseIcs(text: string) {
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (const l of raw) {                     // RFC 5545: a leading space continues the previous line
    if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1);
    else lines.push(l);
  }
  const events: any[] = [];
  let cur: any = null;
  for (const l of lines) {
    if (l.startsWith("BEGIN:VEVENT")) cur = {};
    else if (l.startsWith("END:VEVENT")) { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const i = l.indexOf(":");
      if (i < 0) continue;
      const name = l.slice(0, i).split(";")[0].toUpperCase();
      const val = l.slice(i + 1).trim();
      if (name === "UID") cur.uid = val;
      else if (name === "SUMMARY") cur.summary = val;
      else if (name === "DTSTART") cur.start = icsDate(val);
      else if (name === "DTEND") cur.end = icsDate(val);
    }
  }
  return events;
}
function icsDate(v: string) {
  const m = v.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function cleanGuest(summary: string, source: string, blocked: boolean) {
  if (blocked) return `Blocked (${source})`;
  const s = summary.replace(/^CLOSED\s*-\s*/i, "").replace(/\s*\(.*?\)\s*$/, "").trim();
  if (!s || /^(reserved|booking|airbnb|closed|busy)$/i.test(s)) return `${source} guest`;
  return s.slice(0, 80);
}
