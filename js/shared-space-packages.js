// Shared Space Packages: prepaid passes for free Shared Space check-ins. Pricing/expiry match
// the old system's real sell form exactly (see migration 0010's comment).

const PACKAGE_TIERS = {
  "10_days": { label: "10 Days", price: 1400, daysIncluded: 10, expiryDays: 30 },
  "20_days": { label: "20 Days", price: 2700, daysIncluded: 20, expiryDays: 30 },
  "unlimited": { label: "Unlimited / Month", price: 3750, daysIncluded: null, expiryDays: 30 },
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysISO(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntil(dateStr) {
  const today = new Date(todayISO() + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

// Derives display status from stored status + dates -- expiry is a date comparison, not a
// separately-tracked flag (see migration comment).
function deriveStatus(pkg) {
  if (pkg.status === "cancelled") return "cancelled";
  if (pkg.status === "exhausted") return "exhausted";
  if (daysUntil(pkg.expires_date) < 0) return "expired";
  return "active";
}

function isExpiringSoon(pkg) {
  if (deriveStatus(pkg) !== "active") return false;
  if (daysUntil(pkg.expires_date) <= 3) return true;
  if (pkg.days_included != null && (pkg.days_included - pkg.days_used) <= 3) return true;
  return false;
}

async function fetchPackages(supabase) {
  const { data, error } = await supabase
    .from("shared_space_packages")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  return { packages: data || [] };
}

async function fetchPackagesSummary(supabase) {
  const result = await fetchPackages(supabase);
  if (result.error) return { error: result.error };

  const packages = result.packages;
  const active = packages.filter(p => deriveStatus(p) === "active");
  const expiringSoon = active.filter(isExpiringSoon);

  const { first } = (() => {
    const d = new Date();
    return { first: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01` };
  })();
  const soldThisMonth = packages.filter(p => p.purchased_date >= first);

  return {
    activeCount: active.length,
    expiringSoonCount: expiringSoon.length,
    soldThisMonthCount: soldThisMonth.length,
    revenueThisMonth: soldThisMonth.reduce((sum, p) => sum + (Number(p.price) || 0), 0),
  };
}

async function sellPackage(supabase, { clientId, clientName, clientPhone, tier, cashierId, cashierName, paymentMethod, purchasedDate }) {
  const tierInfo = PACKAGE_TIERS[tier];
  if (!tierInfo) return { error: "Invalid package tier" };

  const purchased = purchasedDate || todayISO();
  const { error } = await supabase.from("shared_space_packages").insert({
    client_id: clientId || null,
    client_name: clientName,
    client_phone: clientPhone || null,
    tier,
    price: tierInfo.price,
    days_included: tierInfo.daysIncluded,
    purchased_date: purchased,
    expires_date: addDaysISO(purchased, tierInfo.expiryDays),
    payment_method: paymentMethod,
    sold_by: cashierId || null,
    sold_by_name: cashierName,
  });
  return error ? { error: error.message } : { ok: true };
}

// Used by check-in.html: finds a client's currently-usable package, if any.
async function getActivePackageForClient(supabase, clientId) {
  if (!clientId) return { package: null };
  const { data, error } = await supabase
    .from("shared_space_packages")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .gte("expires_date", todayISO())
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };

  const usable = (data || []).find(p => p.days_included == null || p.days_used < p.days_included);
  return { package: usable || null };
}

// Consumes one check-in against a package -- marks it exhausted once a day-limited tier runs out.
async function consumePackageDay(supabase, pkg) {
  const newDaysUsed = pkg.days_used + 1;
  const update = { days_used: newDaysUsed };
  if (pkg.days_included != null && newDaysUsed >= pkg.days_included) {
    update.status = "exhausted";
  }
  const { error } = await supabase.from("shared_space_packages").update(update).eq("id", pkg.id);
  return error ? { error: error.message } : { ok: true };
}

async function cancelPackage(supabase, id) {
  const { error } = await supabase.from("shared_space_packages").update({ status: "cancelled" }).eq("id", id);
  return error ? { error: error.message } : { ok: true };
}
