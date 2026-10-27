import { describe, expect, it } from "vitest";
import {
  MAX_TRANSFER_AMOUNT_MINOR,
  amountMinorToJson,
  parseAmountMinor,
} from "../src/domain/money.ts";

describe("parseAmountMinor", () => {
  it("accepts a positive integer string of kobo", () => {
    expect(parseAmountMinor("150000")).toEqual({ ok: true, amountMinor: 150000n });
  });

  it("accepts the maximum exactly", () => {
    expect(parseAmountMinor(MAX_TRANSFER_AMOUNT_MINOR.toString())).toEqual({
      ok: true,
      amountMinor: MAX_TRANSFER_AMOUNT_MINOR,
    });
  });

  it("refuses one kobo above the maximum", () => {
    const justOver = (MAX_TRANSFER_AMOUNT_MINOR + 1n).toString();
    expect(parseAmountMinor(justOver)).toEqual({ ok: false, reason: "AMOUNT_ABOVE_MAXIMUM" });
  });

  it("refuses zero", () => {
    expect(parseAmountMinor("0")).toEqual({ ok: false, reason: "AMOUNT_NOT_POSITIVE" });
  });

  it("refuses a number even when the value would be valid", () => {
    expect(parseAmountMinor(150000)).toEqual({ ok: false, reason: "AMOUNT_NOT_A_STRING" });
  });

  it("refuses anything that is not a plain run of digits", () => {
    for (const input of ["", " ", "-1", "1.5", "1e4", "+1", "0x1f", "12a", "１５", "NaN"]) {
      expect(parseAmountMinor(input)).toEqual({ ok: false, reason: "AMOUNT_NOT_AN_INTEGER" });
    }
  });

  it("refuses null, undefined, objects and bigints", () => {
    for (const input of [null, undefined, {}, [], 10n, true]) {
      expect(parseAmountMinor(input)).toEqual({ ok: false, reason: "AMOUNT_NOT_A_STRING" });
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseAmountMinor("  150000  ")).toEqual({ ok: true, amountMinor: 150000n });
  });

  it("keeps a value that a double would round", () => {
    // 9007199254740993 is 2^53 + 1, the first integer a double cannot represent.
    const beyondDouble = 9007199254740993n;
    expect(Number(beyondDouble).toString()).not.toBe(beyondDouble.toString());
    expect(BigInt(beyondDouble.toString())).toBe(beyondDouble);
  });
});

describe("amountMinorToJson", () => {
  it("renders kobo as a string", () => {
    expect(amountMinorToJson(150000n)).toBe("150000");
  });

  it("does not lose precision past the safe integer range", () => {
    const large = 9007199254740993n;
    expect(amountMinorToJson(large)).toBe("9007199254740993");
  });
});
