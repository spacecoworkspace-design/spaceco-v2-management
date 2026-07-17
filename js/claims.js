// Claim requests: fetch + resolve logic for claims.html.
// Resolution (merge/link) always happens server-side via confirm_claim/reject_claim RPCs --
// this file only reads and calls those, it never writes to clients/check_ins/reservations
// directly, so there's no client-side logic that can get the merge semantics wrong.

async function fetchPendingClaims(supabase) {
  const { data: claims, error } = await supabase
    .from("claim_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };

  const ids = (rows, key) => [...new Set(rows.filter(r => r[key]).map(r => r[key]))];
  const clientIds = ids(claims, "client_id");
  const dupIds = ids(claims, "duplicate_client_id");
  const checkInIds = ids(claims, "check_in_id");
  const reservationIds = ids(claims, "reservation_id");

  const [clientsRes, dupRes, checkInsRes, reservationsRes] = await Promise.all([
    clientIds.length ? supabase.from("clients").select("id, name, phone, email").in("id", clientIds) : Promise.resolve({ data: [] }),
    dupIds.length ? supabase.from("clients").select("id, name, phone, source").in("id", dupIds) : Promise.resolve({ data: [] }),
    checkInIds.length ? supabase.from("check_ins").select("id, visit_date, room, guest_name, guest_phone").in("id", checkInIds) : Promise.resolve({ data: [] }),
    reservationIds.length ? supabase.from("reservations").select("id, reservation_date, room, guest_name, guest_phone").in("id", reservationIds) : Promise.resolve({ data: [] }),
  ]);

  const byId = (rows) => Object.fromEntries((rows || []).map(r => [r.id, r]));
  const clientsById = byId(clientsRes.data);
  const dupById = byId(dupRes.data);
  const checkInsById = byId(checkInsRes.data);
  const reservationsById = byId(reservationsRes.data);

  const enriched = claims.map(c => ({
    ...c,
    client: clientsById[c.client_id] || null,
    duplicateClient: c.duplicate_client_id ? dupById[c.duplicate_client_id] : null,
    checkIn: c.check_in_id ? checkInsById[c.check_in_id] : null,
    reservation: c.reservation_id ? reservationsById[c.reservation_id] : null,
  }));

  return { claims: enriched };
}

async function confirmClaim(supabase, claimId) {
  const { error } = await supabase.rpc("confirm_claim", { p_claim_id: claimId });
  return error ? { error: error.message } : { ok: true };
}

async function rejectClaim(supabase, claimId) {
  const { error } = await supabase.rpc("reject_claim", { p_claim_id: claimId });
  return error ? { error: error.message } : { ok: true };
}
