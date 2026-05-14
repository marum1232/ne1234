/**
 * Consolidated Zod validation schemas — single source of truth.
 *
 * All route handlers SHOULD import from here instead of defining
 * schemas inline.  Inline definitions are acceptable only for
 * highly route-specific shapes that have no reuse value.
 */

import { z } from "zod";

/* ── Phone number ──────────────────────────────────────────────────── */
export const PhoneSchema = z
  .string()
  .min(7, "Phone number is required")
  .max(20, "Phone number too long")
  .regex(/^[\d\s\-()+]{7,20}$/, "Phone must contain only digits, spaces, dashes, or parentheses");

/* ── Shared field helpers ──────────────────────────────────────────── */
const positiveAmount = z
  .union([z.number().positive(), z.string().min(1)])
  .transform((v) => parseFloat(String(v)))
  .refine((v) => !isNaN(v) && isFinite(v) && v > 0, "Amount must be a positive number");

/* ── User registration ─────────────────────────────────────────────── */
export const UserRegistrationSchema = z
  .object({
    phone: PhoneSchema,
    password: z.string().min(8, "Password must be at least 8 characters"),
    name: z.string().max(80).optional(),
    role: z.enum(["customer", "rider", "vendor"]).optional(),
    email: z.string().email().optional().or(z.literal("")),
    username: z
      .string()
      .min(3)
      .max(20)
      .regex(/^[a-z0-9_]+$/, "Username: lowercase letters, numbers, and underscores only")
      .optional(),
    cnic: z
      .string()
      .regex(/^\d{5}-\d{7}-\d{1}$/, "CNIC format must be XXXXX-XXXXXXX-X")
      .optional()
      .or(z.literal("")),
    nationalId: z.string().optional(),
    vehicleType: z.string().optional(),
    vehicleRegNo: z.string().optional(),
    drivingLicense: z.string().optional(),
    address: z.string().max(255).optional(),
    city: z.string().max(80).optional(),
    emergencyContact: z.string().optional(),
    vehiclePlate: z.string().optional(),
    vehiclePhoto: z.string().optional(),
    documents: z.string().optional(),
    businessName: z.string().max(120).optional(),
    businessType: z.string().optional(),
    storeAddress: z.string().max(255).optional(),
    ntn: z.string().optional(),
    storeName: z.string().max(120).optional(),
    captchaToken: z.string().optional(),
  })
  .strip();

/* ── User login ────────────────────────────────────────────────────── */
export const UserLoginSchema = z
  .object({
    identifier: z.string().min(3, "Phone, email, or username is required").optional(),
    username: z.string().min(3).optional(),
    password: z.string().min(1, "Password is required"),
    deviceFingerprint: z.string().max(512).optional(),
    role: z.enum(["customer", "rider", "vendor"]).optional(),
  })
  .strip()
  .refine((d) => d.identifier || d.username, {
    message: "Phone, email, or username is required",
    path: ["identifier"],
  });

/* ── OTP request / verify ──────────────────────────────────────────── */
export const SendOtpSchema = z
  .object({
    phone: PhoneSchema,
    role: z.enum(["customer", "rider", "vendor"]).optional(),
    deviceId: z.string().max(256).optional(),
    preferredChannel: z.enum(["whatsapp", "sms", "email"]).optional(),
    captchaToken: z.string().optional(),
  })
  .strip();

export const VerifyOtpSchema = z
  .object({
    phone: PhoneSchema,
    otp: z
      .string()
      .length(6, "OTP must be exactly 6 digits")
      .regex(/^\d{6}$/, "OTP must be 6 digits"),
    deviceFingerprint: z.string().max(512).optional(),
    deviceId: z.string().max(256).optional(),
    role: z.enum(["customer", "rider", "vendor"]).optional(),
  })
  .strip();

/* ── Order creation ────────────────────────────────────────────────── */
export const OrderCreateSchema = z
  .object({
    vendorId: z.string().min(1, "vendorId is required"),
    type: z.enum(["mart", "food"]).default("mart"),
    items: z
      .array(
        z.object({
          productId: z.string().optional(),
          name: z.string().min(1),
          qty: z.number().int().positive(),
          price: z.number().positive(),
          variantId: z.string().optional(),
        })
      )
      .min(1, "At least one item is required"),
    total: positiveAmount,
    deliveryAddress: z.string().min(1, "deliveryAddress is required").max(500),
    paymentMethod: z.enum(["cod", "wallet", "jazzcash", "easypaisa"]).default("cod"),
    note: z.string().max(500).optional(),
    promoCode: z.string().max(50).optional(),
  })
  .strip();

/* ── Wallet transaction ────────────────────────────────────────────── */
export const WalletTransactionSchema = z
  .object({
    amount: positiveAmount,
    paymentMethod: z
      .string()
      .min(1, "paymentMethod is required")
      .regex(/^[a-z_]+$/, "paymentMethod must be a lowercase identifier"),
    transactionId: z.string().min(1, "transactionId is required"),
    idempotencyKey: z.string().uuid("idempotencyKey must be a UUID"),
    accountNumber: z.string().optional(),
    note: z.string().max(200).optional(),
  })
  .strip();

/* ── Wallet send ───────────────────────────────────────────────────── */
export const WalletSendSchema = z
  .object({
    receiverPhone: z.string().optional(),
    ajkId: z.string().optional(),
    amount: positiveAmount,
    note: z.string().max(200).optional(),
  })
  .strip()
  .refine((d) => d.receiverPhone || d.ajkId, {
    message: "receiverPhone or ajkId is required",
  });

/* ── Location update ───────────────────────────────────────────────── */
export const LocationUpdateSchema = z
  .object({
    latitude: z
      .number()
      .min(-90, "Latitude must be between -90 and 90")
      .max(90, "Latitude must be between -90 and 90"),
    longitude: z
      .number()
      .min(-180, "Longitude must be between -180 and 180")
      .max(180, "Longitude must be between -180 and 180"),
    accuracy: z
      .number()
      .min(0, "Accuracy must be non-negative")
      .max(500, "Accuracy must not exceed 500 meters")
      .optional(),
    timestamp: z
      .number()
      .refine(
        (v) => v <= Date.now() + 5_000,
        "Timestamp cannot be more than 5 seconds in the future"
      )
      .optional(),
    heading: z.number().min(0).max(360).optional(),
    speed: z.number().min(0).optional(),
    batteryLevel: z.number().min(0).max(100).optional(),
  })
  .strip();

/* ── Product creation ──────────────────────────────────────────────── */
export const ProductCreateSchema = z
  .object({
    name: z.string().min(1, "Product name is required").max(200),
    description: z.string().max(2000).optional(),
    price: positiveAmount,
    categoryId: z.string().min(1, "categoryId is required"),
    stock: z.number().int().min(0, "Stock cannot be negative").default(0),
    unit: z.string().max(20).optional(),
    images: z.array(z.string().url()).max(10).optional(),
    isAvailable: z.boolean().default(true),
    discountPercent: z.number().min(0).max(100).optional(),
    minOrderQty: z.number().int().positive().optional(),
    maxOrderQty: z.number().int().positive().optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  })
  .strip();

/* ── Chat message ──────────────────────────────────────────────────── */
export const ChatMessageSchema = z
  .object({
    content: z
      .string()
      .min(1, "Message cannot be empty")
      .max(2000, "Message cannot exceed 2000 characters")
      .transform((s) => s.trim()),
    type: z.enum(["text", "image", "audio", "location"]).default("text"),
    replyToId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strip();

/* ── Cursor pagination query ───────────────────────────────────────── */
export const CursorPaginationSchema = z
  .object({
    limit: z
      .string()
      .optional()
      .transform((v) => Math.min(parseInt(v ?? "20", 10) || 20, 100)),
    after: z.string().optional(),
  })
  .strip();

/* ── Address ───────────────────────────────────────────────────────── */
export const AddressSchema = z
  .object({
    street: z.string().min(1, "Street is required").max(255),
    city: z.string().min(1, "City is required").max(80),
    province: z.string().max(80).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(60).optional(),
    latitude: z
      .number()
      .min(-90, "Latitude must be between -90 and 90")
      .max(90, "Latitude must be between -90 and 90")
      .optional(),
    longitude: z
      .number()
      .min(-180, "Longitude must be between -180 and 180")
      .max(180, "Longitude must be between -180 and 180")
      .optional(),
    label: z.string().max(50).optional(),
    isDefault: z.boolean().optional(),
  })
  .strip();

/* ── Cart item ─────────────────────────────────────────────────────── */
export const CartItemSchema = z
  .object({
    productId: z.string().min(1, "productId is required"),
    quantity: z
      .number()
      .int("Quantity must be an integer")
      .min(1, "Quantity must be at least 1")
      .max(99, "Quantity cannot exceed 99"),
    variantId: z.string().optional(),
    note: z.string().max(200).optional(),
  })
  .strip();

/* ── Create order (canonical export alias) ─────────────────────────── */
export const CreateOrderSchema = OrderCreateSchema;

/* ── Create product (canonical export alias) ───────────────────────── */
export const CreateProductSchema = ProductCreateSchema;

/* ── Update product ────────────────────────────────────────────────── */
export const UpdateProductSchema = z
  .object({
    name: z.string().min(1, "Product name is required").max(200).optional(),
    description: z.string().max(2000).optional(),
    price: z
      .union([z.number().positive(), z.string().min(1)])
      .transform((v) => parseFloat(String(v)))
      .refine((v) => !isNaN(v) && isFinite(v) && v > 0, "Price must be a positive number")
      .optional(),
    categoryId: z.string().min(1).optional(),
    stock: z.number().int().min(0, "Stock cannot be negative").optional(),
    unit: z.string().max(20).optional(),
    images: z.array(z.string().url()).max(10).optional(),
    isAvailable: z.boolean().optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    minOrderQty: z.number().int().positive().optional(),
    maxOrderQty: z.number().int().positive().optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  })
  .strip();

/* ── Review creation ───────────────────────────────────────────────── */
export const CreateReviewSchema = z
  .object({
    rating: z
      .number()
      .int("Rating must be an integer")
      .min(1, "Rating must be at least 1")
      .max(5, "Rating cannot exceed 5"),
    comment: z.string().max(1000, "Comment cannot exceed 1000 characters").optional(),
    orderId: z.string().optional(),
    productId: z.string().optional(),
    vendorId: z.string().optional(),
    riderId: z.string().optional(),
    images: z.array(z.string().url()).max(5).optional(),
  })
  .strip();

/* ── Parcel booking ────────────────────────────────────────────────── */
export const CreateParcelSchema = z
  .object({
    recipientName: z.string().min(1, "Recipient name is required").max(100),
    recipientPhone: PhoneSchema,
    recipientAddress: z.string().min(1, "Recipient address is required").max(500),
    senderAddress: z.string().min(1, "Sender address is required").max(500),
    weight: z
      .number()
      .positive("Weight must be a positive number")
      .max(100, "Weight cannot exceed 100 kg"),
    dimensions: z
      .object({
        length: z.number().positive().max(300),
        width: z.number().positive().max(300),
        height: z.number().positive().max(300),
      })
      .optional(),
    description: z.string().max(500).optional(),
    fragile: z.boolean().optional(),
    paymentMethod: z.enum(["cod", "wallet", "jazzcash", "easypaisa"]).default("cod"),
    declaredValue: z.number().min(0).optional(),
  })
  .strip();

/* ── Ride request ──────────────────────────────────────────────────── */
export const CreateRideSchema = z
  .object({
    pickupLat: z
      .number()
      .min(-90, "Pickup latitude must be between -90 and 90")
      .max(90, "Pickup latitude must be between -90 and 90"),
    pickupLng: z
      .number()
      .min(-180, "Pickup longitude must be between -180 and 180")
      .max(180, "Pickup longitude must be between -180 and 180"),
    dropoffLat: z
      .number()
      .min(-90, "Dropoff latitude must be between -90 and 90")
      .max(90, "Dropoff latitude must be between -90 and 90"),
    dropoffLng: z
      .number()
      .min(-180, "Dropoff longitude must be between -180 and 180")
      .max(180, "Dropoff longitude must be between -180 and 180"),
    pickupAddress: z.string().min(1, "Pickup address is required").max(500),
    dropoffAddress: z.string().min(1, "Dropoff address is required").max(500),
    rideType: z.enum(["bike", "car", "auto", "van"]),
    paymentMethod: z.enum(["cash", "wallet"]).default("cash"),
    note: z.string().max(300).optional(),
    scheduledAt: z.string().datetime().optional(),
  })
  .strip();

/* ── Push token registration ───────────────────────────────────────── */
export const PushTokenSchema = z
  .object({
    token: z.string().min(1, "Push token is required").max(512),
    platform: z.enum(["ios", "android", "web"]),
    deviceId: z.string().max(256).optional(),
    deviceName: z.string().max(100).optional(),
  })
  .strip();
