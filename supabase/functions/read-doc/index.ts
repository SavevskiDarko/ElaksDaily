// Reads a photographed supplier delivery note (испратница / фактура) and
// returns structured purchase lines for review in the app.
//
// The API key lives in the `secrets` table, which has no select policy — only
// this function, running with the service role, can read it. It never reaches
// the phone.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const INSTRUCTION = `You are reading a photographed supplier delivery note or invoice from North Macedonia
(испратница / фактура). Text may be Macedonian Cyrillic, Latin, or both on one line.

Return ONLY a JSON object, no prose and no markdown fences:

{
  "supplier": "company name as printed, without the legal form if it is long",
  "doc_no": "document number, e.g. 001-464/2026",
  "doc_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or null",
  "currency": "MKD",
  "printed_total_gross": number or null,
  "items": [
    { "code": "supplier article code or null",
      "name": "article description as printed",
      "qty": number,
      "unit_price_gross": number,
      "line_total_gross": number,
      "vat_rate": 18 or 5 }
  ],
  "notes": "anything important you could not fit above, or null"
}

Rules:
- GROSS means the price WITH ДДВ included. Notes usually print "Цена без ДДВ" (net)
  and "Износ" (gross line total). Use the gross figures. If only net is printed,
  multiply by (1 + vat_rate/100) and round to 2 decimals.
- qty comes from Кол. / Количина. Keep decimals if present.
- unit_price_gross = line_total_gross / qty when a unit price is not printed.
- Serial numbers (Сериски број) belong in "notes", not in the name.
- If a value is genuinely unreadable use null rather than guessing.
- Read every line of the table, including ones that wrap onto two rows.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // the caller must be signed in, and allowed to see Elaks
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "Not signed in" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);
    const { data: role } = await admin.from("user_roles").select("role, see_elaks")
      .eq("user_id", userData.user.id).maybeSingle();
    if (!role || (role.role !== "owner" && !role.see_elaks)) return json({ error: "Not allowed" }, 403);

    const { image, mediaType } = await req.json();
    if (!image) return json({ error: "No image" }, 400);

    const { data: secret } = await admin.from("secrets").select("value")
      .eq("name", "anthropic_api_key").maybeSingle();
    if (!secret?.value) return json({ error: "No API key saved. Settings → Document reading." }, 400);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": secret.value,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
            { type: "text", text: INSTRUCTION },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("anthropic", res.status, detail.slice(0, 400));
      const friendly = res.status === 401 ? "The saved API key was rejected — check it in Settings."
        : res.status === 429 ? "Rate limited by the API — try again in a moment."
        : `Reading failed (${res.status})`;
      return json({ error: friendly }, 502);
    }

    const out = await res.json();
    const text = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1));
    } catch (_e) {
      console.error("parse", cleaned.slice(0, 400));
      return json({ error: "Could not read that photo — try a straighter, brighter shot." }, 422);
    }

    // arithmetic check: the app shows this so a misread line is obvious
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const sum = items.reduce((s: number, it: any) => {
      const line = Number(it.line_total_gross);
      if (Number.isFinite(line)) return s + line;
      return s + (Number(it.qty) || 0) * (Number(it.unit_price_gross) || 0);
    }, 0);
    const printed = Number(parsed.printed_total_gross);
    parsed.computed_total_gross = Math.round(sum * 100) / 100;
    parsed.totals_match = Number.isFinite(printed) ? Math.abs(printed - sum) < 1 : null;

    return json(parsed);
  } catch (e) {
    console.error("read-doc", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
