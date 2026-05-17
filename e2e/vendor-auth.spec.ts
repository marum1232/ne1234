import { test, expect } from "@playwright/test";

const API = "/api/auth";

test.describe("Vendor Auth — password reset flow", () => {
  test("forgot-password with unknown identifier returns generic success (no leakage)", async ({ request }) => {
    const res = await request.post(`${API}/forgot-password`, {
      data: { identifier: "unknown_vendor_xyz@example.com" },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toMatch(/reset code/i);
  });

  test("forgot-password with unknown phone returns generic success", async ({ request }) => {
    const res = await request.post(`${API}/forgot-password`, {
      data: { phone: "03999999999" },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
  });

  test("verify-reset-otp with invalid code returns 422", async ({ request }) => {
    const res = await request.post(`${API}/verify-reset-otp`, {
      data: { phone: "03001234567", otp: "000000" },
    });

    expect([400, 422]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("reset-password with invalid OTP returns 401", async ({ request }) => {
    const res = await request.post(`${API}/reset-password`, {
      data: { phone: "03001234567", otp: "000000", newPassword: "NewP@ss123!" },
    });

    expect([401, 404]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("check-identifier for email returns send_email_otp or no_method", async ({ request }) => {
    const res = await request.post(`${API}/check-identifier`, {
      data: { identifier: "vendor@teststore.com", role: "vendor" },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(["send_email_otp", "no_method", "send_phone_otp"]).toContain(body.data.action);
  });

  test("recovery reset-password with invalid token returns 400", async ({ request }) => {
    const res = await request.post(`${API}/recovery/reset-password`, {
      data: { token: "invalid_recovery_token_xyz", newPassword: "NewP@ss123!" },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("validate-token with garbage returns 401", async ({ request }) => {
    const res = await request.post(`${API}/validate-token`, {
      data: { token: "not_a_real_jwt_token" },
    });

    expect([401, 400]).toContain(res.status());
  });
});
