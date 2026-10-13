import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { HttpError } from "../lib/http.js";
import { isNotFound } from "../lib/prismaErrors.js";

export const notFound: RequestHandler = (req) => {
  throw new HttpError(404, "NOT_FOUND", `No route for ${req.method} ${req.originalUrl}`);
};

/** Every error leaves the API as `{ error: { code, message, ...details } }`. Internals are never leaked. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    res.status(tooLarge ? 413 : 400).json({
      error: { code: tooLarge ? "FILE_TOO_LARGE" : "BAD_UPLOAD", message: err.message },
    });
    return;
  }
  if (isNotFound(err)) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  // body-parser errors carry an HTTP status.
  if (typeof err?.status === "number" && err.status >= 400 && err.status < 500 && err.expose) {
    res.status(err.status).json({ error: { code: "BAD_REQUEST", message: err.message } });
    return;
  }

  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};
