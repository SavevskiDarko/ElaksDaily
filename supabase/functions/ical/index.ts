// Publishes one apartment's booked dates as a calendar feed, so Booking.com
// and Airbnb block the nights you sold directly.
//
// Public on purpose — the platforms fetch it without signing in — so the
// address carries a random token and the feed says only "busy", never who is
// staying or what they paid.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateOnly = (iso: string) => String(iso).slice(0, 10).replace(/-/g, "");

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("apt");
  // "for" lets each platform have its own link, so their own bookings are not
  // sent back to them — that would create a duplicate block on their side
  const skip = (url.searchParams.get("for") || "").toLowerCase();

  if (!token) return new Response("Missing apartment", { status: 400 });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: apt } = await admin.from("apartments")
      .select("id, name").eq("feed_token", token).maybeSingle();
    if (!apt) return new Response("Unknown calendar", { status: 404 });

    const from = new Date();
    from.setDate(from.getDate() - 60);          // a little history, then everything ahead
    const { data: stays } = await admin.from("stays")
      .select("id, check_in, check_out, source, guest_name")
      .eq("apartment_id", apt.id)
      .gte("check_out", from.toISOString().slice(0, 10))
      .order("check_in");

    const now = stamp(new Date());
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Centrala//Apartment calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${apt.name} (Centrala)`,
    ];

    for (const s of stays ?? []) {
      const src = String(s.source || "").toLowerCase();
      if (skip && src.includes(skip)) continue;            // their own booking
      if (skip === "booking" && src.includes("booking")) continue;
      if (!s.check_in || !s.check_out) continue;
      lines.push(
        "BEGIN:VEVENT",
        `UID:centrala-${s.id}@centrala.app`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${dateOnly(s.check_in)}`,
        `DTEND;VALUE=DATE:${dateOnly(s.check_out)}`,
        "SUMMARY:Busy",                                    // never the guest's name
        "TRANSP:OPAQUE",
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");

    return new Response(lines.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "public, max-age=900",
        "Content-Disposition": `inline; filename="${apt.id}.ics"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    console.error("ical", e);
    return new Response("Error", { status: 500 });
  }
});
