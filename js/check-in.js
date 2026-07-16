// Client lookup + check-in submission logic for check-in.html.

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
