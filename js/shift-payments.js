// Shift Payments: computed daily summaries (from check_ins + drink_orders), drink/snack order
// logging, and manual shift reconciliation entries. Shared logic for shift-payments.html.

const DRINK_MENU = [
  { name: "Water", price: 10 },
  { name: "Tea", price: 15 },
  { name: "Green Mint", price: 15 },
  { name: "Anise", price: 15 },
  { name: "Nescafe", price: 20 },
  { name: "Espresso", price: 25 },
  { name: "Americano", price: 25 },
  { name: "Double Shot", price: 35 },
  { name: "Any with Milk", price: 45 },
  { name: "Cola", price: 20 },
  { name: "Redbull", price: 70 },
];

const SNACK_MENU = [
  { name: "Chips", price: 15 },
  { name: "Chocolate", price: 20 },
  { name: "Candy", price: 10 },
];

async function fetchActiveStaff(supabase) {
  const { data, error } = await supabase.from("staff").select("id, name").eq("active", true).order("name");
  if (error) return { error: error.message };
  return { staff: data || [] };
}

async function fetchDailySummary(supabase, date) {
  const [checkInsRes, drinkOrdersRes] = await Promise.all([
    supabase.from("check_ins").select("cashier_name, cost, cash, instapay").eq("visit_date", date),
    supabase.from("drink_orders").select("cashier_name, total, payment_method").eq("order_date", date),
  ]);
  if (checkInsRes.error) return { error: checkInsRes.error.message };
  if (drinkOrdersRes.error) return { error: drinkOrdersRes.error.message };

  const byCashier = {};
  const ensure = (name) => {
    if (!byCashier[name]) byCashier[name] = { cashierName: name, rooms: 0, drinks: 0, cash: 0, instapay: 0 };
    return byCashier[name];
  };

  (checkInsRes.data || []).forEach(c => {
    const row = ensure(c.cashier_name || "Unassigned");
    row.rooms += Number(c.cost) || 0;
    row.cash += Number(c.cash) || 0;
    row.instapay += Number(c.instapay) || 0;
  });

  (drinkOrdersRes.data || []).forEach(o => {
    const row = ensure(o.cashier_name || "Unassigned");
    row.drinks += Number(o.total) || 0;
    if (o.payment_method === "cash") row.cash += Number(o.total) || 0;
    if (o.payment_method === "instapay") row.instapay += Number(o.total) || 0;
  });

  const summary = Object.values(byCashier).map(r => ({ ...r, grandTotal: r.rooms + r.drinks }));
  return { summary };
}

async function logDrinkOrder(supabase, { cashierName, clientName, items, paymentMethod }) {
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const { error } = await supabase.from("drink_orders").insert({
    cashier_name: cashierName,
    guest_client_name: clientName || "Walk-in",
    order_date: new Date().toISOString().slice(0, 10),
    items,
    total,
    payment_method: paymentMethod,
  });
  return error ? { error: error.message } : { ok: true };
}

async function fetchDrinkOrders(supabase, date) {
  const { data, error } = await supabase.from("drink_orders")
    .select("id, order_date, cashier_name, guest_client_name, items, total, payment_method")
    .eq("order_date", date)
    .order("id", { ascending: false });
  if (error) return { error: error.message };
  return { orders: data || [] };
}

async function deleteDrinkOrder(supabase, id) {
  const { error } = await supabase.rpc("soft_delete_row", { p_table: "drink_orders", p_id: id });
  return error ? { error: error.message } : { ok: true };
}

async function addShiftPaymentRecord(supabase, { shiftDate, cashierName, cashTotal, instapayTotal, otherTotal }) {
  const { error } = await supabase.from("shift_payments").insert({
    shift_date: shiftDate,
    cashier_name: cashierName,
    cash_total: cashTotal,
    instapay_total: instapayTotal,
    other_total: otherTotal,
  });
  return error ? { error: error.message } : { ok: true };
}

async function fetchShiftPaymentRecords(supabase, date) {
  const { data, error } = await supabase.from("shift_payments")
    .select("id, shift_date, cashier_name, cash_total, instapay_total, other_total")
    .eq("shift_date", date)
    .order("id", { ascending: false });
  if (error) return { error: error.message };
  return { records: data || [] };
}

async function deleteShiftPaymentRecord(supabase, id) {
  const { error } = await supabase.rpc("soft_delete_row", { p_table: "shift_payments", p_id: id });
  return error ? { error: error.message } : { ok: true };
}
