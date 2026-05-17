import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Router } from "express";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

/* swagger-jsdoc reads STATIC JSDoc comments — always point at the TypeScript
   source files regardless of whether we're in dev (tsx, __filename ends in .ts)
   or bundled prod (esbuild, __filename is dist/index.mjs with __dirname=dist/).

   Resolution:
   - Dev (tsx):  __dirname === …/src/docs/   → ../routes  === …/src/routes
   - Bundled:    __dirname === …/dist/        → ../src/routes === …/src/routes ✓ */
const srcRoutesDir = __filename.endsWith(".ts")
  ? resolve(__dirname, "..", "routes")          // dev: src/docs → src/routes
  : resolve(__dirname, "..", "src", "routes");  // prod bundle: dist → src/routes

/* Always use .ts source files — swagger-jsdoc reads static comments only */
const ext = ".ts";

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
        url: process.env["APP_BASE_URL"] ? `${process.env["APP_BASE_URL"]}/api` : `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "localhost:5000"}/api`,
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
    resolve(srcRoutesDir, "auth", `identifier${ext}`),
    resolve(srcRoutesDir, "auth", `otp${ext}`),
    resolve(srcRoutesDir, "auth", `email-otp${ext}`),
    resolve(srcRoutesDir, "auth", `password${ext}`),
    resolve(srcRoutesDir, "auth", `register${ext}`),
    resolve(srcRoutesDir, "auth", `refresh${ext}`),
    resolve(srcRoutesDir, "auth", `two-factor${ext}`),
    resolve(srcRoutesDir, "auth", `magic-link${ext}`),
    resolve(srcRoutesDir, "auth", `social${ext}`),
    resolve(srcRoutesDir, "auth", `merge${ext}`),
    resolve(srcRoutesDir, "auth", `config${ext}`),
    resolve(srcRoutesDir, "auth", `misc${ext}`),
    resolve(srcRoutesDir, "admin", "system", `users${ext}`),
    resolve(srcRoutesDir, `health${ext}`),
    resolve(srcRoutesDir, `users${ext}`),
    resolve(srcRoutesDir, `orders${ext}`),
    resolve(srcRoutesDir, `wallet${ext}`),
  ],
};

const specs = swaggerJsdoc(options);

router.use(swaggerUi.serve, swaggerUi.setup(specs, {
  explorer: true,
  customSiteTitle: "AJKMart API Docs",
  customCss: `
    .swagger-ui .topbar { background: #1e293b; border-bottom: 1px solid #334155; }
    .swagger-ui .topbar-wrapper img { display: none; }
    .swagger-ui .topbar-wrapper::before {
      content: "AJKMart API Docs";
      color: #a5b4fc;
      font-weight: 700;
      font-size: 1.1rem;
      font-family: system-ui, sans-serif;
      margin-left: 4px;
    }
    .swagger-ui { font-family: system-ui, sans-serif; }
    body { background: #0f172a; }
  `,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    deepLinking: true,
  },
}));

router.get("/spec.json", (_req, res) => {
  res.json(specs);
});

export default router;
