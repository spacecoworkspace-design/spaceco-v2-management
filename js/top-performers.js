// Top Performers: a loyalty/spend leaderboard computed from check_ins. Pure reporting -- no
// writes, no new tables. Groups by client_id when a check-in is linked to a real client,
// otherwise by guest_phone (falling back to guest_name) so repeat guests still show up.

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// weekOffset: 0 = current week (Mon-Sun), -1 = last week, etc.
function getWeekBounds(weekOffset) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + weekOffset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toISODate(monday), end: toISODate(sunday), label: `Week of ${toISODate(monday)}` };
}

// monthOffset: 0 = current month, -1 = last month, etc.
function getMonthBounds(monthOffset) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
  const label = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start: toISODate(first), end: toISODate(last), label };
}

async function fetchTopPerformers(supabase, { start, end }, limit = 10) {
  const { data, error } = await supabase
    .from("check_ins")
    .select("client_id, guest_name, guest_phone, room, cost, visit_date, clients(name, phone)")
    .gte("visit_date", start)
    .lte("visit_date", end);
  if (error) return { error: error.message };

  const groups = {};
  (data || []).forEach(row => {
    const key = row.client_id ? `client:${row.client_id}` : `guest:${row.guest_phone || row.guest_name || "unknown"}`;
    if (!groups[key]) {
      groups[key] = {
        name: row.client_id ? row.clients?.name : (row.guest_name || "Guest"),
        phone: row.client_id ? row.clients?.phone : row.guest_phone,
        isMember: !!row.client_id,
        clientId: row.client_id,
        visits: 0,
        totalSpent: 0,
        rooms: {},
        lastVisit: null,
      };
    }
    const g = groups[key];
    g.visits += 1;
    g.totalSpent += Number(row.cost) || 0;
    if (row.room) g.rooms[row.room] = (g.rooms[row.room] || 0) + 1;
    if (!g.lastVisit || row.visit_date > g.lastVisit) g.lastVisit = row.visit_date;
  });

  const ranked = Object.values(groups)
    .map(g => ({
      ...g,
      avgPerVisit: g.visits ? g.totalSpent / g.visits : 0,
      favRoom: Object.entries(g.rooms).sort((a, b) => b[1] - a[1])[0]?.[0] || "-",
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit);

  return { ranked };
}
