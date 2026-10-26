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
import { occursOn } from "./occurs.ts";

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

// Whether a person sees a flat, as the app shows it to them: the owner sees
// every one but those they have put away (hide_apts); anyone else needs the
// Apartments tab, and if limited, the flat must be one they manage or one they
// have been given (apt_ids). The columns arrive with migration 0006 and read
// as empty before it, which leaves things as they were.
const aptVisible = (r: any, a: any) => r.role === "owner"
  ? !(r.hide_apts ?? []).includes(a.id)
  : !!r.see_apts && (!r.apts_own_only || a.managed_by === r.user_id || (r.apt_ids ?? []).includes(a.id));
// the owner hears about a task unless it belongs to a flat they have put away
const ownerSees = (r: any, t: any) => r.role === "owner" && !(t.apartment_id && (r.hide_apts ?? []).includes(t.apartment_id));

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
  // The function is deployed with --no-verify-jwt, so this header is the only
  // thing standing between the schedule and the open internet. Refuse when the
  // secret is missing: without it anyone could fire notifications at every
  // phone and burn the once-a-day markers (reminded_on, low_alerted_on,
  // digest_sent_on, bills_sent_on) so the real reminders never arrive.
  const SECRET = Deno.env.get("PUSH_SECRET");
  if (!SECRET) {
    console.error("PUSH_SECRET is not set — refusing to run. supabase secrets set PUSH_SECRET=...");
    return new Response("not configured", { status: 503 });
  }
  if (req.headers.get("x-push-key") !== SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const now = nowLocal();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dom = now.getDate();

  // A repeating task is settled for today by a tick for today, or by being
  // marked as not happening. last_done alone cannot say so: ticking off an
  // earlier day that was missed moves it to that day, and today's reminder
  // would come anyway. Read by the reminders and by the morning digest.
  const { data: comps } = await db.from("task_completions").select("task_id").eq("done_on", today);
  const settledToday = new Set((comps ?? []).map((c: any) => c.task_id));
  const doneToday = (t: any) => t.recurrence ? settledToday.has(t.id) || t.last_done === today : !!t.done;

  // ---- 1. task reminders ----
  const { data: tasks } = await db.from("tasks").select("*")
    .eq("remind", true).not("due_time", "is", null);
  // A limited person hears about a flat's task only if the flat is theirs —
  // the same rule the database applies to what they can read (migration 0006).
  const { data: aptRows } = await db.from("apartments").select("*");
  const { data: stayRows } = await db.from("stays").select("id, apartment_id").gte("check_out", today);
  const flatOf = (t: any) => t.apartment_id ?? (stayRows ?? []).find((s: any) => s.id === t.stay_id)?.apartment_id ?? null;
  const flatOk = (r: any, t: any) => {
    const id = flatOf(t);
    if (!r.apts_own_only || !id) return true;
    const a = (aptRows ?? []).find((x: any) => x.id === id);
    return !!a && (a.managed_by === r.user_id || (r.apt_ids ?? []).includes(a.id));
  };
  for (const t of tasks ?? []) {
    // on the days the Tasks tab lists it, by the same rules — see occurs.ts
    const isToday = occursOn(t, today);
    // Fire ahead of the task by however many minutes it asks for — a reminder
    // that arrives as something starts is too late to be any use.
    const lead = Number(t.remind_before) || 0;
    const fireAt = (() => {
      const [h, m] = t.due_time.slice(0, 5).split(":").map(Number);
      const mins = Math.max(0, h * 60 + m - lead);
      return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
    })();
    if (isToday && !doneToday(t) && t.reminded_on !== today && fireAt <= hhmm) {
      // A personal task is private: it goes to whoever it belongs to, and to
      // anyone they have given access to — never to everyone with the context.
      const who = t.context === "personal"
        ? (r: any) => r.user_id === t.owner_uid || (r.personal_access ?? []).includes(t.owner_uid)
        : t.assigned_to
          ? (r: any) => ownerSees(r, t) || r.user_id === t.assigned_to
          : (r: any) => ownerSees(r, t) || ((r.task_contexts ?? []).includes(t.context) && flatOk(r, t));
      const at = t.due_time.slice(0, 5);
      const body = lead
        ? `${t.title} — за ${lead >= 60 ? (lead / 60) + " ч." : lead + " мин."} (${at})`
        : `${t.title} (${at})`;
      await sendToAll("Потсетник", body, `task-${t.id}`, who, t.id);
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
  const sentOn = String(sentRow?.value ?? "").replace(/"/g, "").slice(0, 10);

  // A morning summary that arrives in the evening is worse than none. The rule
  // used to be "any time at or after the digest hour, if not sent today", so a
  // run that missed the morning — the schedule slipped, or an earlier query
  // failed — said "Good morning" at whatever hour it eventually ran. It now has
  // an upper bound: past the window the day is skipped rather than sent late.
  const minutesPast = (() => {
    const [dh, dm] = digestHour.split(":").map(Number);
    const [nh, nm] = hhmm.split(":").map(Number);
    return (nh * 60 + nm) - (dh * 60 + dm);
  })();
  const DIGEST_WINDOW_MIN = 180;      // three hours

  if (minutesPast >= 0 && minutesPast <= DIGEST_WINDOW_MIN && sentOn !== today) {
    // today's as the Tasks tab counts them, and what slipped from earlier days
    const openToday = (tasks0: any[]) =>
      tasks0.filter((t) => {
        const isToday = occursOn(t, today) ||
          (t.due_date && t.due_date < today && !t.done && !t.recurrence);
        return isToday && !doneToday(t);
      });
    const { data: all } = await db.from("tasks").select("*");
    const { data: ownerRow } = await db.from("user_roles").select("*").eq("role", "owner").maybeSingle();
    const ownerId = ownerRow?.user_id ?? null;
    // this message goes to the owner, so somebody else's personal tasks have
    // no business being counted in it — nor tasks for flats they have put away
    const open = openToday((all ?? []).filter((t: any) =>
      (t.context !== "personal" || !t.owner_uid || t.owner_uid === ownerId) && (!ownerRow || ownerSees(ownerRow, t))));
    const byCtx = (c: string) => open.filter((t) => t.context === c).length;
    const lowCount = (stock ?? []).filter((a) => a.min_stock > 0 && a.stock <= a.min_stock).length;
    // the per-area counts already contain these, so name them rather than
    // sending a second message that repeats the same tasks
    const lateN = open.filter((t) => !t.recurrence && t.due_date && t.due_date < today).length;
    let body = lateN ? `${lateN} overdue · ` : "";
    body += `Work: ${byCtx("work")} · Elaks: ${byCtx("elaks")} · Personal: ${byCtx("personal")} · Apts: ${byCtx("apts")}`;
    if (lowCount) body += ` · Low stock: ${lowCount}`;
    await sendToAll(`Good morning — ${open.length} today`, body, "digest", (r) => r.role === "owner");
    await db.from("app_settings").update({ value: today + "@" + hhmm }).eq("key", "digest_sent_on");
  }


  // ---- 4. unpaid bills reminder ----
  // Bills arrive the month after they cover: on 5 August the electricity bill
  // on the table is July's. So this counts the PREVIOUS month, and keeps
  // reminding weekly until every one of them is entered and paid.
  try {
    const { data: cfg } = await db.from("app_settings").select("key, value").in("key", ["bills_day", "bills_sent_on", "bill_types"]);
    const get = (k: string) => String((cfg ?? []).find((r: any) => r.key === k)?.value ?? "").replace(/"/g, "");
    const billsDay = parseInt(get("bills_day")) || 5;
    const prev = new Date(today + "T12:00Z");
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    const month = prev.toISOString().slice(0, 7);          // the month the bills are FOR
    const label = prev.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    // marker is "<month>@<date last sent>", so it can repeat weekly
    const [lastMonth, lastSent] = String(get("bills_sent_on") || "").split("@");
    const daysSince = lastSent ? Math.floor((Date.parse(today) - Date.parse(lastSent)) / 86400000) : 999;
    const dueNow = lastMonth !== month || daysSince >= 7;
    if (dom >= billsDay && hhmm >= digestHour && dueNow) {
      const { data: apts } = await db.from("apartments").select("*").eq("active", true);
      const { data: bs } = await db.from("bills").select("apartment_id, type, paid").eq("month", month + "-01");
      const { data: roles } = await db.from("user_roles").select("*");
      // the list of bill types lives in app_settings, written by the app,
      // so adding a type never leaves this count behind
      const rawTypes = (cfg ?? []).find((r: any) => r.key === "bill_types")?.value;
      const typeList = Array.isArray(rawTypes)
        ? rawTypes
        : (() => { try { return JSON.parse(rawTypes); } catch { return null; } })();
      const TYPES: string[] = (typeList && typeList.length)
        ? typeList.map((x: any) => String(x?.key ?? x))
        : ["electricity", "water", "internet", "building", "heating", "booking"];
      // what a flat asks for: nothing when its tenant pays the bills, and never
      // a platform's fee on a flat let by the month
      const typesFor = (a: any) => a.rent_mode === "monthly" ? (a.tenant_pays_bills ? [] : TYPES.filter((x) => x !== "booking")) : TYPES;
      // each person is told about the flats they see, so the count is theirs
      const unpaidFor = (r: any) => {
        const mine = (apts ?? []).filter((a: any) => aptVisible(r, a));
        const need = mine.reduce((n: number, a: any) => n + typesFor(a).length, 0);
        const paidN = (bs ?? []).filter((b: any) => b.paid && mine.some((a: any) => a.id === b.apartment_id && typesFor(a).includes(b.type))).length;
        return Math.max(0, need - paidN);
      };
      const byCount = new Map<number, Set<string>>();
      for (const r of roles ?? []) {
        if (r.role !== "owner" && !r.see_apts) continue;
        const n = unpaidFor(r);
        if (n > 0) byCount.set(n, (byCount.get(n) ?? new Set()).add(r.user_id));
      }
      const again = lastMonth === month ? " — still" : "";
      for (const [n, who] of byCount) {
        await sendToAll("Bills to pay", `${n} unpaid for ${label}${again}`, "bills", (r) => who.has(r.user_id));
      }
      await db.from("app_settings").upsert({ key: "bills_sent_on", value: month + "@" + today }, { onConflict: "key" });
    }
  } catch (e) { console.error("bills reminder", e); }

  // ---- 4b. rent that is late ----
  // A tenant's rent not (fully) in by the day after it fell due — said once a
  // month per tenant, to whoever sees that flat. leases arrives with migration
  // 0006; before it the query fails and this is skipped.
  try {
    const { data: leases, error: lerr } = await db.from("leases").select("*");
    if (!lerr && (leases ?? []).length && hhmm >= digestHour) {
      const m = today.slice(0, 7);
      const [y, mo] = m.split("-").map(Number);
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const { data: pays } = await db.from("rent_payments").select("lease_id, amount").eq("month", m + "-01");
      const { data: apts } = await db.from("apartments").select("*").eq("active", true);
      for (const l of leases ?? []) {
        if (String(l.start_date).slice(0, 7) > m || (l.end_date && String(l.end_date).slice(0, 7) < m)) continue;
        if (l.late_sent_month === m) continue;
        const due = `${m}-${pad(Math.min(Number(l.due_day) || 1, last))}`;
        if (today <= due) continue;                      // late from the day after
        const paid = (pays ?? []).filter((p: any) => p.lease_id === l.id).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
        const left = (Number(l.rent) || 0) - paid;
        if (left <= 0.005) continue;
        const apt = (apts ?? []).find((a: any) => a.id === l.apartment_id);
        if (!apt) continue;
        await sendToAll("Rent late", `${l.tenant_name} · ${apt.name}: ${Math.round(left).toLocaleString("mk-MK")} ден., due ${due.slice(8)}-${due.slice(5, 7)}`,
          `rent-${l.id}`, (r) => aptVisible(r, apt));
        await db.from("leases").update({ late_sent_month: m }).eq("id", l.id);
      }
    }
  } catch (e) { console.error("rent reminder", e); }

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
                stay_id: made.id, apartment_id: feed.apartment_id,
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
      const { data: late } = await db.from("tasks").select("id, title, context, assigned_to, owner_uid")
        .is("recurrence", null).eq("done", false).lt("due_date", today)
        .neq("context", "personal");     // private tasks are not counted in a shared nudge
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

  // ---- 8. insurance policies coming to an end ----
  // Told four times: a month out, then 20, 10 and 7 days before. Each mark is
  // recorded once, so a policy is never announced twice for the same one — and
  // if the app was quiet when a mark passed, the next run still says it, using
  // the real number of days left rather than the missed one.
  try {
    if (hhmm >= digestHour) {
      // Warnings scale to how long the cover runs: a year-long policy is worth
      // a month's notice, a one-month green card is not.
      const marksFor = (fromDate: string, toDate: string) => {
        const len = Math.round((Date.parse(toDate + "T12:00Z") - Date.parse(fromDate + "T12:00Z")) / 86400000);
        if (len >= 180) return [30, 20, 10, 7];
        if (len >= 45) return [14, 7, 3];
        return [7, 3, 1];
      };
      const wording = (days: number) => days === 0 ? "истекува денес"
        : days === 1 ? "истекува утре" : `истекува за ${days} дена`;

      const { data: pols } = await db.from("policies")
        .select("id, holder_name, policy_no, start_date, end_date, amount, reminded_days, has_green_card, green_card_no, green_card_end, gc_reminded_days")
        .eq("active", true);

      for (const p of pols ?? []) {
        // the policy itself
        if (p.end_date && p.end_date >= today) {
          const days = Math.round((Date.parse(p.end_date + "T12:00Z") - Date.parse(today + "T12:00Z")) / 86400000);
          const marks = marksFor(p.start_date ?? today, p.end_date);
          const done: number[] = p.reminded_days ?? [];
          const passed = marks.filter((m) => days <= m && !done.includes(m));
          if (passed.length) {
            await sendToAll("Полиса " + wording(days),
              `${p.holder_name}${p.policy_no ? " · " + p.policy_no : ""} · ${p.end_date}`,
              `policy-${p.id}`, (r) => r.role === "owner" || !!r.see_insurance);
            await db.from("policies").update({ reminded_days: done.concat(passed) }).eq("id", p.id);
          }
        }
        // the green card on it, which runs out much sooner
        if (p.has_green_card && p.green_card_end && p.green_card_end >= today) {
          const gdays = Math.round((Date.parse(p.green_card_end + "T12:00Z") - Date.parse(today + "T12:00Z")) / 86400000);
          const gmarks = marksFor(p.start_date ?? today, p.green_card_end);
          const gdone: number[] = p.gc_reminded_days ?? [];
          const gpassed = gmarks.filter((m) => gdays <= m && !gdone.includes(m));
          if (gpassed.length) {
            await sendToAll("Зелен картон " + wording(gdays),
              `${p.holder_name}${p.green_card_no ? " · " + p.green_card_no : ""} · ${p.green_card_end}`,
              `gc-${p.id}`, (r) => r.role === "owner" || !!r.see_insurance);
            await db.from("policies").update({ gc_reminded_days: gdone.concat(gpassed) }).eq("id", p.id);
          }
        }
      }
    }
  } catch (e) { console.error("policy reminders", e); }

  // ---- 9. somebody has put a task on your list ----
  // Announced once: the row remembers who it was last announced to, so an
  // assignment that has not changed is never repeated.
  try {
    const { data: fresh } = await db.from("tasks")
      .select("id, title, context, due_date, due_time, assigned_to, assigned_notified_to, created_by")
      .not("assigned_to", "is", null).eq("done", false);
    for (const t of fresh ?? []) {
      if (t.assigned_to === t.assigned_notified_to) continue;
      if (t.assigned_to !== t.created_by) {          // no need to tell yourself
        const when = t.due_date
          ? (t.due_date === today ? "денес" : t.due_date) + (t.due_time ? " " + String(t.due_time).slice(0, 5) : "")
          : "без датум";
        await sendToAll("Нова задача за тебе", `${t.title} · ${when}`,
          `assign-${t.id}`, (r: any) => r.user_id === t.assigned_to, t.id);
      }
      await db.from("tasks").update({ assigned_notified_to: t.assigned_to }).eq("id", t.id);
    }
  } catch (e) { console.error("assignment notices", e); }

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

// redeploy
