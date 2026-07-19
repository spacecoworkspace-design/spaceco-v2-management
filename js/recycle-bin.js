// Recycle Bin: list/restore/permanently-delete soft-deleted rows across every table that
// supports it. All three actions go through RPCs (list_recycle_bin, restore_row, purge_row) --
// see migration 0011 for why (staff-gated, single deletion path).

const RECYCLE_TYPE_LABEL = {
  clients: "Client",
  check_ins: "Visit",
  reservations: "Reservation",
  drink_orders: "Drink Order",
  shift_payments: "Shift Record",
  expenses: "Expense",
  shared_space_packages: "Package",
};

function daysSinceDeleted(deletedAt) {
  const deleted = new Date(deletedAt);
  const now = new Date();
  return Math.floor((now - deleted) / (1000 * 60 * 60 * 24));
}

async function fetchRecycleBin(supabase) {
  const { data, error } = await supabase.rpc("list_recycle_bin");
  if (error) return { error: error.message };
  return { items: (data || []).sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at)) };
}

async function restoreItem(supabase, tableName, id) {
  const { error } = await supabase.rpc("restore_row", { p_table: tableName, p_id: id });
  return error ? { error: error.message } : { ok: true };
}

async function purgeItem(supabase, tableName, id) {
  const { error } = await supabase.rpc("purge_row", { p_table: tableName, p_id: id });
  return error ? { error: error.message } : { ok: true };
}
