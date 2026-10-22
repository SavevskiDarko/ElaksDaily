// When a task falls due — the rules the app's Tasks tab uses (occursOn in
// index.html), kept the same here so a reminder arrives on exactly the days
// the app lists the task. Before this the server had rules of its own: a task
// every second day reminded every day, a weekly one every week however many
// weeks apart it was set, reminders began before a task's start date and went
// on after its end, and a task for the 31st never came round in a short month.
//
// Dates are the plain "YYYY-MM-DD" the database stores, counted as days on a
// calendar rather than moments in time, so the server's own time zone plays
// no part in it.

export type Repeating = {
  due_date?: string | null;
  recurrence?: string | null;
  recur_from?: string | null;
  recur_until?: string | null;
  recur_every?: number | string | null;
  recur_days?: number[] | null;
  recur_dow?: number | null;
  recur_dom?: number | null;
};

const DAY = 86400000;
const ymd = (ds: string) => [Number(ds.slice(0, 4)), Number(ds.slice(5, 7)), Number(ds.slice(8, 10))];
// days since 1 January 1970, on the calendar
const dayNo = (ds: string) => {
  const [y, m, d] = ymd(ds);
  return Date.UTC(y, m - 1, d) / DAY;
};
// Monday-based week number, counted as the app counts it, so the two agree
// on which weeks "every 2 weeks" means
const weekNo = (ds: string) => Math.floor((dayNo(ds) + 3) / 7);

export function recurDays(t: Repeating): number[] {
  if (t.recur_days && t.recur_days.length) return t.recur_days;
  return t.recur_dow !== null && t.recur_dow !== undefined ? [t.recur_dow] : [];
}

export function occursOn(t: Repeating, ds: string): boolean {
  if (!t.recurrence) return t.due_date === ds;
  const from = t.recur_from || t.due_date || null;
  if (from && ds < from) return false;                      // not started yet
  if (t.recur_until && ds > t.recur_until) return false;    // finished
  const every = Math.max(1, parseInt(String(t.recur_every ?? "")) || 1);
  const [y, m, d] = ymd(ds);

  if (t.recurrence === "daily") {
    if (every === 1 || !from) return true;
    const days = dayNo(ds) - dayNo(from);
    return days >= 0 && days % every === 0;
  }
  if (t.recurrence === "weekly") {
    if (!recurDays(t).includes(new Date(dayNo(ds) * DAY).getUTCDay())) return false;
    if (every === 1 || !from) return true;
    return (weekNo(ds) - weekNo(from)) % every === 0;
  }
  if (t.recurrence === "monthly") {
    // a task set for the 31st still falls on the 30th, 29th or 28th
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d !== Math.min(t.recur_dom || 1, last)) return false;
    if (every === 1 || !from) return true;
    const [fy, fm] = ymd(from);
    const months = (y - fy) * 12 + (m - fm);
    return months >= 0 && months % every === 0;
  }
  return false;
}
