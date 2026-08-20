import { describe, expect, it } from "vitest";
import { calculateMonth, formatMoney, normalizeNumericInput, validateBackup, validatePayment, visibleEmptyRows } from "./calculations.js";

describe("عرض المبالغ", () => {
  it("يعرض أرقامًا إنجليزية بلا صفرين ويحافظ على الكسر الحقيقي", () => {
    expect(formatMoney(1)).toBe("₪1");
    expect(formatMoney(123)).toBe("₪123");
    expect(formatMoney(12.5)).toBe("₪12.5");
    expect(formatMoney(1234)).toBe("₪1,234");
  });
});

describe("إدخال الأرقام العربية", () => {
  it("يحوّل الأرقام العربية والفارسية والفاصل العشري", () => {
    expect(normalizeNumericInput("١٢٣")).toBe("123");
    expect(normalizeNumericInput("۱۲۳")).toBe("123");
    expect(validatePayment("جهة", "١٢٫٥").value.amount).toBe(12.5);
    expect(validatePayment("جهة", "١٬٢٣٤").value.amount).toBe(1234);
  });
});

describe("أسطر الدفعات الفارغة", () => {
  it("يسمح بحذف جميع الأسطر ثم إضافة سطر جديد", () => {
    expect(visibleEmptyRows(0, 0)).toBe(5);
    expect(visibleEmptyRows(0, -5)).toBe(0);
    expect(visibleEmptyRows(0, -4)).toBe(1);
  });
});

describe("حساب الشهر", () => {
  it("يحسب الإجماليات والمتبقي دون تعديل المدخلات", () => {
    const payments = [{ amount: 3500, paid: true }, { amount: 1340.5, paid: false }];
    expect(calculateMonth(8000, 12000, payments)).toEqual({
      wallet: 8000, income: 12000, total: 4840.5, paid: 3500,
      unpaid: 1340.5, remaining: 15159.5,
    });
    expect(payments[0].amount).toBe(3500);
  });
});

describe("التحقق", () => {
  it("يرفض الدفعة الفارغة أو الصفرية", () => {
    expect(validatePayment("", 0).valid).toBe(false);
  });
  it("يقبل نسخة احتياطية سليمة ويرفض شهرًا مكررًا", () => {
    const base = { format: "hisabati-backup", version: 1, years: [{ year: 2026, months: [{ monthNumber: 0, payments: [] }] }] };
    expect(validateBackup(base)).toBe(base);
    expect(() => validateBackup({ ...base, years: [{ year: 2026, months: [{ monthNumber: 0, payments: [] }, { monthNumber: 0, payments: [] }] }] })).toThrow();
  });
});
