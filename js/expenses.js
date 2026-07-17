// Expenses: fetch/add/delete logic for expenses.html.

const EXPENSE_CATEGORIES = [
  "Rent", "Utilities", "Supplies", "Maintenance", "Salaries", "Marketing",
  "Food & Drinks Stock", "Other",
];

function monthBounds(d = new Date()) {
  const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { first, today };
}

async function fetchExpensesSummary(supabase) {
  const { first, today } = monthBounds();

  const [expensesRes, checkInsRes] = await Promise.all([
    supabase.from("expenses").select("amount, category, payment_method").gte("expense_date", first).lte("expense_date", today),
    supabase.from("check_ins").select("cost").gte("visit_date", first).lte("visit_date", today),
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

async function fetchExpenses(supabase, category) {
  let query = supabase.from("expenses").select("id, expense_date, description, category, amount, payment_method, notes")
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
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  return error ? { error: error.message } : { ok: true };
}
