import { describe, expect, it } from "vitest";
import {
  MAX_TRANSFER_AMOUNT_MINOR,
  amountMinorToJson,
  amountMinorSchema,
} from "../src/domain/money.ts";

describe("amountMinorSchema", () => {
  it("accepts a positive integer string of kobo", () => {
    expect(amountMinorSchema.safeParse("150000")).toEqual({ success: true, data: 150000n });
  });

  it("accepts the maximum exactly", () => {
    expect(amountMinorSchema.safeParse(MAX_TRANSFER_AMOUNT_MINOR.toString())).toEqual({
      success: true,
      data: MAX_TRANSFER_AMOUNT_MINOR,
    });
  });

  it("refuses one kobo above the maximum", () => {
    const justOver = (MAX_TRANSFER_AMOUNT_MINOR + 1n).toString();
    expect(amountMinorSchema.safeParse(justOver)).toMatchObject({
      success: false,
      error: { issues: [{ message: `amountMinor must not exceed ${MAX_TRANSFER_AMOUNT_MINOR} kobo` }] },
    });
  });

  it("refuses zero", () => {
    expect(amountMinorSchema.safeParse("0")).toMatchObject({
      success: false,
      error: { issues: [{ message: "amountMinor must be greater than zero" }] },
    });
  });

  it("refuses a number even when the value would be valid", () => {
    expect(amountMinorSchema.safeParse(150000)).toMatchObject({
      success: false,
      error: { issues: [{ message: "amountMinor must be a string of kobo, not a number" }] },
    });
  });

  it("refuses anything that is not a plain run of digits", () => {
    for (const input of ["", " ", "-1", "1.5", "1e4", "+1", "0x1f", "12a", "１５", "NaN"]) {
      expect(amountMinorSchema.safeParse(input)).toMatchObject({
        success: false,
        error: { issues: [{ message: "amountMinor must contain digits only" }] },
      });
    }
  });

  it("refuses null, undefined, objects and bigints", () => {
    for (const input of [null, undefined, {}, [], 10n, true]) {
      expect(amountMinorSchema.safeParse(input)).toMatchObject({
        success: false,
        error: { issues: [{ message: "amountMinor must be a string of kobo, not a number" }] },
      });
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(amountMinorSchema.safeParse("  150000  ")).toEqual({ success: true, data: 150000n });
  });

  it("normalises leading zeroes without changing the amount", () => {
    expect(amountMinorSchema.safeParse(" 000150000 ")).toEqual({ success: true, data: 150000n });
    expect(amountMinorSchema.safeParse("000")).toMatchObject({
      success: false,
      error: { issues: [{ message: "amountMinor must be greater than zero" }] },
    });
  });

  it("rejects integer strings beyond the safe number range as above the product limit", () => {
    expect(amountMinorSchema.safeParse("9007199254740993")).toMatchObject({
      success: false,
      error: { issues: [{ message: `amountMinor must not exceed ${MAX_TRANSFER_AMOUNT_MINOR} kobo` }] },
    });
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
