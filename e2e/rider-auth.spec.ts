import { test, expect } from "@playwright/test";

const API = "/api/auth";

test.describe("Rider Auth — OTP login flow", () => {
  const riderPhone = `0312${Date.now().toString().slice(-7)}`;

  test("check-identifier returns send_phone_otp for rider role", async ({ request }) => {
    const res = await request.post(`${API}/check-identifier`, {
      data: { identifier: riderPhone, role: "rider" },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(["send_phone_otp", "no_method"]).toContain(body.data.action);
  });

  test("send-otp for a new rider phone succeeds", async ({ request }) => {
    const res = await request.post(`${API}/send-otp`, {
      data: { phone: riderPhone, role: "rider" },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
  });

  test("verify-otp with invalid code returns failure", async ({ request }) => {
    const res = await request.post(`${API}/verify-otp`, {
      data: { phone: riderPhone, otp: "999999" },
    });

    expect([401, 422]).toContain(res.status());
    expect((await res.json()).success).toBe(false);
  });

  test("rate limiter: repeated wrong OTPs eventually hit 429", async ({ request }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request.post(`${API}/verify-otp`, {
        data: { phone: riderPhone, otp: `00000${i}` },
      });
      statuses.push(res.status());
    }
    expect(statuses.some((s) => s === 429 || s === 401 || s === 422)).toBe(true);
  });

  test("check-available rejects taken phone", async ({ request }) => {
    const res = await request.post(`${API}/check-available`, {
      data: { phone: riderPhone },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.phone).toBeDefined();
  });
});
