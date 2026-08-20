import "./style.css";
import { authApi, storeApi } from "./firebase.js";
import { firebaseConfig } from "../firebase-config.js";
import { calculateMonth, formatMoney, normalizeNumericInput, validateBackup, validatePayment, visibleEmptyRows } from "./calculations.js";

const app = document.querySelector("#app");
const state = { user: null, years: [], year: null, months: new Map(), drafts: new Map(), extraRows: new Map(), unsubs: [], calculated: new Map(), dirty: new Set(), busy: false };
const firebaseConfigured = !Object.values(firebaseConfig).some((value) => String(value).includes("YOUR_"));

const escapeHtml = (text = "") => String(text).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
const firebaseError = (error) => ({
  "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "auth/email-already-in-use": "يوجد حساب بهذا البريد بالفعل.",
  "auth/weak-password": "استخدم كلمة مرور من 6 أحرف على الأقل.",
  "auth/invalid-email": "عنوان البريد الإلكتروني غير صالح.",
  "auth/too-many-requests": "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
  "auth/network-request-failed": "تعذر الاتصال بالإنترنت.",
}[error?.code] || error?.message || "حدث خطأ غير متوقع.");

function toast(message, type = "success") {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const item = document.createElement("div"); item.className = `toast ${type}`; item.textContent = message;
  region.append(item); setTimeout(() => item.remove(), 4200);
}
function saveState(label, mode = "saving") {
  const el = document.querySelector("#save-state"); if (!el) return;
  el.className = `save-state ${mode}`; el.textContent = label;
}
async function action(task, success) {
  saveState(navigator.onLine ? "جارٍ الحفظ..." : "تغييرات بانتظار المزامنة", navigator.onLine ? "saving" : "offline");
  try { await task(); saveState(navigator.onLine ? "تم الحفظ" : "تغييرات بانتظار المزامنة", navigator.onLine ? "saved" : "offline"); if (success) toast(success); }
  catch (error) { saveState("حدث خطأ في الحفظ", "error"); toast(firebaseError(error), "error"); throw error; }
}

function renderAuth() {
  app.innerHTML = `<main class="auth-page"><section class="auth-card" aria-labelledby="auth-title">
    <div class="brand-mark">ح</div><p class="eyebrow">دفتر مرتب، أينما كنت</p><h1 id="auth-title">حساباتي الشهرية</h1>
    <p class="muted">رتّب دخلك ودفعاتك من شهر 0 حتى شهر 12، واحتفظ بها متزامنة بين أجهزتك.</p>
    ${!firebaseConfigured ? `<div class="setup-note" role="note"><strong>يلزم إعداد Firebase</strong><span>استبدل القيم في <code>firebase-config.js</code> ثم أعد تشغيل التطبيق.</span></div>` : ""}
    <form id="auth-form" novalidate>
      <label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" required placeholder="name@example.com"></label>
      <label>كلمة المرور<input name="password" type="password" autocomplete="current-password" minlength="6" required placeholder="6 أحرف على الأقل"></label>
      <p id="auth-error" class="form-error" role="alert"></p>
      <button class="primary wide" name="intent" value="login">تسجيل الدخول</button>
      <button class="secondary wide" name="intent" value="register">إنشاء حساب جديد</button>
      <button class="link-button" type="button" id="reset-password">نسيت كلمة المرور؟</button>
    </form>
  </section></main><div id="toast-region" class="toast-region" aria-live="polite"></div>`;
  const form = document.querySelector("#auth-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); const submitter = event.submitter; const errorEl = document.querySelector("#auth-error");
    const email = form.email.value.trim(), password = form.password.value;
    if (!email || password.length < 6) { errorEl.textContent = "أدخل بريدًا صحيحًا وكلمة مرور من 6 أحرف على الأقل."; return; }
    submitter.disabled = true; errorEl.textContent = "";
    try { submitter.value === "register" ? await authApi.register(email, password) : await authApi.login(email, password); }
    catch (error) { errorEl.textContent = firebaseError(error); }
    finally { submitter.disabled = false; }
  });
  document.querySelector("#reset-password").addEventListener("click", async () => {
    const email = form.email.value.trim();
    if (!email) { document.querySelector("#auth-error").textContent = "اكتب بريدك الإلكتروني أولًا."; form.email.focus(); return; }
    try { await authApi.resetPassword(email); toast("أرسلنا رابط استعادة كلمة المرور إلى بريدك."); }
    catch (error) { document.querySelector("#auth-error").textContent = firebaseError(error); }
  });
}

function appShell() {
  app.innerHTML = `<header class="topbar"><div class="brand"><span class="brand-mark small">ح</span><div><strong>حساباتي</strong><span>دفتر الحساب الشهري</span></div></div>
    <div class="account"><span class="online-dot" aria-hidden="true"></span><span class="email">${escapeHtml(state.user.email)}</span><button class="icon-button" id="settings-button" aria-label="فتح الإعدادات">⚙</button><button class="quiet" id="logout">خروج</button></div></header>
    <main class="workspace"><section class="year-toolbar"><div><p class="eyebrow">السنة الحالية</p><div class="year-nav"><button id="prev-year" aria-label="السنة السابقة">‹</button><select id="year-select" aria-label="اختر السنة"></select><button id="next-year" aria-label="السنة التالية">›</button></div></div>
      <div class="toolbar-actions"><span id="save-state" class="save-state">جارٍ تحميل البيانات...</span><button class="secondary" id="new-year">+ سنة جديدة</button><button class="danger-text" id="delete-year">حذف السنة</button></div></section>
      <section id="content" aria-live="polite"><div class="loading"><span class="spinner"></span>جارٍ تحميل سنواتك...</div></section></main>
    <dialog id="payment-dialog"></dialog><dialog id="settings-dialog"></dialog><dialog id="confirm-dialog"></dialog>
    <div id="toast-region" class="toast-region" aria-live="polite"></div>`;
  document.querySelector("#logout").onclick = () => authApi.logout();
  document.querySelector("#settings-button").onclick = openSettings;
  document.querySelector("#new-year").onclick = createYear;
  document.querySelector("#delete-year").onclick = deleteYear;
  document.querySelector("#year-select").onchange = (event) => selectYear(Number(event.target.value));
  document.querySelector("#prev-year").onclick = () => stepYear(-1);
  document.querySelector("#next-year").onclick = () => stepYear(1);
}

function watchYears() {
  return storeApi.watchYears(state.user.uid, (snapshot) => {
    state.years = snapshot.docs.map((entry) => Number(entry.id));
    saveState(snapshot.metadata.hasPendingWrites ? "تغييرات بانتظار المزامنة" : (snapshot.metadata.fromCache && !navigator.onLine ? "غير متصل بالإنترنت" : "تم الحفظ"), snapshot.metadata.hasPendingWrites || !navigator.onLine ? "offline" : "saved");
    if (!state.year && state.years.length) selectYear(state.years[0]);
    else if (state.year && !state.years.includes(state.year)) state.years.length ? selectYear(state.years[0]) : showEmptyYears();
    updateYearSelect();
    if (!state.years.length) showEmptyYears();
  }, (error) => showLoadError(error));
}
function updateYearSelect() {
  const select = document.querySelector("#year-select"); if (!select) return;
  select.innerHTML = state.years.map((year) => `<option value="${year}" ${year === state.year ? "selected" : ""}>${year}</option>`).join("");
  document.querySelector("#delete-year").disabled = !state.year;
}
function stepYear(direction) { const i = state.years.indexOf(state.year); const target = state.years[i + direction]; if (target) selectYear(target); }
function showEmptyYears() {
  state.year = null; clearMonthListeners(); updateYearSelect();
  document.querySelector("#content").innerHTML = `<div class="empty-state"><span>١٢</span><h2>ابدأ أول سنة حسابية</h2><p>أنشئ سنة لتظهر أشهرها من 0 إلى 12.</p><button class="primary" id="empty-new-year">+ إنشاء سنة</button></div>`;
  document.querySelector("#empty-new-year").onclick = createYear;
}
function showLoadError(error) {
  document.querySelector("#content").innerHTML = `<div class="empty-state error-box"><h2>تعذر تحميل البيانات</h2><p>${escapeHtml(firebaseError(error))}</p><button class="primary" onclick="location.reload()">إعادة المحاولة</button></div>`;
}
function clearMonthListeners() { state.unsubs.forEach((fn) => fn()); state.unsubs = []; state.months.clear(); state.drafts.clear(); state.extraRows.clear(); state.calculated.clear(); state.dirty.clear(); }
function selectYear(year) {
  if (year === state.year && state.unsubs.length) return;
  clearMonthListeners(); state.year = year; updateYearSelect();
  document.querySelector("#content").innerHTML = `<div class="month-hint">اسحب أفقيًا للتنقل بين الأشهر</div><div id="months-board" class="months-board" aria-label="أشهر سنة ${year}">${Array.from({ length: 13 }, (_, month) => monthCard(month)).join("")}</div>`;
  for (let month = 0; month <= 12; month += 1) {
    const unsub = storeApi.watchMonth(state.user.uid, year, month, (change) => {
      const current = state.months.get(month) || { monthNumber: month, walletValue: 0, expectedIncome: 0, payments: [] };
      if (change.type === "month" && change.data) Object.assign(current, change.data);
      if (change.type === "payments") current.payments = change.data;
      state.months.set(month, current); renderMonth(month);
      saveState(change.metadata.hasPendingWrites ? "تغييرات بانتظار المزامنة" : (navigator.onLine ? "تم الحفظ" : "غير متصل بالإنترنت"), change.metadata.hasPendingWrites || !navigator.onLine ? "offline" : "saved");
    }, (error) => { document.querySelector(`#month-${month} .payments`).innerHTML = `<p class="inline-error">${escapeHtml(firebaseError(error))}</p>`; });
    state.unsubs.push(unsub);
  }
}
function monthCard(month) {
  return `<article class="month-card ${month === 0 ? "month-zero" : ""}" id="month-${month}"><header><span class="month-number">${month}</span><div><p>دفتر السنة</p><h2>شهر ${month}</h2></div></header>
    ${month ? `<div class="money-fields"><label>قيمة المحفظة الحالية المتوقعة<input inputmode="decimal" type="text" data-field="walletValue" placeholder="اكتب المبلغ"></label><label>المدخول المتوقع للشهر<input inputmode="decimal" type="text" data-field="expectedIncome" placeholder="اكتب المبلغ"></label></div>` : `<p class="zero-description">دفعات جانبية لا تدخل فيها المحفظة أو المدخول.</p>`}
    <div class="list-heading"><h3>الدفعات</h3><span class="payment-count">0 دفعات</span></div><div class="payments" role="table" aria-label="دفعات شهر ${month}"><div class="mini-loading"></div></div>
    <button class="add-payment secondary wide">+ إضافة سطر</button><button class="calculate primary wide">${month ? "احسب هذا الشهر" : "احسب شهر 0"}</button><div class="summary-slot"></div></article>`;
}
function renderMonth(month) {
  const card = document.querySelector(`#month-${month}`), data = state.months.get(month); if (!card || !data) return;
  if (month) card.querySelectorAll("[data-field]").forEach((input) => {
    if (document.activeElement !== input) {
      const value = data[input.dataset.field];
      input.value = Number(value) === 0 ? "" : (value ?? "");
    }
  });
  card.querySelector(".payment-count").textContent = `${data.payments.length} ${data.payments.length === 1 ? "دفعة" : "دفعات"}`;
  const draft = state.drafts.get(month);
  const availableRows = visibleEmptyRows(data.payments.length, state.extraRows.get(month) || 0, Boolean(draft));
  const draftSlot = Math.min(draft?.slot ?? 0, availableRows - 1);
  const draftMarkup = `<div class="payment draft-row" role="row"><div class="amount-cell" role="cell"><input class="inline-amount draft-amount" type="text" inputmode="decimal" value="${escapeHtml(draft?.amount ?? "")}" placeholder="المبلغ" aria-label="قيمة الدفعة الجديدة"></div><div class="recipient-cell" role="cell"><input class="inline-recipient draft-recipient" maxlength="120" value="${escapeHtml(draft?.recipient ?? "")}" placeholder="اسم الجهة" aria-label="الجهة الجديدة"><button class="cancel-draft" aria-label="إلغاء السطر الجديد">×</button></div></div>`;
  const availableMarkup = Array.from({ length: availableRows }, (_, slot) => draft && slot === draftSlot
    ? draftMarkup
    : `<div class="payment placeholder-row" data-empty-slot="${slot}" role="button" tabindex="0" aria-label="إضافة دفعة في هذا السطر"><span role="cell"><small>اضغط للإضافة</small></span><span role="cell"><button class="delete-empty-row" aria-label="حذف هذا السطر الفارغ">×</button></span></div>`).join("");
  card.querySelector(".payments").innerHTML = `<div class="payment-table-head" role="row"><span role="columnheader">قيمة الدفع</span><span role="columnheader">الجهة المدفوع لها</span></div>${data.payments.map((p) => `<div class="payment ${p.paid ? "paid" : ""}" data-id="${escapeHtml(p.id)}" role="row">
    <div class="amount-cell" role="cell"><input class="inline-amount" type="text" inputmode="decimal" value="${p.amount}" aria-label="قيمة دفعة ${escapeHtml(p.recipient)}"><label class="paid-check"><input type="checkbox" ${p.paid ? "checked" : ""} aria-label="${p.paid ? "إلغاء تحديد" : "تحديد"} دفعة ${escapeHtml(p.recipient)} كمدفوعة"><span aria-hidden="true">✓</span></label>${p.paid ? `<small>تم الدفع</small>` : ""}</div>
    <div class="recipient-cell" role="cell"><input class="inline-recipient" maxlength="120" value="${escapeHtml(p.recipient)}" aria-label="الجهة المدفوع لها"><div class="payment-actions"><button class="delete" aria-label="حذف دفعة ${escapeHtml(p.recipient)}">×</button></div></div></div>`).join("")}${availableMarkup}`;
  wireMonth(card, month, data); renderSummary(month);
}
function markDirty(month) { if (state.calculated.has(month)) { state.dirty.add(month); renderSummary(month); } }
function wireMonth(card, month, data) {
  card.querySelectorAll("[data-field], .inline-amount").forEach((input) => {
    input.onfocus = () => { if (input.value) input.select(); };
  });
  card.querySelectorAll("[data-field], .inline-amount, .inline-recipient").forEach((input) => {
    input.onkeydown = (event) => { if (event.key === "Enter") input.blur(); };
  });
  card.querySelector(".add-payment").onclick = () => {
    state.extraRows.set(month, (state.extraRows.get(month) || 0) + 1);
    renderMonth(month);
    card.querySelector(".payments")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  card.querySelectorAll(".placeholder-row").forEach((row) => {
    const activate = () => {
      if (!state.drafts.has(month)) {
        state.drafts.set(month, { recipient: "", amount: "", slot: Number(row.dataset.emptySlot) });
        renderMonth(month);
      }
      setTimeout(() => document.querySelector(`#month-${month} .draft-recipient`)?.focus(), 0);
    };
    row.onclick = activate;
    row.onkeydown = (event) => { if (!event.target.closest("button") && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); activate(); } };
    row.querySelector(".delete-empty-row").onclick = (event) => {
      event.stopPropagation();
      state.extraRows.set(month, (state.extraRows.get(month) || 0) - 1);
      renderMonth(month);
    };
  });
  card.querySelector(".calculate").onclick = () => { state.calculated.set(month, calculateMonth(data.walletValue, data.expectedIncome, data.payments)); state.dirty.delete(month); renderSummary(month); };
  card.querySelectorAll("[data-field]").forEach((input) => input.onchange = async () => {
    const value = Number(normalizeNumericInput(input.value)); if (!Number.isFinite(value) || value < 0) { toast("أدخل قيمة صحيحة لا تقل عن صفر.", "error"); input.value = Number(data[input.dataset.field]) === 0 ? "" : (data[input.dataset.field] ?? ""); return; }
    data[input.dataset.field] = value; markDirty(month); await action(() => storeApi.updateMonth(state.user.uid, state.year, month, { [input.dataset.field]: value }));
  });
  card.querySelectorAll(".payment[data-id]").forEach((row) => {
    const payment = data.payments.find((p) => p.id === row.dataset.id);
    row.querySelector(".paid-check input").onchange = async (event) => { markDirty(month); await action(() => storeApi.updatePayment(state.user.uid, state.year, month, payment.id, { paid: event.target.checked })); };
    row.querySelector(".inline-recipient").onchange = async (event) => {
      const result = validatePayment(event.target.value, payment.amount);
      if (!result.valid) { toast(result.errors.recipient, "error"); event.target.value = payment.recipient; return; }
      markDirty(month); await action(() => storeApi.updatePayment(state.user.uid, state.year, month, payment.id, { recipient: result.value.recipient }));
    };
    row.querySelector(".inline-amount").onchange = async (event) => {
      const result = validatePayment(payment.recipient, event.target.value);
      if (!result.valid) { toast(result.errors.amount, "error"); event.target.value = payment.amount; return; }
      markDirty(month); await action(() => storeApi.updatePayment(state.user.uid, state.year, month, payment.id, { amount: result.value.amount }));
    };
    row.querySelector(".delete").onclick = () => confirmAction("حذف الدفعة؟", `سيتم حذف دفعة «${payment.recipient}» نهائيًا.`, "حذف الدفعة", async () => { markDirty(month); await action(() => storeApi.deletePayment(state.user.uid, state.year, month, payment.id), "تم حذف الدفعة."); });
  });
  const draftRow = card.querySelector(".draft-row");
  if (draftRow) {
    const draft = state.drafts.get(month);
    const trySaveDraft = async () => {
      const result = validatePayment(draft.recipient, draft.amount);
      if (!result.valid) return;
      if (draft.saving) return; draft.saving = true;
      state.drafts.delete(month);
      renderMonth(month);
      try {
        markDirty(month);
        await action(() => storeApi.addPayment(state.user.uid, state.year, month, { ...result.value, paid: false }), "تمت إضافة السطر.");
      } catch {
        draft.saving = false;
        state.drafts.set(month, draft);
        renderMonth(month);
      }
    };
    draftRow.querySelector(".draft-recipient").oninput = (event) => { draft.recipient = event.target.value; };
    draftRow.querySelector(".draft-amount").oninput = (event) => { draft.amount = event.target.value; };
    draftRow.querySelector(".draft-recipient").onchange = trySaveDraft;
    draftRow.querySelector(".draft-amount").onchange = trySaveDraft;
    draftRow.querySelector(".cancel-draft").onclick = () => { state.drafts.delete(month); renderMonth(month); };
  }
}
function renderSummary(month) {
  const slot = document.querySelector(`#month-${month} .summary-slot`); if (!slot) return;
  const result = state.calculated.get(month); if (!result) { slot.innerHTML = ""; return; }
  slot.innerHTML = `<section class="summary"><div class="summary-head"><h3>ملخص الحساب</h3><span>لحظة الضغط</span></div>${state.dirty.has(month) ? `<p class="stale-note">تم تعديل البيانات؛ اضغط على زر الحساب لتحديث النتيجة.</p>` : ""}
    ${month ? `<div><span>المحفظة</span><strong>${formatMoney(result.wallet)}</strong></div><div><span>المدخول</span><strong>${formatMoney(result.income)}</strong></div>` : ""}
    <div><span>جميع الدفعات</span><strong>${formatMoney(result.total)}</strong></div><div><span>المدفوع</span><strong>${formatMoney(result.paid)}</strong></div><div><span>غير المدفوع</span><strong>${formatMoney(result.unpaid)}</strong></div>
    ${month ? `<div class="remaining"><span>المتبقي المتوقع</span><strong>${formatMoney(result.remaining)}</strong></div>` : ""}</section>`;
}

function openPaymentDialog(month, payment = null) {
  const dialog = document.querySelector("#payment-dialog"); dialog.innerHTML = `<form method="dialog" class="dialog-card" id="payment-form" novalidate><button type="button" class="dialog-close" aria-label="إغلاق">×</button>
    <p class="eyebrow">شهر ${month}</p><h2>${payment ? "تعديل الدفعة" : "إضافة دفعة جديدة"}</h2><label>الجهة المدفوع لها<input name="recipient" maxlength="120" value="${escapeHtml(payment?.recipient || "")}" autocomplete="off"><small class="field-error" id="recipient-error"></small></label>
    <label>مبلغ الدفع بالشيكل<input name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${payment?.amount ?? ""}" placeholder="مثال: 3500"><small class="field-error" id="amount-error"></small></label>
    <div class="dialog-actions"><button type="button" class="secondary cancel-payment">إلغاء</button><button type="submit" value="default" class="primary">حفظ الدفعة</button></div></form>`;
  const form = dialog.querySelector("form"); let changed = false; form.addEventListener("input", () => { changed = true; });
  const closeDialog = () => {
    if (!changed || confirm("سيضيع الإدخال غير المحفوظ. هل تريد الإغلاق؟")) dialog.close();
  };
  dialog.querySelector(".dialog-close").onclick = closeDialog;
  dialog.querySelector(".cancel-payment").onclick = closeDialog;
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); const result = validatePayment(form.recipient.value, form.amount.value);
    form.querySelector("#recipient-error").textContent = result.errors.recipient || ""; form.querySelector("#amount-error").textContent = result.errors.amount || "";
    if (!result.valid) { (result.errors.recipient ? form.recipient : form.amount).focus(); return; }
    const button = form.querySelector("[type=submit]"); if (state.busy) return; state.busy = true; button.disabled = true;
    try { markDirty(month); await action(() => payment ? storeApi.updatePayment(state.user.uid, state.year, month, payment.id, result.value) : storeApi.addPayment(state.user.uid, state.year, month, { ...result.value, paid: false }), payment ? "تم تعديل الدفعة." : "تمت إضافة الدفعة."); changed = false; dialog.close(); }
    finally { state.busy = false; button.disabled = false; }
  });
  dialog.addEventListener("cancel", (event) => { if (changed && !confirm("سيضيع الإدخال غير المحفوظ. هل تريد الإغلاق؟")) event.preventDefault(); }, { once: true });
  dialog.showModal(); setTimeout(() => form.recipient.focus(), 0);
}
function confirmAction(title, description, confirmLabel, callback) {
  const dialog = document.querySelector("#confirm-dialog"); dialog.innerHTML = `<form method="dialog" class="dialog-card compact"><div class="warning-icon">!</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><div class="dialog-actions"><button value="cancel" class="secondary">إلغاء</button><button value="confirm" class="danger">${escapeHtml(confirmLabel)}</button></div></form>`;
  dialog.onclose = () => { if (dialog.returnValue === "confirm") callback(); }; dialog.showModal();
}
async function createYear() {
  const raw = prompt("اكتب السنة الجديدة (مثل 2026):", String(new Date().getFullYear())); if (raw === null) return;
  const year = Number(raw); if (!Number.isInteger(year) || year < 1900 || year > 2200) return toast("أدخل سنة صحيحة بين 1900 و2200.", "error");
  if (state.years.includes(year)) return toast("هذه السنة موجودة بالفعل. اخترها من القائمة.", "error");
  await action(() => storeApi.createYear(state.user.uid, year), `تم إنشاء سنة ${year}.`); selectYear(year);
}
function deleteYear() { if (!state.year) return; const year = state.year; confirmAction(`حذف سنة ${year}؟`, "سيتم حذف جميع الأشهر والدفعات داخل هذه السنة نهائيًا ولا يمكن التراجع.", "حذف السنة نهائيًا", () => action(() => storeApi.deleteYear(state.user.uid, year), "تم حذف السنة.")); }

function openSettings() {
  const dialog = document.querySelector("#settings-dialog"); dialog.innerHTML = `<section class="dialog-card settings"><button class="dialog-close" aria-label="إغلاق">×</button><p class="eyebrow">البيانات والنسخ الاحتياطي</p><h2>الإعدادات</h2>
    <div class="setting-row"><div><strong>تصدير نسخة احتياطية</strong><span>تنزيل جميع السنوات والدفعات في ملف JSON.</span></div><button class="secondary" id="export-data">تصدير</button></div>
    <div class="setting-row"><div><strong>استيراد نسخة احتياطية</strong><span>تحقق من الملف ثم اختر الدمج أو الاستبدال.</span></div><label class="secondary file-button">اختيار ملف<input type="file" id="import-data" accept="application/json,.json"></label></div>
    <div id="import-preview"></div><div class="setting-row danger-zone"><div><strong>مسح جميع بياناتي</strong><span>يحذف الحسابات المالية فقط، وليس حساب تسجيل الدخول.</span></div><button class="danger" id="erase-data">مسح البيانات</button></div></section>`;
  dialog.querySelector(".dialog-close").onclick = () => dialog.close(); dialog.querySelector("#export-data").onclick = exportData; dialog.querySelector("#import-data").onchange = previewImport; dialog.querySelector("#erase-data").onclick = eraseAll; dialog.showModal();
}
async function exportData(event) {
  event.currentTarget.disabled = true;
  try { const backup = await storeApi.exportAll(state.user.uid); const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `hisabati-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); toast("تم إنشاء النسخة الاحتياطية."); }
  catch (error) { toast(`فشل التصدير: ${firebaseError(error)}`, "error"); } finally { event.currentTarget.disabled = false; }
}
async function previewImport(event) {
  const preview = document.querySelector("#import-preview");
  try { const backup = validateBackup(JSON.parse(await event.target.files[0].text())); const months = backup.years.reduce((n, y) => n + y.months.length, 0), payments = backup.years.reduce((n, y) => n + y.months.reduce((m, x) => m + x.payments.length, 0), 0);
    preview.innerHTML = `<div class="import-preview"><strong>الملف صالح</strong><p>${backup.years.length} سنوات · ${months} أشهر · ${payments} دفعات</p><p>الدمج يحافظ على بياناتك ويحدّث السجلات المتطابقة. الاستبدال يمسح بياناتك الحالية أولًا.</p><div class="dialog-actions"><button class="secondary" data-mode="merge">دمج</button><button class="danger" data-mode="replace">استبدال الكل</button></div><small id="import-progress"></small></div>`;
    preview.querySelectorAll("[data-mode]").forEach((button) => button.onclick = () => runImport(backup, button.dataset.mode));
  } catch (error) { preview.innerHTML = `<p class="inline-error">${escapeHtml(error.message || "فشل قراءة الملف.")}</p>`; }
}
function runImport(backup, mode) { const label = mode === "replace" ? "استبدال جميع البيانات؟" : "دمج النسخة؟"; confirmAction(label, mode === "replace" ? "ستُحذف بياناتك الحالية أولًا ثم تُستورد النسخة." : "ستُدمج النسخة مع البيانات الحالية دون حذف السنوات الأخرى.", "بدء الاستيراد", async () => { try { await action(() => storeApi.importAll(state.user.uid, backup, mode, (done, total) => { const el = document.querySelector("#import-progress"); if (el) el.textContent = `جارٍ الاستيراد: ${done} من ${total}`; }), "اكتمل استيراد النسخة."); document.querySelector("#settings-dialog")?.close(); } catch {} }); }
function eraseAll() {
  const typed = prompt("هذا الإجراء نهائي. اكتب كلمة «حذف» للمتابعة:"); if (typed !== "حذف") return toast("لم يتم المسح؛ كلمة التأكيد غير مطابقة.", "error");
  confirmAction("التأكيد النهائي لمسح البيانات", "سيتم حذف جميع سنواتك وأشهرك ودفعاتك. لا يمكن استرجاعها دون نسخة احتياطية.", "نعم، امسح بياناتي", async () => { await action(() => storeApi.deleteAll(state.user.uid), "تم مسح جميع البيانات المالية."); document.querySelector("#settings-dialog")?.close(); });
}

window.addEventListener("online", () => saveState("عاد الاتصال — جارٍ المزامنة...", "saving"));
window.addEventListener("offline", () => saveState("غير متصل بالإنترنت", "offline"));
renderAuth();
try {
  authApi.observe((user) => { clearMonthListeners(); state.user = user; state.year = null; state.years = []; if (!user) renderAuth(); else { appShell(); state.unsubs.push(watchYears()); } });
} catch (error) { document.querySelector("#auth-error").textContent = firebaseError(error); }
