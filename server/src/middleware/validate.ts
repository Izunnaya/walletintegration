import type { NextFunction, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { MAX_TRANSFER_AMOUNT_MINOR } from "../domain/money.ts";

// Where a malformed request is refused: wrong types, missing fields, an amount that is not
// a string of kobo. It returns 400 and names the fields that failed.
//
// Business rules are deliberately not checked here. Whether a wallet can afford a transfer
// is decided under a row lock inside the transaction, because a balance read from outside
// one is already stale by the time it is used.

export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);

  // isEmpty is a method, and calling it is the whole point: reading it without the
  // parentheses yields a function reference, which is always truthy, so every invalid
  // request would sail through.
  if (errors.isEmpty()) {
    next();
    return;
  }

  // One response, and status() rather than sendStatus(), because sendStatus sends the
  // body itself and a second .json() on top of it throws.
  res.status(400).json({
    error: {
      code: "VALIDATION_FAILED",
      message: "The request body is invalid.",
      requestId: req.requestId,
      details: errors.array().map((failure) => ({
        field: "path" in failure ? failure.path : null,
        message: failure.msg,
      })),
    },
  });
};

export const validateTransferRequest = [
  body("sourceWalletId")
    .isInt({ min: 1 })
    .withMessage("sourceWalletId must be a positive integer"),

  body("destinationWalletId")
    .isInt({ min: 1 })
    .withMessage("destinationWalletId must be a positive integer"),

  body("currency").equals("NGN").withMessage("currency must be NGN"),

  // Money arrives as a string of kobo. A JSON number is refused even when its value would
  // be valid, because a JSON number is a double and the precision loss would be silent.
  body("amountMinor")
    .isString()
    .withMessage("amountMinor must be a string of kobo, not a number")
    .bail()
    .matches(/^\s*\d+\s*$/)
    .withMessage("amountMinor must contain digits only")
    .bail()
    .custom((value: string) => {
      const amountMinor = BigInt(value.trim());

      if (amountMinor <= 0n) {
        throw new Error("amountMinor must be greater than zero");
      }

      if (amountMinor > MAX_TRANSFER_AMOUNT_MINOR) {
        throw new Error(`amountMinor must not exceed ${MAX_TRANSFER_AMOUNT_MINOR} kobo`);
      }

      return true;
    }),

  handleValidationErrors,
];
