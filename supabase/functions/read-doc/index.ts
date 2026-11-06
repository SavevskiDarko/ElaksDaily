// Reads a photographed supplier delivery note (испратница / фактура) and
// returns structured purchase lines for review in the app. With
// kind: "product" it reads a picture of goods instead — a supplier's web page,
// a price list, a box or its label — and returns articles for the Stock list.
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

// A product picture: what each article is, what it costs, and where its own
// photo sits on the picture, so the app can cut it out for the offers.
const productInstruction = (width: number, height: number, categories: string[]) => `You are reading a picture
that shows goods a security-systems installer in North Macedonia buys to resell: a screenshot of a
supplier's web shop (one product page or a list of products), a supplier's price list, or a photo of
a box or its label. Text may be Macedonian Cyrillic, Latin, or both.

The picture is ${width} × ${height} pixels.

Return ONLY a JSON object, no prose and no markdown fences:

{
  "supplier": "the shop or company selling these, from the logo, the web address or the header; null if not shown",
  "currency": "MKD" or "EUR" or another 3-letter code,
  "prices_vat": "with" if the picture says the prices include ДДВ/VAT (со ДДВ, ДДВ вклучен, incl. VAT),
                "without" if it says they do not (без ДДВ, + ДДВ, excl. VAT), null if it says neither,
  "products": [
    { "name": "the product's name as printed, brand first, e.g. HIKVISION IPC-D140HA-LUC 4 MP Smart Hybrid Light",
      "model": "the manufacturer's model number, e.g. IPC-D140HA-LUC or DS-2CE16D0T-IRF; null if none",
      "sku": "the shop's own article code (SKU, Шифра, Код); null if none",
      "buy_price": number or null,
      "list_price": number or null,
      "category": one of ${JSON.stringify(categories)},
      "unit": "ком" or "m",
      "cam_type": "ip" or "turbo" or null,
      "mp": number or null,
      "specs": ["short spec lines that are printed, e.g. 4 MP", "2.8 mm објектив", "IR 30 m"],
      "photo_box": [left, top, right, bottom] or null }
  ]
}

Rules:
- buy_price is what a reseller pays: a price marked wholesale, Wholesale Price, ВП, цена за препродавачи,
  your price, or the sale/action price. When only one price is shown, it is buy_price.
- list_price is the other, higher price when there are two: the crossed-out, regular or retail price
  (МП цена). Otherwise null.
- Prices are plain numbers: 2,100 ден → 2100, 1.250,00 → 1250.
- cam_type: "ip" for IP / network cameras and NVRs (Hikvision DS-2CD, Hikvision/Hilook IPC-, Dahua IPC-, PoE,
  Wi-Fi); "turbo" for Turbo HD / HDCVI / AHD / analog cameras and DVR/XVR (DS-2CE, THC-, HAC-). null for
  anything that is not a camera or recorder, or when you cannot tell.
- mp: the camera's megapixels (4 MP → 4, 4K → 8, 1080p → 2). null when not a camera or not shown.
- unit is "m" only for cable sold by the metre.
- specs: only what is actually printed on the picture, at most 6 lines, without the price. [] if none.
- photo_box: where the product's own photo is on the picture, in pixels of this ${width} × ${height}
  picture: the left, top, right and bottom edges of that photo, tight around it, without the
  text, buttons or icons next to it. null if there is no photo of this product.
- Include every product the picture shows with its name; skip menus, banners and adverts.
- If a value is genuinely unreadable use null rather than guessing.`;

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

    const { image, mediaType, kind, width, height, categories } = await req.json();
    if (!image) return json({ error: "No image" }, 400);
    const product = kind === "product";
    const cats = Array.isArray(categories) && categories.length
      ? categories.map((c: unknown) => String(c)).slice(0, 20)
      : ["CCTV", "DVR", "Alarm", "Access", "Cables", "Other"];
    const prompt = product
      ? productInstruction(Math.round(Number(width)) || 1600, Math.round(Number(height)) || 1200, cats)
      : INSTRUCTION;

    const { data: secret } = await admin.from("secrets").select("value")
      .eq("name", "anthropic_api_key").maybeSingle();
    if (!secret?.value) return json({ error: "No API key saved. Settings → Document reading." }, 400);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": secret.value,
        "anthropic-version": "2023-06-01",
        // a photo the model declines is tried again on the model Anthropic recommends for that case
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        fallbacks: "default",
        // it thinks before it answers, and that counts here too: room for a long note's lines
        max_tokens: 16000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
            { type: "text", text: prompt },
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
    if (out.stop_reason === "refusal") {
      console.error("refused", JSON.stringify(out.stop_details ?? null).slice(0, 200));
      return json({ error: product ? "That picture could not be read — try another one."
        : "That photo could not be read — try another shot of the note." }, 422);
    }
    if (out.stop_reason === "max_tokens") {
      console.error("cut short", JSON.stringify(out.usage ?? null));
      return json({ error: product ? "Too many articles to read in one go — take the picture in two parts."
        : "The note is too long to read in one go — photograph it in two halves." }, 422);
    }
    const text = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1));
    } catch (_e) {
      console.error("parse", cleaned.slice(0, 400));
      return json({ error: "Could not read that photo — try a straighter, brighter shot." }, 422);
    }

    if (product) {
      // the app checks each one; here only what is plainly not an article is dropped
      parsed.products = (Array.isArray(parsed.products) ? parsed.products : [])
        .filter((p: any) => p && typeof p.name === "string" && p.name.trim());
      return json(parsed);
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

// deployed via CI
