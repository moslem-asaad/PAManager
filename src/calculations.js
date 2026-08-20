export function normalizeNumericInput(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/[٬,\s]/g, "");
}

export function toAmount(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(normalizeNumericInput(value));
  return Number.isFinite(number) ? number : 0;
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatMoney(value) {
  return moneyFormatter.format(toAmount(value));
}

export function visibleEmptyRows(paymentCount, adjustment = 0, hasDraft = false) {
  const baseRows = Math.max(0, 5 - paymentCount);
  return Math.max(hasDraft ? 1 : 0, baseRows + adjustment);
}

export function calculateMonth(walletValue, expectedIncome, payments = []) {
  const total = payments.reduce((sum, item) => sum + toAmount(item.amount), 0);
  const paid = payments.reduce(
    (sum, item) => sum + (item.paid ? toAmount(item.amount) : 0),
    0,
  );
  return {
    wallet: toAmount(walletValue),
    income: toAmount(expectedIncome),
    total,
    paid,
    unpaid: total - paid,
    remaining: toAmount(walletValue) + toAmount(expectedIncome) - total,
  };
}

export function validatePayment(recipient, amount) {
  const cleanRecipient = String(recipient ?? "").trim();
  const numericAmount = Number(normalizeNumericInput(amount));
  const errors = {};
  if (!cleanRecipient) errors.recipient = "اكتب اسم الجهة.";
  else if (cleanRecipient.length > 120) errors.recipient = "اسم الجهة طويل جدًا.";
  if (amount === "" || amount === null || amount === undefined) {
    errors.amount = "اكتب مبلغ الدفعة.";
  } else if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    errors.amount = "أدخل مبلغًا صحيحًا أكبر من صفر.";
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { recipient: cleanRecipient, amount: numericAmount },
  };
}

export function validateBackup(data) {
  if (!data || data.format !== "hisabati-backup" || data.version !== 1) {
    throw new Error("هذا الملف ليس نسخة احتياطية صالحة لتطبيق حساباتي.");
  }
  if (!Array.isArray(data.years)) throw new Error("قائمة السنوات غير صالحة.");
  for (const yearEntry of data.years) {
    if (!Number.isInteger(yearEntry.year) || yearEntry.year < 1900 || yearEntry.year > 2200) {
      throw new Error("تحتوي النسخة على سنة غير صالحة.");
    }
    if (!Array.isArray(yearEntry.months)) throw new Error("بيانات أشهر غير صالحة.");
    const seen = new Set();
    for (const month of yearEntry.months) {
      if (!Number.isInteger(month.monthNumber) || month.monthNumber < 0 || month.monthNumber > 12 || seen.has(month.monthNumber)) {
        throw new Error("تحتوي النسخة على رقم شهر غير صالح أو مكرر.");
      }
      seen.add(month.monthNumber);
      if (month.monthNumber > 0 && (![month.walletValue, month.expectedIncome].every((v) => Number.isFinite(Number(normalizeNumericInput(v))) && Number(normalizeNumericInput(v)) >= 0))) {
        throw new Error("تحتوي النسخة على قيمة محفظة أو مدخول غير صالح.");
      }
      if (!Array.isArray(month.payments)) throw new Error("قائمة دفعات غير صالحة.");
      for (const payment of month.payments) {
        const result = validatePayment(payment.recipient, payment.amount);
        if (!result.valid || typeof payment.paid !== "boolean") throw new Error("تحتوي النسخة على دفعة غير صالحة.");
      }
    }
  }
  return data;
}
