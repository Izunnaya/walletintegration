import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_TRANSFER_AMOUNT_MINOR,
  amountMinorToJson,
  parseAmountMinor,
} from "../src/domain/money.ts";

describe("parseAmountMinor", () => {
  it("accepts a positive integer string of kobo", () => {
    assert.deepEqual(parseAmountMinor("150000"), { ok: true, amountMinor: 150000n });
  });

  it("accepts the maximum exactly", () => {
    assert.deepEqual(parseAmountMinor(MAX_TRANSFER_AMOUNT_MINOR.toString()), {
      ok: true,
      amountMinor: MAX_TRANSFER_AMOUNT_MINOR,
    });
  });

  it("refuses one kobo above the maximum", () => {
    const justOver = (MAX_TRANSFER_AMOUNT_MINOR + 1n).toString();
    assert.deepEqual(parseAmountMinor(justOver), { ok: false, reason: "AMOUNT_ABOVE_MAXIMUM" });
  });

  it("refuses zero", () => {
    assert.deepEqual(parseAmountMinor("0"), { ok: false, reason: "AMOUNT_NOT_POSITIVE" });
  });

  it("refuses a number even when the value would be valid", () => {
    assert.deepEqual(parseAmountMinor(150000), { ok: false, reason: "AMOUNT_NOT_A_STRING" });
  });

  it("refuses anything that is not a plain run of digits", () => {
    for (const input of ["", " ", "-1", "1.5", "1e4", "+1", "0x1f", "12a", "１５", "NaN"]) {
      assert.deepEqual(
        parseAmountMinor(input),
        { ok: false, reason: "AMOUNT_NOT_AN_INTEGER" },
        `expected ${JSON.stringify(input)} to be refused`,
      );
    }
  });

  it("refuses null, undefined, objects and bigints", () => {
    for (const input of [null, undefined, {}, [], 10n, true]) {
      assert.deepEqual(parseAmountMinor(input), { ok: false, reason: "AMOUNT_NOT_A_STRING" });
    }
  });

  it("tolerates surrounding whitespace", () => {
    assert.deepEqual(parseAmountMinor("  150000  "), { ok: true, amountMinor: 150000n });
  });

  it("keeps a value that a double would round", () => {
    // 9007199254740993 is 2^53 + 1, the first integer a double cannot represent.
    const beyondDouble = 9007199254740993n;
    assert.notEqual(Number(beyondDouble).toString(), beyondDouble.toString());
    assert.equal(BigInt(beyondDouble.toString()), beyondDouble);
  });
});

describe("amountMinorToJson", () => {
  it("renders kobo as a string", () => {
    assert.equal(amountMinorToJson(150000n), "150000");
  });

  it("does not lose precision past the safe integer range", () => {
    const large = 9007199254740993n;
    assert.equal(amountMinorToJson(large), "9007199254740993");
  });
});
