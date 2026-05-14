import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodSchema } from "zod";
import { logger } from "../lib/logger.js";

interface ValidationTarget {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

interface ValidationErrorDetail {
  field: string;
  message: string;
}

const formatZodDetails = (err: ZodError): ValidationErrorDetail[] =>
  err.errors.map((e) => ({
    field: e.path.length > 0 ? e.path.join(".") : "_root",
    message: e.message,
  }));

export function validate(schema: ValidationTarget) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (schema.body) {
      const result = schema.body.safeParse(req.body);
      if (!result.success) {
        logger.warn(
          { validationErrors: result.error.errors, url: req.url, method: req.method },
          "Request body validation failed"
        );
        res.status(400).json({
          success: false,
          error: "Validation Failed",
          details: formatZodDetails(result.error),
        });
        return;
      }
      req.body = result.data;
    }

    if (schema.query) {
      const result = schema.query.safeParse(req.query);
      if (!result.success) {
        logger.warn(
          { validationErrors: result.error.errors, url: req.url, method: req.method },
          "Request query validation failed"
        );
        res.status(400).json({
          success: false,
          error: "Validation Failed",
          details: formatZodDetails(result.error),
        });
        return;
      }
      const parsed = result.data as Record<string, unknown>;
      Object.keys(req.query).forEach((k) => {
        if (!(k in parsed)) delete (req.query as Record<string, unknown>)[k];
      });
      Object.assign(req.query, parsed);
    }

    if (schema.params) {
      const result = schema.params.safeParse(req.params);
      if (!result.success) {
        logger.warn(
          { validationErrors: result.error.errors, url: req.url, method: req.method },
          "Request params validation failed"
        );
        res.status(400).json({
          success: false,
          error: "Validation Failed",
          details: formatZodDetails(result.error),
        });
        return;
      }
      req.params = result.data as Record<string, string>;
    }

    next();
  };
}

export function validateBody(schema: ZodSchema) {
  return validate({ body: schema });
}

export function validateQuery(schema: ZodSchema) {
  return validate({ query: schema });
}

export function validateParams(schema: ZodSchema) {
  return validate({ params: schema });
}
