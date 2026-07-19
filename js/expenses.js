// Expenses: fetch/add/delete logic for expenses.html.

const EXPENSE_CATEGORIES = [
  "Rent", "Utilities", "Supplies", "Maintenance", "Salaries", "Marketing",
  "Food & Drinks Stock", "Other",
];

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// monthKey is "YYYY-MM". Returns the full calendar-month range, not just "up to today" --
// browsing a past month should show that whole month, not a truncated one.
function monthKeyBounds(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = `${monthKey}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const last = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  return { first, last };
}

async function fetchExpensesSummary(supabase, monthKey = currentMonthKey()) {
  const { first, last } = monthKeyBounds(monthKey);

  const [expensesRes, checkInsRes] = await Promise.all([
    supabase.from("expenses").select("amount, category, payment_method").gte("expense_date", first).lte("expense_date", last),
    supabase.from("check_ins").select("cost").gte("visit_date", first).lte("visit_date", last),
  ]);

  if (expensesRes.error) return { error: expensesRes.error.message };
  if (checkInsRes.error) return { error: checkInsRes.error.message };

  const expenses = expensesRes.data || [];
  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const paidCash = expenses.filter(e => e.payment_method === "cash").reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const paidInstapay = expenses.filter(e => e.payment_method === "instapay").reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const revenue = (checkInsRes.data || []).reduce((sum, c) => sum + (Number(c.cost) || 0), 0);

  const byCategory = {};
  expenses.forEach(e => {
    const cat = e.category || "Other";
    byCategory[cat] = (byCategory[cat] || 0) + (Number(e.amount) || 0);
  });

  return {
    totalExpenses, paidCash, paidInstapay,
    netRevenue: revenue - totalExpenses,
    byCategory,
  };
}

async function fetchExpenses(supabase, category, monthKey = currentMonthKey()) {
  const { first, last } = monthKeyBounds(monthKey);
  let query = supabase.from("expenses").select("id, expense_date, description, category, amount, payment_method, notes")
    .gte("expense_date", first)
    .lte("expense_date", last)
    .order("expense_date", { ascending: false })
    .order("id", { ascending: false });
  if (category && category !== "all") query = query.eq("category", category);

  const { data, error } = await query;
  if (error) return { error: error.message };
  return { expenses: data || [] };
}

async function addExpense(supabase, { description, category, amount, paidFrom, notes, expenseDate }) {
  const { error } = await supabase.from("expenses").insert({
    description, category, amount, payment_method: paidFrom, notes: notes || null,
    expense_date: expenseDate,
  });
  return error ? { error: error.message } : { ok: true };
}

async function deleteExpense(supabase, id) {
  const { error } = await supabase.rpc("soft_delete_row", { p_table: "expenses", p_id: id });
  return error ? { error: error.message } : { ok: true };
}
