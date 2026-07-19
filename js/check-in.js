// Client lookup + check-in submission logic for check-in.html.

// Trial Client: lets staff quickly test the check-in flow without typing real data. Trial
// check-ins are tagged with this exact name/phone so "Clear Trial" can find and remove them in
// bulk without touching anything else -- goes through the same soft-delete path as everything
// else (recoverable from the Recycle Bin if cleared by mistake).
const TRIAL_GUEST_NAME = "TRIAL Test Guest";
const TRIAL_GUEST_PHONE = "00000000000";

async function clearTrialCheckIns(supabase) {
  const { data, error } = await supabase.from("check_ins").select("id").eq("guest_name", TRIAL_GUEST_NAME);
  if (error) return { error: error.message };
  const ids = (data || []).map(r => r.id);
  for (const id of ids) {
    await supabase.rpc("soft_delete_row", { p_table: "check_ins", p_id: id });
  }
  return { cleared: ids.length };
}

const ROOMS = [
  { label: "Room 4 Persons (1)", key: "room4-1" },
  { label: "Room 4 Persons (2)", key: "room4-2" },
  { label: "Room 6 Persons", key: "room6" },
  { label: "Room 8 Persons", key: "room8" },
  { label: "Class Room", key: "classroom" },
  { label: "Shared Space", key: "sharedspace" },
  { label: "Drawing Room", key: "drawingroom" },
];

// Looks up by exact Client ID if the query is numeric, otherwise by name/phone (case-insensitive
// partial match). Staff can SELECT all clients via RLS, so this is a real, unrestricted search.
async function lookupClient(supabase, query) {
  const q = query.trim();
  if (!q) return [];

  if (/^\d+$/.test(q)) {
    const { data } = await supabase.from("clients").select("id, name, phone, email").eq("id", Number(q));
    if (data && data.length) return data;
  }

  const { data } = await supabase
    .from("clients")
    .select("id, name, phone, email")
    .or(`normalized_name.ilike.%${q.toLowerCase()}%,phone.ilike.%${q}%`)
    .limit(10);
  return data || [];
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowLocal() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Real pricing pulled directly from the old system's check-in form, not guessed. Room 1-4 bill
// a first hour then a per-hour rate after, rounded up to the next hour (so 1h05m bills as 2
// hours -- matches how the old system's "1st hr, +X/hr" labels read). Drawing Room and Shared
// Space are flat day-rate tiers instead: whichever bracket the *actual* elapsed time falls into,
// not rounded, since "day rate" is a cap, not a per-hour multiplier.
const ROOM_PRICING = {
  "room4-1": { type: "hourly", firstHour: 250, perAdditionalHour: 80, label: "250 LE 1st hr, +80 LE/hr" },
  "room4-2": { type: "hourly", firstHour: 250, perAdditionalHour: 80, label: "250 LE 1st hr, +80 LE/hr" },
  "room6": { type: "hourly", firstHour: 320, perAdditionalHour: 120, label: "320 LE 1st hr, +120 LE/hr" },
  "room8": { type: "hourly", firstHour: 370, perAdditionalHour: 180, label: "370 LE 1st hr, +180 LE/hr" },
  "classroom": { type: "flat_hourly", perHour: 600, label: "600 LE per hour" },
  "drawingroom": { type: "tiered", tier1: 80, tier2: 160, dayRate: 200, label: "80 LE/1hr | 160 LE/2hr | 200 LE day" },
  "sharedspace": { type: "tiered", tier1: 50, tier2: 100, dayRate: 150, label: "50 LE/1hr | 100 LE/2hr | 150 LE day" },
};

function calculateRoomCost(roomKey, hoursElapsed) {
  const pricing = ROOM_PRICING[roomKey];
  if (!pricing) return 0;
  const h = Math.max(0, hoursElapsed);

  if (pricing.type === "tiered") {
    if (h <= 1) return pricing.tier1;
    if (h <= 2) return pricing.tier2;
    return pricing.dayRate;
  }

  const roundedHours = Math.max(1, Math.ceil(h));
  if (pricing.type === "flat_hourly") return roundedHours * pricing.perHour;
  if (roundedHours <= 1) return pricing.firstHour;
  return pricing.firstHour + (roundedHours - 1) * pricing.perAdditionalHour;
}

function combineDateTime(dateStr, timeStr) {
  // Postgres time columns round-trip through PostgREST as "HH:MM:SS", not "HH:MM" -- only pad
  // with seconds when the caller passed a bare "HH:MM" (e.g. straight from a <input type=time>).
  const datePart = String(dateStr).slice(0, 10);
  const timePart = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return new Date(`${datePart}T${timePart}`);
}

function hoursBetween(startDate, endDate) {
  return Math.max(0, (endDate - startDate) / (1000 * 60 * 60));
}

async function fetchActiveSessions(supabase) {
  const { data, error } = await supabase
    .from("check_ins")
    .select("id, client_id, is_guest, guest_name, room, room_key, visit_date, time_in, cashier_name, clients(name)")
    .is("time_out", null)
    .order("time_in", { ascending: true });
  if (error) return { error: error.message };
  return {
    sessions: (data || []).map(s => ({
      ...s,
      displayName: s.is_guest ? s.guest_name : (s.clients?.name || "Client"),
      startedAt: combineDateTime(s.visit_date, s.time_in),
    })),
  };
}

async function submitCheckout(supabase, { checkInId, timeOut, cashier, discount, paymentMethod, items, rating, feedback, startedAt, roomKey }) {
  const endDate = combineDateTime(todayLocal(), timeOut);
  const hours = hoursBetween(startedAt, endDate);
  const roomCost = Math.max(0, calculateRoomCost(roomKey, hours) - (Number(discount) || 0));

  const checkInUpdate = {
    time_out: timeOut,
    hours: Math.round(hours * 100) / 100,
    cost: roomCost,
    cash: paymentMethod === "cash" ? roomCost : 0,
    instapay: paymentMethod === "instapay" ? roomCost : 0,
  };
  if (rating) checkInUpdate.rating = rating;
  if (feedback) checkInUpdate.feedback = feedback;

  const { error: checkInError } = await supabase.from("check_ins").update(checkInUpdate).eq("id", checkInId);
  if (checkInError) return { error: checkInError.message };

  let drinksTotal = 0;
  if (items && items.length) {
    drinksTotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const { data: sessionRow } = await supabase.from("check_ins").select("guest_name, is_guest, client_id, clients(name)").eq("id", checkInId).single();
    const clientName = sessionRow ? (sessionRow.is_guest ? sessionRow.guest_name : sessionRow.clients?.name) : "Walk-in";

    const { error: orderError } = await supabase.from("drink_orders").insert({
      cashier_name: cashier.name,
      guest_client_name: clientName || "Walk-in",
      order_date: todayLocal(),
      items,
      total: drinksTotal,
      payment_method: paymentMethod,
    });
    if (orderError) return { error: orderError.message };
  }

  return { ok: true, roomCost, drinksTotal, grandTotal: roomCost + drinksTotal };
}

async function submitCheckIn(supabase, { clientId, guestName, guestPhone, guestEmail, room, cashier }) {
  const isGuest = !clientId;
  const roomDef = ROOMS.find(r => r.key === room);

  const { data, error } = await supabase
    .from("check_ins")
    .insert({
      client_id: clientId || null,
      is_guest: isGuest,
      guest_name: isGuest ? guestName : null,
      guest_phone: isGuest ? guestPhone : null,
      guest_email: isGuest ? (guestEmail || null) : null,
      room: roomDef ? roomDef.label : room,
      room_key: room,
      visit_date: todayLocal(),
      time_in: nowLocal(),
      cashier_id: cashier.id,
      cashier_name: cashier.name,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { checkInId: data.id };
}
