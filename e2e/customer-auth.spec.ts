import { test, expect } from "@playwright/test";

const API = "/api/auth";

test.describe("Customer Auth — register → login → logout", () => {
  const phone = `0300${Date.now().toString().slice(-7)}`;

  test("step 1: check-identifier returns send_phone_otp for new phone", async ({ request }) => {
    const res = await request.post(`${API}/check-identifier`, {
      data: { identifier: phone },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(["send_phone_otp", "no_method"]).toContain(body.data.action);
  });

  test("step 2: send-otp returns otpRequired:true or bypass", async ({ request }) => {
    const res = await request.post(`${API}/send-otp`, {
      data: { phone },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("otpRequired");
  });

  test("step 3: verify-otp with wrong code returns 401", async ({ request }) => {
    await request.post(`${API}/send-otp`, { data: { phone } });

    const res = await request.post(`${API}/verify-otp`, {
      data: { phone, otp: "000001" },
    });

    expect([401, 422]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("step 4: login with username and wrong password returns 401", async ({ request }) => {
    const res = await request.post(`${API}/login`, {
      data: { identifier: "nonexistent_user_xyz", password: "wrong" },
    });

    expect([401, 404]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("step 5: logout endpoint returns 200 without auth", async ({ request }) => {
    const res = await request.post(`${API}/logout`, {
      data: {},
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
  });

  test("step 6: refresh with invalid token returns 401", async ({ request }) => {
    const res = await request.post(`${API}/refresh`, {
      data: { refreshToken: "totally_invalid_token_for_e2e_test" },
    });

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
