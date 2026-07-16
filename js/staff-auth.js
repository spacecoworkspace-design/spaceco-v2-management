// Staff login + TOTP MFA + session guard, shared by sign-in.html and check-in.html.
// Design: after password sign-in, check the MFA assurance level. No factors enrolled yet ->
// force enrollment before granting access (first login always sets up MFA). Factor already
// enrolled but this session hasn't verified it -> challenge for a code. Only a session at aal2
// (or a factor-less state we never actually allow past enrollment) is treated as "in."

async function checkStaffRow(supabase) {
  // The staff SELECT policy intentionally exposes the whole staff directory to any active staff
  // member (not just their own row), so this must filter explicitly -- an unfiltered query
  // returns every staff row once more than one exists, and .maybeSingle() errors on that.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("staff").select("id, name, role, active").eq("id", user.id).maybeSingle();
  if (error || !data || !data.active) return null;
  return data;
}

async function signInStaff(supabase, { email, password }) {
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) return { error: signInError.message };

  const staff = await checkStaffRow(supabase);
  if (!staff) {
    await supabase.auth.signOut();
    return { error: "This account is not an active staff member." };
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aal.currentLevel === "aal2") {
    return { status: "in", staff };
  }
  if (aal.nextLevel === "aal2" && aal.currentLevel === "aal1") {
    return { status: "needs_challenge", staff };
  }
  // No factors enrolled at all -- force enrollment before this account can be used.
  return { status: "needs_enroll", staff };
}

async function enrollTotp(supabase) {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) return { error: error.message };
  return { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret };
}

async function verifyTotpCode(supabase, factorId, code) {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) return { error: challengeError.message };

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) return { error: verifyError.message };
  return { ok: true };
}

// Guard for check-in.html: must be signed in, staff, and at aal2 (MFA verified this session).
// getSession() first is deliberate: on a cold page load, calling an MFA method as the very
// first auth call on a freshly constructed client hung indefinitely in testing (reproduced
// reliably, 10+ seconds, not just slow). getSession() reads/validates the stored session and
// appears to settle whatever internal state the hang was waiting on -- warming up with it before
// touching mfa.* avoids the hang. Root cause not fully understood; this is a confirmed workaround.
async function requireStaffSession(supabase) {
  await supabase.auth.getSession();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { redirect: true };

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.currentLevel !== "aal2") return { redirect: true };

  const staff = await checkStaffRow(supabase);
  if (!staff) {
    await supabase.auth.signOut();
    return { redirect: true };
  }

  return { staff };
}
