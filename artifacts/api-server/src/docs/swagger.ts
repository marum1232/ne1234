import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Router } from "express";

const router = Router();

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "AJKMart API",
      version: "1.0.0",
      description: "AJKMart super-app API server — authentication, e-commerce, food delivery, ride-hailing, pharmacy, parcels, inter-city transport, and admin operations.",
      contact: {
        name: "AJKMart Support",
        email: "support@ajkmart.com",
      },
    },
    servers: [
      {
        url: process.env["APP_BASE_URL"] ?? `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "localhost:5000"}`,
        description: "Current environment",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Customer / user JWT access token",
        },
        adminBearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Admin JWT access token (requires admin-auth-v2 flow)",
        },
      },
      schemas: {
        ApiSuccess: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            data: { type: "object", example: {} },
            message: { type: "string", example: "OK" },
          },
        },
        ApiError: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Something went wrong" },
          },
        },
        Session: {
          type: "object",
          properties: {
            id: { type: "string" },
            deviceName: { type: "string" },
            browser: { type: "string" },
            os: { type: "string" },
            ip: { type: "string" },
            location: { type: "string", nullable: true },
            lastActiveAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
  apis: [
    "src/routes/auth/*.ts",
    "src/routes/admin/system/users.ts",
    "src/routes/health.ts",
    "src/routes/users.ts",
    "src/routes/orders.ts",
    "src/routes/wallet.ts",
  ],
};

const specs = swaggerJsdoc(options);

router.use(swaggerUi.serve, swaggerUi.setup(specs, {
  explorer: true,
  customSiteTitle: "AJKMart API Docs",
}));

export default router;
